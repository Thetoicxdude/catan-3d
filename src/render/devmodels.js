// The development mode's models (the design of record: Claude Docs「卡坦島：發展模式美術設計」,
// https://claude.ai/artifact/7XW87u6o6g7CfbaE2iFWbX): the special buildings beside the settlements and the
// development facilities on the hexes (the wonders on the deserts are in devwonders.js), built with the
// kit in devkit.js. Each has an outline of its own (arches, a cylinder under a cone, striped awnings, a
// ship's ribs…) so it reads from the map's camera; the owner's colour is on the roofs and the cloth.
import * as THREE from 'three';
import { Model, TAU, rng, rough, house, haystack } from './devkit.js';
import { WONDER } from './devwonders.js';

export { Model };

// ── the special buildings (beside a settlement; front towards +z, the settlement behind at −z) ──

const BUILD = {};

// 糧倉: a round stone silo with a thatched cone (a band of the owner's colour under it), a smaller one,
// sacks of grain at the door
BUILD.granary = () => {
  const m = new Model();
  const silo = (x, z, r, h, s = 1) => {
    m.lathe('stone', [[0, 0], [r + 0.04, 0], [r + 0.04, 0.07], [r, 0.09], [r * 0.97, h], [0, h]], 18, { x, z }, 0.55);
    m.lathe('thatch', [[0, h - 0.02], [r + 0.1, h - 0.02], [r + 0.06, h + 0.05], [r * 0.55, h + 0.35 * s], [r * 0.14, h + 0.55 * s], [0, h + 0.6 * s]], 18, { x, z }, 0.45);
    m.cyl('roof', r + 0.035, r + 0.035, 0.07, 18, { x, y: h - 0.07, z }, 0.4, true);
    m.box('dark', 0.15, Math.min(0.3, h * 0.4), 0.03, { x, z: z + r - 0.005 });
  };
  silo(-0.18, -0.1, 0.42, 0.95, 1);
  silo(0.5, 0.28, 0.25, 0.62, 0.7);
  // a pennant at the big silo's tip: whose granary it is, from afar
  m.flag(-0.18, -0.1, 0.42, { y: 1.5, w: 0.3, fh: 0.18 });
  for (const [x, z, s, r] of [[0.08, 0.42, 1, 0.3], [-0.12, 0.47, 0.9, -0.4], [0.15, 0.6, 0.85, 0.9]]) m.sack(x, z, s, r);
  m.box('wood', 0.42, 0.04, 0.3, { x: -0.55, z: 0.45, ry: 0.3 });
  m.sack(-0.6, 0.42, 0.8, 0.2);
  m.sack(-0.47, 0.5, 0.75, 1.2);
  return m;
};

// 市集: three stalls round a little square, striped awnings in the owner's colour, crates and baskets
BUILD.market = () => {
  const m = new Model();
  const stall = (x, z, ry) => {
    const s = new Model();
    const w = 0.56;
    const d = 0.36;
    for (const sx of [-1, 1]) {
      s.box('wood', 0.03, 0.62, 0.03, { x: (sx * w) / 2, z: -d / 2 });
      s.box('wood', 0.03, 0.48, 0.03, { x: (sx * w) / 2, z: d / 2 });
    }
    s.box('wood', w, 0.2, 0.2, { z: d / 2 - 0.08 });
    s.box('wood', w + 0.04, 0.025, 0.24, { y: 0.2, z: d / 2 - 0.08 });
    // the awning: stripes of the owner's colour and canvas, sloping to the front
    const n = 6;
    for (let i = 0; i < n; i++) {
      const g = new THREE.PlaneGeometry(w / n + 0.002, d + 0.16);
      g.rotateX(-Math.PI / 2 + 0.38);
      g.translate(-w / 2 + (w / n) * (i + 0.5), 0.56, 0.02);
      s.add(i % 2 ? 'canvas' : 'cloth', g);
      // the scalloped front edge
      const f = new THREE.PlaneGeometry(w / n + 0.002, 0.06);
      f.translate(-w / 2 + (w / n) * (i + 0.5), 0.46, d / 2 + 0.1);
      s.add(i % 2 ? 'canvas' : 'cloth', f);
    }
    // wares on the counter
    s.lathe('burlap', [[0, 0], [0.05, 0], [0.06, 0.05], [0, 0.06]], 7, { x: -0.15, y: 0.225, z: 0.06 }, 0.3);
    s.lathe('burlap', [[0, 0], [0.05, 0], [0.06, 0.05], [0, 0.06]], 7, { x: 0.12, y: 0.225, z: 0.08 }, 0.3);
    s.box('leaf', 0.08, 0.04, 0.06, { x: 0.0, y: 0.225, z: 0.06 });
    m.merge(s, { x, z, ry });
  };
  stall(-0.48, -0.12, 0.62);
  stall(0.5, -0.12, -0.62);
  stall(0.0, -0.45, 0);
  // the square: crates, a basket, a barrel
  m.part('props', 'wooden_crate_01', { x: -0.62, z: 0.48, ry: 0.4 }, 0.17);
  m.part('props', 'wooden_crate_01', { x: -0.48, z: 0.6, ry: 1.1 }, 0.15);
  m.part('props', 'wicker_basket_01', { x: 0.4, z: 0.5 }, 0.1);
  m.barrel(0.58, 0.36, 1);
  m.barrel(0.66, 0.52, 0.9, { lying: true, ry: 0.5 });
  m.sack(0.2, 0.62, 0.8, 0.4);
  return m;
};

// 兵營: a long stone barracks roofed in the owner's colour, a drill yard with straw targets and a
// weapon rack, a tall flagpole
BUILD.barracks = () => {
  const m = new Model();
  house(m, { w: 1.25, h: 0.42, d: 0.48, wall: 'stone', z: -0.25, windows: 4, frame: false });
  m.gable('roof', 1.25, 0.48, 0.24, { y: 0.42, z: -0.25 }, 0.35);
  m.gableEnds('stone', 1.25, 0.48, 0.24, { y: 0.42, z: -0.25 });
  m.box('stone', 0.14, 0.16, 0.14, { x: 0.4, y: 0.6, z: -0.32 });
  // the yard: a fence, two straw men on posts, a rack of spears
  m.fence(-0.7, 0.05, -0.7, 0.68);
  m.fence(-0.7, 0.68, 0.38, 0.68);
  // archery butts: straw targets on stands, the owner's colour at the gold
  for (const [x, z] of [[-0.38, 0.3], [-0.06, 0.36]]) {
    m.cyl('thatch', 0.1, 0.1, 0.05, 14, { x, y: 0.24, z, rx: Math.PI / 2 - 0.2 }, 0.3);
    m.cyl('cloth', 0.035, 0.035, 0.052, 10, { x, y: 0.24, z: z + 0.002, rx: Math.PI / 2 - 0.2 }, 0.3);
    m.box('wood', 0.025, 0.24, 0.025, { x: x - 0.07, z: z - 0.04, rx: 0.15 });
    m.box('wood', 0.025, 0.24, 0.025, { x: x + 0.07, z: z - 0.04, rx: 0.15 });
    m.box('wood', 0.025, 0.26, 0.025, { x, z: z - 0.12, rx: -0.35 });
  }
  m.box('wood', 0.36, 0.03, 0.04, { x: 0.32, y: 0.3, z: 0.2, ry: -0.2 });
  m.box('wood', 0.36, 0.03, 0.04, { x: 0.32, y: 0.1, z: 0.2, ry: -0.2 });
  for (let i = 0; i < 5; i++) {
    const x = 0.18 + i * 0.07;
    m.cyl('wood', 0.008, 0.008, 0.42, 4, { x, z: 0.2 + (x - 0.32) * 0.2, rz: 0.08 });
    m.cone('metal', 0.014, 0.05, 4, { x: x - 0.034, y: 0.415, z: 0.2 + (x - 0.32) * 0.2, rz: 0.08 });
  }
  m.flag(0.62, 0.1, 1.55, { w: 0.42, fh: 0.27 });
  return m;
};

// 學院: a small stone college, the owner's roof, a copper-domed observatory on top with its telescope,
// a porch of two columns over steps
BUILD.academy = () => {
  const m = new Model();
  const w = 0.92;
  const d = 0.7;
  const h = 0.6;
  m.box('plaster', w, h, d, { z: -0.1 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.box('stone', 0.08, h + 0.01, 0.08, { x: (sx * (w - 0.06)) / 2, z: -0.1 + (sz * (d - 0.06)) / 2 });
  m.box('stone', w + 0.04, 0.05, d + 0.04, { y: h, z: -0.1 });
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.28;
    m.box('dark', 0.08, 0.16, 0.02, { x, y: 0.3, z: -0.1 + d / 2 + 0.006 });
    m.box('stone', 0.11, 0.02, 0.03, { x, y: 0.29, z: -0.1 + d / 2 + 0.01 });
    m.box('dark', 0.08, 0.16, 0.02, { x, y: 0.3, z: -0.1 - d / 2 - 0.006 });
  }
  m.hip('roof', w, d, 0.24, { y: h + 0.05, z: -0.1 }, 0.35);
  // the observatory: a drum and a copper dome, a slit, the telescope
  m.cyl('stone', 0.2, 0.2, 0.18, 16, { x: 0.12, y: h + 0.12, z: -0.18 });
  m.dome('copper', 0.215, 18, { x: 0.12, y: h + 0.3, z: -0.18 });
  m.box('dark', 0.05, 0.16, 0.06, { x: 0.12, y: h + 0.32, z: -0.18 + 0.19, rx: -0.5 });
  m.cyl('metal', 0.018, 0.022, 0.2, 8, { x: 0.12, y: h + 0.42, z: -0.0, rx: -0.9 });
  // the porch
  m.box('stone', 0.42, 0.04, 0.16, { y: 0, z: d / 2 - 0.02 });
  m.box('stone', 0.36, 0.04, 0.1, { y: 0.04, z: d / 2 - 0.05 });
  for (const sx of [-1, 1]) m.cyl('stone', 0.025, 0.03, 0.36, 8, { x: sx * 0.14, y: 0.04, z: d / 2 + 0.02 });
  // the pediment over the porch: its ridge runs out from the wall, its triangle faces the front
  m.box('stone', 0.38, 0.04, 0.2, { y: 0.4, z: d / 2 - 0.04 });
  m.gable('roof', 0.2, 0.38, 0.1, { y: 0.44, z: d / 2 - 0.04, ry: Math.PI / 2 }, 0.3, 0.02);
  m.gableEnds('stone', 0.2, 0.38, 0.1, { y: 0.44, z: d / 2 - 0.04, ry: Math.PI / 2 });
  m.box('dark', 0.13, 0.26, 0.02, { y: 0.0, z: -0.1 + d / 2 + 0.006 });
  // a bench by the door
  m.box('wood', 0.22, 0.05, 0.07, { x: -0.36, y: 0.05, z: 0.38 });
  return m;
};

// 水道橋: a stone bridge of three arches carrying a channel of water to a little water tower (its roof in
// the owner's colour); the field it waters in rows in front
BUILD.aqueduct = () => {
  const m = new Model();
  const x0 = -0.1;
  const w = 1.12;
  const h = 0.7;
  m.arcade('stone', w, h, 3, { x: x0, z: 0 }, { depth: 0.22, open: 0.7, rise: 0.84, base: 0, see: true });
  // the channel along the top: a deck, its two walls, the water between
  m.box('stone', w + 0.06, 0.035, 0.27, { x: x0, y: h - 0.01 }, 0.4);
  for (const sz of [-1, 1]) m.box('stone', w + 0.04, 0.09, 0.045, { x: x0, y: h + 0.02, z: sz * 0.11 }, 0.4);
  m.box('water', w + 0.02, 0.012, 0.18, { x: x0, y: h + 0.07 });
  // the far end: a pier as tall as the bridge, a spout
  m.box('stone', 0.2, h + 0.11, 0.3, { x: x0 - w / 2 - 0.08 }, 0.5);
  // the water tower at the near end, its pyramid roof in the owner's colour
  const tx = x0 + w / 2 + 0.17;
  m.box('stone', 0.36, 1.08, 0.36, { x: tx }, 0.5);
  m.box('stone', 0.42, 0.05, 0.42, { x: tx, y: 1.06 }, 0.4);
  m.hip('roof', 0.42, 0.42, 0.28, { x: tx, y: 1.1 }, 0.3, 0.04);
  m.box('dark', 0.12, 0.2, 0.02, { x: tx, z: 0.185 });
  m.box('dark', 0.07, 0.1, 0.02, { x: tx, y: 0.86, z: 0.185 });
  // the rows of the garden it waters
  for (let k = 0; k < 3; k++) {
    m.box('earth', 0.98, 0.025, 0.09, { x: x0, z: 0.34 + k * 0.12 }, 0.5);
    for (let i = 0; i < 7; i++) m.dome('leaf', 0.045, 5, { x: x0 - 0.42 + i * 0.14, y: 0.015, z: 0.34 + k * 0.12, sy: 0.8 });
  }
  return m;
};

// 造船廠: a slipway with a ship's skeleton on it (keel, ribs, stem and stern posts, the first planks), a
// post crane with its jib over the hull and the owner's flag at its head, timber waiting
BUILD.shipyard = () => {
  const m = new Model();
  const rnd = rng(11);
  // the slipway, running down to the front (the sea, where there is one)
  m.box('wood', 0.62, 0.05, 1.55, { y: 0.04, z: 0.05, rx: 0.06 }, 0.4);
  for (let k = 0; k < 6; k++) m.box('wood', 0.7, 0.04, 0.05, { y: 0.02, z: -0.6 + k * 0.25 }, 0.4);
  // the keel on its blocks
  const ky = 0.16;
  m.box('wood', 0.05, 0.06, 1.25, { y: ky - 0.05, z: 0.02 }, 0.4);
  for (const z of [-0.45, -0.1, 0.25]) m.box('dark', 0.12, 0.08, 0.08, { y: 0.06, z });
  // the ribs: a U each, widest amidships
  const ribs = 8;
  for (let i = 0; i < ribs; i++) {
    const f = (i / (ribs - 1)) * 2 - 1;
    const z = 0.02 + f * 0.52;
    const R = 0.3 * Math.sqrt(Math.max(0.12, 1 - f * f * 0.85));
    const g = new THREE.TorusGeometry(R, 0.014, 4, 9, Math.PI);
    g.rotateZ(Math.PI);
    g.scale(1, 1.15, 1);
    g.translate(0, ky + R * 1.15, z);
    m.add('wood', g);
    // the ribs' tops carried up straight
    for (const sx of [-1, 1]) m.box('wood', 0.025, 0.1, 0.025, { x: sx * R, y: ky + R * 1.15, z });
  }
  // stem (raked forward) and sternpost
  m.cyl('wood', 0.02, 0.025, 0.62, 5, { y: ky, z: 0.6, rx: 0.42 });
  m.cyl('wood', 0.02, 0.025, 0.5, 5, { y: ky, z: -0.56, rx: -0.12 });
  // the first planks, on the turn of the bilge
  for (const sx of [-1, 1]) m.box('wood', 0.03, 0.08, 0.96, { x: sx * 0.17, y: ky + 0.06, z: 0.02, rz: sx * 0.75 }, 0.4);
  // the crane: a mast, a jib reaching over the hull, a rope and a timber on it; the flag at its head
  const mx = 0.55;
  const mz = -0.38;
  m.box('wood', 0.07, 1.3, 0.07, { x: mx, z: mz }, 0.5);
  m.box('wood', 0.3, 0.05, 0.05, { x: mx, z: mz }, 0.4);
  m.box('wood', 0.05, 0.05, 0.3, { x: mx, z: mz }, 0.4);
  const jl = 0.78;
  const ja = 0.5;
  m.cyl('wood', 0.018, 0.025, jl, 5, { x: mx, y: 0.62, z: mz, rz: Math.PI / 2 - ja });
  const tipX = mx - jl * Math.cos(ja);
  const tipY = 0.62 + jl * Math.sin(ja);
  m.cyl('wood', 0.012, 0.012, Math.hypot(mx - tipX, 1.2 - tipY), 4, { x: tipX, y: tipY, z: mz, rz: -Math.atan2(mx - tipX, 1.2 - tipY) });
  m.cyl('dark', 0.004, 0.004, tipY - 0.66, 3, { x: tipX, y: 0.66, z: mz });
  m.box('wood', 0.05, 0.05, 0.42, { x: tipX, y: 0.6, z: mz + 0.08, ry: 0.3 });
  m.flag(mx, mz, 1.5, { w: 0.38, fh: 0.24 });
  // timber: logs, a stack of planks, a barrel of tar
  m.logs(-0.58, -0.42, 5, { len: 0.62, r: 0.05, ry: 0.15 });
  for (let k = 0; k < 4; k++) m.box('wood', 0.62, 0.025, 0.1, { x: -0.55, y: k * 0.026, z: 0.45 + (rnd() - 0.5) * 0.03, ry: (rnd() - 0.5) * 0.08 }, 0.4);
  m.barrel(0.55, 0.32, 0.9);
  m.part('props', 'wooden_bucket_01', { x: 0.42, z: 0.48 }, 0.1);
  return m;
};

// 商會: a tall, narrow timber-framed house of three jettied storeys, its gable to the front (the owner's
// roof), a hoist beam at the gable's top, the guild's banner on the front, scales at the door
BUILD.guild = () => {
  const m = new Model();
  const storeys = [
    { w: 0.72, d: 0.74, h: 0.36 },
    { w: 0.78, d: 0.8, h: 0.34 },
    { w: 0.84, d: 0.86, h: 0.32 },
  ];
  let y = 0;
  storeys.forEach((st, i) => {
    house(m, { w: st.w, h: st.h, d: st.d, y, z: -0.08, door: i === 0, windows: 2 });
    y += st.h;
  });
  const top = storeys[2];
  // the roof: ridge running front to back, so the gable faces the street
  m.gable('roof', top.d, top.w, 0.66, { y, z: -0.08, ry: Math.PI / 2 }, 0.32, 0.05);
  m.gableEnds('plaster', top.d, top.w, 0.66, { y, z: -0.08, ry: Math.PI / 2 });
  // timbering on the front gable and its windows
  const fz = -0.08 + top.d / 2 + 0.004;
  m.box('wood', 0.03, 0.6, 0.02, { y, z: fz });
  m.box('wood', top.w * 0.8, 0.03, 0.02, { y: y + 0.18, z: fz });
  m.box('dark', 0.1, 0.12, 0.02, { y: y + 0.24, z: fz + 0.004, x: 0.14 });
  m.box('dark', 0.1, 0.12, 0.02, { y: y + 0.24, z: fz + 0.004, x: -0.14 });
  // the hoist beam at the top of the gable, a rope and a bale on it
  m.box('wood', 0.05, 0.05, 0.3, { y: y + 0.44, z: fz + 0.12 }, 0.3);
  m.cyl('dark', 0.004, 0.004, 0.42, 3, { y: y + 0.02, z: fz + 0.25 });
  m.box('burlap', 0.12, 0.1, 0.1, { y: y - 0.08, z: fz + 0.25 }, 0.3);
  // the banner on the second storey, and the chimney
  m.plane('cloth', 0.22, 0.27, { y: storeys[0].h + 0.17, z: -0.08 + storeys[1].d / 2 + 0.008 });
  m.box('gold', 0.26, 0.025, 0.025, { y: storeys[0].h + 0.31, z: -0.08 + storeys[1].d / 2 + 0.02 });
  m.box('stone', 0.12, 0.3, 0.12, { x: -0.28, y: y + 0.28, z: -0.3 }, 0.3);
  // the scales on a bracket by the door
  const sz = -0.08 + storeys[0].d / 2;
  m.box('wood', 0.025, 0.025, 0.14, { x: 0.22, y: 0.34, z: sz + 0.07 });
  m.box('gold', 0.16, 0.012, 0.012, { x: 0.22, y: 0.29, z: sz + 0.13 });
  m.cyl('gold', 0.003, 0.003, 0.05, 3, { x: 0.22, y: 0.29, z: sz + 0.13 });
  for (const sx of [-1, 1]) m.cyl('gold', 0.035, 0.025, 0.012, 8, { x: 0.22 + sx * 0.08, y: 0.22, z: sz + 0.13 });
  // goods at the door
  m.part('props', 'wooden_crate_01', { x: -0.36, z: 0.42, ry: 0.3 }, 0.16);
  m.part('props', 'wooden_crate_01', { x: -0.34, z: 0.44, ry: 0.9 }, 0.12);
  m.sack(0.36, 0.45, 0.85, 0.5);
  m.barrel(-0.12, 0.5, 0.8);
  return m;
};

// 城牆: a curved stretch of wall round the settlement's corner, its walk edged with merlons, a round
// tower at the end under a cone in the owner's colour, a buttress at the other
BUILD.wall = () => {
  const m = new Model();
  const R = 1.7;
  const a0 = -0.62;
  const a1 = 0.62;
  const n = 6;
  const pt = (a) => [R * Math.sin(a), -R + R * Math.cos(a)];
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pt(a0 + ((a1 - a0) * i) / n);
    const [x1, z1] = pt(a0 + ((a1 - a0) * (i + 1)) / n);
    m.wallRun('stone', x0, z0, x1, z1, { h: 0.48, t: 0.17, merlon: 0.09 });
  }
  // the tower
  const [tx, tz] = pt(a1 + 0.08);
  m.cyl('stone', 0.24, 0.27, 0.86, 14, { x: tx, z: tz }, 0.5);
  m.cyl('stone', 0.29, 0.29, 0.07, 14, { x: tx, y: 0.84, z: tz }, 0.4);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    m.box('stone', 0.09, 0.1, 0.07, { x: tx + Math.cos(a) * 0.255, y: 0.91, z: tz + Math.sin(a) * 0.255, ry: -a }, 0.3);
  }
  m.cone('roof', 0.24, 0.42, 14, { x: tx, y: 0.9, z: tz }, 0.3);
  m.box('dark', 0.05, 0.12, 0.02, { x: tx, y: 0.5, z: tz + 0.265 });
  m.box('dark', 0.13, 0.22, 0.02, { x: tx - 0.08, z: tz + 0.25, ry: 0.4 });
  m.flag(tx, tz, 0.55, { y: 1.28, w: 0.3, fh: 0.18 });
  // the buttress at the other end
  const [bx, bz] = pt(a0 - 0.05);
  m.box('stone', 0.26, 0.62, 0.26, { x: bx, z: bz, ry: 0.6 }, 0.4);
  m.box('stone', 0.3, 0.06, 0.3, { x: bx, y: 0.6, z: bz, ry: 0.6 }, 0.3);
  return m;
};

// 傭兵營: bell tents in the owner's colour round a fire, a rack of shields, spears stacked, a standard
BUILD.mercenaries = () => {
  const m = new Model();
  m.tent(-0.32, -0.26, 0.31, 0.74, { ry: 0.2 });
  m.tent(0.36, -0.36, 0.26, 0.62, { ry: -0.35 });
  m.tent(0.58, 0.26, 0.2, 0.5, { ry: -1.1 });
  // the fire, logs to sit on
  m.part('props', 'stone_fire_pit', { x: 0.02, z: 0.28 }, 0.08);
  m.flame(0.02, 0.04, 0.28, 0.07, 0.2);
  m.lying('wood', 0.04, 0.36, { x: -0.3, z: 0.42, ry: 0.5 });
  m.lying('wood', 0.04, 0.32, { x: 0.15, z: 0.58, ry: -0.3 });
  // the shield rack: two posts, a rail, three round shields leaning on it (one in the owner's colour)
  const rx = -0.62;
  const rz = 0.25;
  m.box('wood', 0.03, 0.26, 0.03, { x: rx, z: rz - 0.2 });
  m.box('wood', 0.03, 0.26, 0.03, { x: rx, z: rz + 0.2 });
  m.box('wood', 0.03, 0.03, 0.44, { x: rx, y: 0.25, z: rz });
  [-0.13, 0.0, 0.13].forEach((dz, i) => {
    const slot = i === 1 ? 'cloth' : 'wood';
    m.cyl(slot, 0.1, 0.1, 0.02, 12, { x: rx + 0.06, y: 0.12, z: rz + dz, rz: Math.PI / 2 - 0.25 }, 0.3);
    m.cyl('metal', 0.03, 0.03, 0.03, 8, { x: rx + 0.075, y: 0.122, z: rz + dz, rz: Math.PI / 2 - 0.25 }, 0.3);
  });
  // spears stacked in a cone
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU;
    m.cyl('wood', 0.007, 0.007, 0.62, 4, { x: 0.68 + Math.cos(a) * 0.09, z: -0.08 + Math.sin(a) * 0.09, rx: Math.sin(a) * 0.14, rz: -Math.cos(a) * 0.14 });
  }
  m.cone('metal', 0.03, 0.06, 5, { x: 0.68, y: 0.6, z: -0.08 });
  // a standard
  m.flag(-0.62, -0.6, 1.25, { w: 0.4, fh: 0.26 });
  m.barrel(0.28, 0.62, 0.8);
  return m;
};

// 冒險者公會: a timber tavern of two storeys (the owner's roof, smoke from its chimney), a great sign hung
// out from the corner, a round shield in the owner's colour over crossed swords; a notice board
BUILD.adventurers = () => {
  const m = new Model();
  const z0 = -0.18;
  house(m, { w: 1.0, h: 0.66, d: 0.58, z: z0, windows: 3 });
  m.gable('roof', 1.0, 0.58, 0.34, { y: 0.66, z: z0 }, 0.32, 0.06);
  m.gableEnds('plaster', 1.0, 0.58, 0.34, { y: 0.66, z: z0 });
  m.box('stone', 0.14, 0.42, 0.14, { x: -0.33, y: 0.72, z: z0 - 0.08 }, 0.3);
  m.smokeAt(-0.33, 1.16, z0 - 0.08, 0.7);
  // the sign: an iron arm out from the front corner, the shield and swords hanging from it
  const front = z0 + 0.29;
  m.box('dark', 0.36, 0.025, 0.025, { x: 0.66, y: 0.6, z: front });
  m.box('dark', 0.025, 0.12, 0.025, { x: 0.52, y: 0.5, z: front, rz: 0.75 });
  const cx = 0.72;
  const cy = 0.4;
  m.cyl('dark', 0.004, 0.004, 0.08, 3, { x: cx, y: cy + 0.12, z: front });
  for (const s of [-1, 1]) {
    m.box('metal', 0.03, 0.5, 0.012, { x: cx, y: cy - 0.25, z: front - 0.012, rz: s * 0.62 });
    m.box('gold', 0.11, 0.025, 0.02, { x: cx + s * 0.13, y: cy + 0.1, z: front - 0.012, rz: s * 0.62 });
  }
  m.cyl('cloth', 0.15, 0.15, 0.025, 16, { x: cx, y: cy, z: front - 0.012, rx: Math.PI / 2 }, 0.3);
  m.cyl('metal', 0.155, 0.155, 0.012, 16, { x: cx, y: cy, z: front - 0.018, rx: Math.PI / 2 }, 0.3);
  m.cyl('metal', 0.035, 0.035, 0.012, 8, { x: cx, y: cy, z: front + 0.016, rx: Math.PI / 2 }, 0.3);
  // the notice board with its little roof, papers pinned on it
  const nx = -0.6;
  const nz = 0.32;
  for (const sx of [-1, 1]) m.box('wood', 0.03, 0.46, 0.03, { x: nx + sx * 0.17, z: nz });
  m.box('wood', 0.38, 0.26, 0.025, { x: nx, y: 0.17, z: nz });
  m.gable('thatch', 0.44, 0.1, 0.06, { x: nx, y: 0.45, z: nz }, 0.3, 0.02);
  for (const [dx, dy, r] of [[-0.11, 0.3, 0.1], [0.0, 0.27, -0.06], [0.1, 0.31, 0.05], [-0.06, 0.2, 0.04], [0.08, 0.21, -0.1]]) m.plane('paper', 0.07, 0.085, { x: nx + dx, y: dy, z: nz + 0.016, rz: r });
  m.barrel(0.3, 0.32, 0.85);
  m.barrel(0.42, 0.4, 0.75);
  m.box('wood', 0.26, 0.04, 0.07, { x: 0.0, y: 0.06, z: front + 0.08 });
  return m;
};

// 驛站: a stable (the owner's roof) with a horse at the rail in front, a trough, a milestone and a
// signpost by the road
BUILD.post = () => {
  const m = new Model();
  const z0 = -0.22;
  m.box('wood', 1.05, 0.36, 0.48, { z: z0 }, 0.4);
  for (let k = 0; k < 3; k++) {
    const x = -0.33 + k * 0.33;
    m.box('dark', 0.2, 0.25, 0.02, { x, z: z0 + 0.245 });
    m.box('wood', 0.22, 0.12, 0.025, { x, z: z0 + 0.255 });
  }
  m.gable('roof', 1.05, 0.48, 0.26, { y: 0.36, z: z0 }, 0.32, 0.07);
  m.gableEnds('wood', 1.05, 0.48, 0.26, { y: 0.36, z: z0 });
  m.box('thatch', 0.2, 0.1, 0.14, { x: 0.18, y: 0.2, z: z0 + 0.32 }, 0.3);
  // the rail, the horse tied to it, the trough
  for (const x of [-0.42, 0.12]) m.box('wood', 0.035, 0.24, 0.035, { x, z: 0.2 });
  m.box('wood', 0.6, 0.03, 0.03, { x: -0.15, y: 0.21, z: 0.2 });
  m.animal('horse', -0.15, 0.36, Math.PI / 2 + 0.15, 0.42);
  m.box('wood', 0.34, 0.1, 0.12, { x: -0.48, z: 0.46 }, 0.3);
  m.box('water', 0.3, 0.01, 0.08, { x: -0.48, y: 0.095, z: 0.46 });
  // the milestone and the signpost
  m.box('stone', 0.14, 0.26, 0.09, { x: 0.52, z: 0.45 }, 0.3);
  m.cyl('stone', 0.07, 0.07, 0.09, 10, { x: 0.52 + 0.045, y: 0.26, z: 0.45, rz: Math.PI / 2 }, 0.3);
  m.box('dark', 0.06, 0.04, 0.01, { x: 0.52, y: 0.18, z: 0.497 });
  m.box('wood', 0.035, 0.62, 0.035, { x: 0.68, z: 0.15 });
  m.box('wood', 0.28, 0.06, 0.02, { x: 0.78, y: 0.52, z: 0.15, ry: 0.3 });
  m.box('wood', 0.26, 0.06, 0.02, { x: 0.6, y: 0.42, z: 0.15, ry: -0.5 });
  return m;
};

// 拓荒營地: a covered wagon (its canvas in the owner's colour), a fire with a pot, a pile of logs, a
// lean-to over the tools, stumps of the trees cleared, an axe in one
BUILD.camp = () => {
  const m = new Model();
  const W = new Model();
  W.box('wood', 0.68, 0.12, 0.34, { y: 0.15 }, 0.3);
  for (const [x, z] of [[-0.24, -0.19], [-0.24, 0.19], [0.24, -0.19], [0.24, 0.19]]) W.wheel(x, 0.14, z, 0.14, { ry: Math.PI / 2 });
  const cover = new THREE.CylinderGeometry(0.2, 0.2, 0.64, 10, 1, true, 0, Math.PI);
  cover.rotateZ(Math.PI / 2);
  cover.translate(0, 0.28, 0);
  W.add('cloth', cover);
  for (const x of [-0.24, 0, 0.24]) {
    const g = new THREE.TorusGeometry(0.205, 0.008, 3, 10, Math.PI);
    g.rotateY(Math.PI / 2);
    g.translate(x, 0.28, 0);
    W.add('wood', g);
  }
  W.box('wood', 0.42, 0.03, 0.03, { x: 0.52, y: 0.12, rz: 0.25 });
  m.merge(W, { x: -0.18, z: -0.12, ry: 0.35 });
  // the fire and a pot on a tripod
  m.part('props', 'stone_fire_pit', { x: 0.42, z: 0.36 }, 0.08);
  m.flame(0.42, 0.04, 0.36, 0.06, 0.17);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    m.cyl('wood', 0.006, 0.006, 0.36, 3, { x: 0.42 + Math.cos(a) * 0.1, z: 0.36 + Math.sin(a) * 0.1, rx: Math.sin(a) * 0.28, rz: -Math.cos(a) * 0.28 });
  }
  m.dome('metal', 0.05, 8, { x: 0.42, y: 0.25, z: 0.36, rx: Math.PI });
  // logs, the lean-to, stumps and an axe
  m.logs(-0.5, 0.42, 6, { len: 0.5, r: 0.045, ry: -0.2 });
  m.box('wood', 0.03, 0.4, 0.03, { x: 0.32, z: -0.5 });
  m.box('wood', 0.03, 0.4, 0.03, { x: 0.74, z: -0.5 });
  m.box('wood', 0.03, 0.28, 0.03, { x: 0.32, z: -0.2 });
  m.box('wood', 0.03, 0.28, 0.03, { x: 0.74, z: -0.2 });
  m.box('thatch', 0.52, 0.03, 0.4, { x: 0.53, y: 0.36, z: -0.35, rx: 0.3 }, 0.3);
  m.box('wood', 0.3, 0.12, 0.14, { x: 0.53, z: -0.38 }, 0.3);
  for (const [x, z, r] of [[0.12, 0.62, 0.06], [-0.72, 0.0, 0.07], [0.72, 0.1, 0.055]]) m.cyl('wood', r, r * 1.15, 0.07, 9, { x, z }, 0.3);
  m.box('wood', 0.018, 0.2, 0.018, { x: -0.72, y: 0.07, z: 0.0, rz: 0.5 });
  m.box('metal', 0.07, 0.05, 0.015, { x: -0.68, y: 0.24, z: 0.0, rz: 0.5 });
  return m;
};

// 印刷坊: a timber workshop (the owner's roof), a screw press under a lean-to beside it, sheets of
// printed paper drying on two lines in front
BUILD.press = () => {
  const m = new Model();
  const rnd = rng(5);
  house(m, { w: 0.82, h: 0.5, d: 0.55, x: -0.24, z: -0.3, wall: 'stone', windows: 2, frame: false });
  m.gable('roof', 0.82, 0.55, 0.3, { x: -0.24, y: 0.5, z: -0.3 }, 0.32, 0.06);
  m.gableEnds('stone', 0.82, 0.55, 0.3, { x: -0.24, y: 0.5, z: -0.3 });
  // the lean-to and the press under it
  for (const [x, z, h] of [[0.2, -0.46, 0.5], [0.66, -0.46, 0.5], [0.2, 0.04, 0.42], [0.66, 0.04, 0.42]]) m.box('wood', 0.03, h, 0.03, { x, z });
  m.box('thatch', 0.56, 0.03, 0.62, { x: 0.43, y: 0.46, z: -0.21, rx: 0.15 }, 0.3);
  const px = 0.43;
  const pz = -0.22;
  for (const sx of [-1, 1]) m.box('wood', 0.05, 0.4, 0.05, { x: px + sx * 0.12, z: pz }, 0.3);
  m.box('wood', 0.32, 0.06, 0.08, { x: px, y: 0.36, z: pz }, 0.3);
  m.cyl('metal', 0.02, 0.02, 0.12, 6, { x: px, y: 0.24, z: pz });
  m.box('wood', 0.17, 0.035, 0.14, { x: px, y: 0.21, z: pz }, 0.3);
  m.box('wood', 0.26, 0.05, 0.26, { x: px, y: 0.12, z: pz }, 0.3);
  m.cyl('wood', 0.008, 0.008, 0.3, 4, { x: px, y: 0.3, z: pz + 0.02, rx: Math.PI / 2, ry: 0.5 });
  m.box('paper', 0.14, 0.08, 0.1, { x: px - 0.02, y: 0, z: pz + 0.24 }, 0.3);
  // the drying lines and the sheets on them
  for (const x of [-0.66, 0.66]) m.box('wood', 0.03, 0.52, 0.03, { x, z: 0.42 });
  for (const z of [0.34, 0.5]) {
    m.cyl('dark', 0.004, 0.004, 1.32, 3, { y: 0.48, z, rz: Math.PI / 2, x: 0.66 });
    for (let i = 0; i < 7; i++) {
      const x = -0.54 + i * 0.18 + (z > 0.4 ? 0.06 : 0);
      if (x > 0.58) continue;
      m.plane('paper', 0.13, 0.16, { x, y: 0.4, z, ry: (rnd() - 0.5) * 0.3, rz: (rnd() - 0.5) * 0.06 });
    }
  }
  m.barrel(0.74, 0.0, 0.7);
  return m;
};

export const BUILDING_MODELS = BUILD;

// ── development facilities (one per terrain; level 2 adds to level 1) ──

const FACILITY = {};

// 田地: a farmstead (a barn and haystacks); level 2 adds a windmill (the countryside's own, with the
// owner's flag on its cap: devmesh.js puts the kit's windmill there)
FACILITY.fields = (lv) => {
  const m = new Model();
  house(m, { w: 1.15, h: 0.5, d: 0.7, wall: 'plaster', x: -0.25, z: 0.05, windows: 2 });
  m.gable('thatch', 1.15, 0.7, 0.45, { x: -0.25, y: 0.5, z: 0.05 }, 0.4, 0.1);
  m.gableEnds('wood', 1.15, 0.7, 0.45, { x: -0.25, y: 0.5, z: 0.05 });
  m.box('wood', 0.36, 0.38, 0.02, { x: -0.25, z: 0.41 });
  // a lean-to with sacks, a hay cart
  m.box('wood', 0.03, 0.34, 0.03, { x: 0.52, z: 0.38 });
  m.box('wood', 0.03, 0.34, 0.03, { x: 0.52, z: -0.25 });
  m.gable('thatch', 0.34, 0.7, 0.04, { x: 0.45, y: 0.34, z: 0.05, rz: -0.25 }, 0.4, 0.04);
  m.sack(0.42, 0.2, 0.9, 0.3).sack(0.45, 0.0, 0.85, 1.2);
  m.box('wood', 0.42, 0.06, 0.24, { x: 0.15, y: 0.12, z: 0.62, ry: 0.3 });
  m.cyl('wood', 0.09, 0.09, 0.03, 10, { x: 0.0, y: 0.09, z: 0.52, rx: Math.PI / 2, ry: 0.3 });
  m.cyl('wood', 0.09, 0.09, 0.03, 10, { x: 0.29, y: 0.09, z: 0.72, rx: Math.PI / 2, ry: 0.3 });
  m.lathe('thatch', haystack(0.75), 10, { x: 0.15, y: 0.15, z: 0.62 }, 0.4);
  for (const [x, z, s] of [[0.55, 0.5, 1], [0.78, 0.18, 0.85]]) m.lathe('thatch', haystack(s), 12, { x, z }, 0.4);
  m.fence(-0.8, 0.75, 0.9, 0.75);
  m.flag(0.42, -0.1, 1.05);
  if (lv >= 2) {
    m.part('windmill', null, { x: 0.85, z: -0.85, ry: 0.4 }, 2.0);
    m.lathe('thatch', haystack(0.9), 12, { x: 1.25, z: -0.2 }, 0.4);
  }
  return m;
};

// 森林: a lumber camp: a cabin of logs, logs stacked between posts, a sawhorse, stumps, a chopping
// block with its axe and split wood; level 2 adds the sawmill: a long open shed over a frame saw,
// planks stacked, more logs
FACILITY.forest = (lv) => {
  const m = new Model();
  const rnd = rng(21);
  const cx = -0.48;
  const cz = -0.18;
  const W = 0.66;
  const D = 0.48;
  for (let k = 0; k < 5; k++) {
    const y = k * 0.07;
    for (const sz of [-1, 1]) m.lying('wood', 0.036, W + 0.1, { x: cx, y, z: cz + (sz * D) / 2 }, 7);
    for (const sx of [-1, 1]) m.lying('wood', 0.036, D + 0.1, { x: cx + (sx * W) / 2, y: y + 0.035, z: cz, ry: Math.PI / 2 }, 7);
  }
  m.box('wood', W - 0.04, 0.34, D - 0.04, { x: cx, z: cz }, 0.4);
  m.gable('thatch', W + 0.06, D + 0.06, 0.3, { x: cx, y: 0.37, z: cz }, 0.4, 0.09);
  m.gableEnds('wood', W, D, 0.3, { x: cx, y: 0.37, z: cz });
  m.box('dark', 0.15, 0.26, 0.02, { x: cx + 0.12, z: cz + D / 2 + 0.04 });
  // logs stacked between posts
  const lx = 0.42;
  const lz = -0.32;
  m.logs(lx, lz, 6, { len: 0.9, r: 0.072 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.box('wood', 0.04, 0.34, 0.04, { x: lx + sx * 0.25, z: lz + sz * 0.3 });
  // the sawhorse with a log across it
  const hx = 0.08;
  const hz = 0.46;
  for (const dx of [-0.18, 0.18]) {
    m.box('wood', 0.025, 0.26, 0.025, { x: hx + dx, z: hz - 0.05, rx: 0.35 });
    m.box('wood', 0.025, 0.26, 0.025, { x: hx + dx, z: hz + 0.05, rx: -0.35 });
  }
  m.lying('wood', 0.05, 0.62, { x: hx, y: 0.19, z: hz }, 8);
  // stumps, the chopping block and its axe, split wood
  for (const [x, z, r] of [[-0.82, 0.42, 0.07], [0.7, 0.32, 0.08], [-0.05, -0.62, 0.06], [0.95, -0.15, 0.065]]) m.cyl('wood', r, r * 1.2, 0.08, 9, { x, z }, 0.3);
  m.cyl('wood', 0.09, 0.1, 0.14, 9, { x: -0.48, z: 0.48 }, 0.3);
  m.box('wood', 0.018, 0.22, 0.018, { x: -0.45, y: 0.14, z: 0.48, rz: -0.5 });
  m.box('metal', 0.07, 0.05, 0.015, { x: -0.41, y: 0.19, z: 0.48, rz: -0.5 });
  for (let k = 0; k < 7; k++) m.box('wood', 0.05, 0.05, 0.2, { x: -0.3 + (k % 4) * 0.055, y: Math.floor(k / 4) * 0.05, z: 0.3, ry: (rnd() - 0.5) * 0.2 });
  m.flag(0.08, -0.62, 1.05);
  if (lv >= 2) {
    const sx0 = 0.5;
    const sz0 = -1.28;
    const L = 1.75;
    const Dd = 0.72;
    for (let i = 0; i <= 3; i++) for (const sz of [-1, 1]) m.box('wood', 0.05, 0.55, 0.05, { x: sx0 - L / 2 + (L * i) / 3, z: sz0 + (sz * Dd) / 2 });
    m.gable('thatch', L + 0.08, Dd + 0.08, 0.34, { x: sx0, y: 0.55, z: sz0 }, 0.4, 0.1);
    m.gableEnds('wood', L + 0.08, Dd + 0.08, 0.34, { x: sx0, y: 0.55, z: sz0 });
    m.box('wood', L, 0.26, 0.04, { x: sx0, z: sz0 - Dd / 2 }, 0.4);
    // the frame saw: uprights, the frame with its blade, the bed and a log on it
    const fx = sx0 - 0.2;
    for (const dx of [-0.2, 0.2]) m.box('wood', 0.05, 0.62, 0.05, { x: fx + dx, z: sz0 }, 0.3);
    m.box('wood', 0.45, 0.05, 0.05, { x: fx, y: 0.6, z: sz0 }, 0.3);
    m.box('wood', 0.24, 0.32, 0.03, { x: fx, y: 0.24, z: sz0 }, 0.3);
    m.box('metal', 0.02, 0.32, 0.035, { x: fx, y: 0.24, z: sz0 });
    m.box('wood', 1.1, 0.08, 0.2, { x: sx0 + 0.15, y: 0.16, z: sz0 }, 0.4);
    m.lying('wood', 0.07, 0.9, { x: sx0 + 0.3, y: 0.24, z: sz0 }, 8);
    // planks and more logs
    for (let k = 0; k < 5; k++) m.box('wood', 0.75, 0.025, 0.12, { x: 1.25, y: k * 0.026, z: -0.55 + (rnd() - 0.5) * 0.03, ry: Math.PI / 2 + (rnd() - 0.5) * 0.06 }, 0.4);
    m.logs(-0.6, -1.15, 9, { len: 1.0, r: 0.075, ry: 0.15 });
    m.logs(1.35, -1.45, 5, { len: 0.8, r: 0.065, ry: -0.3 });
  }
  return m;
};

// 丘陵: a brickworks: a bottle kiln (smoke from its neck), stacks of fired bricks, a heap of clay and a
// barrow; level 2 adds a second kiln and a long drying shed over rows of green bricks
FACILITY.hills = (lv) => {
  const m = new Model();
  const rnd = rng(23);
  const kiln = (x, z, s) => {
    m.lathe('brick', [[0, 0], [0.44 * s, 0], [0.46 * s, 0.12 * s], [0.43 * s, 0.42 * s], [0.31 * s, 0.7 * s], [0.18 * s, 0.9 * s], [0.14 * s, 1.16 * s], [0.18 * s, 1.18 * s], [0.18 * s, 1.25 * s], [0.12 * s, 1.25 * s], [0.12 * s, 1.18 * s]], 16, { x, z }, 0.5);
    m.box('dark', 0.17 * s, 0.22 * s, 0.05, { x, z: z + 0.43 * s });
    m.box('brick', 0.3 * s, 0.07 * s, 0.1 * s, { x, y: 0.21 * s, z: z + 0.43 * s }, 0.3);
    m.smokeAt(x, 1.27 * s, z, 1.1 * s);
  };
  kiln(-0.35, -0.28, 1);
  const stack = (x, z, ry, layers = 3) => {
    for (let l = 0; l < layers; l++) m.box('brick', 0.36, 0.08, 0.26, { x, y: l * 0.082, z, ry: ry + (l % 2) * 0.1 }, 0.3);
  };
  stack(0.36, 0.02, 0.2);
  stack(0.5, 0.42, -0.3, 2);
  stack(0.08, 0.52, 0.5, 2);
  // the clay heap and a barrow
  m.rubble('earth', -0.72, 0.38, 0.3, 0.22, rnd, { n: 0, sx: 1.3 });
  m.box('wood', 0.2, 0.08, 0.14, { x: -0.36, y: 0.08, z: 0.48, ry: 0.4 }, 0.3);
  m.wheel(-0.25, 0.06, 0.53, 0.06, { ry: 0.4 });
  for (const s of [-1, 1]) m.box('wood', 0.02, 0.02, 0.3, { x: -0.47 + s * 0.05, y: 0.1, z: 0.42, ry: 0.4 - Math.PI / 2, rx: -0.2 });
  m.flag(0.45, -0.5, 1.05);
  if (lv >= 2) {
    kiln(0.82, -1.08, 1.15);
    const hx = -0.55;
    const hz = -1.25;
    const L = 1.45;
    const D = 0.62;
    for (let i = 0; i <= 2; i++) for (const sz of [-1, 1]) m.box('wood', 0.045, 0.42, 0.045, { x: hx - L / 2 + (L * i) / 2, z: hz + (sz * D) / 2 });
    m.gable('thatch', L + 0.06, D + 0.06, 0.24, { x: hx, y: 0.42, z: hz }, 0.4, 0.08);
    m.gableEnds('wood', L + 0.06, D + 0.06, 0.24, { x: hx, y: 0.42, z: hz });
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) m.box('sand', 0.17, 0.06, 0.1, { x: hx - L / 2 + 0.16 + k * 0.225, z: hz - 0.18 + r * 0.18, ry: (rnd() - 0.5) * 0.1 }, 0.3);
    stack(0.15, -0.72, 0.1);
    stack(1.45, -0.4, -0.5, 2);
  }
  return m;
};

// 牧場: a sheepfold: a ring of dry-stone wall with a hurdle at the gate, a shelter against the back,
// sheep inside; level 2 adds the shearing barn: a tall-roofed timber barn, fleeces and sacks of wool
FACILITY.pasture = (lv) => {
  const m = new Model();
  const rnd = rng(25);
  const R = 0.8;
  const n = 14;
  const at = (i) => [R * Math.sin(((i - 0.5) / n) * TAU), R * Math.cos(((i - 0.5) / n) * TAU)];
  for (let i = 1; i < n; i++) {
    const [x0, z0] = at(i);
    const [x1, z1] = at(i + 1);
    m.wallRun('stone', x0, z0, x1, z1, { h: 0.22, t: 0.12, crenel: false, sink: 0.04 });
  }
  // the hurdle swung open at the gate
  const [gx, gz] = at(1);
  m.fence(gx, gz, gx + 0.32, gz + 0.12, { h: 0.2, gap: 0.16 });
  // a shelter against the back wall
  m.box('stone', 0.6, 0.3, 0.12, { z: -R + 0.12 }, 0.4);
  for (const sx of [-1, 1]) m.box('wood', 0.035, 0.28, 0.035, { x: sx * 0.27, z: -R + 0.42 });
  m.box('thatch', 0.68, 0.035, 0.42, { y: 0.3, z: -R + 0.3, rx: 0.12 }, 0.3);
  // sheep, a trough
  for (const [x, z, ry] of [[-0.3, 0.1, 0.5], [0.12, 0.28, -1.2], [0.36, -0.1, 2.4], [-0.1, -0.22, 1.4], [0.2, 0.0, 0.2]]) m.animal('sheep', x, z, ry, 0.26);
  m.box('wood', 0.3, 0.08, 0.1, { x: -0.4, z: 0.42, ry: 0.5 }, 0.3);
  m.box('water', 0.26, 0.01, 0.06, { x: -0.4, y: 0.075, z: 0.42, ry: 0.5 });
  m.flag(0.9, -0.45, 1.05);
  if (lv >= 2) {
    const bx = 0.15;
    const bz = -1.55;
    const W = 1.25;
    const D = 0.78;
    m.box('wood', W, 0.5, D, { x: bx, z: bz }, 0.4);
    m.gable('thatch', W, D, 0.78, { x: bx, y: 0.5, z: bz }, 0.4, 0.09);
    m.gableEnds('wood', W, D, 0.78, { x: bx, y: 0.5, z: bz });
    m.box('dark', 0.36, 0.42, 0.02, { x: bx, z: bz + D / 2 + 0.006 });
    for (const sx of [-1, 1]) m.box('wood', 0.2, 0.42, 0.02, { x: bx + sx * 0.3, z: bz + D / 2 + 0.06, ry: sx * 0.6 });
    m.box('dark', 0.12, 0.12, 0.02, { x: bx, y: 0.85, z: bz + D / 2 + 0.006 });
    // fleeces and sacks of wool by the door
    for (const [x, z] of [[0.75, -1.05], [0.88, -0.92], [-0.55, -1.0]]) m.dome('canvas', 0.11, 7, { x, z, sy: 0.55 });
    m.sack(0.95, -1.2, 0.9, 0.3).sack(1.08, -1.05, 0.85, 1.4).sack(-0.7, -1.15, 0.9, 0.6);
    m.box('wood', 0.42, 0.1, 0.16, { x: -0.35, y: 0.08, z: -1.0, ry: 0.2 }, 0.3);
    m.animal('sheep', 1.25, -0.7, -0.6, 0.26);
  }
  return m;
};

// 山脈: a mine: a timber portal into an outcrop, rails out of the adit with a cart of ore on them, a
// lantern, a heap of spoil; level 2 adds the headframe: a timber tower with its great wheel over a
// shaft, a winding house, heaps of ore
FACILITY.mountains = (lv) => {
  const m = new Model();
  const rnd = rng(27);
  const ox = -0.15;
  const oz = -0.6;
  const g = new THREE.LatheGeometry([[0, 0], [1.0, 0], [0.94, 0.38], [0.66, 0.82], [0.34, 1.08], [0.0, 1.16]].map(([a, b]) => new THREE.Vector2(Math.max(a, 0.0001), b)), 11);
  rough(g, 0.12, 3);
  g.scale(1.25, 1, 0.72);
  m.add('rock', g, { x: ox, z: oz });
  // the portal and the dark of the adit
  const pz = oz + 0.66;
  for (const sx of [-1, 1]) m.box('wood', 0.07, 0.56, 0.07, { x: ox + sx * 0.22, z: pz });
  m.box('wood', 0.62, 0.08, 0.11, { x: ox, y: 0.55, z: pz });
  m.box('dark', 0.38, 0.52, 0.36, { x: ox, z: pz - 0.17 });
  // rails, sleepers, the cart of ore
  for (let k = 0; k < 7; k++) m.box('wood', 0.28, 0.02, 0.05, { x: ox, z: pz + 0.04 + k * 0.14 }, 0.3);
  for (const sx of [-1, 1]) m.box('metal', 0.02, 0.025, 0.95, { x: ox + sx * 0.08, y: 0.02, z: pz + 0.47 });
  const cz = pz + 0.6;
  m.box('wood', 0.22, 0.12, 0.3, { x: ox, y: 0.05, z: cz }, 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.wheel(ox + sx * 0.1, 0.04, cz + sz * 0.09, 0.04, { w: 0.02 });
  m.dome('rock', 0.13, 7, { x: ox, y: 0.16, z: cz, sx: 0.8, sz: 1.1, sy: 0.6 });
  // a lantern on a post, the spoil heap, the flag on the outcrop
  m.box('wood', 0.03, 0.42, 0.03, { x: ox + 0.38, z: pz + 0.08 });
  m.box('glow', 0.05, 0.06, 0.05, { x: ox + 0.38, y: 0.42, z: pz + 0.08 });
  m.rubble('rock', 0.7, 0.3, 0.34, 0.26, rnd, { n: 3, block: 0.8 });
  m.flag(ox - 0.1, oz, 0.7, { y: 1.02 });
  if (lv >= 2) {
    // the headframe: four legs leaning in, braces, the great wheel at the top over the shaft
    const hx = 0.95;
    const hz = -1.05;
    const H = 1.55;
    const b = 0.34;
    const t = 0.12;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.beam('wood', hx + sx * b, 0, hz + sz * b, hx + sx * t, H, hz + sz * t, 0.03, 4);
    for (const y of [0.45, 0.95]) {
      const w = b - ((b - t) * y) / H;
      for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) m.beam('wood', hx + ax * w, y, hz + az * w, hx + bx * w, y, hz + bz * w, 0.018, 4);
    }
    m.box('wood', 0.34, 0.06, 0.34, { x: hx, y: H, z: hz }, 0.3);
    m.wheel(hx, H + 0.22, hz, 0.24, { w: 0.05 });
    m.beam('dark', hx, H + 0.22, hz + 0.24, hx, 0.05, hz + 0.05, 0.006, 3);
    m.beam('dark', hx, H + 0.46, hz, hx + 0.6, 0.35, hz + 0.6, 0.006, 3);
    // the shaft's collar, the winding house, ore
    for (const [dx, dz, w, d] of [[0, -0.24, 0.56, 0.1], [0, 0.24, 0.56, 0.1], [-0.24, 0, 0.1, 0.38], [0.24, 0, 0.1, 0.38]]) m.box('stone', w, 0.12, d, { x: hx + dx, z: hz + dz }, 0.3);
    m.box('dark', 0.38, 0.02, 0.38, { x: hx, y: 0.04, z: hz });
    const wx = hx + 0.75;
    const wz = hz + 0.65;
    m.box('wood', 0.48, 0.34, 0.4, { x: wx, z: wz, ry: -0.6 }, 0.4);
    m.gable('thatch', 0.48, 0.4, 0.2, { x: wx, y: 0.34, z: wz, ry: -0.6 }, 0.4, 0.06);
    m.gableEnds('wood', 0.48, 0.4, 0.2, { x: wx, y: 0.34, z: wz, ry: -0.6 });
    m.rubble('rock', hx - 0.75, hz + 0.25, 0.32, 0.3, rnd, { n: 2, block: 0.7 });
    m.rubble('metal', hx - 0.2, hz + 0.75, 0.22, 0.2, rnd, { n: 0 });
  }
  return m;
};

export const FACILITY_MODELS = FACILITY;

export const WONDER_MODELS = WONDER;

// ── the basic cards' pictures (the road is modelled here; the village, the city and the deck of
// development cards are the map's own pieces, set up in Blender by tools/art/cards/bldgcards.py) ──
export const CARD_MODELS = {
  // 道路: a stretch of paved road bending across, kerbs along both sides, a milestone, a handcart
  road: () => {
    const m = new Model();
    const pts = [[-1.25, 0.6], [-0.55, 0.22], [0.2, 0.02], [1.15, -0.4]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ry = -Math.atan2(z1 - z0, x1 - x0);
      const nx = -(z1 - z0) / len;
      const nz = (x1 - x0) / len;
      m.box('street', len + 0.14, 0.05, 0.62, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, ry }, 0.42);
      for (const s of [-1, 1]) m.box('stone', len + 0.12, 0.07, 0.08, { x: (x0 + x1) / 2 + nx * 0.35 * s, z: (z0 + z1) / 2 + nz * 0.35 * s, ry }, 0.3);
    }
    m.box('stone', 0.14, 0.26, 0.09, { x: 0.25, z: -0.42 }, 0.3);
    m.cyl('stone', 0.07, 0.07, 0.09, 10, { x: 0.25 + 0.045, y: 0.26, z: -0.42, rz: Math.PI / 2 }, 0.3);
    m.plant('fern_b', -0.9, 0, -0.15, 0.3).plant('fern_b', 0.75, 0, 0.35, 0.32).plant('fern_c', -0.2, 0, 0.55, 0.25);
    const C = new Model();
    C.box('wood', 0.42, 0.1, 0.3, { y: 0.14 }, 0.3);
    for (const sz of [-1, 1]) C.wheel(0, 0.12, sz * 0.17, 0.12, { ry: Math.PI / 2 });
    for (const sz of [-1, 1]) C.box('wood', 0.42, 0.025, 0.025, { x: 0.36, y: 0.12, z: sz * 0.1, rz: 0.25 });
    C.sack(-0.08, 0.0, 0.8, 0.4);
    C.part('props', 'wooden_crate_01', { x: 0.08, z: 0.02, ry: 0.3 }, 0.12);
    m.merge(C, { x: -0.3, z: 0.18, ry: 0.42, s: 1.35 });
    return m;
  },
};

// the model of a building ('granary'…), a wonder at a stage, or a development facility, or null
export function buildingModel(k) {
  return BUILD[k] ? BUILD[k]() : null;
}
export function wonderModel(k, stage) {
  return WONDER[k] ? WONDER[k](stage) : null;
}
export function facilityModel(terrain, level) {
  return FACILITY[terrain] ? FACILITY[terrain](level) : null;
}
