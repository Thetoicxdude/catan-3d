// The development mode's buildings of 2026-11-18 (the proposal「發展模式：新增特殊建築」): the twelve of
// the five directions and the thirteen neutral ones, beside a settlement (front towards +z, the
// settlement behind at −z), built with the kit in devkit.js like the others (devmodels.js); and what a
// third level adds to a development facility (beside a farmstead's city). Each has an outline of its
// own so it reads from the map's camera: a gold sheaf on a roof, a crane, an obelisk, a dome, a ring of
// columns, steps of terraces…; the owner's colour on the roofs and the cloth.
import * as THREE from 'three';
import { Model, TAU, rng, house, haystack } from './devkit.js';

export const BUILD2 = {};
const B = BUILD2;

// a building with a gable roof in one go: walls (house), the roof, its ends
function hall(m, { w, h, d, x = 0, z = 0, ry = 0, wall = 'plaster', roof = 'roof', rh = 0.28, windows = 2, frame = true, door = true }) {
  const sub = new Model();
  house(sub, { w, h, d, wall, windows, frame, door });
  sub.gable(roof, w, d, rh, { y: h }, 0.32, 0.06);
  sub.gableEnds(wall === 'plaster' ? 'plaster' : wall, w, d, rh, { y: h });
  return m.merge(sub, { x, z, ry });
}

// ── farming ──

// 農莊: a great barn (the owner's roof) with a hayloft door and its hoist, a fenced paddock with a cow, a
// hay wain
B.farmstead = () => {
  const m = new Model();
  const z0 = -0.28;
  m.box('wood', 1.05, 0.5, 0.62, { x: -0.12, z: z0 }, 0.4);
  // (a gambrel's outline: a steep lower roof under a flat upper one)
  m.gable('roof', 1.05, 0.62, 0.22, { x: -0.12, y: 0.5, z: z0 }, 0.32, 0.08);
  m.gable('roof', 1.05, 0.36, 0.2, { x: -0.12, y: 0.68, z: z0 }, 0.32, 0.02);
  m.gableEnds('wood', 1.05, 0.62, 0.22, { x: -0.12, y: 0.5, z: z0 });
  m.gableEnds('wood', 1.05, 0.36, 0.2, { x: -0.12, y: 0.68, z: z0 });
  // the doors with their white cross braces, the hayloft and its hoist beam
  m.box('dark', 0.34, 0.36, 0.02, { x: -0.12, z: z0 + 0.315 });
  for (const s of [-1, 1]) m.box('plaster', 0.02, 0.44, 0.012, { x: -0.12 + s * 0.08, y: 0.0, z: z0 + 0.33, rz: s * 0.7 });
  m.box('dark', 0.16, 0.13, 0.02, { x: -0.12, y: 0.55, z: z0 + 0.315 });
  m.box('wood', 0.03, 0.03, 0.24, { x: -0.12, y: 0.74, z: z0 + 0.4 });
  m.cyl('dark', 0.004, 0.004, 0.3, 3, { x: -0.12, y: 0.44, z: z0 + 0.5 });
  // the paddock and its cow, a trough
  m.fence(0.32, 0.1, 0.32, 0.72, { h: 0.2 });
  m.fence(0.32, 0.72, 0.8, 0.72, { h: 0.2 });
  m.fence(0.8, 0.72, 0.8, 0.1, { h: 0.2 });
  m.animal('cow', 0.56, 0.42, 0.6, 0.34);
  m.box('wood', 0.26, 0.07, 0.09, { x: 0.62, z: 0.16 }, 0.3);
  // the hay wain by the door
  m.box('wood', 0.42, 0.06, 0.26, { x: -0.5, y: 0.13, z: 0.4, ry: 0.4 }, 0.3);
  for (const s of [-1, 1]) m.wheel(-0.5 - s * 0.14 * Math.cos(0.4), 0.11, 0.4 + s * 0.14 * Math.sin(0.4) + 0.14, 0.11, { ry: 0.4 + Math.PI / 2 });
  m.lathe('thatch', haystack(0.7), 10, { x: -0.5, y: 0.17, z: 0.4 }, 0.4);
  m.flag(0.5, -0.4, 1.35);
  return m;
};

// 屯田: a settler's cabin of logs by fresh furrows, a plough left in the last of them, a scarecrow in
// the owner's coat
B.homestead = () => {
  const m = new Model();
  const cx = -0.42;
  const cz = -0.32;
  for (let k = 0; k < 4; k++) for (const sz of [-1, 1]) m.lying('wood', 0.034, 0.62, { x: cx, y: k * 0.065, z: cz + sz * 0.2 }, 7);
  for (let k = 0; k < 4; k++) for (const sx of [-1, 1]) m.lying('wood', 0.034, 0.46, { x: cx + sx * 0.28, y: k * 0.065 + 0.032, z: cz, ry: Math.PI / 2 }, 7);
  m.box('wood', 0.52, 0.28, 0.36, { x: cx, z: cz }, 0.4);
  m.gable('roof', 0.62, 0.46, 0.22, { x: cx, y: 0.29, z: cz }, 0.32, 0.06);
  m.gableEnds('wood', 0.62, 0.46, 0.22, { x: cx, y: 0.29, z: cz });
  m.box('dark', 0.12, 0.2, 0.02, { x: cx + 0.1, z: cz + 0.24 });
  m.box('stone', 0.09, 0.3, 0.09, { x: cx - 0.2, y: 0.3, z: cz - 0.08 }, 0.3);
  m.smokeAt(cx - 0.2, 0.62, cz - 0.08, 0.6);
  // the furrows: ridges of turned earth, the plough in the last
  for (let i = 0; i < 6; i++) m.lying('earth', 0.05, 0.95, { x: 0.32, y: -0.03, z: 0.05 + i * 0.12, sy: 0.7 }, 6);
  m.box('wood', 0.36, 0.03, 0.03, { x: 0.68, y: 0.12, z: 0.65, rz: 0.4 });
  m.box('metal', 0.08, 0.06, 0.025, { x: 0.5, y: 0.04, z: 0.65, rz: 0.4 });
  for (const s of [-1, 1]) m.box('wood', 0.2, 0.02, 0.02, { x: 0.86, y: 0.23, z: 0.65 + s * 0.05, rz: 0.5 });
  // the scarecrow
  const sx = 0.2;
  const sz = -0.32;
  m.box('wood', 0.03, 0.62, 0.03, { x: sx, z: sz });
  m.box('wood', 0.38, 0.03, 0.03, { x: sx, y: 0.46, z: sz });
  m.box('cloth', 0.16, 0.2, 0.08, { x: sx, y: 0.3, z: sz });
  for (const s of [-1, 1]) m.box('cloth', 0.1, 0.06, 0.06, { x: sx + s * 0.12, y: 0.43, z: sz });
  m.dome('burlap', 0.06, 8, { x: sx, y: 0.5, z: sz });
  m.cone('thatch', 0.11, 0.07, 9, { x: sx, y: 0.55, z: sz });
  m.cyl('thatch', 0.11, 0.11, 0.01, 9, { x: sx, y: 0.55, z: sz });
  return m;
};

// 農會: a long meeting hall of the farmers' guild, a great gilded sheaf of wheat on its ridge, a
// weighing beam and sacks at the door
B.grange = () => {
  const m = new Model();
  const z0 = -0.22;
  hall(m, { w: 1.18, h: 0.5, d: 0.56, z: z0, wall: 'stone', frame: false, windows: 4, rh: 0.3 });
  // the sheaf on the ridge: a bundle of gold stalks, bound in the middle, the ears fanned out
  const sy = 0.8;
  for (let i = 0; i < 9; i++) {
    const a = ((i - 4) / 4) * 0.42;
    m.cyl('gold', 0.012, 0.016, 0.42, 4, { x: Math.sin(a) * 0.05, y: sy, z: z0, rz: a });
    m.cone('gold', 0.03, 0.12, 5, { x: Math.sin(a) * 0.2, y: sy + 0.4 * Math.cos(a) - 0.02, z: z0, rz: a });
  }
  m.cyl('roof', 0.05, 0.05, 0.05, 8, { y: sy + 0.14, z: z0 });
  // the porch, the weighing beam and its sacks
  m.box('wood', 0.5, 0.03, 0.2, { y: 0.34, z: z0 + 0.36, rx: 0.15 }, 0.3);
  for (const s of [-1, 1]) m.box('wood', 0.03, 0.34, 0.03, { x: s * 0.22, z: z0 + 0.45 });
  m.box('wood', 0.03, 0.46, 0.03, { x: 0.52, z: 0.3 });
  m.box('wood', 0.42, 0.025, 0.025, { x: 0.52, y: 0.46, z: 0.3, rz: 0.08 });
  for (const s of [-1, 1]) {
    m.cyl('dark', 0.003, 0.003, 0.18, 3, { x: 0.52 + s * 0.19, y: 0.28 - s * 0.017, z: 0.3 });
    m.cyl('metal', 0.07, 0.07, 0.012, 10, { x: 0.52 + s * 0.19, y: 0.27 - s * 0.017, z: 0.3 });
  }
  m.sack(0.33, 0.24 + 0.03, 0.55, 0.2);
  for (const [x, z, s, r] of [[-0.35, 0.36, 0.9, 0.2], [-0.5, 0.44, 0.85, 1.1], [-0.42, 0.56, 0.8, 2.0], [0.1, 0.5, 0.9, 0.6]]) m.sack(x, z, s, r);
  return m;
};

// ── trade ──

// 商隊旅館: a caravanserai: a square court behind a high arched gate, its walls of sand-coloured stone, a
// dome on one corner, horses and bales of goods at the gate
B.caravan = () => {
  const m = new Model();
  const W = 1.2;
  const z0 = -0.28;
  const h = 0.46;
  // the court's walls; the front one with the gate
  m.box('sand', W, h, 0.1, { z: z0 - W / 2 + 0.05 }, 0.5);
  for (const s of [-1, 1]) m.box('sand', 0.1, h, W - 0.1, { x: s * (W / 2 - 0.05), z: z0 }, 0.5);
  m.arcade('sand', W, h + 0.14, 1, { z: z0 + W / 2 - 0.05 }, { depth: 0.12, open: 0.32, rise: 0.66, see: true });
  m.box('stone', W + 0.04, 0.04, 0.14, { y: h + 0.14, z: z0 + W / 2 - 0.05 }, 0.4);
  for (const s of [-1, 1]) m.crenels('sand', s * 0.5, z0 + W / 2 - 0.05, s * 0.12, z0 + W / 2 - 0.05, h + 0.18, { h: 0.07, w: 0.08, gap: 0.06 });
  // the inner rooms round the court with their doors, a strip of the owner's awning over them
  m.box('plaster', W - 0.22, 0.3, 0.24, { z: z0 - W / 2 + 0.22 }, 0.5);
  for (let i = 0; i < 4; i++) m.box('dark', 0.08, 0.16, 0.02, { x: -0.33 + i * 0.22, z: z0 - W / 2 + 0.345 });
  m.box('cloth', W - 0.24, 0.015, 0.12, { y: 0.29, z: z0 - W / 2 + 0.39, rx: 0.3 }, 0.4);
  // the court's floor of beaten earth
  m.box('earth', W - 0.22, 0.012, W - 0.5, { z: z0 + 0.12 }, 0.5);
  // the corner dome on its drum
  m.cyl('sand', 0.2, 0.2, 0.2, 14, { x: -W / 2 + 0.16, y: h, z: z0 - W / 2 + 0.16 });
  m.dome('roof', 0.21, 14, { x: -W / 2 + 0.16, y: h + 0.2, z: z0 - W / 2 + 0.16 });
  m.cone('gold', 0.025, 0.1, 5, { x: -W / 2 + 0.16, y: h + 0.4, z: z0 - W / 2 + 0.16 });
  // a well in the court
  m.cyl('stone', 0.1, 0.1, 0.12, 12, { x: 0.2, z: z0 + 0.05 });
  m.cyl('water', 0.08, 0.08, 0.005, 12, { x: 0.2, y: 0.115, z: z0 + 0.05 });
  // at the gate: horses with their packs, bales and a rug
  m.animal('horse', 0.55, 0.52, -0.3, 0.4);
  m.animal('horse', -0.6, 0.55, 0.4, 0.38);
  for (const [x, z, ry] of [[0.12, 0.5, 0.2], [-0.2, 0.58, -0.3], [-0.05, 0.68, 0.9]]) m.box('burlap', 0.2, 0.13, 0.14, { x, z, ry }, 0.3);
  m.box('burlap', 0.3, 0.01, 0.2, { x: 0.22, z: 0.74, ry: 0.3 }, 0.3);
  return m;
};

// 港務局: a customs house of stone with a square tower and a gallery, a mast of signal flags on top,
// an anchor by the steps, a bollard and coils of rope
B.harborOffice = () => {
  const m = new Model();
  const z0 = -0.2;
  m.box('stone', 1.0, 0.5, 0.56, { z: z0 }, 0.5);
  m.hip('roof', 1.0, 0.56, 0.22, { y: 0.5, z: z0 }, 0.32, 0.05);
  for (let i = 0; i < 4; i++) m.box('dark', 0.09, 0.17, 0.02, { x: -0.36 + i * 0.24, y: 0.22, z: z0 + 0.286 });
  m.box('dark', 0.14, 0.26, 0.02, { x: 0, z: z0 + 0.287 });
  // the tower, its gallery and the mast of signal flags
  const tx = 0.32;
  const tz = z0 - 0.1;
  m.box('stone', 0.3, 1.05, 0.3, { x: tx, z: tz }, 0.4);
  m.box('stone', 0.4, 0.04, 0.4, { x: tx, y: 1.05, z: tz }, 0.3);
  for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) m.box('dark', Math.abs(bx - ax) * 0.2 || 0.01, 0.09, Math.abs(bz - az) * 0.2 || 0.01, { x: tx + ((ax + bx) / 2) * 0.2, y: 1.09, z: tz + ((az + bz) / 2) * 0.2 }, 0.3);
  m.hip('roof', 0.28, 0.28, 0.2, { x: tx, y: 1.18, z: tz }, 0.3, 0.02);
  m.box('dark', 0.08, 0.13, 0.02, { x: tx, y: 0.75, z: tz + 0.156 });
  m.cyl('wood', 0.014, 0.018, 0.6, 5, { x: tx, y: 1.36, z: tz });
  m.box('wood', 0.36, 0.015, 0.015, { x: tx, y: 1.8, z: tz });
  for (const [dx, dy, slot] of [[-0.15, 1.72, 'cloth'], [0.15, 1.72, 'canvas'], [0.15, 1.6, 'cloth']]) m.plane(slot, 0.09, 0.07, { x: tx + dx, y: dy, z: tz });
  // the anchor by the steps
  const ax = -0.46;
  const az = 0.32;
  m.box('metal', 0.03, 0.32, 0.03, { x: ax, z: az });
  m.box('metal', 0.16, 0.025, 0.03, { x: ax, y: 0.26, z: az });
  const fl = new THREE.TorusGeometry(0.12, 0.016, 4, 12, Math.PI);
  fl.rotateZ(Math.PI);
  fl.translate(0, 0.12, 0);
  m.add('metal', fl, { x: ax, z: az });
  m.cyl('metal', 0.035, 0.035, 0.02, 8, { x: ax, y: 0.32, z: az, rx: Math.PI / 2 });
  m.box('stone', 0.34, 0.05, 0.14, { z: z0 + 0.35 }, 0.3);
  // a bollard and a coil of rope
  m.cyl('dark', 0.05, 0.06, 0.16, 8, { x: 0.45, z: 0.42 });
  const rope = new THREE.TorusGeometry(0.09, 0.022, 4, 12);
  rope.rotateX(Math.PI / 2);
  m.add('burlap', rope, { x: 0.18, y: 0.02, z: 0.5 });
  return m;
};

// ── expansion ──

// 築路司: the road-builders' depot: a shed of tools, a great stone roller, paving setts stacked, a short
// stretch of finished road with its kerbs, a barrow of gravel
B.roadworks = () => {
  const m = new Model();
  const rnd = rng(41);
  hall(m, { w: 0.7, h: 0.38, d: 0.42, x: -0.42, z: -0.42, wall: 'wood', frame: false, windows: 1, rh: 0.22 });
  // the stretch of road, kerbs on both sides, coming out of the depot
  m.box('street', 1.3, 0.04, 0.44, { x: 0.02, z: 0.12, ry: 0.12 }, 0.42);
  for (const s of [-1, 1]) m.box('stone', 1.3, 0.06, 0.06, { x: 0.02 - s * 0.03, z: 0.12 + s * 0.25, ry: 0.12 }, 0.3);
  // the roller: a stone drum in a wooden frame with its shaft
  const rx = 0.42;
  const rz = 0.12;
  m.lying('stone', 0.15, 0.36, { x: rx, y: 0.03, z: rz, ry: Math.PI / 2 + 0.12 }, 12);
  for (const s of [-1, 1]) m.box('wood', 0.04, 0.05, 0.42, { x: rx + s * 0.2, y: 0.17, z: rz + 0.04, ry: 0.12 });
  m.box('wood', 0.03, 0.03, 0.5, { x: rx - 0.02, y: 0.22, z: rz + 0.38, ry: 0.12, rx: 0.3 });
  // setts stacked by the shed, a barrow of gravel, a heap of it
  m.blocks('stone', 0.05, 0, -0.52, 7, rnd, { w: 0.14, h: 0.08, d: 0.12 });
  m.box('wood', 0.22, 0.08, 0.15, { x: -0.48, y: 0.08, z: 0.52, ry: -0.5 }, 0.3);
  m.dome('rock', 0.09, 7, { x: -0.48, y: 0.16, z: 0.52, sy: 0.5 });
  m.wheel(-0.37, 0.06, 0.58, 0.06, { ry: -0.5 });
  m.rubble('rock', -0.66, 0.2, 0.17, 0.13, rnd, { n: 0 });
  // a pick and a shovel against the shed
  m.box('wood', 0.02, 0.36, 0.02, { x: -0.08, y: 0.0, z: -0.2, rz: 0.15 });
  m.box('metal', 0.16, 0.025, 0.025, { x: -0.03, y: 0.34, z: -0.2 });
  m.box('wood', 0.02, 0.34, 0.02, { x: -0.16, y: 0.0, z: -0.19, rz: -0.2 });
  m.box('metal', 0.07, 0.08, 0.01, { x: -0.19, y: 0.0, z: -0.19, rz: -0.2 });
  m.flag(0.62, -0.4, 1.25);
  return m;
};

// 新市鎮: a new quarter: three narrow houses of different heights round a little square with a well,
// the owner's roofs, a lamp post
B.newTown = () => {
  const m = new Model();
  hall(m, { w: 0.42, h: 0.56, d: 0.42, x: -0.5, z: -0.3, rh: 0.3, windows: 1 });
  hall(m, { w: 0.38, h: 0.72, d: 0.4, x: 0.0, z: -0.42, rh: 0.28, windows: 1 });
  hall(m, { w: 0.44, h: 0.46, d: 0.4, x: 0.5, z: -0.28, ry: -0.35, rh: 0.26, windows: 1, wall: 'stone', frame: false });
  for (const [x, z] of [[-0.5, -0.44], [0.0, -0.56]]) {
    m.box('stone', 0.07, 0.24, 0.07, { x: x + 0.1, y: x < 0 ? 0.62 : 0.8, z }, 0.3);
    m.smokeAt(x + 0.1, x < 0 ? 0.88 : 1.06, z, 0.5);
  }
  // the square: setts, the well with its little roof, a lamp post
  m.cyl('street', 0.5, 0.5, 0.02, 16, { x: 0.0, z: 0.28 }, 0.42);
  m.cyl('stone', 0.1, 0.1, 0.16, 12, { x: 0.0, z: 0.28 });
  m.cyl('water', 0.08, 0.08, 0.005, 12, { x: 0.0, y: 0.155, z: 0.28 });
  for (const s of [-1, 1]) m.box('wood', 0.025, 0.32, 0.025, { x: s * 0.09, z: 0.28 });
  m.gable('roof', 0.24, 0.16, 0.08, { y: 0.32, z: 0.28 }, 0.3, 0.03);
  m.box('dark', 0.025, 0.5, 0.025, { x: 0.42, z: 0.42 });
  m.box('glow', 0.05, 0.07, 0.05, { x: 0.42, y: 0.5, z: 0.42 });
  m.plant('broad_b', -0.55, 0, 0.42, 0.35);
  return m;
};

// 市政廳: the town hall: an arcaded ground floor, the hall above, a tall bell tower over the middle with
// a clock face and the owner's flag
B.townHall = () => {
  const m = new Model();
  const z0 = -0.25;
  const W = 1.2;
  m.arcade('stone', W, 0.32, 5, { z: z0 + 0.25 }, { depth: 0.08, open: 0.6, rise: 0.8 });
  m.box('plaster', W, 0.32, 0.46, { z: z0 - 0.02 }, 0.5);
  m.box('plaster', W, 0.3, 0.56, { y: 0.32, z: z0 }, 0.5);
  for (let i = 0; i < 5; i++) m.box('dark', 0.08, 0.15, 0.02, { x: -0.48 + i * 0.24, y: 0.4, z: z0 + 0.286 });
  m.box('stone', W + 0.04, 0.035, 0.6, { y: 0.32, z: z0 }, 0.4);
  m.gable('roof', W, 0.56, 0.24, { y: 0.62, z: z0 }, 0.32, 0.05);
  m.gableEnds('plaster', W, 0.56, 0.24, { y: 0.62, z: z0 });
  // the tower: a square shaft out of the ridge, the belfry's openings, a clock, a spire
  m.box('stone', 0.26, 0.95, 0.26, { y: 0.45, z: z0 }, 0.4);
  for (const [dx, dz, ry] of [[0, 0.132, 0], [0, -0.132, 0], [0.132, 0, Math.PI / 2], [-0.132, 0, Math.PI / 2]]) m.box('dark', 0.1, 0.13, 0.01, { x: dx, y: 1.22, z: z0 + dz, ry });
  m.cyl('paper', 0.07, 0.07, 0.01, 14, { y: 1.04, z: z0 + 0.135, rx: Math.PI / 2 });
  m.box('dark', 0.008, 0.05, 0.004, { y: 1.05, z: z0 + 0.142 });
  m.box('dark', 0.04, 0.008, 0.004, { x: 0.015, y: 1.04, z: z0 + 0.142 });
  m.hip('roof', 0.26, 0.26, 0.38, { y: 1.4, z: z0 }, 0.3, 0.03);
  m.flag(0, z0, 0.3, { y: 1.76, w: 0.26, fh: 0.15 });
  // the steps and a bench
  m.box('stone', 0.5, 0.04, 0.16, { z: z0 + 0.38 }, 0.3);
  m.box('wood', 0.26, 0.05, 0.07, { x: 0.45, y: 0.05, z: 0.38 });
  return m;
};

// 總督府: the governor's house: a symmetrical mansion of two wings, a portico of four columns under a
// pediment, clipped hedges and a flag on the roof
B.governor = () => {
  const m = new Model();
  const z0 = -0.28;
  m.box('plaster', 1.3, 0.5, 0.5, { z: z0 }, 0.5);
  m.hip('roof', 1.3, 0.5, 0.2, { y: 0.5, z: z0 }, 0.32, 0.05);
  for (const s of [-1, 1]) {
    m.box('plaster', 0.36, 0.56, 0.6, { x: s * 0.5, z: z0 + 0.05 }, 0.5);
    m.hip('roof', 0.36, 0.6, 0.22, { x: s * 0.5, y: 0.56, z: z0 + 0.05 }, 0.32, 0.04);
    for (const y of [0.14, 0.36]) m.box('dark', 0.08, 0.13, 0.02, { x: s * 0.5, y, z: z0 + 0.356 });
  }
  for (const x of [-0.18, 0.18]) for (const y of [0.14, 0.36]) m.box('dark', 0.07, 0.12, 0.02, { x, y, z: z0 + 0.256 });
  // the portico: four columns on steps, the pediment
  for (let i = 0; i < 4; i++) m.column('marble', -0.18 + i * 0.12, z0 + 0.42, 0.04, 0.42, 0.022);
  m.box('marble', 0.48, 0.04, 0.26, { y: 0, z: z0 + 0.38 }, 0.3);
  m.box('marble', 0.44, 0.04, 0.2, { y: 0.46, z: z0 + 0.36 }, 0.3);
  m.gable('roof', 0.22, 0.46, 0.12, { y: 0.5, z: z0 + 0.36, ry: Math.PI / 2 }, 0.3, 0.02);
  m.gableEnds('marble', 0.22, 0.46, 0.12, { y: 0.5, z: z0 + 0.36, ry: Math.PI / 2 });
  m.box('dark', 0.1, 0.22, 0.02, { y: 0.04, z: z0 + 0.256 });
  // the hedges and the gravel walk
  for (const s of [-1, 1]) m.box('leaf', 0.42, 0.12, 0.1, { x: s * 0.42, z: 0.42 }, 0.3);
  m.box('sand', 0.24, 0.01, 0.4, { z: 0.38 }, 0.4);
  m.flag(0, z0 - 0.1, 0.7, { y: 0.7 });
  return m;
};

// ── learning ──

// 講堂: a lecture theatre in the open: tiers of stone seats in a half round about a lectern, a portico
// with a small roof behind it
B.lectureHall = () => {
  const m = new Model();
  const z0 = -0.12;
  // the tiers: a stepped half bowl round the back (its profile turned half a turn), its two ends closed
  const prof = [[0.3, 0]];
  for (let k = 0; k < 4; k++) prof.push([0.3 + k * 0.15, 0.1 + k * 0.1], [0.45 + k * 0.15, 0.1 + k * 0.1]);
  prof.push([0.9, 0]);
  const bowl = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 18, Math.PI / 2, Math.PI);
  m.add('stone', bowl, { z: z0 });
  for (const sx of [1, -1]) {
    const pts = sx > 0 ? prof : prof.slice().reverse();
    const cap = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([r, y]) => new THREE.Vector2(sx * r, y))));
    m.add('stone', cap, { z: z0 + 0.001 });
  }
  // the floor and the lectern at the middle, the speaker's awning in the owner's colour
  m.cyl('street', 0.3, 0.3, 0.02, 14, { z: z0 }, 0.4);
  m.box('wood', 0.14, 0.24, 0.1, { z: z0 + 0.05 }, 0.3);
  m.box('wood', 0.18, 0.02, 0.14, { y: 0.24, z: z0 + 0.06, rx: -0.3 }, 0.3);
  m.plane('paper', 0.1, 0.07, { y: 0.27, z: z0 + 0.06, rx: -Math.PI / 2 + 0.3 });
  // the back wall with its portico of columns and a roof
  const bz = z0 - 0.8;
  m.box('stone', 1.4, 0.56, 0.12, { z: bz }, 0.5);
  for (let i = 0; i < 6; i++) m.column('marble', -0.6 + i * 0.24, bz + 0.16, 0.0, 0.56, 0.025);
  m.box('marble', 1.42, 0.05, 0.3, { y: 0.56, z: bz + 0.08 }, 0.3);
  m.gable('roof', 1.42, 0.3, 0.12, { y: 0.61, z: bz + 0.08 }, 0.3, 0.03);
  m.flag(0.66, bz, 1.2);
  return m;
};

// 抄經室: a scriptorium: a round stone tower with tall arched windows lit from inside, a conical roof, a
// chapel-like room beside it, scrolls drying on a rack
B.scriptorium = () => {
  const m = new Model();
  const tx = -0.3;
  const tz = -0.3;
  m.cyl('stone', 0.3, 0.32, 0.95, 16, { x: tx, z: tz }, 0.5);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    m.box('glow', 0.06, 0.2, 0.02, { x: tx + Math.sin(a) * 0.31, y: 0.55, z: tz + Math.cos(a) * 0.31, ry: a });
    m.box('dark', 0.06, 0.16, 0.02, { x: tx + Math.sin(a + 0.8) * 0.315, y: 0.22, z: tz + Math.cos(a + 0.8) * 0.315, ry: a + 0.8 });
  }
  m.cyl('stone', 0.34, 0.34, 0.05, 16, { x: tx, y: 0.95, z: tz });
  m.cone('roof', 0.36, 0.6, 16, { x: tx, y: 1.0, z: tz }, 0.4);
  m.cone('gold', 0.02, 0.12, 5, { x: tx, y: 1.58, z: tz });
  // the copying room
  hall(m, { w: 0.6, h: 0.42, d: 0.44, x: 0.32, z: -0.22, wall: 'stone', frame: false, windows: 2, rh: 0.26 });
  m.box('glow', 0.07, 0.1, 0.02, { x: 0.32, y: 0.22, z: 0.005 });
  // the rack of scrolls drying, a bench with an inkpot
  for (const x of [0.12, 0.7]) m.box('wood', 0.03, 0.42, 0.03, { x, z: 0.42 });
  m.box('wood', 0.62, 0.025, 0.025, { x: 0.41, y: 0.4, z: 0.42 });
  for (let i = 0; i < 5; i++) m.plane('paper', 0.08, 0.26, { x: 0.18 + i * 0.115, y: 0.26, z: 0.42 });
  m.box('wood', 0.3, 0.05, 0.1, { x: -0.35, y: 0.12, z: 0.4 }, 0.3);
  for (const s of [-1, 1]) m.box('wood', 0.03, 0.12, 0.08, { x: -0.35 + s * 0.12, z: 0.4 });
  m.cyl('dark', 0.02, 0.02, 0.03, 6, { x: -0.3, y: 0.17, z: 0.4 });
  m.box('wood', 0.012, 0.08, 0.012, { x: -0.3, y: 0.18, z: 0.4, rz: 0.3 });
  return m;
};

// 大學: a university: a domed library on a drum of columns between two halls, a slender spire on one,
// a lawn with a statue in front
B.university = () => {
  const m = new Model();
  const z0 = -0.3;
  for (const s of [-1, 1]) {
    hall(m, { w: 0.46, h: 0.5, d: 0.52, x: s * 0.46, z: z0, wall: 'stone', frame: false, windows: 2, rh: 0.22 });
  }
  // the library: a round drum ringed by columns, its dome
  m.cyl('plaster', 0.28, 0.28, 0.52, 18, { z: z0 });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    m.cyl('marble', 0.018, 0.022, 0.48, 6, { x: Math.sin(a) * 0.31, z: z0 + Math.cos(a) * 0.31 });
  }
  m.cyl('marble', 0.34, 0.34, 0.04, 18, { y: 0.48, z: z0 });
  m.cyl('plaster', 0.25, 0.25, 0.12, 18, { y: 0.52, z: z0 });
  m.dome('roof', 0.27, 18, { y: 0.64, z: z0 });
  m.cyl('marble', 0.05, 0.05, 0.1, 8, { y: 0.9, z: z0 });
  m.dome('gold', 0.05, 8, { y: 1.0, z: z0 });
  // the spire on the right hall
  m.box('stone', 0.16, 0.36, 0.16, { x: 0.46, y: 0.72, z: z0 - 0.08 }, 0.3);
  m.cone('roof', 0.12, 0.5, 4, { x: 0.46, y: 1.08, z: z0 - 0.08, ry: Math.PI / 4 }, 0.3);
  // the lawn, the path, the statue on its plinth
  m.box('leaf', 1.2, 0.01, 0.5, { z: 0.35 }, 0.5);
  m.box('sand', 0.16, 0.012, 0.5, { z: 0.35 }, 0.4);
  m.box('stone', 0.12, 0.16, 0.12, { x: 0.35, z: 0.38 }, 0.3);
  m.cyl('metal', 0.03, 0.035, 0.16, 6, { x: 0.35, y: 0.16, z: 0.38 });
  m.dome('metal', 0.035, 6, { x: 0.35, y: 0.32, z: 0.38 });
  return m;
};

// ── the neutral buildings ──

// 貨棧: a tall timber storehouse with a hoist beam over its loft doors, a load on the rope, crates and
// barrels stacked at the foot
B.warehouse = () => {
  const m = new Model();
  const z0 = -0.28;
  m.box('wood', 0.9, 0.82, 0.56, { z: z0 }, 0.4);
  for (const y of [0.0, 0.41]) m.box('dark', 0.2, 0.26, 0.02, { y: y + 0.04, z: z0 + 0.286 });
  m.box('dark', 0.16, 0.16, 0.02, { y: 0.62, z: z0 + 0.286 });
  m.gable('roof', 0.9, 0.56, 0.3, { y: 0.82, z: z0 }, 0.32, 0.06);
  m.gableEnds('wood', 0.9, 0.56, 0.3, { y: 0.82, z: z0 });
  // the hoist beam out from the gable, the pulley, the rope and its load
  m.box('wood', 0.06, 0.06, 0.4, { y: 0.95, z: z0 + 0.42 });
  m.cyl('metal', 0.04, 0.04, 0.03, 8, { y: 0.9, z: z0 + 0.58, rz: Math.PI / 2, x: 0.015 });
  m.cyl('dark', 0.004, 0.004, 0.62, 3, { y: 0.3, z: z0 + 0.6 });
  m.part('props', 'wooden_crate_01', { y: 0.2, z: z0 + 0.6, ry: 0.3 }, 0.13);
  // crates and barrels at the foot
  m.part('props', 'wooden_crate_01', { x: 0.52, z: 0.32, ry: 0.2 }, 0.2);
  m.part('props', 'wooden_crate_01', { x: 0.55, y: 0.2, z: 0.3, ry: 0.7 }, 0.16);
  m.part('props', 'wooden_crate_01', { x: 0.3, z: 0.48, ry: -0.3 }, 0.17);
  m.barrel(-0.5, 0.32, 1);
  m.barrel(-0.36, 0.42, 0.95);
  m.barrel(-0.55, 0.52, 0.9, { lying: true, ry: 0.3 });
  m.sack(-0.18, 0.5, 0.85, 0.6);
  m.flag(-0.6, -0.6, 1.5);
  return m;
};

// 錢莊: a counting house of dressed stone, two pillars at a heavy door, barred windows, a money-changer's
// table outside with stacks of coins and an abacus
B.countingHouse = () => {
  const m = new Model();
  const z0 = -0.26;
  m.box('stone', 0.96, 0.62, 0.56, { z: z0 }, 0.5);
  m.box('stone', 1.0, 0.06, 0.6, { y: 0.62, z: z0 }, 0.4);
  m.hip('roof', 0.96, 0.56, 0.2, { y: 0.68, z: z0 }, 0.32, 0.04);
  // the door between its pillars, the windows with their bars
  m.box('wood', 0.18, 0.32, 0.03, { z: z0 + 0.29 });
  m.box('metal', 0.2, 0.025, 0.035, { y: 0.16, z: z0 + 0.3 });
  for (const s of [-1, 1]) {
    m.column('stone', s * 0.17, z0 + 0.33, 0, 0.42, 0.032);
    m.box('dark', 0.1, 0.16, 0.02, { x: s * 0.36, y: 0.32, z: z0 + 0.286 });
    for (let k = 0; k < 3; k++) m.box('metal', 0.008, 0.16, 0.01, { x: s * 0.36 - 0.03 + k * 0.03, y: 0.32, z: z0 + 0.296 });
  }
  m.box('stone', 0.44, 0.05, 0.08, { y: 0.44, z: z0 + 0.33 }, 0.3);
  // the table, the coins in stacks, the abacus, a strongbox
  const tx = 0.32;
  const tz = 0.36;
  m.box('wood', 0.42, 0.03, 0.24, { x: tx, y: 0.2, z: tz }, 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.box('wood', 0.025, 0.2, 0.025, { x: tx + sx * 0.18, z: tz + sz * 0.09 });
  for (const [dx, dz, n] of [[-0.12, -0.04, 5], [-0.05, 0.05, 3], [0.02, -0.05, 4]]) m.cyl('gold', 0.025, 0.025, 0.012 * n, 9, { x: tx + dx, y: 0.23, z: tz + dz });
  m.box('wood', 0.14, 0.08, 0.012, { x: tx + 0.12, y: 0.23, z: tz + 0.02 });
  for (let k = 0; k < 3; k++) m.cyl('dark', 0.003, 0.003, 0.12, 3, { x: tx + 0.12, y: 0.25 + k * 0.02, z: tz + 0.02, rz: Math.PI / 2 });
  m.box('wood', 0.2, 0.13, 0.13, { x: -0.42, z: 0.36, ry: 0.3 }, 0.3);
  m.box('metal', 0.21, 0.02, 0.14, { x: -0.42, y: 0.1, z: 0.36, ry: 0.3 });
  m.flag(-0.4, -0.5, 1.3);
  return m;
};

// 救濟院: an almshouse: a long low house with a row of doors, a great cauldron over a fire in front,
// benches, a basket of loaves
B.almshouse = () => {
  const m = new Model();
  const z0 = -0.32;
  m.box('plaster', 1.3, 0.36, 0.42, { z: z0 }, 0.5);
  for (let k = 0; k < 4; k++) {
    m.box('dark', 0.1, 0.22, 0.02, { x: -0.48 + k * 0.32, z: z0 + 0.216 });
    m.box('dark', 0.08, 0.08, 0.02, { x: -0.33 + k * 0.32, y: 0.2, z: z0 + 0.216 });
  }
  m.gable('roof', 1.3, 0.42, 0.24, { y: 0.36, z: z0 }, 0.32, 0.07);
  m.gableEnds('plaster', 1.3, 0.42, 0.24, { y: 0.36, z: z0 });
  for (const x of [-0.3, 0.42]) {
    m.box('stone', 0.08, 0.24, 0.08, { x, y: 0.4, z: z0 - 0.06 }, 0.3);
    m.smokeAt(x, 0.66, z0 - 0.06, 0.5);
  }
  // the cauldron on its stones, the fire under it, steam
  const cx = 0.08;
  const cz = 0.3;
  m.part('props', 'stone_fire_pit', { x: cx, z: cz }, 0.08);
  m.flame(cx, 0.03, cz, 0.07, 0.15, { smoke: false });
  m.lathe('metal', [[0, 0], [0.12, 0.02], [0.16, 0.1], [0.15, 0.2], [0.16, 0.21], [0.0, 0.21]], 12, { x: cx, y: 0.1, z: cz }, 0.3);
  m.smokeAt(cx, 0.38, cz, 0.8);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.3;
    m.cyl('dark', 0.008, 0.008, 0.36, 3, { x: cx + Math.cos(a) * 0.17, z: cz + Math.sin(a) * 0.17, rx: Math.sin(a) * 0.15, rz: -Math.cos(a) * 0.15 });
  }
  // the benches, a basket of loaves, a ladle
  for (const [x, z, ry] of [[-0.42, 0.32, 0.25], [0.55, 0.36, -0.3]]) {
    m.box('wood', 0.34, 0.03, 0.08, { x, y: 0.1, z, ry });
    for (const s of [-1, 1]) m.box('wood', 0.03, 0.1, 0.07, { x: x + s * 0.14 * Math.cos(ry), z: z - s * 0.14 * Math.sin(ry), ry });
  }
  m.part('props', 'wicker_basket_01', { x: -0.2, z: 0.55 }, 0.1);
  for (const [dx, dz] of [[-0.03, 0], [0.03, 0.02], [0, -0.03]]) m.dome('burlap', 0.035, 7, { x: -0.2 + dx, y: 0.09, z: 0.55 + dz, sy: 0.7 });
  return m;
};

// 鐵匠鋪: a smithy: an open forge under a lean-to, its hearth aglow, a tall chimney smoking, the anvil on
// its block, a quench tub, horseshoes on the post
B.smithy = () => {
  const m = new Model();
  const z0 = -0.32;
  // the back wall, the chimney, the lean-to roof on posts
  m.box('stone', 1.1, 0.5, 0.14, { z: z0 - 0.18 }, 0.5);
  m.box('stone', 0.3, 1.25, 0.3, { x: -0.32, z: z0 - 0.12 }, 0.4);
  m.box('stone', 0.36, 0.05, 0.36, { x: -0.32, y: 1.25, z: z0 - 0.12 }, 0.3);
  m.smokeAt(-0.32, 1.32, z0 - 0.12, 1.0);
  for (const x of [-0.5, 0.5]) m.box('wood', 0.05, 0.5, 0.05, { x, z: z0 + 0.4 });
  m.box('roof', 1.16, 0.035, 0.68, { y: 0.52, z: z0 + 0.14, rx: 0.12 }, 0.4);
  // the hearth aglow, the bellows
  m.box('stone', 0.36, 0.26, 0.3, { x: -0.32, z: z0 + 0.08 }, 0.3);
  m.box('glow', 0.24, 0.03, 0.18, { x: -0.32, y: 0.26, z: z0 + 0.1 });
  m.fire(-0.32, 0.28, z0 + 0.1, 0.12);
  m.box('dark', 0.16, 0.06, 0.12, { x: -0.06, y: 0.2, z: z0 + 0.05, rz: 0.25 });
  // the anvil on its block
  const ax = 0.22;
  const az = z0 + 0.3;
  m.cyl('wood', 0.1, 0.11, 0.2, 10, { x: ax, z: az }, 0.3);
  m.box('metal', 0.18, 0.06, 0.08, { x: ax, y: 0.2, z: az });
  m.box('metal', 0.08, 0.04, 0.06, { x: ax, y: 0.26, z: az });
  m.cone('metal', 0.035, 0.1, 5, { x: ax + 0.13, y: 0.25, z: az, rz: -Math.PI / 2 });
  m.box('dark', 0.1, 0.02, 0.025, { x: ax - 0.02, y: 0.29, z: az + 0.02, ry: 0.5 });
  // the quench tub, a rack of tools, horseshoes on the post
  m.cyl('wood', 0.1, 0.09, 0.14, 10, { x: 0.52, z: 0.34 }, 0.3);
  m.cyl('water', 0.09, 0.09, 0.005, 10, { x: 0.52, y: 0.135, z: 0.34 });
  for (let k = 0; k < 3; k++) {
    const g = new THREE.TorusGeometry(0.04, 0.008, 3, 8, Math.PI * 1.4);
    m.add('metal', g, { x: 0.5, y: 0.34 - k * 0.1, z: z0 + 0.43, rz: Math.PI * 0.8 });
  }
  m.logs(-0.52, 0.38, 3, { len: 0.42, r: 0.04 });
  m.flag(0.66, z0 - 0.15, 1.15);
  return m;
};

// 梯田: terraces stepped up a slope behind the settlement, green with crops, held by dry-stone walls, a
// little hut on the top step and a channel of water down the side
B.terraces = () => {
  const m = new Model();
  const steps = [
    [0.38, 1.4, 0.36],
    [0.02, 1.25, 0.36],
    [-0.34, 1.05, 0.36],
  ];
  steps.forEach(([z, w, d], k) => {
    const y = k * 0.18;
    m.box('stone', w, y + 0.18, d, { z }, 0.5);
    m.box('earth', w - 0.06, 0.02, d - 0.06, { y: y + 0.18, z }, 0.5);
    // rows of crops on each step
    for (let r = 0; r < 2; r++) m.box('leaf', w - 0.16, 0.06, 0.06, { y: y + 0.19, z: z - 0.08 + r * 0.16 }, 0.3);
  });
  // the hut on the top step
  const hy = 0.54;
  m.box('plaster', 0.36, 0.26, 0.26, { x: 0.28, y: hy, z: -0.4 }, 0.4);
  m.gable('roof', 0.36, 0.26, 0.16, { x: 0.28, y: hy + 0.26, z: -0.4 }, 0.3, 0.04);
  m.gableEnds('plaster', 0.36, 0.26, 0.16, { x: 0.28, y: hy + 0.26, z: -0.4 });
  m.box('dark', 0.08, 0.15, 0.02, { x: 0.28, y: hy, z: -0.265 });
  // the channel of water down the side, stepping with the terraces
  for (const [z, y] of [[0.38, 0.18], [0.02, 0.36], [-0.34, 0.54]]) m.box('water', 0.06, 0.005, 0.36, { x: -0.6, y: y + 0.005, z });
  m.flag(-0.4, -0.45, 0.9, { y: 0.54 });
  return m;
};

// 天文台: an observatory: a round tower and its great copper dome, the slit open and a long telescope out
// of it, a sundial in front
B.observatory = () => {
  const m = new Model();
  const tx = -0.1;
  const tz = -0.3;
  m.cyl('stone', 0.38, 0.42, 0.78, 18, { x: tx, z: tz }, 0.5);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.2;
    m.box('dark', 0.06, 0.14, 0.02, { x: tx + Math.sin(a) * 0.41, y: 0.36, z: tz + Math.cos(a) * 0.41, ry: a });
  }
  m.box('dark', 0.14, 0.24, 0.02, { x: tx, z: tz + 0.42 });
  m.cyl('stone', 0.44, 0.44, 0.05, 18, { x: tx, y: 0.78, z: tz });
  m.dome('copper', 0.42, 20, { x: tx, y: 0.83, z: tz });
  // the slit, open to the sky, and the telescope out of it
  m.box('dark', 0.12, 0.36, 0.1, { x: tx, y: 0.92, z: tz + 0.3, rx: -0.75 });
  m.cyl('metal', 0.04, 0.05, 0.62, 10, { x: tx, y: 1.02, z: tz + 0.12, rx: -0.85 });
  m.cyl('gold', 0.055, 0.055, 0.04, 10, { x: tx, y: 1.02 + 0.6 * Math.cos(0.85), z: tz + 0.12 + 0.6 * Math.sin(0.85), rx: -0.85 });
  // the sundial, a bench, a little star chart on a board
  m.cyl('stone', 0.06, 0.08, 0.24, 8, { x: 0.45, z: 0.38 });
  m.cyl('stone', 0.12, 0.12, 0.02, 14, { x: 0.45, y: 0.24, z: 0.38 });
  m.box('metal', 0.005, 0.07, 0.1, { x: 0.45, y: 0.26, z: 0.38, rx: 0.5 });
  m.box('wood', 0.03, 0.36, 0.03, { x: 0.55, z: -0.1 });
  m.plane('paper', 0.2, 0.15, { x: 0.55, y: 0.3, z: -0.08 });
  m.flag(-0.55, 0.15, 1.1);
  return m;
};

// 瞭望塔: a watchtower: a tall timber tower on four legs, a ladder, a roofed lookout with a brazier
// burning, the owner's banner
B.watchtower = () => {
  const m = new Model();
  const x0 = 0.1;
  const z0 = -0.15;
  const H = 1.24;
  const b = 0.32;
  const t = 0.22;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.beam('wood', x0 + sx * b, 0, z0 + sz * b, x0 + sx * t, H, z0 + sz * t, 0.03, 5);
  for (const y of [0.35, 0.8]) {
    const w = b - ((b - t) * y) / H;
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) m.beam('wood', x0 + ax * w, y, z0 + az * w, x0 + bx * w, y + 0.35, z0 + bz * w, 0.015, 4);
  }
  // the lookout: floor, a rail of planks, four posts and a roof
  m.box('wood', 0.62, 0.05, 0.62, { x: x0, y: H, z: z0 }, 0.3);
  for (const [dx, dz, w, d] of [[0, 0.3, 0.62, 0.03], [0, -0.3, 0.62, 0.03], [0.3, 0, 0.03, 0.62], [-0.3, 0, 0.03, 0.62]]) m.box('wood', w, 0.16, d, { x: x0 + dx, y: H + 0.05, z: z0 + dz }, 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.box('wood', 0.03, 0.42, 0.03, { x: x0 + sx * 0.28, y: H + 0.05, z: z0 + sz * 0.28 });
  m.hip('roof', 0.62, 0.62, 0.26, { x: x0, y: H + 0.47, z: z0 }, 0.3, 0.06);
  // the brazier burning on the lookout
  m.cyl('metal', 0.07, 0.04, 0.06, 8, { x: x0 + 0.12, y: H + 0.05, z: z0 + 0.12 });
  m.flame(x0 + 0.12, H + 0.11, z0 + 0.12, 0.05, 0.12, { smoke: false });
  // the ladder up one side
  for (const s of [-1, 1]) m.beam('wood', x0 + s * 0.08, 0, z0 + 0.52, x0 + s * 0.08, H, z0 + 0.25, 0.014, 4);
  for (let k = 1; k < 8; k++) {
    const f = k / 8;
    m.box('wood', 0.16, 0.015, 0.015, { x: x0, y: H * f, z: z0 + 0.52 - 0.27 * f });
  }
  m.flag(x0 - 0.28, z0 - 0.28, 0.44, { y: H + 0.4, w: 0.3, fh: 0.18 });
  m.rubble('rock', -0.5, 0.35, 0.16, 0.12, rng(9), { n: 1, block: 0.6 });
  return m;
};

// 神殿: a small temple: a cella ringed by columns on a stepped base, its pediment roof, an altar with a
// flame in front
B.temple = () => {
  const m = new Model();
  const z0 = -0.2;
  const W = 0.9;
  const D = 0.7;
  for (let k = 0; k < 3; k++) m.box('marble', W + 0.24 - k * 0.08, 0.05, D + 0.24 - k * 0.08, { y: k * 0.05, z: z0 }, 0.4);
  const y0 = 0.15;
  m.box('plaster', W - 0.3, 0.46, D - 0.3, { y: y0, z: z0 }, 0.5);
  m.box('dark', 0.14, 0.26, 0.02, { y: y0, z: z0 + (D - 0.3) / 2 + 0.006 });
  // the ring of columns
  const cols = [];
  for (let i = 0; i < 4; i++) cols.push([-W / 2 + 0.06 + (i * (W - 0.12)) / 3, -D / 2 + 0.06], [-W / 2 + 0.06 + (i * (W - 0.12)) / 3, D / 2 - 0.06]);
  for (const sz of [-1, 1]) cols.push([-W / 2 + 0.06, (sz * (D - 0.12)) / 6], [W / 2 - 0.06, (sz * (D - 0.12)) / 6]);
  for (const [x, z] of cols) m.column('marble', x, z0 + z, y0, 0.5, 0.03);
  m.box('marble', W, 0.06, D, { y: y0 + 0.5, z: z0 }, 0.4);
  m.gable('roof', D, W, 0.18, { y: y0 + 0.56, z: z0, ry: Math.PI / 2 }, 0.32, 0.04);
  m.gableEnds('marble', D, W, 0.18, { y: y0 + 0.56, z: z0, ry: Math.PI / 2 });
  // the altar and its flame, two urns
  m.box('marble', 0.2, 0.16, 0.14, { z: 0.46 }, 0.3);
  m.flame(0, 0.16, 0.46, 0.05, 0.12);
  for (const s of [-1, 1]) m.lathe('copper', [[0, 0], [0.04, 0], [0.06, 0.06], [0.04, 0.13], [0.05, 0.15], [0, 0.15]], 8, { x: s * 0.3, z: 0.42 }, 0.3);
  return m;
};

// 營造廠: a builders' yard: a treadwheel crane over blocks waiting to go up, a mason's shed, a heap of
// sand, the owner's pennant on the mast
B.builders = () => {
  const m = new Model();
  const rnd = rng(31);
  m.crane(-0.2, -0.1, 1.3, { reach: 0.55, load: 0.45, ry: 0.4 });
  hall(m, { w: 0.5, h: 0.32, d: 0.36, x: 0.46, z: -0.45, wall: 'wood', frame: false, windows: 1, rh: 0.18 });
  m.blocks('stone', 0.2, 0, 0.18, 8, rnd, { ry: 0.2, w: 0.16, h: 0.1, d: 0.12 });
  m.blocks('marble', -0.62, 0, 0.36, 4, rnd, { ry: -0.4, w: 0.16, h: 0.1, d: 0.12 });
  m.rubble('sand', 0.6, 0.35, 0.18, 0.14, rnd, { n: 0 });
  // the mason's banker (a work bench) with a block on it, a mallet
  m.box('wood', 0.3, 0.04, 0.16, { x: 0.2, y: 0.22, z: 0.52 }, 0.3);
  for (const s of [-1, 1]) m.box('wood', 0.04, 0.22, 0.14, { x: 0.2 + s * 0.12, z: 0.52 });
  m.box('stone', 0.14, 0.08, 0.1, { x: 0.18, y: 0.26, z: 0.52 }, 0.3);
  m.box('wood', 0.07, 0.05, 0.05, { x: 0.3, y: 0.26, z: 0.56 });
  return m;
};

// 衛戍所: a garrison post: a square stone keep with merlons and a slit window, a palisade of sharpened
// stakes round its yard, spears in a rack, the owner's banner on the keep
B.garrison = () => {
  const m = new Model();
  const kx = -0.25;
  const kz = -0.3;
  m.box('stone', 0.5, 0.9, 0.5, { x: kx, z: kz }, 0.5);
  m.box('stone', 0.58, 0.06, 0.58, { x: kx, y: 0.9, z: kz }, 0.4);
  m.crenels('stone', kx - 0.27, kz + 0.27, kx + 0.27, kz + 0.27, 0.96, { h: 0.09, w: 0.09, gap: 0.07 });
  m.crenels('stone', kx - 0.27, kz - 0.27, kx + 0.27, kz - 0.27, 0.96, { h: 0.09, w: 0.09, gap: 0.07 });
  m.crenels('stone', kx - 0.27, kz - 0.27, kx - 0.27, kz + 0.27, 0.96, { h: 0.09, w: 0.09, gap: 0.07 });
  m.crenels('stone', kx + 0.27, kz - 0.27, kx + 0.27, kz + 0.27, 0.96, { h: 0.09, w: 0.09, gap: 0.07 });
  m.box('dark', 0.04, 0.18, 0.02, { x: kx, y: 0.55, z: kz + 0.256 });
  m.box('dark', 0.14, 0.24, 0.02, { x: kx, z: kz + 0.256 });
  m.flag(kx, kz, 0.6, { y: 0.96, w: 0.34, fh: 0.2 });
  // the palisade: sharpened stakes round the yard in front
  const stake = (x, z) => {
    m.cyl('wood', 0.03, 0.03, 0.28, 5, { x, z });
    m.cone('wood', 0.03, 0.07, 5, { x, y: 0.28, z });
  };
  for (let i = 0; i <= 10; i++) stake(0.12 + i * 0.065, -0.5);
  for (let i = 1; i <= 12; i++) stake(0.77, -0.5 + i * 0.075);
  for (let i = 1; i <= 9; i++) stake(0.77 - i * 0.075, 0.4);
  // the rack of spears and a shield on it
  m.box('wood', 0.3, 0.03, 0.04, { x: 0.42, y: 0.3, z: 0.05 });
  for (let i = 0; i < 4; i++) {
    m.cyl('wood', 0.007, 0.007, 0.48, 4, { x: 0.32 + i * 0.07, z: 0.05, rz: 0.05 });
    m.cone('metal', 0.014, 0.05, 4, { x: 0.32 + i * 0.07 - 0.024, y: 0.48, z: 0.05, rz: 0.05 });
  }
  m.cyl('cloth', 0.09, 0.09, 0.02, 12, { x: 0.42, y: 0.18, z: 0.08, rx: Math.PI / 2 - 0.15 });
  m.cyl('metal', 0.095, 0.095, 0.01, 12, { x: 0.42, y: 0.18, z: 0.07, rx: Math.PI / 2 - 0.15 });
  return m;
};

// 學徒工坊: a carpenters' workshop open at the front: a workbench with a vice, a great wheel of a lathe,
// sawhorses with a plank, planks stacked, shavings
B.workshop = () => {
  const m = new Model();
  const rnd = rng(37);
  const z0 = -0.35;
  // the shed: back and side walls, the posts at the front, the roof
  m.box('wood', 1.1, 0.5, 0.06, { z: z0 - 0.22 }, 0.4);
  for (const s of [-1, 1]) m.box('wood', 0.06, 0.5, 0.5, { x: s * 0.53, z: z0 }, 0.4);
  for (const x of [-0.53, 0, 0.53]) m.box('wood', 0.05, 0.5, 0.05, { x, z: z0 + 0.24 });
  m.gable('roof', 1.12, 0.54, 0.24, { y: 0.5, z: z0 }, 0.32, 0.07);
  m.gableEnds('wood', 1.12, 0.54, 0.24, { y: 0.5, z: z0 });
  // the workbench and its vice, tools on the wall
  m.box('wood', 0.56, 0.04, 0.18, { x: -0.22, y: 0.22, z: z0 - 0.08 }, 0.3);
  for (const s of [-1, 1]) m.box('wood', 0.04, 0.22, 0.16, { x: -0.22 + s * 0.24, z: z0 - 0.08 });
  m.box('metal', 0.06, 0.06, 0.06, { x: -0.44, y: 0.26, z: z0 + 0.02 });
  for (let k = 0; k < 3; k++) m.box('dark', 0.03, 0.14, 0.012, { x: -0.4 + k * 0.13, y: 0.32, z: z0 - 0.185 });
  // the lathe and its great wheel
  m.wheel(0.32, 0.26, z0 - 0.02, 0.24, { ry: Math.PI / 2, w: 0.04 });
  m.box('wood', 0.3, 0.05, 0.08, { x: 0.2, y: 0.24, z: z0 + 0.1 }, 0.3);
  // sawhorses with a plank, planks stacked, a heap of shavings
  for (const dx of [-0.22, 0.22]) {
    m.box('wood', 0.025, 0.24, 0.025, { x: dx, z: 0.28, rx: 0.3 });
    m.box('wood', 0.025, 0.24, 0.025, { x: dx, z: 0.36, rx: -0.3 });
    m.box('wood', 0.03, 0.03, 0.14, { x: dx, y: 0.22, z: 0.32 });
  }
  m.box('wood', 0.7, 0.025, 0.16, { y: 0.245, z: 0.32, ry: 0.05 }, 0.4);
  for (let k = 0; k < 5; k++) m.box('wood', 0.62, 0.025, 0.12, { x: 0.52, y: k * 0.026, z: 0.18 + (rnd() - 0.5) * 0.03, ry: Math.PI / 2 + (rnd() - 0.5) * 0.05 }, 0.4);
  m.dome('sand', 0.11, 7, { x: -0.5, z: 0.42, sy: 0.4 });
  m.flag(-0.64, -0.62, 1.3);
  return m;
};

// 公會大廳: a guild hall: a tall half-timbered hall with a stepped gable to the front, the guilds'
// banners hanging down its face, a wide door with a lantern
B.guildHall = () => {
  const m = new Model();
  const z0 = -0.3;
  const W = 0.86;
  house(m, { w: W, h: 0.72, d: 0.6, z: z0, windows: 3 });
  m.gable('roof', W, 0.6, 0.42, { y: 0.72, z: z0, ry: Math.PI / 2 }, 0.32, 0.03);
  // the stepped gable on the front: blocks stepping up to a pinnacle
  const fz = z0 + 0.31;
  for (let k = 0; k < 4; k++) {
    const w = W - k * 0.2;
    m.box('plaster', w, 0.12, 0.06, { y: 0.72 + k * 0.12, z: fz }, 0.4);
    for (const s of [-1, 1]) m.box('stone', 0.06, 0.04, 0.08, { x: s * (w / 2 - 0.03), y: 0.84 + k * 0.12, z: fz }, 0.3);
  }
  m.cone('gold', 0.03, 0.14, 5, { y: 1.2, z: fz });
  // the banners down the face, the wide door, the lantern
  for (const [x, slot] of [[-0.3, 'cloth'], [0.3, 'cloth'], [0, 'canvas']]) {
    m.box('wood', 0.16, 0.015, 0.015, { x, y: 0.66, z: fz + 0.04 });
    m.plane(slot, 0.13, 0.3, { x, y: 0.5, z: fz + 0.045 });
  }
  m.box('dark', 0.22, 0.3, 0.02, { y: 0, z: fz + 0.005 });
  m.box('dark', 0.04, 0.05, 0.12, { x: 0.18, y: 0.32, z: fz + 0.06 });
  m.box('glow', 0.05, 0.07, 0.05, { x: 0.18, y: 0.25, z: fz + 0.12 });
  // the steps, a pair of benches
  m.box('stone', 0.4, 0.04, 0.16, { z: fz + 0.1 }, 0.3);
  for (const s of [-1, 1]) m.box('wood', 0.24, 0.05, 0.07, { x: s * 0.48, y: 0.05, z: 0.3 });
  return m;
};

// 紀念碑: a monument: a tall obelisk on a stepped plinth, its gilded tip, a low railing and four lamps
// round it
B.monument = () => {
  const m = new Model();
  const z0 = -0.05;
  for (let k = 0; k < 3; k++) m.box('stone', 0.7 - k * 0.14, 0.08, 0.7 - k * 0.14, { y: k * 0.08, z: z0 }, 0.4);
  m.box('marble', 0.34, 0.24, 0.34, { y: 0.24, z: z0 }, 0.4);
  m.box('gold', 0.2, 0.08, 0.012, { y: 0.32, z: z0 + 0.176 });
  m.frustum('marble', 4, 0.12, 0.07, 1.32, { y: 0.48, z: z0 }, 0.5);
  m.cone('gold', 0.1, 0.16, 4, { y: 1.8, z: z0, ry: Math.PI / 4 });
  // the railing and the lamps at its corners
  const r = 0.58;
  for (const [ax, az, bx, bz] of [[-r, -r, r, -r], [r, -r, r, r], [r, r, -r, r], [-r, r, -r, -r]]) {
    m.beam('dark', ax, 0.18, z0 + az, bx, 0.18, z0 + bz, 0.01, 4);
    m.box('dark', 0.03, 0.2, 0.03, { x: ax, z: z0 + az });
    m.box('glow', 0.05, 0.06, 0.05, { x: ax, y: 0.2, z: z0 + az });
  }
  m.plant('fern_b', 0.55, 0, z0 + 0.7, 0.26);
  m.plant('fern_c', -0.6, 0, z0 + 0.66, 0.24);
  return m;
};

// ── a third level of a development facility (2026-11-18: beside a farmstead's city) ──

export const FACILITY3 = {
  // 田地: a stone granary barn under the owner's roof, a hay wain and more stacks
  fields: (m) => {
    const x = -1.3;
    const z = -0.78;
    m.box('stone', 0.78, 0.48, 0.52, { x, z }, 0.5);
    m.gable('roof', 0.78, 0.52, 0.34, { x, y: 0.48, z }, 0.32, 0.07);
    m.gableEnds('stone', 0.78, 0.52, 0.34, { x, y: 0.48, z });
    m.box('dark', 0.26, 0.3, 0.02, { x, z: z + 0.266 });
    for (const [hx, hz, s] of [[-1.55, -0.2, 0.9], [-1.15, -0.1, 0.8]]) m.lathe('thatch', haystack(s), 12, { x: hx, z: hz }, 0.4);
  },
  // 森林: a charcoal burner's clamp, smoking under its turf, with cordwood stacked beside it
  forest: (m) => {
    const x = -1.3;
    const z = -0.85;
    m.dome('earth', 0.42, 12, { x, z, sy: 0.65 });
    m.smokeAt(x, 0.3, z, 1.1);
    m.smokeAt(x + 0.18, 0.2, z + 0.12, 0.7);
    m.logs(x + 0.15, z + 0.62, 6, { len: 0.6, r: 0.05, ry: 0.4 });
    m.box('wood', 0.03, 0.4, 0.03, { x: x - 0.5, z: z + 0.3 });
  },
  // 丘陵: the brickworks' tall square chimney, smoking, and its stacks of bricks
  hills: (m) => {
    const x = -1.4;
    const z = 0.0;
    m.box('brick', 0.26, 1.5, 0.26, { x, z }, 0.4);
    m.box('brick', 0.32, 0.06, 0.32, { x, y: 1.5, z }, 0.3);
    m.smokeAt(x, 1.58, z, 1.2);
    m.box('brick', 0.5, 0.28, 0.4, { x: x + 0.32, z: z + 0.1 }, 0.4);
    for (let l = 0; l < 3; l++) m.box('brick', 0.32, 0.08, 0.24, { x: x - 0.1, y: l * 0.082, z: z + 0.42, ry: 0.3 + (l % 2) * 0.1 }, 0.3);
  },
  // 牧場: a weaving house, bolts of the owner's cloth drying on a line before it
  pasture: (m) => {
    const x = -1.32;
    const z = -0.7;
    house(m, { w: 0.66, h: 0.42, d: 0.46, x, z, windows: 2 });
    m.gable('roof', 0.66, 0.46, 0.26, { x, y: 0.42, z }, 0.32, 0.06);
    m.gableEnds('plaster', 0.66, 0.46, 0.26, { x, y: 0.42, z });
    for (const dx of [-0.36, 0.36]) m.box('wood', 0.03, 0.44, 0.03, { x: x + dx, z: z + 0.55 });
    m.cyl('dark', 0.004, 0.004, 0.72, 3, { x: x + 0.36, y: 0.42, z: z + 0.55, rz: Math.PI / 2 });
    for (const [dx, slot] of [[-0.22, 'cloth'], [0, 'canvas'], [0.22, 'cloth']]) m.plane(slot, 0.16, 0.26, { x: x + dx, y: 0.28, z: z + 0.55 });
  },
  // 山脈: a smelter: a stone furnace glowing at its mouth and smoking, ingots stacked beside it
  mountains: (m) => {
    const x = -1.18;
    const z = 0.55;
    m.frustum('stone', 4, 0.28, 0.16, 0.8, { x, z }, 0.5);
    m.box('glow', 0.12, 0.12, 0.02, { x, y: 0.08, z: z + 0.285 });
    m.fire(x, 0.1, z + 0.25, 0.1);
    m.smokeAt(x, 0.84, z, 1.0);
    for (let l = 0; l < 3; l++) for (let k = 0; k < 3 - l; k++) m.box('metal', 0.12, 0.05, 0.05, { x: x + 0.45 + k * 0.13 + l * 0.065, y: l * 0.05, z: z + 0.1, ry: 0.1 });
  },
};
