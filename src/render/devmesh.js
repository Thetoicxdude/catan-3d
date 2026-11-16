// The development mode's models (devmodels.js) made into meshes: each material slot gets the asset
// pack's scanned materials where it has them (the same tiling stone, timber, thatch and brick as the
// windmills, kilns and mines of the countryside), plain colours otherwise (the page without the pack);
// the owner's colour goes on the roofs and the cloth. Parts of the pack's kits (the fort's towers and
// walls, crates and baskets, the windmill) are put where the model says, at the height it asks for.
import * as THREE from 'three';
import { tileMaterial, windmill } from './props.js';
import { modelMaterial, part as kitPart } from './models.js';
import { shade } from './geo.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildingModel, wonderModel, facilityModel } from './devmodels.js';

// plain colours (no pack, or slots the pack has no material for)
const PLAIN = {
  stone: '#b8ad98',
  plaster: '#e6dac2',
  wood: '#7a5a3c',
  dark: '#2c241e',
  thatch: '#c6a259',
  brick: '#a55c3c',
  rock: '#8a837a',
  street: '#9c9488',
  sand: '#dcc69c',
  marble: '#e9e3d6',
  metal: '#5a5c61',
  copper: '#5f9a83',
  gold: '#c9a03e',
  leaf: '#4d7a30',
  water: '#4f86a3',
  canvas: '#ece2cc',
  paper: '#f4efe2',
  burlap: '#a88c5c',
  earth: '#5e4631',
  glow: '#ffb347',
};
// slots drawn from the pack's tiling sets: [set, tint]
const TILED = {
  stone: ['stone', [1.75, 1.68, 1.55]],
  wood: ['wood', null],
  dark: ['wood', '#2a2420'],
  thatch: ['thatch', [2.2, 1.8, 1.0]],
  brick: ['brick', null],
  rock: ['rock', null],
  street: ['street', null],
  sand: ['stone', [2.15, 1.8, 1.22]],
  marble: ['stone', [2.45, 2.38, 2.24]],
  burlap: ['thatch', [1.45, 1.1, 0.72]],
};
// The slots are drawn in a few groups, each one material (so a model is a handful of draws, not one
// per slot): those of one tiling set together, the plain colours together, the metals together; what
// tells the slots of a group apart (a tint of the scan, a plain colour) is in the vertex colours.
// Without the pack every slot that is not metal, water, fire or the owner's is a plain colour.
const METALS = { metal: [0.45, 0.6], copper: [0.55, 0.35], gold: [0.35, 0.75] };
function groupOf(slot, tiles) {
  if (slot === 'roof' || slot === 'cloth' || slot === 'water' || slot === 'glow') return slot;
  if (METALS[slot]) return 'metal';
  const tiled = TILED[slot];
  if (tiles && tiled && tiles[tiled[0]]) return 'tile:' + tiled[0];
  return 'plain';
}
// a slot's colour in its group (linear: a scan's tint may go over 1 to lift it)
const _c = new THREE.Color();
function slotColor(slot, tiles) {
  const tiled = TILED[slot];
  if (tiles && tiled && tiles[tiled[0]]) {
    const t = tiled[1];
    if (Array.isArray(t)) return _c.setRGB(t[0], t[1], t[2]);
    return t ? _c.set(t) : _c.setRGB(1, 1, 1);
  }
  return _c.set(PLAIN[slot] || PLAIN.stone);
}

let shared = null;
let sharedFor;
// the materials of the groups that are the same for everyone (made again for another pack)
function materials(tiles) {
  if (shared && sharedFor === tiles) return shared;
  shared = {};
  sharedFor = tiles;
  if (tiles) {
    for (const name of new Set(Object.values(TILED).map((x) => x[0]))) {
      const t = tiles[name];
      if (!t) continue;
      const m = new THREE.MeshStandardMaterial({ map: t.d, normalMap: t.n, aoMap: t.arm, roughnessMap: t.arm, roughness: 1, metalness: 0, vertexColors: true });
      m.normalScale.set(1, -1);
      shared['tile:' + name] = m;
    }
  }
  // (the plain group holds cloth, paper and leaves, seen from both sides)
  shared.plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  shared.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.65 });
  shared.water = new THREE.MeshStandardMaterial({ color: PLAIN.water, roughness: 0.12, metalness: 0.05 });
  shared.glow = new THREE.MeshBasicMaterial({ color: PLAIN.glow });
  return shared;
}

// a model's slots merged into its groups, the slots' colours in the vertices (shared by every copy)
const grouped = new Map();
function groupsOf(key, b, tiles) {
  const k = key + (tiles ? '|pack' : '|plain');
  if (grouped.has(k)) return grouped.get(k);
  const lists = {};
  for (const [slot, geo] of Object.entries(b.geos)) {
    const gname = groupOf(slot, tiles);
    const c = slotColor(slot, tiles);
    const g = geo.clone();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (lists[gname] = lists[gname] || []).push(g);
  }
  const out = {};
  for (const [gname, list] of Object.entries(lists)) {
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    g.computeBoundingSphere();
    out[gname] = g;
  }
  grouped.set(k, out);
  return out;
}

// roof tiles: rows of rounded clay tiles, grey (the owner's colour multiplies it)
let shingle = null;
function shingleTexture() {
  if (shingle || typeof document === 'undefined') return shingle;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, S, S);
  const rows = 8;
  const cols = 8;
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k <= cols; k++) {
      const x = ((k + (r % 2) * 0.5) * S) / cols;
      const y = (r * S) / rows;
      const w = S / cols;
      const grad = g.createLinearGradient(x, 0, x + w, 0);
      const l = 175 + Math.floor(Math.random() * 40);
      grad.addColorStop(0, `rgb(${l * 0.62},${l * 0.62},${l * 0.62})`);
      grad.addColorStop(0.45, `rgb(${l},${l},${l})`);
      grad.addColorStop(1, `rgb(${l * 0.55},${l * 0.55},${l * 0.55})`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x + 2, y);
      g.lineTo(x + w - 2, y);
      g.lineTo(x + w - 2, y + S / rows - 6);
      g.quadraticCurveTo(x + w / 2, y + S / rows + 4, x + 2, y + S / rows - 6);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, y + S / rows - 3, w, 3);
    }
  }
  shingle = new THREE.CanvasTexture(c);
  shingle.colorSpace = THREE.SRGBColorSpace;
  shingle.wrapS = shingle.wrapT = THREE.RepeatWrapping;
  shingle.anisotropy = 4;
  return shingle;
}

// the owner's roof and cloth (one pair per colour)
const owned = new Map();
function ownerMaterials(color) {
  const key = color || '#888888';
  let o = owned.get(key);
  if (o) return o;
  o = {
    roof: new THREE.MeshStandardMaterial({ color: shade(key, 1.05), map: shingleTexture(), roughness: 0.82, metalness: 0 }),
    cloth: new THREE.MeshStandardMaterial({ color: key, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
  };
  owned.set(key, o);
  return o;
}

// built models, by what they are (their geometry is shared by every copy on the map)
const built = new Map();
function modelOf(kind, k, x) {
  const key = `${kind}|${k}|${x}`;
  if (built.has(key)) return built.get(key);
  const m = kind === 'b' ? buildingModel(k) : kind === 'w' ? wonderModel(k, x) : facilityModel(k, x);
  const b = m ? m.build() : null;
  if (b) b.key = key;
  built.set(key, b);
  return b;
}

// an animal of the pack standing still (the first frame of its idle, in its own colours)
let animalMat = null;
function animalMesh(models, name, h) {
  const b = models && models.baked && models.baked[name];
  if (!b) return null;
  if (!animalMat) animalMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
  const m = new THREE.Mesh(b.geo, animalMat);
  m.scale.setScalar(h / Math.max(0.01, b.height));
  m.castShadow = true;
  m.receiveShadow = true;
  const wrap = new THREE.Group();
  wrap.add(m);
  return wrap;
}

// the stand-ins' plain materials (one set, compiled while the map loads: devPrewarm)
let standIns = null;
function standInMaterials() {
  if (standIns) return standIns;
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  standIns = {
    wood: std(PLAIN.wood),
    mill: std('#d8cfbd'),
    leaf: std(PLAIN.leaf, { flatShading: true }),
    sheep: std('#e8e2d4'),
    horse: std('#6b4a32'),
    pig: std('#d9a08f'),
    cow: std('#d8d2c6'),
  };
  return standIns;
}

// a stand-in for a kit part without the pack
function plainKit(name, h) {
  if (name === 'sheep' || name === 'horse' || name === 'cow' || name === 'pig') return plainAnimal(name, h);
  const mat = name === 'windmill' ? standInMaterials().mill : standInMaterials().wood;
  const g = name === 'windmill' ? new THREE.CylinderGeometry(0.28, 0.36, 1, 10).translate(0, 0.5, 0) : new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, mat);
  m.scale.set(h * (name === 'windmill' ? 1 : 1.2), h, h * (name === 'windmill' ? 1 : 0.9));
  return m;
}

// an animal in plain shapes: a body, a head, four legs (facing +z)
const plainAnimals = new Map();
function plainAnimal(name, h) {
  let geo = plainAnimals.get(name);
  if (!geo) {
    const horse = name === 'horse';
    const L = horse ? 1.0 : 0.9;
    const parts = [
      new THREE.BoxGeometry(0.42, 0.36, L * 0.78).translate(0, 0.62, 0),
      new THREE.BoxGeometry(0.2, horse ? 0.42 : 0.24, horse ? 0.36 : 0.26).translate(0, horse ? 0.95 : 0.74, L * 0.48),
    ];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(0.09, 0.46, 0.09).translate(sx * 0.13, 0.23, sz * L * 0.3));
    geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    geo.computeBoundingBox();
    plainAnimals.set(name, geo);
  }
  const m = new THREE.Mesh(geo, standInMaterials()[name] || standInMaterials().sheep);
  m.scale.setScalar(h / (geo.boundingBox.max.y || 1));
  m.castShadow = true;
  const wrap = new THREE.Group();
  wrap.add(m);
  return wrap;
}

// one kit part: the pack's geometry scaled to the height asked for
function kitMesh(models, k, color) {
  if (k.model === 'animal') return animalMesh(models, k.name, k.h || 0.3) || plainKit(k.name, k.h || 0.3);
  if (k.model === 'windmill') {
    if (models && models.stone && models.thatch) {
      const { group } = windmill(models);
      group.scale.setScalar((k.h || 2) / 2.68);
      // the owner's flag on the cap
      const own = ownerMaterials(color);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26).translate(0.23, 0, 0), own.cloth);
      cloth.position.set(0, 2.95, 0);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5).translate(0, 0.25, 0), tileMaterial(models, 'wood'));
      pole.position.set(0, 2.62, 0);
      group.add(cloth, pole);
      return group;
    }
    return plainKit('windmill', k.h || 2);
  }
  const md = models && models[k.model];
  const g = md && kitPart(md, k.name);
  if (!g) return plainKit(k.name, k.h || 0.2);
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  const s = k.h ? k.h / Math.max(0.001, bb.max.y - bb.min.y) : 0.16 * k.s;
  const m = new THREE.Mesh(g, modelMaterial(md));
  m.scale.setScalar(s);
  m.position.y = -bb.min.y * s;
  m.castShadow = true;
  m.receiveShadow = true;
  const wrap = new THREE.Group();
  wrap.add(m);
  return wrap;
}

// a plant drawn plainly (no pack, or a model that grows with the zoom): a trunk under round crowns
function plainPlant(_, p) {
  const mats = standInMaterials();
  const g = new THREE.Group();
  const low = /fern|rooibos/.test(p.sp);
  if (!low) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * p.h, 0.05 * p.h, p.h * 0.45, 5).translate(0, p.h * 0.225, 0), mats.wood);
    trunk.castShadow = true;
    g.add(trunk);
  }
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(low ? p.h * 0.55 : p.h * 0.32, 0), mats.leaf);
  crown.position.y = low ? p.h * 0.3 : p.h * 0.62;
  crown.scale.y = low ? 0.6 : 1.1;
  crown.castShadow = true;
  g.add(crown);
  g.position.set(p.x, p.y, p.z);
  return g;
}

// A group for a building (kind 'b', k), a wonder (kind 'w', k, stage) or a facility (kind 'f', terrain,
// level), in the owner's colour. models: the pack's models and tiling sets, or null. impostors: the
// plants are left to the caller (userData.plants: the map's own photographed plants, placed in world
// coordinates); otherwise they are drawn plainly here.
export function devGroup(models, kind, k, x, color, { impostors = false } = {}) {
  const b = modelOf(kind, k, x);
  const group = new THREE.Group();
  if (!b) return group;
  const tiles = models && models.stone ? models : null;
  const mats = materials(tiles);
  const own = ownerMaterials(color);
  for (const [gname, geo] of Object.entries(groupsOf(b.key, b, tiles))) {
    const mat = gname === 'roof' ? own.roof : gname === 'cloth' ? own.cloth : mats[gname] || mats.plain;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = gname !== 'glow';
    mesh.receiveShadow = true;
    mesh.userData.group = gname;
    group.add(mesh);
  }
  for (const k2 of b.kit) {
    const o = kitMesh(models, k2, color);
    o.position.set(k2.x, k2.y, k2.z);
    o.rotation.y = k2.ry;
    group.add(o);
  }
  if (!impostors) for (const p of b.plants) group.add(plainPlant(mats, p));
  group.userData.box = b.box;
  group.userData.fires = b.fires;
  group.userData.smoke = b.smoke || [];
  group.userData.plants = impostors ? b.plants : [];
  return group;
}

// every material a model can use, for compiling the shaders while the map loads
export function devPrewarm(models, colors) {
  const g = new THREE.Group();
  const tiles = models && models.stone ? models : null;
  const mats = materials(tiles);
  const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  for (const m of Object.values(mats)) g.add(new THREE.Mesh(geo, m));
  for (const c of colors) {
    const o = ownerMaterials(c);
    g.add(new THREE.Mesh(geo, o.roof), new THREE.Mesh(geo, o.cloth));
  }
  const a = models && models.baked && Object.keys(models.baked)[0];
  if (a) g.add(animalMesh(models, a, 0.3));
  for (const m of Object.values(standInMaterials())) g.add(new THREE.Mesh(geo, m));
  return g;
}
