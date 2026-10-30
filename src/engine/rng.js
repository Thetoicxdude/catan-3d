// Seeded PRNG (xoshiro128**, 128-bit state). The state lives inside a plain object (holder.rng,
// four uint32) so the whole game state stays JSON-serializable and replays are deterministic.

function splitmix32(a) {
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedState(seed) {
  const sm = splitmix32(seed >>> 0);
  const s = [sm(), sm(), sm(), sm()];
  if (!(s[0] | s[1] | s[2] | s[3])) s[0] = 1;
  return s;
}

const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;

export function rngFloat(holder) {
  let s = holder.rng;
  if (typeof s === 'number') s = holder.rng = seedState(s); // older saves
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result / 4294967296;
}

export function rngInt(holder, lo, hi) {
  // inclusive range
  return lo + Math.floor(rngFloat(holder) * (hi - lo + 1));
}

export function shuffle(holder, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rngFloat(holder) * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}

export function randomState() {
  const a = new Uint32Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < 4; i++) a[i] = (Math.random() * 4294967296) >>> 0;
  const s = [a[0], a[1], a[2], a[3]];
  if (!(s[0] | s[1] | s[2] | s[3])) s[0] = 1;
  return s;
}

// Small standalone generator for non-authoritative randomness (AI noise, visuals).
export function makeRng(seed) {
  const h = { rng: seedState(seed >>> 0) };
  const f = () => rngFloat(h);
  f.int = (lo, hi) => rngInt(h, lo, hi);
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}
