// Static board geometry for the standard 19-hex island (pointy-top hexes).
// World units: hex circumradius HEX_SIZE. x grows east, z grows south.
// Vertices (intersections) and edges (paths) get stable integer ids.

export const HEX_SIZE = 10;
const SQRT3 = Math.sqrt(3);
export const BOARD_RADIUS = 2;

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

function buildGeometry() {
  const hexes = [];
  const hexIndex = new Map();
  for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r++) {
    for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q++) {
      if (Math.abs(q + r) > BOARD_RADIUS) continue;
      const w = axialToWorld(q, r);
      const h = { id: hexes.length, q, r, x: w.x, z: w.z, vertices: [], edges: [], neighbors: [] };
      hexIndex.set(q + ',' + r, h.id);
      hexes.push(h);
    }
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

  // Coastal edges ordered clockwise around the island (by angle of the midpoint).
  const coastal = edges.filter((e) => e.hexes.length === 1);
  for (const e of coastal) {
    const h = hexes[e.hexes[0]];
    const dx = e.x - h.x;
    const dz = e.z - h.z;
    const len = Math.hypot(dx, dz);
    e.outward = { x: dx / len, z: dz / len };
    e.angle = Math.atan2(e.z, e.x);
  }
  coastal.sort((a, b) => a.angle - b.angle);
  for (const e of edges) e.coastal = e.hexes.length === 1;
  for (const v of vertices) v.coastal = v.hexes.length < 3;

  // Sea frame ring (for rendering only).
  const sea = [];
  for (let r = -BOARD_RADIUS - 1; r <= BOARD_RADIUS + 1; r++) {
    for (let q = -BOARD_RADIUS - 1; q <= BOARD_RADIUS + 1; q++) {
      if (hexDistance(q, r, 0, 0) !== BOARD_RADIUS + 1) continue;
      const w = axialToWorld(q, r);
      sea.push({ q, r, x: w.x, z: w.z });
    }
  }

  return {
    hexes,
    vertices,
    edges,
    coastalEdges: coastal.map((e) => e.id),
    sea,
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

export const GEO = buildGeometry();
