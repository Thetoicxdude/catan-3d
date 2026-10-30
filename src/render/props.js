// Countryside buildings drawn with photo-scanned tiling materials (Poly Haven, CC0): stone tower
// windmills with thatched caps and timber sails, golden haystacks, brick kilns, timbered mine
// entrances and the half-buried fort walls of the desert ruins. Used once the asset pack is loaded.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { modelMaterial, part as modelPart } from './models.js';

const mats = new Map();
// a PBR material from a tiling set (d / n / arm), optionally tinted
export function tileMaterial(tiles, name, { tint = null, side = THREE.FrontSide } = {}) {
  const key = name + String(tint || '') + side;
  if (mats.has(key)) return mats.get(key);
  const t = tiles[name];
  const m = new THREE.MeshStandardMaterial({ map: t.d, normalMap: t.n, aoMap: t.arm, roughnessMap: t.arm, roughness: 1, metalness: 0, side });
  m.normalScale.set(1, -1);
  if (Array.isArray(tint)) m.color.setRGB(...tint); // linear multiplier, may exceed 1 to lift a dark scan
  else if (tint) m.color.set(tint);
  mats.set(key, m);
  return m;
}

// UVs scaled to world units, so a texture repeats every `tile` units whatever the shape's size
function worldUV(geo, uScale, vScale) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
  return geo;
}

function lathe(profile, segs, tile) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segs);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  const rMax = Math.max(...profile.map((p) => p[0]));
  return worldUV(g, (2 * Math.PI * rMax) / tile, len / tile);
}

function box(w, h, d, tile, t = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  worldUV(g, Math.max(w, d) / tile, h / tile);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx || 0, t.ry || 0, t.rz || 0)),
    new THREE.Vector3(1, 1, 1),
  );
  return g.applyMatrix4(m);
}

// gable roof with UVs running down the slopes
function gable(w, d, h, tile, t = {}) {
  const hw = w / 2;
  const hd = d / 2;
  const slope = Math.hypot(hd, h);
  const P = [
    // left slope
    [-hw, 0, -hd], [hw, 0, -hd], [hw, h, 0], [-hw, 0, -hd], [hw, h, 0], [-hw, h, 0],
    // right slope
    [-hw, 0, hd], [-hw, h, 0], [hw, h, 0], [-hw, 0, hd], [hw, h, 0], [hw, 0, hd],
    // gables
    [-hw, 0, -hd], [-hw, h, 0], [-hw, 0, hd], [hw, 0, -hd], [hw, 0, hd], [hw, h, 0],
  ];
  const UV = [
    [0, 0], [w, 0], [w, slope], [0, 0], [w, slope], [0, slope],
    [0, 0], [0, slope], [w, slope], [0, 0], [w, slope], [w, 0],
    [0, 0], [hd, h], [d, 0], [0, 0], [d, 0], [hd, h],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV.flat().map((v) => v / tile), 2));
  g.computeVertexNormals();
  g.translate(t.x || 0, t.y || 0, t.z || 0);
  if (t.ry) g.rotateY(t.ry);
  return g;
}

const shadowed = (m) => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

// ── windmill: stone tower, thatched cap, four lattice sails ──
let millGeo = null;
function windmillGeometry() {
  if (millGeo) return millGeo;
  const tower = lathe(
    [
      [0.0, 0.0],
      [0.6, 0.0],
      [0.6, 0.12],
      [0.55, 0.16],
      [0.44, 1.9],
      [0.5, 1.92],
      [0.0, 1.93],
    ],
    20,
    0.75,
  );
  const cap = lathe(
    [
      [0.0, 1.9],
      [0.58, 1.88],
      [0.56, 1.98],
      [0.4, 2.3],
      [0.16, 2.6],
      [0.0, 2.68],
    ],
    20,
    0.55,
  );
  const door = box(0.26, 0.42, 0.08, 0.5, { y: 0.21, z: 0.58, rx: -0.07 });
  const win = box(0.14, 0.18, 0.06, 0.5, { y: 1.15, z: 0.5, rx: -0.07 });
  const wood = [];
  const canvas = [];
  for (let b = 0; b < 4; b++) {
    const parts = [box(0.07, 1.75, 0.07, 1.2, { y: 0.88 })];
    for (const x of [0.07, 0.44]) parts.push(box(0.025, 1.36, 0.025, 1.2, { x, y: 1.0, z: 0.02 }));
    for (let k = 0; k < 8; k++) parts.push(box(0.4, 0.02, 0.02, 1.2, { x: 0.26, y: 0.36 + k * 0.18, z: 0.02 }));
    const blade = mergeGeometries(parts);
    blade.rotateZ((b * Math.PI) / 2);
    wood.push(blade);
    const c = new THREE.PlaneGeometry(0.36, 1.25).translate(0.255, 1.0, 0.035);
    c.rotateZ((b * Math.PI) / 2);
    canvas.push(c);
  }
  wood.push(box(0.12, 0.12, 0.3, 1, { z: -0.1 }));
  millGeo = { tower, cap, dark: mergeGeometries([door, win]), sails: mergeGeometries(wood), canvas: mergeGeometries(canvas) };
  return millGeo;
}

export function windmill(tiles) {
  const G = windmillGeometry();
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(G.tower, tileMaterial(tiles, 'stone', { tint: [1.75, 1.68, 1.55] }))));
  g.add(shadowed(new THREE.Mesh(G.cap, tileMaterial(tiles, 'thatch', { tint: [2.2, 1.8, 1.0] }))));
  g.add(new THREE.Mesh(G.dark, tileMaterial(tiles, 'wood', { tint: '#6a5a4a' })));
  const hub = new THREE.Group();
  hub.position.set(0, 1.86, 0.62);
  hub.add(shadowed(new THREE.Mesh(G.sails, tileMaterial(tiles, 'wood'))));
  hub.add(shadowed(new THREE.Mesh(G.canvas, canvasMaterial())));
  g.add(hub);
  return { group: g, hub };
}

let canvasMat = null;
function canvasMaterial() {
  if (!canvasMat) canvasMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.92, side: THREE.DoubleSide });
  return canvasMat;
}

// ── haystack: a rounded rick of golden hay ──
let hayGeo = null;
export function haystackGeometry() {
  if (hayGeo) return hayGeo;
  // bottom to top: a slightly bellied base under a rounded dome
  const prof = [
    [0, 0],
    [0.38, 0],
    [0.42, 0.12],
    [0.43, 0.3],
  ];
  for (let i = 1; i <= 9; i++) {
    const a = (i / 9) * (Math.PI / 2);
    prof.push([0.43 * Math.cos(a), 0.3 + 0.62 * Math.sin(a)]);
  }
  hayGeo = lathe(prof, 16, 0.5);
  // tousle the hay a little
  const p = hayGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.05 * Math.sin(a * 5 + y * 7) + 0.03 * Math.sin(a * 11 - y * 13);
    p.setXYZ(i, x * k, y, z * k);
  }
  hayGeo.computeVertexNormals();
  return hayGeo;
}
export function hayMaterial(tiles) {
  return tileMaterial(tiles, 'thatch', { tint: [2.9, 2.3, 1.05] });
}

// ── brick kiln: a brick dome with a chimney, a timber lean-to and stacked bricks ──
let kilnGeo = null;
export function kiln(tiles) {
  if (!kilnGeo) {
    const dome = [[0, 0]];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2);
      dome.push([0.58 * Math.cos(a), 0.62 * Math.sin(a)]);
    }
    kilnGeo = {
      brick: mergeGeometries([
        lathe(dome, 18, 0.5),
        lathe([[0.12, 0], [0.11, 1.15], [0.14, 1.18], [0.14, 1.24], [0.0, 1.24]], 10, 0.4).translate(0.32, 0.1, -0.05),
        box(0.36, 0.14, 0.24, 0.4, { x: 0.25, y: 0.07, z: 0.85 }),
        box(0.36, 0.14, 0.24, 0.4, { x: 0.27, y: 0.21, z: 0.86, ry: 0.1 }),
        box(0.3, 0.14, 0.24, 0.4, { x: 0.6, y: 0.07, z: 0.8, ry: 0.4 }),
      ]),
      dark: box(0.26, 0.26, 0.06, 0.5, { y: 0.15, z: 0.56 }),
      wood: mergeGeometries([
        box(0.06, 0.48, 0.06, 1, { x: -0.55, y: 0.24, z: 0.35 }),
        box(0.06, 0.48, 0.06, 1, { x: -1.35, y: 0.24, z: 0.35 }),
        box(0.06, 0.48, 0.06, 1, { x: -0.55, y: 0.24, z: -0.35 }),
        box(0.06, 0.48, 0.06, 1, { x: -1.35, y: 0.24, z: -0.35 }),
        box(0.85, 0.2, 0.05, 0.8, { x: -0.95, y: 0.12, z: -0.37 }),
      ]),
      roof: gable(1.0, 0.86, 0.3, 0.6, { x: -0.95, y: 0.48 }),
    };
  }
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(kilnGeo.brick, tileMaterial(tiles, 'brick'))));
  g.add(new THREE.Mesh(kilnGeo.dark, tileMaterial(tiles, 'wood', { tint: '#2a2420' })));
  g.add(shadowed(new THREE.Mesh(kilnGeo.wood, tileMaterial(tiles, 'wood'))));
  g.add(shadowed(new THREE.Mesh(kilnGeo.roof, tileMaterial(tiles, 'thatch', { tint: [2.2, 1.8, 1.0], side: THREE.DoubleSide }))));
  return { group: g, chimney: new THREE.Vector3(0.32, 1.38, -0.05) };
}

// ── mine entrance: a timber portal against the rock, a dark adit and a crate of ore ──
let mineGeo = null;
export function mine(tiles, models) {
  if (!mineGeo) {
    mineGeo = {
      wood: mergeGeometries([
        box(0.11, 0.82, 0.11, 1, { x: -0.36, y: 0.41, z: 0.05 }),
        box(0.11, 0.82, 0.11, 1, { x: 0.36, y: 0.41, z: 0.05 }),
        box(0.98, 0.13, 0.15, 1, { y: 0.86, z: 0.05 }),
        box(0.07, 0.06, 1.0, 1, { x: -0.18, y: 0.03, z: 0.6 }),
        box(0.07, 0.06, 1.0, 1, { x: 0.18, y: 0.03, z: 0.6 }),
        ...[0, 1, 2, 3, 4].map((k) => box(0.52, 0.04, 0.09, 1, { y: 0.01, z: 0.2 + k * 0.2 })),
      ]),
      dark: box(0.62, 0.78, 0.2, 1, { y: 0.39, z: -0.05 }),
      rock: mergeGeometries([
        lathe([[0, 0], [1.05, 0.0], [0.95, 0.55], [0.55, 1.05], [0.0, 1.25]], 9, 0.9).scale(1.5, 1, 0.75).translate(0, -0.05, -0.45),
      ]),
    };
    // rough up the hillock
    const p = mineGeo.rock.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + 0.12 * Math.sin(x * 5.1 + z * 3.7) * Math.sin(y * 4.3 + x * 2.2);
      p.setXYZ(i, x * k, y * (0.92 + 0.12 * Math.sin(z * 6 + x * 2)), z * k);
    }
    mineGeo.rock.computeVertexNormals();
  }
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(mineGeo.rock, tileMaterial(tiles, 'rock'))));
  g.add(new THREE.Mesh(mineGeo.dark, tileMaterial(tiles, 'wood', { tint: '#16120f' })));
  g.add(shadowed(new THREE.Mesh(mineGeo.wood, tileMaterial(tiles, 'wood'))));
  if (models && models.props) {
    const crate = modelPart(models.props, 'wooden_crate_01');
    if (crate) {
      const c = shadowed(new THREE.Mesh(crate, modelMaterial(models.props)));
      c.scale.setScalar(0.42);
      c.position.set(0.62, 0, 0.55);
      c.rotation.y = 0.5;
      g.add(c);
    }
  }
  return g;
}

// ── ruins: fort walls sunk into the sand, toppled and broken ──
export function ruins(models, rnd) {
  const g = new THREE.Group();
  const fort = models.fort;
  if (!fort) return g;
  const mat = modelMaterial(fort);
  const pieces = [
    ['wall_thin_gate_01', 0.0, 0.0, 0.0, 0.12, 0.0],
    ['wall_thin_corner_01', -2.1, 0.45, 0.55, 0.32, 0.06],
    ['wall_thin_straight_04', 2.2, 0.3, -0.3, 0.45, -0.08],
    ['wall_thin_straight_04', 0.8, 2.3, 1.2, 0.62, 0.14],
    ['wall_thin_corner_01', -1.1, -1.9, 2.4, 0.5, -0.1],
  ];
  for (const [name, x, z, ry, sink, tilt] of pieces) {
    const geo = modelPart(fort, name);
    if (!geo) continue;
    const m = shadowed(new THREE.Mesh(geo, mat));
    const s = 0.14;
    m.scale.setScalar(s);
    if (!geo.boundingBox) geo.computeBoundingBox();
    const h = (geo.boundingBox.max.y - geo.boundingBox.min.y) * s;
    m.position.set(x, -h * sink, z);
    m.rotation.set(tilt, ry + (rnd() - 0.5) * 0.3, tilt * 0.6);
    g.add(m);
  }
  return g;
}
