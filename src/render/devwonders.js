// The wonders of the development mode, on the deserts (the design of record: Claude Docs「Hexverse：發展模式
// 美術設計」): each in its three stages while it goes up (1: the foundations and the first level with a
// treadwheel crane; 2: half built, wrapped in scaffolding; 3: only the top missing, scaffolding on the
// upper part), complete (the owner's flags and banners) and as the ruin a destroyed one leaves.
import * as THREE from 'three';
import { Model, TAU, rng } from './devkit.js';

// ── the wonders (on a desert; stage 1–3 while being built, 'done', 'ruin') ──

export const WONDER = {};

// 空中花園: three stepped terraces of sandstone with arcades along their fronts, gardens on every terrace
// (the map's own trees, ferns and bushes), vines hanging over the edges, a stair up the middle, a fall
// of water down one side into a pool, the owner's banners. While it goes up: the levels rise inside
// scaffolding with a treadwheel crane and blocks waiting; destroyed: broken arcades, the upper levels
// fallen into heaps of rubble, dead trees.
WONDER.gardens = (stage) => {
  const m = new Model();
  const rnd = rng(7);
  const ruin = stage === 'ruin';
  const done = stage === 'done';
  // levels standing whole, and the one going up (half)
  const whole = done || ruin ? 3 : stage - 1;
  const L = [
    { w: 5.2, d: 3.8, h: 0.95, z: 0.05, n: 7, ns: 5 },
    { w: 3.9, d: 2.7, h: 0.9, z: -0.42, n: 5, ns: 3 },
    { w: 2.6, d: 1.7, h: 0.85, z: -0.75, n: 3, ns: 2 },
  ];
  let y = 0.15;
  L.forEach((l) => {
    l.y = y;
    y += l.h;
  });
  const top = y;
  // the plinth (deep enough to sit on uneven sand)
  m.box('sand', 6.3, 1.3, 5.1, { y: -1.15, z: 0.2 }, 1.2);
  m.box('stone', 6.4, 0.06, 5.2, { y: 0.12, z: 0.2 }, 0.9);
  const level = (l, h, broken) => {
    const front = l.z + l.d / 2;
    if (broken) {
      // what is left: stumps of wall, arches with gaps, rubble where the rest fell
      const pieces = l.n;
      for (let k = 0; k < pieces; k++) {
        if (rnd() < 0.3) continue;
        const fx = -l.w / 2 + (l.w / pieces) * (k + 0.5);
        const hh = h * (0.35 + rnd() * 0.65);
        m.box('sand', l.w / pieces - 0.04, hh, l.d * (0.6 + rnd() * 0.4), { x: fx, y: l.y, z: l.z - rnd() * 0.2 }, 1.0);
      }
      return;
    }
    if (h < l.h * 0.99) {
      m.box('sand', l.w - 0.1, h, l.d - 0.1, { y: l.y, z: l.z }, 1.0);
      return;
    }
    // (the core stands back from the arcades, so their openings are dark)
    m.box('sand', l.w - 0.26, h, l.d - 0.26, { y: l.y, z: l.z }, 1.0);
    // arcades on the front and the sides, a coping round the top
    m.arcade('sand', l.w, h - 0.08, l.n, { y: l.y, z: front - 0.02 }, { depth: 0.1, open: 0.58, rise: 0.78, base: 0.08 });
    for (const sx of [-1, 1]) m.arcade('sand', l.d, h - 0.08, l.ns, { x: sx * (l.w / 2 - 0.02), y: l.y, z: l.z, ry: (sx * Math.PI) / 2 }, { depth: 0.1, open: 0.58, rise: 0.78, base: 0.08 });
    m.box('stone', l.w + 0.12, 0.08, l.d + 0.12, { y: l.y + h - 0.08, z: l.z }, 0.8);
    // planters on the parapet
    for (let k = 0; k < l.n + 1; k++) {
      const fx = -l.w / 2 + 0.12 + ((l.w - 0.24) * k) / l.n;
      m.box('stone', 0.16, 0.1, 0.16, { x: fx, y: l.y + h, z: front - 0.02 }, 0.5);
    }
  };
  if (!ruin) {
    L.forEach((l, i) => {
      if (i < whole) level(l, l.h, false);
      else if (i === whole && !done) level(l, l.h * 0.5, false);
    });
  } else {
    // destroyed: the first level stands in part, its arcade broken; chunks of the second lie on it, a
    // stump of the third; heaps of rubble against the walls; dead trees
    const l0 = L[0];
    const front = l0.z + l0.d / 2;
    m.box('sand', l0.w - 0.3, l0.h * 0.72, l0.d - 0.3, { y: l0.y, z: l0.z }, 1.0);
    const bays = l0.n;
    const bw = l0.w / bays;
    for (let k = 0; k < bays; k++) {
      if (k === 2 || k === 5) continue;
      const hh = l0.h * (0.55 + rnd() * 0.45);
      m.arcade('sand', bw, hh, 1, { x: -l0.w / 2 + bw * (k + 0.5), y: l0.y, z: front - 0.02 }, { depth: 0.1, open: 0.58, rise: Math.min(0.78, 0.7 * (l0.h / hh)), base: 0.08 });
    }
    for (const sx of [-1, 1]) m.box('sand', 0.12, l0.h * (0.5 + rnd() * 0.4), l0.d * 0.8, { x: sx * (l0.w / 2 - 0.08), y: l0.y, z: l0.z - 0.2 }, 1.0);
    const y1 = l0.y + l0.h * 0.72;
    for (const [x, z, w, d, h] of [[-1.1, -0.5, 1.2, 1.4, 0.55], [0.6, -0.8, 1.0, 1.1, 0.4], [1.5, 0.1, 0.6, 0.8, 0.3]]) m.box('sand', w, h, d, { x, y: y1, z, ry: (rnd() - 0.5) * 0.2 }, 1.0);
    m.box('sand', 0.8, 0.35, 0.7, { x: -1.0, y: y1 + 0.55, z: -0.6, ry: 0.15 }, 1.0);
    for (const [x, z, r, h] of [[2.3, 1.5, 1.0, 0.55], [-2.35, 1.3, 0.9, 0.5], [0.7, 2.3, 0.8, 0.32], [-0.9, -2.0, 1.1, 0.55], [1.8, -1.6, 0.8, 0.45]]) {
      m.lathe('sand', [[0, 0], [r, 0], [r * 0.7, h * 0.45], [r * 0.25, h * 0.9], [0, h]], 9, { x, y: 0.12, z, sx: 1.2 }, 0.8);
      for (let k = 0; k < 5; k++) {
        const a = rnd() * TAU;
        m.box('sand', 0.2 + rnd() * 0.15, 0.13 + rnd() * 0.1, 0.16 + rnd() * 0.1, { x: x + Math.cos(a) * r * 0.8, y: 0.12 + rnd() * h * 0.4, z: z + Math.sin(a) * r * 0.6, ry: rnd() * 3, rx: (rnd() - 0.5) * 0.6, rz: (rnd() - 0.5) * 0.6 }, 0.6);
      }
    }
    for (const [x, z, h] of [[-1.9, 0.9, 1.0], [1.0, 0.6, 0.75], [-0.2, -1.1, 0.9]]) {
      m.cyl('dark', 0.03, 0.05, h, 5, { x, y: y1, z, rz: (rnd() - 0.5) * 0.3 });
      for (let k = 0; k < 3; k++) m.cyl('dark', 0.012, 0.02, h * 0.45, 4, { x, y: y1 + h * (0.55 + k * 0.12), z, rz: (k % 2 ? 1 : -1) * (0.7 + rnd() * 0.3), ry: rnd() * 3 });
    }
    m.plant('rooibos_b', 2.6, 0.15, -1.7, 0.5).plant('rooibos_a', -2.75, 0.15, -0.7, 0.45).plant('rooibos_a', 0.4, y1, 0.9, 0.35);
  }
  // the stair up the middle of the front
  const stair = (l, flights) => {
    const steps = 7;
    for (let k = 0; k < steps; k++) {
      const runD = ((steps - k) * 0.55) / steps;
      m.box('stone', 0.8, l.h / steps, runD, { y: l.y + (k * l.h) / steps, z: l.z + l.d / 2 + runD / 2 }, 0.6);
    }
    for (const sx of [-1, 1]) m.box('stone', 0.08, 0.14, 0.62, { x: sx * 0.44, y: l.y + l.h * 0.5, z: l.z + l.d / 2 + 0.28, rx: 0.9 }, 0.5);
    return flights;
  };
  if (!ruin) for (let i = 0; i < Math.min(whole, 3); i++) stair(L[i]);
  else {
    // the stair broken: steps tumbled
    for (let k = 0; k < 6; k++) m.box('stone', 0.4 + rnd() * 0.3, 0.12, 0.25, { x: (rnd() - 0.5) * 0.9, y: 0.15 + rnd() * 0.3, z: 2.25 + rnd() * 0.3, ry: (rnd() - 0.5) * 0.8, rx: (rnd() - 0.5) * 0.5 }, 0.6);
  }
  if (done) {
    // the gardens: trees on the top, small trees and ferns on the terraces, bushes in the planters
    m.plant('broad_a', -0.55, top, -0.85, 2.0).plant('broad_b', 0.65, top, -0.95, 1.3).plant('fern_b', 0.0, top, -0.35, 0.45);
    // (green the whole way up: the rooibos of the desert is too dark for a garden)
    for (const [x, z] of [[-1.55, -0.65], [1.6, -0.55], [-1.2, 0.55], [1.25, 0.55]]) m.plant(rnd() < 0.5 ? 'broad_b' : 'fern_b', x, L[1].y + L[1].h, z, 0.75 + rnd() * 0.35);
    for (const [x, z] of [[-2.15, 0.9], [-1.5, 1.55], [1.5, 1.55], [2.2, 0.85], [-2.2, -1.2], [2.2, -1.25]]) m.plant(rnd() < 0.5 ? 'fern_b' : 'fern_c', x, L[0].y + L[0].h, z, 0.42 + rnd() * 0.2);
    L.forEach((l) => {
      const front = l.z + l.d / 2;
      for (let k = 0; k < l.n + 1; k++) m.dome('leaf', 0.1, 6, { x: -l.w / 2 + 0.12 + ((l.w - 0.24) * k) / l.n, y: l.y + l.h + 0.08, z: front - 0.02, sy: 0.9 });
      // vines over the parapet between the arches
      for (let k = 0; k <= l.n; k++) {
        if (rnd() < 0.25) continue;
        const fx = -l.w / 2 + (l.w * k) / l.n + (rnd() - 0.5) * 0.08;
        const hang = 0.25 + rnd() * 0.4;
        const g = new THREE.PlaneGeometry(0.14 + rnd() * 0.08, hang, 1, 3);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setX(i, p.getX(i) * (0.4 + rnd() * 0.5));
        g.translate(fx, l.y + l.h - hang / 2 - 0.02, front + 0.07);
        m.add('leaf', g);
      }
    });
    // the water: from the top down the right of the stair, terrace by terrace, into a pool
    const wx = 1.15;
    L.forEach((l) => m.box('water', 0.26, l.h + 0.02, 0.04, { x: wx, y: l.y, z: l.z + l.d / 2 + 0.07 }, 0.4));
    m.box('stone', 1.4, 0.16, 0.8, { x: wx + 0.35, y: 0.15, z: 2.35 }, 0.6);
    m.box('water', 1.26, 0.02, 0.66, { x: wx + 0.35, y: 0.3, z: 2.35 }, 0.6);
    // banners
    m.flag(-1.15, -1.45, 1.25, { y: top, w: 0.55, fh: 0.34 });
    m.flag(1.15, -1.45, 1.25, { y: top, w: 0.55, fh: 0.34 });
    m.flag(-2.45, 1.8, 1.6, { y: 0.15, w: 0.6, fh: 0.38 });
    m.flag(2.45, 1.8, 1.6, { y: 0.15, w: 0.6, fh: 0.38 });
  }
  if (!done && !ruin) {
    // going up: scaffolding round the level being built, the crane, blocks and a few ferns already in
    const l = L[whole];
    m.scaffold(-l.w / 2, l.w / 2, l.z - l.d / 2, l.z + l.d / 2, l.y, l.y + l.h * 0.5 + 0.3);
    m.crane(-2.6, 1.55, top * 0.6 + 1.6, { ry: -0.75, reach: 1.4, load: l.y + l.h * 0.55 });
    for (const [x, z, k] of [[2.35, 1.95, 5], [1.85, 2.3, 3], [-1.6, 2.35, 4]]) {
      for (let i = 0; i < k; i++) m.box('sand', 0.3, 0.17, 0.22, { x: x + (i % 3) * 0.31, y: Math.floor(i / 3) * 0.17 + 0.15, z: z + (rnd() - 0.5) * 0.05, ry: (rnd() - 0.5) * 0.15 }, 0.6);
    }
    if (whole >= 2) for (const [x, z] of [[-2.1, 1.2], [2.1, 1.2]]) m.plant('fern_c', x, L[0].y + L[0].h, z, 0.4);
  }
  return m;
};


// ── shared bits ──

// a statue standing on y: a robed figure in bronze, h high
function statue(m, x, y, z, h, { slot = 'copper', ry = 0, lie = false } = {}) {
  const prof = [[0, 0], [0.32, 0], [0.3, 0.1], [0.24, 0.45], [0.2, 0.62], [0.26, 0.7], [0.18, 0.78], [0.1, 0.8], [0.12, 0.88], [0.11, 0.97], [0, 1.0]].map(([r, v]) => [r * h * 0.5, v * h]);
  const t = lie ? { x, y: y + h * 0.16, z, rz: Math.PI / 2, ry } : { x, y, z, ry };
  m.lathe(slot, prof, 8, t, 0.3);
}

// an obelisk on its plinth: a tapering square shaft, a gilded tip (lying: toppled along x, in two)
function obelisk(m, x, z, h, { y = 0, lying = false, broken = false, ry = 0 } = {}) {
  const a = h * 0.085;
  const b = h * 0.055;
  if (!lying) {
    m.box('stone', a * 3.2, h * 0.16, a * 3.2, { x, y, z, ry }, 0.4);
    m.frustum('marble', 4, a, b, h, { x, y: y + h * 0.16, z, ry }, 0.5);
    m.cone('gold', b * 1.41, h * 0.1, 4, { x, y: y + h * 1.16, z, ry: ry + Math.PI / 4 });
    return;
  }
  // on its side (the base towards −x), resting on rollers; broken: in two, apart
  const parts = broken ? [[0, 0.55], [0.62, 1]] : [[0, 1]];
  parts.forEach(([f0, f1], i) => {
    const r0 = a - (a - b) * f0;
    const r1 = a - (a - b) * f1;
    const len = h * (f1 - f0);
    const off = broken ? i * 0.25 : 0;
    m.frustum('marble', 4, r0, r1, len, { x: x - h / 2 + h * f0 + off, y: y + a, z: z + (broken ? i * 0.12 : 0), rz: -Math.PI / 2, ry: ry + (broken ? i * 0.18 : 0) }, 0.5);
  });
  if (!broken) for (const f of [0.2, 0.75]) m.lying('wood', 0.05, a * 3, { x: x - h / 2 + h * f, y, z, ry: Math.PI / 2 }, 6);
}

// ── 大燈塔 ──
// On a podium with a stair, a tall square tier with rows of windows, a cornice with bronze tritons at
// its corners, an octagonal tier, a round lantern of columns and on top the brazier: its fire glows and
// smokes. Complete: the owner's banners down three faces and flags at the podium's corners. Going up:
// the tiers inside scaffolding, the crane growing with them. Destroyed: the square tier broken off half
// way, the octagon fallen beside it in two pieces, the brazier upturned, rubble and blocks everywhere.
WONDER.lighthouse = (stage) => {
  const m = new Model();
  const rnd = rng(13);
  const ruin = stage === 'ruin';
  const done = stage === 'done';
  m.box('sand', 4.6, 1.3, 4.6, { y: -1.1 }, 1.2);
  m.box('stone', 4.72, 0.07, 4.72, { y: 0.16 }, 0.9);
  const y0 = 0.23;
  for (let k = 0; k < 4; k++) m.box('stone', 1.5, y0 * (1 - k / 4), 0.24, { z: 2.36 + 0.12 + k * 0.24 }, 0.5);
  const T1 = { a: 1.2, b: 1.02, h: 2.4 };
  const T2 = { a: 0.82, b: 0.7, h: 1.55 };
  const yC = y0 + T1.h;
  const y2 = yC + 0.12;
  const y3 = y2 + T2.h + 0.1;
  const half = (A, h) => A.a - ((A.a - A.b) * h) / A.h;
  const windows = (A, ybase, h, faces, spacing, xs) => {
    for (let y = ybase + 0.35; y < ybase + h - 0.25; y += spacing) {
      const a = half(A, y - ybase) + 0.006;
      for (const ang of faces) for (const dx of xs) m.box('dark', 0.1, 0.24, 0.02, { x: Math.sin(ang) * a + Math.cos(ang) * dx, y, z: Math.cos(ang) * a - Math.sin(ang) * dx, ry: ang });
    }
  };
  const tier1 = (h) => {
    m.frustum('stone', 4, T1.a, half(T1, h), h, { y: y0 }, 0.9);
    windows(T1, y0, h, [0, Math.PI / 2, Math.PI, -Math.PI / 2], 0.55, [-0.4, 0.4]);
    m.box('dark', 0.36, 0.62, 0.02, { y: y0, z: T1.a + 0.004 });
  };
  const tier2 = (h) => {
    m.frustum('stone', 8, T2.a, half(T2, h), h, { y: y2 }, 0.8);
    windows(T2, y2, h, [0, Math.PI / 2, Math.PI, -Math.PI / 2], 0.5, [0]);
  };
  const cornice = () => {
    m.box('stone', 2.3, 0.12, 2.3, { y: yC }, 0.6);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) statue(m, sx * 1.02, yC + 0.12, sz * 1.02, 0.42, { ry: Math.atan2(sx, sz) });
  };
  const lantern = (full) => {
    m.cyl('stone', 0.92, 0.92, 0.1, 8, { y: y3 - 0.1 }, 0.5);
    m.cyl('stone', 0.3, 0.32, 0.62, 10, { y: y3 }, 0.5);
    if (!full) return;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      m.column('marble', Math.cos(a) * 0.48, Math.sin(a) * 0.48, y3, 0.62, 0.045);
    }
    m.cyl('stone', 0.6, 0.6, 0.08, 12, { y: y3 + 0.62 }, 0.5);
    m.lathe('metal', [[0, 0], [0.12, 0], [0.16, 0.06], [0.32, 0.18], [0.34, 0.22], [0, 0.18]], 12, { y: y3 + 0.7 }, 0.3);
    m.flame(0, y3 + 0.86, 0, 0.24, 0.55);
  };
  const S = done ? 4 : ruin ? 0 : stage;
  if (S === 1) tier1(T1.h * 0.45);
  if (S >= 2) {
    tier1(T1.h);
    cornice();
  }
  if (S === 2) tier2(T2.h * 0.5);
  if (S >= 3) tier2(T2.h);
  if (S === 3) lantern(false);
  if (S === 4) lantern(true);
  if (done) {
    for (const ang of [0, Math.PI / 2, -Math.PI / 2]) {
      const a = half(T1, T1.h * 0.62) + 0.016;
      m.plane('cloth', 0.46, 1.3, { x: Math.sin(ang) * a, y: y0 + T1.h * 0.62, z: Math.cos(ang) * a, ry: ang, rx: -0.075 });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.flag(sx * 2.08, sz * 2.08, 1.35, { y: y0, w: 0.5, fh: 0.32, ry: sx > 0 ? Math.PI : 0 });
  }
  if (S >= 1 && S <= 3) {
    // the works: scaffolding round what is going up, the crane beside it, blocks waiting
    if (S === 1) m.scaffold(-T1.a, T1.a, -T1.a, T1.a, y0, y0 + T1.h * 0.45 + 0.25);
    if (S === 2) {
      m.scaffold(-T1.a, T1.a, -T1.a, T1.a, y0, yC);
      m.scaffold(-T2.a, T2.a, -T2.a, T2.a, y2, y2 + T2.h * 0.5 + 0.3, { out: 0.12 });
    }
    if (S === 3) m.scaffold(-T2.a, T2.a, -T2.a, T2.a, y2 + T2.h * 0.4, y3 + 0.7, { out: 0.12 });
    const ch = [0, 2.0, 3.4, 4.6][S];
    m.crane(-2.85, 1.7, ch, { ry: -0.7, reach: 1.5, load: [0, 1.4, 3.0, 4.3][S] });
    m.blocks('stone', 1.4, y0, 1.55, 5, rnd, { ry: 0.1 });
    m.blocks('stone', -1.85, y0, -1.6, 4, rnd, { ry: -0.3 });
    m.blocks('sand', 2.5, 0, -1.2, 6, rnd, { ry: 1.2 });
  }
  if (ruin) {
    // the square tier broken off: the shaft to 1.3, a jagged edge of blocks over it
    const hb = 1.3;
    m.frustum('stone', 4, T1.a, half(T1, hb), hb, { y: y0 }, 0.9);
    windows(T1, y0, hb, [0, Math.PI / 2, Math.PI, -Math.PI / 2], 0.55, [-0.4, 0.4]);
    m.box('dark', 0.36, 0.62, 0.02, { y: y0, z: T1.a + 0.004 });
    const ae = half(T1, hb);
    for (let k = 0; k < 9; k++) {
      const f = (k / 8) * 2 - 1;
      for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        if (rnd() < 0.35) continue;
        const hh = 0.12 + rnd() * 0.5;
        m.box('stone', 0.24, hh, 0.22, { x: Math.sin(ang) * (ae - 0.11) + Math.cos(ang) * f * (ae - 0.12), y: y0 + hb, z: Math.cos(ang) * (ae - 0.11) - Math.sin(ang) * f * (ae - 0.12), ry: ang }, 0.5);
      }
    }
    // the octagon on its side in two pieces, the brazier upturned
    m.frustum('stone', 8, T2.a, half(T2, 0.95), 0.95, { x: 3.15, y: T2.a, z: 0.9, rz: Math.PI / 2, ry: 0.35 }, 0.8);
    m.frustum('stone', 8, half(T2, 1.05), T2.b, 0.5, { x: 2.3, y: T2.a - 0.08, z: 2.3, rz: Math.PI / 2 + 0.15, ry: 1.2 }, 0.8);
    m.lathe('metal', [[0, 0], [0.12, 0], [0.16, 0.06], [0.32, 0.18], [0.34, 0.22], [0, 0.18]], 12, { x: -2.7, y: 0.2, z: 1.5, rx: Math.PI }, 0.3);
    for (const [x, z, r, h] of [[1.75, -0.4, 0.75, 0.55], [-1.75, 0.6, 0.85, 0.6], [0.4, -1.8, 0.8, 0.5], [-0.6, 1.8, 0.6, 0.4], [2.7, -1.7, 0.6, 0.4]]) m.rubble('stone', x, z, r, h, rnd, { y: y0 - 0.05, n: 5 });
    statue(m, -2.6, 0, -1.9, 0.42, { lie: true, ry: 0.7 });
  }
  return m;
};

// ── 長城 ──
// A crenellated wall winding across the desert, its walk edged on both sides, three square beacon
// towers at its turns and bastions at its ends; complete, beacon fires burn on the towers under the
// owner's flags. Going up: foundations laid along the whole line, the wall rising run by run, a tower in
// scaffolding, the crane moving along with the work. Destroyed: the runs broken into pieces with gaps,
// the towers fallen to stumps and heaps.
WONDER.greatWall = (stage) => {
  const m = new Model();
  const rnd = rng(17);
  const ruin = stage === 'ruin';
  const done = stage === 'done';
  const P = [[-3.1, 0.95], [-1.65, -0.6], [0.0, 0.55], [1.65, -0.75], [3.1, 0.4]];
  const H = 0.62;
  const T = 0.46;
  const S = done ? 4 : ruin ? 0 : stage;
  const lerp = (i, f) => [P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f];
  const run = (i, f0, f1, h) => {
    const [x0, z0] = lerp(i, f0);
    const [x1, z1] = lerp(i, f1);
    m.wallRun('stone', x0, z0, x1, z1, { h, t: T, merlon: 0.12, sink: 0.75 });
  };
  const tower = (k, h, fire) => {
    const [x, z] = P[k];
    m.box('stone', 0.92, h + 0.5, 0.92, { x, z, y: -0.7 }, 0.6);
    m.box('stone', 1.0, 0.08, 1.0, { x, z, y: h - 0.28 }, 0.5);
    const yt = h - 0.2;
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) m.crenels('stone', x + ax * 0.46, z + az * 0.46, x + bx * 0.46, z + bz * 0.46, yt, { h: 0.13, w: 0.13, t: 0.08, gap: 0.1 });
    for (const ang of [0, Math.PI]) m.box('dark', 0.16, 0.3, 0.02, { x: x + Math.sin(ang) * 0.465, y: H - 0.05, z: z + Math.cos(ang) * 0.465, ry: ang });
    if (fire) {
      m.box('stone', 0.26, 0.3, 0.26, { x, z, y: yt }, 0.4);
      m.flame(x, yt + 0.3, z, 0.11, 0.3);
      m.flag(x + 0.32, z - 0.32, 0.9, { y: yt, w: 0.4, fh: 0.25 });
    }
  };
  const bastion = (k) => {
    const [x, z] = P[k];
    m.box('stone', 0.6, H + 0.1 + 0.75, 0.6, { x, z, y: -0.75 }, 0.5);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) m.crenels('stone', x + ax * 0.3, z + az * 0.3, x + bx * 0.3, z + bz * 0.3, H + 0.1, { h: 0.12, w: 0.12, t: 0.07, gap: 0.09 });
  };
  if (!ruin) {
    // foundations along the whole line
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = P[i];
      const [x1, z1] = P[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      m.box('sand', len + 0.3, 0.82, T + 0.2, { x: (x0 + x1) / 2, y: -0.7, z: (z0 + z1) / 2, ry: -Math.atan2(z1 - z0, x1 - x0) }, 0.8);
    }
    const runsFull = { 1: 1, 2: 2, 3: 3, 4: 4 }[S];
    for (let i = 0; i < 4; i++) {
      if (i < runsFull) run(i, 0, 1, H);
      else if (i === runsFull) run(i, 0, 0.6, H * 0.45);
    }
    if (S >= 1) bastion(0);
    if (S === 4) bastion(4);
    for (let k = 1; k <= 3; k++) {
      if (k < S) tower(k, 1.3, S === 4);
      else if (k === S) tower(k, S === 4 ? 1.3 : 0.75, S === 4);
    }
    if (S <= 3) {
      const [tx, tz] = P[S];
      m.scaffold(tx - 0.46, tx + 0.46, tz - 0.46, tz + 0.46, 0, 1.0, { out: 0.12 });
      const [cx, cz] = lerp(Math.min(S, 3), 0.55);
      m.crane(cx + 0.2, cz + 1.25, 1.9, { ry: -1.2, reach: 1.1, load: 0.75 });
      m.blocks('stone', cx - 0.9, 0, cz + 0.85, 6, rnd, { ry: 0.2 });
      m.blocks('stone', tx + 0.7, 0, tz - 1.0, 4, rnd, { ry: -0.4 });
    }
  } else {
    // broken runs: pieces with gaps, jagged heights
    for (let i = 0; i < 4; i++) {
      const cuts = [0, 0.3, 0.38, 0.62, 0.72, 1];
      for (let k = 0; k < cuts.length - 1; k += 2) {
        if (rnd() < 0.2) continue;
        const h = H * (0.35 + rnd() * 0.65);
        const [x0, z0] = lerp(i, cuts[k]);
        const [x1, z1] = lerp(i, cuts[k + 1]);
        m.wallRun('stone', x0, z0, x1, z1, { h, t: T, merlon: 0.12, sink: 0.75, crenel: rnd() < 0.5 });
      }
      const [gx, gz] = lerp(i, 0.34);
      m.rubble('stone', gx, gz, 0.42, 0.28, rnd, { n: 4 });
      const [hx, hz] = lerp(i, 0.67);
      m.rubble('stone', hx, hz, 0.36, 0.22, rnd, { n: 3 });
    }
    // the towers: a stump, a broken half, a heap
    m.box('stone', 0.92, 1.05, 0.92, { x: P[1][0], z: P[1][1], y: -0.7 }, 0.6);
    m.rubble('stone', P[1][0] + 0.55, P[1][1] + 0.4, 0.5, 0.35, rnd, { n: 4 });
    m.box('stone', 0.92, 1.45, 0.5, { x: P[2][0], z: P[2][1] - 0.21, y: -0.7 }, 0.6);
    m.rubble('stone', P[2][0], P[2][1] + 0.45, 0.62, 0.45, rnd, { n: 6 });
    m.rubble('stone', P[3][0], P[3][1], 0.72, 0.6, rnd, { n: 7 });
    bastion(0);
  }
  return m;
};

// ── 皇家大道 ──
// A paved avenue running through a triumphal arch of three openings (engaged columns, a gilded
// inscription on the attic, a bronze statue on top, the owner's banners hanging from it), obelisks and
// statues on plinths along both sides, trees. Going up: the avenue laid half, the arch's piers, then its
// body in scaffolding with the obelisks lying on rollers, then the attic. Destroyed: one side of the arch
// standing, the other a stump, the attic fallen in blocks, the paving cracked and tilted, an obelisk
// toppled and broken, a statue down.
WONDER.royalRoad = (stage) => {
  const m = new Model();
  const rnd = rng(19);
  const ruin = stage === 'ruin';
  const done = stage === 'done';
  const S = done ? 4 : ruin ? 0 : stage;
  const W = 2.7;
  const BH = 2.0;
  const D = 0.9;
  const LEN = 6.2;
  // the bed of the avenue and its paving
  m.box('sand', 1.75, 0.75, LEN + 0.2, { y: -0.71 }, 0.8);
  const pave = (z0, z1) => {
    m.box('street', 1.5, 0.06, z1 - z0, { z: (z0 + z1) / 2 }, 0.6);
    for (const sx of [-1, 1]) m.box('stone', 0.12, 0.1, z1 - z0, { x: sx * 0.81, z: (z0 + z1) / 2 }, 0.5);
  };
  if (!ruin) pave(-LEN / 2, S === 1 ? 0.2 : LEN / 2);
  else {
    // cracked slabs, tilted, some gone
    for (let k = 0; k < 9; k++) {
      for (const sx of [-1, 1]) {
        if (rnd() < 0.2) continue;
        m.box('street', 0.7, 0.06, 0.62, { x: sx * 0.37 + (rnd() - 0.5) * 0.05, y: -0.02, z: -LEN / 2 + 0.35 + k * 0.69, ry: (rnd() - 0.5) * 0.2, rx: (rnd() - 0.5) * 0.12, rz: (rnd() - 0.5) * 0.12 }, 0.6);
      }
    }
  }
  // the arch: one shape with three openings, extruded through
  const archShape = (top) => {
    const sh = new THREE.Shape();
    sh.moveTo(-W / 2, 0);
    sh.lineTo(W / 2, 0);
    sh.lineTo(W / 2, top);
    sh.lineTo(-W / 2, top);
    sh.closePath();
    for (const [cx, w, spring] of [[0, 0.9, 1.0], [-0.92, 0.42, 0.6], [0.92, 0.42, 0.6]]) {
      const hole = new THREE.Path();
      hole.moveTo(cx - w / 2, 0);
      hole.lineTo(cx + w / 2, 0);
      hole.lineTo(cx + w / 2, spring);
      hole.absarc(cx, spring, w / 2, 0, Math.PI, false);
      hole.lineTo(cx - w / 2, 0);
      sh.holes.push(hole);
    }
    return sh;
  };
  const piers = [[-1.24, 0.22], [-0.58, 0.26], [0.58, 0.26], [1.24, 0.22]];
  const columns = (h) => {
    for (const z of [-D / 2 - 0.06, D / 2 + 0.06]) for (const x of [-1.24, -0.58, 0.58, 1.24]) m.column('marble', x, z, 0, h, 0.075);
  };
  if (S === 1) for (const [x, w] of piers) m.box('stone', w, 0.55, D, { x }, 0.5);
  if (S >= 2) {
    m.extrude('stone', archShape(BH), D, {}, 0.6);
    columns(BH - 0.05);
    m.box('stone', W + 0.2, 0.1, D + 0.18, { y: BH - 0.05 }, 0.5);
  }
  if (S === 3) m.box('stone', W + 0.05, 0.28, D + 0.05, { y: BH + 0.05 }, 0.6);
  if (S === 4) {
    m.box('stone', W + 0.05, 0.56, D + 0.05, { y: BH + 0.05 }, 0.6);
    m.box('stone', W + 0.15, 0.06, D + 0.15, { y: BH + 0.6 }, 0.5);
    for (const z of [-1, 1]) m.box('gold', 1.15, 0.28, 0.02, { y: BH + 0.18, z: z * (D / 2 + 0.035) });
    m.box('stone', 0.5, 0.18, 0.4, { y: BH + 0.66 }, 0.4);
    statue(m, 0, BH + 0.84, 0, 0.62);
    for (const sx of [-1, 1]) {
      statue(m, sx * 1.15, BH + 0.66, 0, 0.36);
      m.plane('cloth', 0.34, 0.95, { x: sx * 0.92, y: BH + 0.08 - 0.48, z: D / 2 + 0.03 });
      m.plane('cloth', 0.34, 0.95, { x: sx * 0.92, y: BH + 0.08 - 0.48, z: -D / 2 - 0.03, ry: Math.PI });
    }
  }
  // obelisks and statues along the avenue
  const obX = 1.3;
  for (const sx of [-1, 1]) {
    for (const z of [-2.35, 2.35]) {
      if (S === 1) continue;
      if (S === 2) {
        if (z < 0) obelisk(m, sx * (obX + 0.5), z + 0.2, 1.7, { lying: true, ry: Math.PI / 2 });
        else m.box('stone', 0.46, 0.27, 0.46, { x: sx * obX, z }, 0.4);
      } else if (S >= 3) obelisk(m, sx * obX, z, 1.7);
    }
    for (const z of [-1.2, 1.2]) {
      if (S >= 3) m.box('stone', 0.36, 0.48, 0.36, { x: sx * obX, z }, 0.4);
      if (S === 4) statue(m, sx * obX, 0.48, z, 0.55, { ry: sx > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
  if (done) {
    for (const sx of [-1, 1]) for (const z of [-1.75, 1.75]) m.plant('broad_b', sx * 2.05, 0, z, 1.05);
    for (const sx of [-1, 1]) m.flag(sx * (W / 2 - 0.1), 0, 0.85, { y: BH + 0.62, w: 0.42, fh: 0.27, ry: sx > 0 ? Math.PI : 0 });
  }
  if (S >= 1 && S <= 3) {
    if (S === 2) m.scaffold(-W / 2, W / 2, -D / 2, D / 2, 0, BH, { out: 0.2 });
    if (S === 3) m.scaffold(-W / 2, W / 2, -D / 2, D / 2, BH - 0.6, BH + 0.5, { out: 0.2 });
    m.crane(-2.45, -1.1, [0, 1.8, 2.8, 3.2][S], { ry: 0.6, reach: 1.4, load: [0, 0.8, 1.6, 2.2][S] });
    m.blocks('stone', 2.05, 0, 0.6, 6, rnd, { ry: Math.PI / 2 });
    m.blocks('street', -2.3, 0, 1.7, 5, rnd, { ry: 0.3, h: 0.08, w: 0.32, d: 0.3 });
  }
  if (ruin) {
    // the left side of the arch stands to a broken edge; the right is a stump
    const sh = new THREE.Shape();
    sh.moveTo(-W / 2, 0);
    sh.lineTo(-0.45, 0);
    sh.lineTo(-0.45, 1.05);
    sh.lineTo(-0.56, 1.42);
    sh.lineTo(-0.8, 1.36);
    sh.lineTo(-0.98, 1.78);
    sh.lineTo(-1.18, 1.66);
    sh.lineTo(-W / 2, 1.72);
    sh.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-1.13, 0);
    hole.lineTo(-0.71, 0);
    hole.lineTo(-0.71, 0.6);
    hole.absarc(-0.92, 0.6, 0.21, 0, Math.PI, false);
    hole.lineTo(-1.13, 0);
    sh.holes.push(hole);
    m.extrude('stone', sh, D, {}, 0.6);
    for (const z of [-D / 2 - 0.06, D / 2 + 0.06]) {
      m.column('marble', -1.24, z, 0, 1.5, 0.075, { capital: false });
      m.column('marble', -0.58, z, 0, 1.0, 0.075, { capital: false });
    }
    m.box('stone', 0.22, 0.45, D, { x: 1.24 }, 0.5);
    m.box('stone', 0.26, 0.28, D, { x: 0.58 }, 0.5);
    // the attic in blocks on the ground, rubble, an obelisk down, a statue fallen
    m.box('stone', 1.1, 0.55, 0.9, { x: 1.1, z: 1.25, ry: 0.4, rz: 0.12 }, 0.6);
    m.box('stone', 0.8, 0.5, 0.85, { x: 1.9, z: -0.4, ry: -0.3, rx: 0.15 }, 0.6);
    m.box('gold', 0.6, 0.26, 0.02, { x: 1.1, y: 0.18, z: 1.25 + 0.47, ry: 0.4, rz: 0.12 });
    for (const [x, z, r, h] of [[0.7, 0.0, 0.7, 0.5], [-0.25, -1.4, 0.5, 0.32], [2.3, 1.9, 0.55, 0.36], [-2.1, 0.8, 0.5, 0.3]]) m.rubble('stone', x, z, r, h, rnd, { n: 5 });
    obelisk(m, -obX, -2.35, 1.7);
    m.box('stone', 0.46, 0.27, 0.46, { x: obX, z: -2.35 }, 0.4);
    obelisk(m, obX + 1.0, -1.9, 1.7, { lying: true, broken: true, ry: 0.25 });
    obelisk(m, -obX, 2.35, 1.7);
    m.box('stone', 0.36, 0.48, 0.36, { x: -obX, z: 1.2 }, 0.4);
    statue(m, -obX, 0.48, 1.2, 0.55, { ry: Math.PI / 2 });
    m.box('stone', 0.36, 0.3, 0.36, { x: obX, z: 1.2 }, 0.4);
    statue(m, obX + 0.45, 0, 1.6, 0.55, { lie: true, ry: 2.2 });
    m.plant('rooibos_a', -2.2, 0, -1.9, 0.45).plant('rooibos_b', 2.4, 0, 2.6, 0.4);
  }
  return m;
};

// ── 大圖書館 ──
// A temple of learning on a high podium: a grand stair, a colonnade all round, a roof in the owner's
// tiles with a pediment at the front, a drum rising through it under a copper dome and its lantern;
// bronze statues by the stair, banners between the front columns, a garden of trees at its sides.
// Going up: the podium and the drums of the columns, then the colonnade and the walls in scaffolding,
// then the roof and the drum. Destroyed: columns broken off or fallen in drums, the walls in stumps, the
// dome cracked open on the ground beside it.
WONDER.library = (stage) => {
  const m = new Model();
  const rnd = rng(29);
  const ruin = stage === 'ruin';
  const done = stage === 'done';
  const S = done ? 4 : ruin ? 0 : stage;
  const PW = 4.8;
  const PD = 3.8;
  const PH = 0.7;
  m.box('stone', PW, PH + 0.8, PD, { y: -0.8 }, 0.9);
  m.box('stone', PW + 0.1, 0.06, PD + 0.1, { y: PH - 0.04 }, 0.8);
  const steps = 6;
  for (let k = 0; k < steps; k++) {
    if (ruin && rnd() < 0.3) continue;
    const h = PH * (1 - k / steps);
    m.box('stone', 2.6 + (ruin ? (rnd() - 0.5) * 0.4 : 0), h, 0.2, { z: PD / 2 + 0.1 + k * 0.2, ry: ruin ? (rnd() - 0.5) * 0.06 : 0 }, 0.5);
  }
  for (const sx of [-1, 1]) m.box('stone', 0.28, PH + 0.12, steps * 0.2, { x: sx * 1.44, z: PD / 2 + (steps * 0.2) / 2 }, 0.5);
  // the columns: front and back rows of eight, five more along each side
  const CH = 1.45;
  const CR = 0.11;
  const cols = [];
  for (let i = 0; i < 8; i++) for (const z of [-1.62, 1.62]) cols.push([-2.1 + i * 0.6, z]);
  for (const x of [-2.1, 2.1]) for (let i = 0; i < 5; i++) cols.push([x, -1.08 + i * 0.54]);
  const yT = PH + CH;
  const cella = (h) => {
    m.box('stone', 3.3, h, 2.5, { y: PH }, 0.7);
    if (h > 0.6) m.box('dark', 0.5, Math.min(0.85, h - 0.1), 0.02, { y: PH, z: 1.251 });
  };
  if (S === 1) {
    for (const [x, z] of cols) m.column('marble', x, z, PH, 0.32, CR, { capital: false });
    cella(0.22);
  }
  if (S >= 2) {
    for (const [x, z] of cols) m.column('marble', x, z, PH, CH, CR);
    cella(CH);
  }
  if (S >= 3) {
    m.box('stone', 4.5, 0.26, 3.5, { y: yT }, 0.7);
    m.box('stone', 4.62, 0.05, 3.62, { y: yT + 0.26 }, 0.6);
    m.gable('roof', 3.62, 4.62, 0.62, { y: yT + 0.31, ry: Math.PI / 2 }, 0.45, 0.04);
    m.gableEnds('stone', 3.5, 4.5, 0.58, { y: yT + 0.31, ry: Math.PI / 2 });
    m.cyl('stone', 0.86, 0.9, 0.95, 18, { y: yT + 0.31 }, 0.7);
    m.cyl('stone', 0.96, 0.96, 0.06, 18, { y: yT + 1.26 }, 0.5);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.2;
      m.box('dark', 0.1, 0.24, 0.02, { x: Math.sin(a) * 0.885, y: yT + 0.72, z: Math.cos(a) * 0.885, ry: a });
    }
  }
  if (S === 4) {
    m.dome('copper', 0.92, 20, { y: yT + 1.32 }, 1, 0.6);
    m.cyl('marble', 0.13, 0.15, 0.32, 10, { y: yT + 2.2 }, 0.3);
    m.cone('copper', 0.17, 0.18, 10, { y: yT + 2.52 });
    m.lathe('gold', [[0, 0], [0.04, 0], [0.05, 0.06], [0, 0.14]], 8, { y: yT + 2.68 }, 0.2);
    for (const sx of [-1, 1]) {
      m.box('stone', 0.36, 0.4, 0.36, { x: sx * 1.82, z: PD / 2 + 0.55 }, 0.4);
      statue(m, sx * 1.82, 0.4, PD / 2 + 0.55, 0.6, { ry: 0 });
      m.plane('cloth', 0.38, 0.95, { x: sx * 1.5, y: yT - 0.5, z: 1.62 + 0.02 });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.flag(sx * 2.3, sz * 1.75, 1.2, { y: PH, w: 0.44, fh: 0.28, ry: sx > 0 ? Math.PI : 0 });
    m.plant('broad_b', -3.0, 0, 0.4, 1.25).plant('broad_a', 3.05, 0, -0.5, 1.6).plant('broad_b', 3.0, 0, 1.2, 1.0).plant('fern_b', -2.95, 0, -1.2, 0.5).plant('fern_c', -2.9, 0, 1.5, 0.45);
  }
  if (S >= 1 && S <= 3) {
    if (S === 2) m.scaffold(-2.25, 2.25, -1.78, 1.78, PH, yT, { out: 0.12 });
    if (S === 3) m.scaffold(-0.95, 0.95, -0.95, 0.95, yT + 0.31, yT + 1.4, { out: 0.12 });
    m.crane(-3.15, 1.85, [0, 2.1, 2.9, 3.8][S], { ry: -0.6, reach: 1.5, load: [0, 1.0, 1.9, 2.8][S] });
    m.blocks('marble', 2.85, 0, 1.6, 6, rnd, { ry: 1.4, w: 0.28, h: 0.2, d: 0.28 });
    m.blocks('stone', 2.8, 0, -1.4, 5, rnd, { ry: 1.7 });
    if (S === 1) for (const [x, z] of [[-2.9, -0.5], [-2.75, 0.4]]) m.lying('marble', CR, 0.5, { x, z, ry: 0.4 }, 10);
  }
  if (ruin) {
    // what is left of the colonnade: some columns broken off, drums of the others lying about
    for (const [x, z] of cols) {
      const r = rnd();
      if (r < 0.42) m.column('marble', x, z, PH, CH * (0.3 + rnd() * 0.7), CR, { capital: false });
      else if (r < 0.75) {
        m.column('marble', x, z, PH, 0.2 + rnd() * 0.15, CR, { capital: false });
        const a = rnd() * TAU;
        const d = 0.35 + rnd() * 0.3;
        const fx = x + Math.cos(a) * d;
        const fz = z + Math.sin(a) * d;
        const off = Math.abs(fx) > PW / 2 - 0.1 || Math.abs(fz) > PD / 2 - 0.1;
        m.lying('marble', CR, 0.32 + rnd() * 0.25, { x: fx, y: off ? 0 : PH, z: fz, ry: rnd() * 3 }, 10);
      }
    }
    // the walls in stumps
    for (const [x, z, w, d] of [[-1.3, 0, 0.18, 2.4], [1.3, 0.3, 0.18, 1.6], [-0.6, -1.2, 1.4, 0.18], [0.9, -1.2, 0.8, 0.18]]) m.box('stone', w, 0.3 + rnd() * 0.75, d, { x, y: PH, z }, 0.7);
    // the dome cracked open on the ground beside the podium
    const g = new THREE.SphereGeometry(0.92, 18, 8, 0, Math.PI * 1.25, 0, Math.PI / 2);
    m.add('copper', g, { x: -3.0, y: 0.25, z: -0.6, rx: 0.5, rz: 0.35, ry: 0.8 });
    for (const [x, z, r, h] of [[1.2, 0.6, 0.6, 0.4], [-0.4, -0.3, 0.7, 0.45], [2.7, 1.6, 0.6, 0.4], [-2.5, 1.7, 0.55, 0.35]]) m.rubble('stone', x, z, r, h, rnd, { y: Math.abs(x) < PW / 2 && Math.abs(z) < PD / 2 ? PH : 0, n: 4 });
    m.plant('rooibos_a', 3.0, 0, -1.6, 0.45).plant('rooibos_b', -2.8, 0, 2.2, 0.4);
  }
  return m;
};
