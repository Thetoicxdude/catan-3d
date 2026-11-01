// Board geometry (pointy-top hexes), computed from a map definition (maps.js).
// World units: hex circumradius HEX_SIZE. x grows east, z grows south.
// Vertices (intersections) and edges (paths) get stable integer ids: they follow the order of the
// map's tiles, so the same map always numbers them the same way.
//
// GEO is the geometry of the map in play. It is a live binding: useMap() switches it, and every
// module that imports GEO sees the new map (only one map is in play at a time).
import { mapDef, DEFAULT_MAP } from './maps.js';

export const HEX_SIZE = 10;
const SQRT3 = Math.sqrt(3);
export const APOTHEM = (HEX_SIZE * SQRT3) / 2;

// corner i sits at angle 30° + 60°·i (i = 0 → east-south-east, 1 → south, 4 → north)
// expressed exactly on an integer lattice: x in units of HEX_SIZE·√3/2, z in units of HEX_SIZE/2
const CORNER_LATTICE = [
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
];

export const AXIAL_DIRS = [
  [1, 0], // east
  [1, -1], // north-east
  [0, -1], // north-west
  [-1, 0], // west
  [-1, 1], // south-west
  [0, 1], // south-east
];

export function axialToWorld(q, r) {
  return { x: HEX_SIZE * SQRT3 * (q + r / 2), z: HEX_SIZE * 1.5 * r };
}

export function axialRound(qf, rf) {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;
  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);
  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export function worldToAxial(x, z) {
  const qf = ((SQRT3 / 3) * x - z / 3) / HEX_SIZE;
  const rf = ((2 / 3) * z) / HEX_SIZE;
  return axialRound(qf, rf);
}

export function hexDistance(q1, r1, q2, r2) {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function latticeToWorld(kx, kz) {
  return { x: (kx * HEX_SIZE * SQRT3) / 2, z: (kz * HEX_SIZE) / 2 };
}

export function buildGeometry(m) {
  const def = mapDef(m);
  const hexes = [];
  const hexIndex = new Map();
  for (const t of def.tiles) {
    const key = t.q + ',' + t.r;
    if (hexIndex.has(key)) throw new Error('地圖有重複的地塊 ' + key);
    const w = axialToWorld(t.q, t.r);
    const h = { id: hexes.length, q: t.q, r: t.r, x: w.x, z: w.z, sea: t.t === 'sea', vertices: [], edges: [], neighbors: [] };
    hexIndex.set(key, h.id);
    hexes.push(h);
  }

  const vertices = [];
  const vIndex = new Map();
  const edges = [];
  const eIndex = new Map();

  for (const h of hexes) {
    const cornerIds = [];
    for (let i = 0; i < 6; i++) {
      const kx = 2 * h.q + h.r + CORNER_LATTICE[i][0];
      const kz = 3 * h.r + CORNER_LATTICE[i][1];
      const key = kx + ',' + kz;
      let id = vIndex.get(key);
      if (id === undefined) {
        id = vertices.length;
        const w = latticeToWorld(kx, kz);
        vertices.push({ id, kx, kz, x: w.x, z: w.z, hexes: [], edges: [], neighbors: [] });
        vIndex.set(key, id);
      }
      vertices[id].hexes.push(h.id);
      cornerIds.push(id);
    }
    h.vertices = cornerIds;
    for (let i = 0; i < 6; i++) {
      const a = cornerIds[i];
      const b = cornerIds[(i + 1) % 6];
      const key = a < b ? a + '-' + b : b + '-' + a;
      let id = eIndex.get(key);
      if (id === undefined) {
        id = edges.length;
        const va = vertices[a];
        const vb = vertices[b];
        edges.push({ id, v: [a, b], hexes: [], x: (va.x + vb.x) / 2, z: (va.z + vb.z) / 2 });
        eIndex.set(key, id);
        va.edges.push(id);
        vb.edges.push(id);
        va.neighbors.push(b);
        vb.neighbors.push(a);
      }
      edges[id].hexes.push(h.id);
      h.edges.push(id);
    }
  }

  for (const h of hexes) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const n = hexIndex.get(h.q + dq + ',' + (h.r + dr));
      if (n !== undefined) h.neighbors.push(n);
    }
  }

  // land hexes, and the middle of the land (the mean of their axial coordinates)
  const land = hexes.filter((h) => !h.sea);
  let sq = 0;
  let sr = 0;
  for (const h of land) {
    sq += h.q;
    sr += h.r;
  }
  const center = land.length ? axialToWorld(sq / land.length, sr / land.length) : { x: 0, z: 0 };

  // Coast: paths with land on one side only (sea or the edge of the map on the other), ordered
  // clockwise round the middle of the land by the angle of their midpoints.
  const landCount = (list) => list.reduce((n, id) => n + (hexes[id].sea ? 0 : 1), 0);
  for (const e of edges) e.coastal = landCount(e.hexes) === 1;
  for (const v of vertices) {
    v.land = landCount(v.hexes);
    v.coastal = v.land > 0 && v.land < 3;
  }
  const coastal = edges.filter((e) => e.coastal);
  for (const e of coastal) {
    const h = hexes[e.hexes.find((id) => !hexes[id].sea)];
    const dx = e.x - h.x;
    const dz = e.z - h.z;
    const len = Math.hypot(dx, dz);
    e.outward = { x: dx / len, z: dz / len };
    e.angle = Math.atan2(e.z - center.z, e.x - center.x);
  }
  coastal.sort((a, b) => a.angle - b.angle);

  // The sea frame: the ring of hexes round the map (for rendering only), north to south.
  const sea = [];
  const seen = new Set();
  for (const h of hexes) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const q = h.q + dq;
      const r = h.r + dr;
      const key = q + ',' + r;
      if (hexIndex.has(key) || seen.has(key)) continue;
      seen.add(key);
      const w = axialToWorld(q, r);
      sea.push({ q, r, x: w.x, z: w.z });
    }
  }
  sea.sort((a, b) => a.r - b.r || a.q - b.q);

  // extents: of the land, and of every tile (sea tiles included); hex corners reach HEX_SIZE
  // north and south of the centre, flat sides APOTHEM east and west
  const extent = (list) => {
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minQ: Infinity, maxQ: -Infinity, minR: Infinity, maxR: -Infinity };
    for (const h of list) {
      b.minX = Math.min(b.minX, h.x - APOTHEM);
      b.maxX = Math.max(b.maxX, h.x + APOTHEM);
      b.minZ = Math.min(b.minZ, h.z - HEX_SIZE);
      b.maxZ = Math.max(b.maxZ, h.z + HEX_SIZE);
      b.minQ = Math.min(b.minQ, h.q);
      b.maxQ = Math.max(b.maxQ, h.q);
      b.minR = Math.min(b.minR, h.r);
      b.maxR = Math.max(b.maxR, h.r);
    }
    return b;
  };

  const bounds = extent(hexes);
  return {
    id: def.id,
    def,
    hexes,
    vertices,
    edges,
    coastalEdges: coastal.map((e) => e.id),
    sea,
    center,
    land: extent(land.length ? land : hexes),
    bounds,
    // how much bigger than the standard island (86.6 × 80) the map is, at least 1: camera distances,
    // zoom thresholds and the minimap scale with it
    scale: Math.max(1, (bounds.maxX - bounds.minX) / 86.61, (bounds.maxZ - bounds.minZ) / 80),
    hexAt(q, r) {
      const id = hexIndex.get(q + ',' + r);
      return id === undefined ? -1 : id;
    },
    edgeBetween(a, b) {
      const key = a < b ? a + '-' + b : b + '-' + a;
      const id = eIndex.get(key);
      return id === undefined ? -1 : id;
    },
  };
}

const built = new Map();

// The geometry of the map in play (see useMap).
export let GEO = geometryOf(DEFAULT_MAP);

// the geometry of a map (by id or definition), built once
export function geometryOf(m) {
  const def = mapDef(m);
  let g = built.get(def.id);
  if (!g || g.def !== def) {
    g = buildGeometry(def);
    built.set(def.id, g);
  }
  return g;
}

// Put a map in play: GEO becomes its geometry. Cheap when it already is.
export function useMap(m) {
  const def = mapDef(m);
  if (GEO.def !== def) GEO = geometryOf(def);
  return GEO;
}

// Run fn with another map in play, then put the current one back (for side work such as drawing
// another map's board while a game is open).
export function withMap(m, fn) {
  const prev = GEO;
  useMap(m);
  try {
    return fn(GEO);
  } finally {
    GEO = prev;
  }
}
