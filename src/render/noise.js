// CPU gradient noise (seeded) for terrain heights, plus shared GLSL noise helpers.
import { makeRng } from '../engine/rng.js';

const GRADS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.70710678, 0.70710678],
  [-0.70710678, 0.70710678],
  [0.70710678, -0.70710678],
  [-0.70710678, -0.70710678],
];

export function makeNoise(seed) {
  const rnd = makeRng(seed ^ 0x9e3779b9);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function g(h, x, y) {
    const v = GRADS[h & 7];
    return v[0] * x + v[1] * y;
  }
  // gradient noise in about [-1, 1]
  function noise(x, y) {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const xf = x - X;
    const yf = y - Y;
    const xi = X & 255;
    const yi = Y & 255;
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = g(aa, xf, yf) + u * (g(ba, xf - 1, yf) - g(aa, xf, yf));
    const x2 = g(ab, xf, yf - 1) + u * (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.41;
  }
  function fbm(x, y, oct = 4, lac = 2.03, gain = 0.5) {
    let s = 0;
    let a = 0.5;
    let norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * noise(x, y);
      norm += a;
      x = x * lac + 17.13;
      y = y * lac + 9.71;
      a *= gain;
    }
    return s / norm;
  }
  function ridged(x, y, oct = 5) {
    let s = 0;
    let a = 0.5;
    let w = 1;
    let norm = 0;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(noise(x, y));
      n *= n;
      n *= w;
      w = Math.min(1, Math.max(0, n * 1.6));
      s += n * a;
      norm += a;
      x = x * 2.07 + 31.7;
      y = y * 2.07 + 11.3;
      a *= 0.52;
    }
    return s / norm;
  }
  return { noise, fbm, ridged };
}

// GLSL: hash / value noise / fbm used by terrain, water and cloud shaders.
export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm4(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.13, 9.71);
    a *= 0.5;
  }
  return s / 0.9375;
}
float fbm2(vec2 p) {
  return (vnoise(p) * 0.6667 + vnoise(p * 2.03 + vec2(17.13, 9.71)) * 0.3333);
}
float cloudField(vec2 p, float t) {
  vec2 q = p * 0.011 + vec2(t * 0.0045, t * 0.0021);
  float n = fbm4(q) * 0.7 + fbm4(q * 2.7 + 5.3) * 0.3;
  return n;
}
`;
