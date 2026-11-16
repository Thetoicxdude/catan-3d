// The kit the development mode's models are built with (devmodels.js: the buildings and the facilities;
// devwonders.js: the wonders): a Model is plain geometry sorted by material slot (stone, wood, thatch, the
// owner's roof and cloth…), so it needs no files of its own: devmesh.js gives the slots the asset pack's
// scanned materials (or plain colours without it), and tools/art/exportobj.mjs writes the same geometry
// out for the card renders in Blender. Parts of the pack's kits (the fort's towers and walls, the props,
// the farm animals) are referenced by name and placed by devmesh.js; the card renders take the original
// Poly Haven and Quaternius models.
//
// Units are the map's: a hex is 10 from its middle to a corner, a village about 2.6 across. A model
// stands on y = 0 with its front towards +z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// the slots and what they are made of (devmesh.js MATERIALS)
//   stone  plaster  wood  dark (doors, windows)  thatch  roof (owner's colour, tiles)  brick  rock
//   street (paving)  sand (sandstone)  marble (pale dressed stone)  metal  copper  gold  leaf  water
//   cloth (owner's colour)
//   canvas (unbleached cloth)  paper  burlap  earth (tilled soil)  glow (fire)
export const TAU = Math.PI * 2;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function place(g, t = {}) {
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0, 'YXZ');
  _q.setFromEuler(_e);
  _s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _m.compose(_p, _q, _s);
  return g.applyMatrix4(_m);
}

// UVs in world units over `tile` (so a texture repeats at the same size on every shape)
export function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

// A model being built: geometry per slot, kit parts, flags (cloth that may wave), the anchor of fire.
export class Model {
  constructor() {
    this.slots = {};
    this.kit = [];
    this.fires = [];
    this.plants = [];
    this.smoke = [];
  }
  add(slot, g, t) {
    if (t) place(g, t);
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    (this.slots[slot] = this.slots[slot] || []).push(g);
    return this;
  }
  // ── primitives (t: { x, y, z, rx, ry, rz, s, sx, sy, sz }; tile: texture repeat in units) ──
  box(slot, w, h, d, t = {}, tile = 0.6) {
    const g = new THREE.BoxGeometry(w, h, d);
    // each face 0..1: stretch u by the face's width (approximately: the larger of w and d)
    scaleUV(g, Math.max(w, d) / tile, Math.max(h, Math.min(w, d)) / tile);
    return this.add(slot, g.translate(0, h / 2, 0), t);
  }
  cyl(slot, rTop, rBot, h, segs, t = {}, tile = 0.6, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, open);
    scaleUV(g, (TAU * Math.max(rTop, rBot)) / tile, h / tile);
    return this.add(slot, g.translate(0, h / 2, 0), t);
  }
  cone(slot, r, h, segs, t = {}, tile = 0.6) {
    const g = new THREE.ConeGeometry(r, h, segs, 1, true);
    scaleUV(g, (TAU * r) / tile, Math.hypot(r, h) / tile);
    return this.add(slot, g.translate(0, h / 2, 0), t);
  }
  // a surface of revolution from [radius, height] pairs, bottom to top
  lathe(slot, profile, segs, t = {}, tile = 0.6) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
    const g = new THREE.LatheGeometry(pts, segs);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    const rMax = Math.max(...profile.map((p) => p[0]));
    scaleUV(g, (TAU * rMax) / tile, len / tile);
    return this.add(slot, g, t);
  }
  // half a sphere (or less: `part` of the way up), radius r, on y = 0
  dome(slot, r, segs, t = {}, part = 1, tile = 0.6) {
    const g = new THREE.SphereGeometry(r, segs, Math.max(4, Math.round(segs / 2)), 0, TAU, 0, (Math.PI / 2) * part);
    scaleUV(g, (TAU * r) / tile, (Math.PI * r) / 2 / tile);
    return this.add(slot, g, t);
  }
  // gable roof: ridge along x, w × d, h high, overhanging by `o`; UVs run down the slopes
  gable(slot, w, d, h, t = {}, tile = 0.5, o = 0.06) {
    const hw = w / 2 + o;
    const hd = d / 2 + o;
    const slope = Math.hypot(hd, h);
    // (wound so the slopes face out)
    const P = [
      [-hw, 0, -hd], [hw, h, 0], [hw, 0, -hd], [-hw, 0, -hd], [-hw, h, 0], [hw, h, 0],
      [-hw, 0, hd], [hw, h, 0], [-hw, h, 0], [-hw, 0, hd], [hw, 0, hd], [hw, h, 0],
    ];
    const UV = [
      [0, 0], [2 * hw, slope], [2 * hw, 0], [0, 0], [0, slope], [2 * hw, slope],
      [0, 0], [2 * hw, slope], [0, slope], [0, 0], [2 * hw, 0], [2 * hw, slope],
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV.flat().map((v) => v / tile), 2));
    g.computeVertexNormals();
    return this.add(slot, g, t);
  }
  // the gable ends under a roof (walls' material): two triangles
  gableEnds(slot, w, d, h, t = {}, tile = 0.6) {
    const hw = w / 2;
    const hd = d / 2;
    const P = [[-hw, 0, -hd], [-hw, 0, hd], [-hw, h, 0], [hw, 0, -hd], [hw, h, 0], [hw, 0, hd]];
    const UV = [[0, 0], [d, 0], [hd, h], [0, 0], [hd, h], [d, 0]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV.flat().map((v) => v / tile), 2));
    g.computeVertexNormals();
    return this.add(slot, g, t);
  }
  // hipped roof: four slopes up to a ridge along x (a pyramid when w = d)
  hip(slot, w, d, h, t = {}, tile = 0.5, o = 0.06) {
    const hw = w / 2 + o;
    const hd = d / 2 + o;
    const r = Math.max(0, hw - hd);
    const A = [-hw, 0, -hd], Bq = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
    const E = [-r, h, 0], F = [r, h, 0];
    const tris = [[A, F, Bq], [A, E, F], [C, E, D], [C, F, E], [Bq, F, C], [D, E, A]];
    const P = [];
    const UV = [];
    for (const tri of tris) {
      for (const v of tri) {
        P.push(...v);
        UV.push((v[0] + v[2] * 0.3) / tile, (v[1] * 1.4 + Math.abs(v[2]) * 0.2) / tile);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.computeVertexNormals();
    return this.add(slot, g, t);
  }
  // a flat shape (THREE.Shape, in x/y) extruded `depth` along z, centred on z
  extrude(slot, shape, depth, t = {}, tile = 0.6) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    scaleUV(g, 1 / tile, 1 / tile);
    return this.add(slot, g, t);
  }
  // a flat rectangle facing +z (double-sided materials: cloth, canvas, paper)
  plane(slot, w, h, t = {}, tile = 1) {
    const g = new THREE.PlaneGeometry(w, h);
    scaleUV(g, w / tile, h / tile);
    return this.add(slot, g, t);
  }
  // ── bits that recur ──
  // a pole with the owner's flag at its top, the cloth towards +x
  flag(x, z, h = 1.4, { y = 0, w = 0.42, fh = 0.26, ry = 0 } = {}) {
    this.cyl('wood', 0.022, 0.03, h, 6, { x, y, z });
    this.box('gold', 0.06, 0.06, 0.06, { x, y: y + h, z });
    const g = new THREE.PlaneGeometry(w, fh, 6, 1);
    // a little wave along the cloth
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w + 0.5) * Math.PI * 1.6) * 0.035 * (p.getX(i) / w + 0.5));
    g.computeVertexNormals();
    g.translate(w / 2 + 0.02, h - fh / 2 - 0.04, 0);
    place(g, { ry });
    return this.add('cloth', g, { x, y, z });
  }
  // a sack of grain or wool (burlap), standing
  sack(x, z, s = 1, ry = 0) {
    return this.lathe('burlap', [[0, 0], [0.09 * s, 0.01 * s], [0.11 * s, 0.08 * s], [0.1 * s, 0.17 * s], [0.06 * s, 0.22 * s], [0.03 * s, 0.25 * s], [0, 0.25 * s]], 8, { x, z, ry }, 0.3);
  }
  // a barrel lying or standing (standing when `lying` is false)
  barrel(x, z, s = 1, { lying = false, ry = 0, y = 0 } = {}) {
    const r = 0.1 * s;
    const h = 0.28 * s;
    const prof = [[0, 0], [r * 0.82, 0], [r, h * 0.5], [r * 0.82, h], [0, h]];
    if (lying) return this.lathe('wood', prof, 10, { x, y: y + r, z, rz: Math.PI / 2, ry }, 0.3);
    return this.lathe('wood', prof, 10, { x, y, z, ry }, 0.3);
  }
  // a stack of logs lying along x
  logs(x, z, n = 3, { len = 0.7, r = 0.06, ry = 0 } = {}) {
    let k = 0;
    for (let row = 0; k < n; row++) {
      const inRow = Math.max(1, 3 - row);
      for (let i = 0; i < inRow && k < n; i++, k++) {
        const ox = (i - (inRow - 1) / 2) * r * 2.05;
        const g = new THREE.CylinderGeometry(r, r, len, 8);
        scaleUV(g, 0.8, len / 0.5);
        g.rotateZ(Math.PI / 2);
        g.rotateY(Math.PI / 2);
        g.translate(ox, r + row * r * 1.75, 0);
        place(g, { ry });
        this.add('wood', g, { x, z });
      }
    }
    return this;
  }
  // a fence along a line from (x0, z0) to (x1, z1)
  fence(x0, z0, x1, z1, { h = 0.22, gap = 0.28 } = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / gap));
    const ry = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i <= n; i++) this.box('wood', 0.03, h, 0.03, { x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n });
    for (const y of [h * 0.45, h * 0.85]) this.box('wood', len, 0.022, 0.018, { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2, ry });
    return this;
  }
  // scaffolding round a box (x0..x1, z0..z1) from y0 to y1: poles, ledgers, braces and planks
  scaffold(x0, x1, z0, z1, y0, y1, { step = 0.45, out = 0.14 } = {}) {
    x0 -= out;
    x1 += out;
    z0 -= out;
    z1 += out;
    const sides = [
      [x0, z0, x1, z0],
      [x1, z0, x1, z1],
      [x1, z1, x0, z1],
      [x0, z1, x0, z0],
    ];
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 0.7));
      const ry = -Math.atan2(bz - az, bx - ax);
      for (let i = 0; i < n; i++) {
        const x = ax + ((bx - ax) * i) / n;
        const z = az + ((bz - az) * i) / n;
        this.cyl('wood', 0.013, 0.013, y1 - y0 + 0.12, 4, { x, y: y0, z }, 0.5);
      }
      for (let y = y0 + step; y <= y1 + 0.01; y += step) {
        this.box('wood', len, 0.016, 0.016, { x: (ax + bx) / 2, y, z: (az + bz) / 2, ry });
        // a plank walk on every other ledger
        if (Math.round((y - y0) / step) % 2 === 0) {
          const ox = Math.sin(ry) * 0.08;
          const oz = Math.cos(ry) * 0.08;
          this.box('wood', len * 0.98, 0.014, 0.12, { x: (ax + bx) / 2 + ox, y: y + 0.016, z: (az + bz) / 2 + oz, ry });
        }
      }
      // one brace a side
      const blen = Math.hypot(len, Math.min(y1 - y0, step * 2));
      const g = new THREE.CylinderGeometry(0.012, 0.012, blen, 4);
      g.rotateZ(Math.atan2(len, Math.min(y1 - y0, step * 2)));
      g.translate(0, y0 + Math.min(y1 - y0, step * 2) / 2, 0);
      place(g, { ry });
      this.add('wood', g, { x: (ax + bx) / 2, z: (az + bz) / 2 });
    }
    return this;
  }
  // a treadwheel crane: a tall mast on a cross of beams, the jib towards +x, the great wheel at the
  // foot, a rope down to a block of stone
  // (the owner's pennant at the top of the mast: whose wonder is going up)
  crane(x, z, h = 2.6, { ry = 0, reach = 1.2, load = 0.7, y = 0, flag = true } = {}) {
    const sub = new Model();
    if (flag) sub.flag(0, 0, 0.5, { y: h + 0.02, w: 0.36, fh: 0.22 });
    sub.box('wood', 1.0, 0.07, 0.08, {});
    sub.box('wood', 0.08, 0.07, 1.0, {});
    sub.box('wood', 0.07, h, 0.07, { y: 0.06 });
    // the struts from the beams' ends up the mast
    for (const [dx, dz] of [[-0.48, 0], [0.48, 0], [0, -0.48], [0, 0.48]]) {
      const len = Math.hypot(Math.hypot(dx, dz), h * 0.42);
      const g = new THREE.CylinderGeometry(0.018, 0.018, len, 4);
      g.rotateX(Math.atan2(Math.hypot(dx, dz), h * 0.42));
      g.rotateY(Math.atan2(dx, dz));
      g.translate(dx / 2, 0.06 + h * 0.21, dz / 2);
      sub.add('wood', g);
    }
    // the jib, sloping up and out
    const len = reach + 0.25;
    const jib = new THREE.CylinderGeometry(0.022, 0.03, len, 5);
    jib.rotateZ(-(Math.PI / 2 - 0.42));
    jib.translate((len / 2) * Math.cos(0.42), h * 0.82 + (len / 2) * Math.sin(0.42), 0);
    sub.add('wood', jib);
    const tipX = len * Math.cos(0.42);
    const tipY = h * 0.82 + len * Math.sin(0.42);
    sub.cyl('dark', 0.005, 0.005, Math.max(0.1, tipY - load - 0.08), 3, { x: tipX, y: load + 0.08 });
    sub.box('sand', 0.22, 0.13, 0.17, { x: tipX, y: load - 0.06 });
    // the great wheel the men walk in, on its axle at the foot
    const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.22, 16, 1, true);
    wheel.rotateX(Math.PI / 2);
    wheel.translate(-0.35, 0.47, 0);
    sub.add('wood', wheel);
    for (let k = 0; k < 4; k++) sub.box('wood', 0.84, 0.03, 0.03, { x: -0.35, y: 0.47 - 0.015, z: 0, rz: (k * Math.PI) / 4 });
    sub.box('wood', 0.05, 0.47, 0.05, { x: -0.35, z: 0.16 });
    sub.box('wood', 0.05, 0.47, 0.05, { x: -0.35, z: -0.16 });
    return this.merge(sub, { x, y, z, ry });
  }
  // another model's geometry, placed
  merge(other, t = {}) {
    for (const [slot, list] of Object.entries(other.slots)) for (const g of list) this.add(slot, g.clone(), t);
    for (const k of other.kit) this.kit.push(compose(k, t));
    for (const pl of other.plants) {
      const c = compose({ ...pl, ry: 0, s: 1 }, t);
      this.plants.push({ sp: pl.sp, x: c.x, y: c.y, z: c.z, h: pl.h * (t.s ?? 1) });
    }
    for (const f of other.fires) {
      const v = new THREE.Vector3(f.x, f.y, f.z);
      _e.set(t.rx || 0, t.ry || 0, t.rz || 0, 'YXZ');
      v.multiplyScalar(t.s ?? 1).applyEuler(_e).add(new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0));
      this.fires.push({ x: v.x, y: v.y, z: v.z, r: f.r * (t.s ?? 1) });
    }
    for (const f of other.smoke) {
      const v = new THREE.Vector3(f.x, f.y, f.z);
      _e.set(t.rx || 0, t.ry || 0, t.rz || 0, 'YXZ');
      v.multiplyScalar(t.s ?? 1).applyEuler(_e).add(new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0));
      this.smoke.push({ x: v.x, y: v.y, z: v.z, s: f.s * (t.s ?? 1) });
    }
    return this;
  }
  // a part of one of the asset pack's kits (models.js names: 'fort' 'tower_round', 'props' 'wooden_crate_01'…);
  // h: its height in map units (the kits are in metres of their own scale)
  part(model, name, t = {}, h = null) {
    this.kit.push({ model, name, x: t.x || 0, y: t.y || 0, z: t.z || 0, ry: t.ry || 0, h, s: t.s || 1 });
    return this;
  }
  fire(x, y, z, r = 0.2) {
    this.fires.push({ x, y, z, r });
    return this;
  }
  // one of the map's own plants (the asset pack's photographed trees and shrubs: 'broad_a', 'broad_b',
  // 'fern_b', 'fern_c', 'rooibos_a', 'quiver1'…), h high; plain stand-ins without the pack
  plant(sp, x, y, z, h) {
    this.plants.push({ sp, x, y, z, h });
    return this;
  }
  // a wall w × h with n arched openings, `depth` thick, its face towards +z; the openings are dark behind
  // (see: the openings go through, as under a bridge or an arch, with nothing dark behind them)
  arcade(slot, w, h, n, t = {}, { depth = 0.1, open = 0.62, rise = 0.74, base = 0.0, see = false } = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(w / 2, h);
    shape.lineTo(-w / 2, h);
    shape.closePath();
    const bay = w / n;
    const aw = bay * open;
    const ah = h * rise;
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + bay * (i + 0.5);
      const hole = new THREE.Path();
      const spring = Math.max(base + 0.02, ah - aw / 2);
      hole.moveTo(cx - aw / 2, base);
      hole.lineTo(cx + aw / 2, base);
      hole.lineTo(cx + aw / 2, spring);
      hole.absarc(cx, spring, aw / 2, 0, Math.PI, false);
      hole.lineTo(cx - aw / 2, base);
      shape.holes.push(hole);
    }
    this.extrude(slot, shape, depth, t, 0.6);
    if (see) return this;
    // the dark behind the openings
    const back = new THREE.BoxGeometry(w - 0.02, ah, 0.012).translate(0, base + ah / 2, -depth / 2 + 0.008);
    this.add('dark', back, t);
    return this;
  }
  // smoke rising from (x, y, z) (a chimney, a kiln, a fire): the map puts drifting puffs there
  smokeAt(x, y, z, s = 1) {
    this.smoke.push({ x, y, z, s });
    return this;
  }
  // a fire: flames of glowing cones (the slot 'glow' is drawn unlit), smoke above them
  flame(x, y, z, r = 0.08, h = 0.22, { smoke = true } = {}) {
    this.cone('glow', r, h, 7, { x, y, z });
    this.cone('glow', r * 0.62, h * 0.72, 6, { x: x + r * 0.45, y, z: z - r * 0.25, ry: 0.5 });
    this.cone('glow', r * 0.55, h * 0.6, 6, { x: x - r * 0.4, y, z: z + r * 0.3, ry: 1.1 });
    this.fires.push({ x, y, z, r });
    if (smoke) this.smokeAt(x, y + h, z, Math.max(0.6, r * 8));
    return this;
  }
  // a prism or frustum with `sides` flat sides (4: square, 8: octagonal), its flats facing the axes;
  // a and b are the half-widths across the flats at the bottom and the top
  frustum(slot, sides, a, b, h, t = {}, tile = 0.6) {
    const k = 1 / Math.cos(Math.PI / sides);
    const g = new THREE.CylinderGeometry(b * k, a * k, h, sides, 1);
    g.rotateY(Math.PI / sides);
    scaleUV(g, (TAU * Math.max(a, b)) / tile, h / tile);
    return this.add(slot, g.translate(0, h / 2, 0), t);
  }
  // a cylinder lying along x (a log, a fallen column), its middle at (x, y + r, z)
  lying(slot, r, len, t = {}, segs = 10, tile = 0.6) {
    const g = new THREE.CylinderGeometry(r, r, len, segs);
    scaleUV(g, (TAU * r) / tile, len / tile);
    g.rotateZ(Math.PI / 2);
    g.translate(0, r, 0);
    return this.add(slot, g, t);
  }
  // a round beam from one point to another (struts, braces, legs of a tower, ropes)
  beam(slot, x0, y0, z0, x1, y1, z1, r = 0.02, sides = 5) {
    const a = new THREE.Vector3(x0, y0, z0);
    const b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, sides);
    scaleUV(g, (TAU * r) / 0.3, len / 0.5);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate(x0, y0, z0);
    return this.add(slot, g);
  }
  // a wheel on edge, its axle along x before turning by ry: a solid wooden wheel and its hub
  wheel(x, y, z, r, { ry = 0, w = 0.035 } = {}) {
    const g = new THREE.CylinderGeometry(r, r, w, 14);
    scaleUV(g, (TAU * r) / 0.3, w / 0.3);
    g.rotateZ(Math.PI / 2);
    this.add('wood', g, { x, y, z, ry });
    const hub = new THREE.CylinderGeometry(r * 0.3, r * 0.3, w * 1.9, 8).rotateZ(Math.PI / 2);
    return this.add('dark', hub, { x, y, z, ry });
  }
  // a bell tent: a short wall and a cone of cloth, the pole through the top, a dark door to the front
  tent(x, z, r, h, { ry = 0, slot = 'cloth', sides = 10 } = {}) {
    const wall = h * 0.18;
    this.cyl(slot, r, r, wall, sides, { x, z, ry }, 0.4, true);
    this.cone(slot, r * 1.05, h - wall, sides, { x, y: wall, z, ry }, 0.4);
    this.cyl('wood', 0.012, 0.012, h * 0.16, 4, { x, y: h - 0.02, z });
    const top = h * 0.52;
    const rt = r * 1.05 * (1 - (top - wall) / (h - wall));
    const g = new THREE.BufferGeometry();
    const dw = r * 0.34;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-dw, 0, r + 0.006, dw, 0, r + 0.006, 0, top, rt + 0.006], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    g.computeVertexNormals();
    return this.add('dark', g, { x, z, ry });
  }
  // merlons along a line at height y (the teeth of a wall's top)
  crenels(slot, x0, z0, x1, z1, y, { h = 0.1, w = 0.09, t = 0.07, gap = 0.08 } = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.floor((len + gap) / (w + gap)));
    const ry = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : (i * (w + gap) + w / 2 + (len - (n * w + (n - 1) * gap)) / 2) / len;
      this.box(slot, w, h, t, { x: x0 + (x1 - x0) * f, y, z: z0 + (z1 - z0) * f, ry }, 0.3);
    }
    return this;
  }
  // a run of wall from (x0, z0) to (x1, z1), t thick and h high, its top walk edged with merlons on both
  // sides (or on the outer, +normal side only when `both` is false)
  wallRun(slot, x0, z0, x1, z1, { h = 0.5, t = 0.16, y = 0, crenel = true, both = true, merlon = 0.1, sink = 0.2 } = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = -Math.atan2(z1 - z0, x1 - x0);
    const nx = -(z1 - z0) / len;
    const nz = (x1 - x0) / len;
    this.box(slot, len + t * 0.6, h + sink, t, { x: (x0 + x1) / 2, y: y - sink, z: (z0 + z1) / 2, ry }, 0.7);
    if (crenel && h > 0.05) {
      const mt = Math.min(0.08, t * 0.3);
      const o = t / 2 - mt / 2;
      for (const side of both ? [1, -1] : [1]) this.crenels(slot, x0 + nx * o * side, z0 + nz * o * side, x1 + nx * o * side, z1 + nz * o * side, y + h, { h: merlon, w: merlon * 0.95, t: mt, gap: merlon * 0.75 });
    }
    return this;
  }
  // a column on its base, with a capital (y: where its base stands)
  column(slot, x, z, y, h, r, { capital = true } = {}) {
    this.box(slot, r * 2.5, r * 0.45, r * 2.5, { x, y, z }, 0.3);
    this.cyl(slot, r * 0.86, r, h - (capital ? r * 0.9 : r * 0.45), 10, { x, y: y + r * 0.45, z }, 0.4);
    if (capital) this.box(slot, r * 2.6, r * 0.45, r * 2.6, { x, y: y + h - r * 0.45, z }, 0.3);
    return this;
  }
  // a heap of rubble: a rough mound with blocks fallen about it
  rubble(slot, x, z, r, h, rnd, { y = 0, n = 5, sx = 1.2, block = 1 } = {}) {
    const prof = [[0, 0], [r, 0], [r * 0.92, h * 0.18], [r * 0.7, h * 0.45], [r * 0.45, h * 0.72], [r * 0.2, h * 0.94], [0, h]];
    const g = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(Math.max(a, 0.0001), b)), 9);
    scaleUV(g, (TAU * r) / 0.8, (h * 1.5) / 0.8);
    rough(g, 0.16, x * 3.1 + z * 1.7);
    this.add(slot, g, { x, y, z, sx });
    for (let k = 0; k < n; k++) {
      const a = rnd() * TAU;
      const s = block * (0.8 + rnd() * 0.5);
      this.box(slot, 0.22 * s, 0.14 * s, 0.17 * s, { x: x + Math.cos(a) * r * (0.6 + rnd() * 0.4) * sx, y: y + rnd() * h * 0.35, z: z + Math.sin(a) * r * (0.6 + rnd() * 0.4), ry: rnd() * 3, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7 }, 0.6);
    }
    return this;
  }
  // a pile of dressed blocks waiting to go up: rows of three, stacked
  blocks(slot, x, y, z, k, rnd, { ry = 0, w = 0.3, h = 0.17, d = 0.22 } = {}) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    for (let i = 0; i < k; i++) {
      const lx = (i % 3) * (w + 0.012);
      this.box(slot, w, h, d, { x: x + c * lx, y: y + Math.floor(i / 3) * h, z: z - s * lx + (rnd() - 0.5) * 0.05, ry: ry + (rnd() - 0.5) * 0.15 }, 0.6);
    }
    return this;
  }
  // one of the farm animals of the asset pack ('sheep', 'horse', 'cow', 'pig'), h high, standing still
  animal(name, x, z, ry = 0, h = 0.3) {
    return this.part('animal', name, { x, z, ry }, h);
  }
  // every slot merged into one geometry
  build() {
    const geos = {};
    for (const [slot, list] of Object.entries(this.slots)) {
      const g = mergeGeometries(list, false);
      if (!g) continue;
      g.computeBoundingBox();
      g.computeBoundingSphere();
      geos[slot] = g;
    }
    const box = new THREE.Box3();
    for (const g of Object.values(geos)) box.union(g.boundingBox);
    return { geos, kit: this.kit, fires: this.fires, plants: this.plants, smoke: this.smoke, box };
  }
}

export function compose(k, t) {
  const v = new THREE.Vector3(k.x, k.y, k.z);
  _e.set(0, t.ry || 0, 0, 'YXZ');
  v.multiplyScalar(t.s ?? 1).applyEuler(_e).add(new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0));
  return { ...k, x: v.x, y: v.y, z: v.z, ry: k.ry + (t.ry || 0), h: k.h == null ? null : k.h * (t.s ?? 1), s: k.s * (t.s ?? 1) };
}

// a small deterministic random stream (the same model every time)
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// roughen a surface: every vertex moved by a smooth function of where it is (the copies of a vertex
// on a seam move together, so the surface stays closed)
export function rough(g, amp = 0.12, seed = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + amp * Math.sin(x * 5.1 + z * 3.7 + seed) * Math.sin(y * 4.3 + x * 2.2 + seed * 0.7);
    p.setXYZ(i, x * k, y * (1 + amp * 0.6 * Math.sin(z * 6 + x * 2 + seed)), z * k);
  }
  g.computeVertexNormals();
  return g;
}

// ── walls, windows, doors ──

// a building block: walls w × h × d of `wall`, a door at the front, windows along the sides
export function house(m, { w, h, d, wall = 'plaster', x = 0, y = 0, z = 0, ry = 0, door = true, windows = 2, frame = true }) {
  const sub = new Model();
  sub.box(wall, w, h, d, {});
  if (frame && wall === 'plaster') {
    // half-timbering: corner posts, a sill and a beam at mid height
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sub.box('wood', 0.045, h, 0.045, { x: (sx * (w - 0.03)) / 2, z: (sz * (d - 0.03)) / 2 });
    for (const y of [0.01, h * 0.52, h - 0.04]) {
      sub.box('wood', w + 0.01, 0.035, 0.03, { y, z: d / 2 });
      sub.box('wood', w + 0.01, 0.035, 0.03, { y, z: -d / 2 });
      sub.box('wood', 0.03, 0.035, d + 0.01, { y, x: w / 2 });
      sub.box('wood', 0.03, 0.035, d + 0.01, { y, x: -w / 2 });
    }
  }
  if (door) sub.box('dark', 0.16, Math.min(0.3, h * 0.62), 0.02, { z: d / 2 + 0.005 });
  for (let i = 0; i < windows; i++) {
    const wx = (i - (windows - 1) / 2) * (w / Math.max(windows, 1)) * 0.8;
    const y = h * 0.55;
    if (Math.abs(wx) > 0.12 || !door) sub.box('dark', 0.09, 0.11, 0.02, { x: wx, y, z: d / 2 + 0.006 });
    sub.box('dark', 0.09, 0.11, 0.02, { x: wx, y, z: -d / 2 - 0.006 });
  }
  return m.merge(sub, { x, y, z, ry });
}

export function haystack(s) {
  const prof = [[0, 0], [0.2 * s, 0], [0.22 * s, 0.07 * s], [0.22 * s, 0.16 * s]];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    prof.push([0.22 * s * Math.cos(a), 0.16 * s + 0.3 * s * Math.sin(a)]);
  }
  return prof;
}
