// Board generation: terrain shuffle, number tokens, harbors, province names.
import { GEO, AXIAL_DIRS } from './geometry.js';
import { rngFloat, shuffle } from './rng.js';

export const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
export const TERRAIN_RES = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  desert: null,
};
export const TERRAIN_COUNTS = { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 };
export const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
// Official token order (A–R) for the spiral placement method.
export const SPIRAL_TOKENS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
export const HARBOR_TYPES = ['any', 'any', 'any', 'any', 'wood', 'brick', 'wool', 'grain', 'ore'];
const HARBOR_GAPS = [3, 3, 4, 3, 3, 4, 3, 3, 4];

export function pips(n) {
  if (!n || n === 7) return 0;
  return 6 - Math.abs(7 - n);
}

const NAMES = {
  forest: [['黑松', '雲杉', '橡木', '霧隱', '幽谷', '楓紅', '古藤', '鹿鳴', '狼嚎', '青岡'], ['林', '森林', '林地']],
  hills: [['赤陶', '紅土', '褐岩', '窯火', '磚紅', '鏽石', '赭石', '炭窯'], ['丘', '丘陵', '崗']],
  pasture: [['青羊', '白羊', '綠野', '風吟', '牧歌', '春草', '銀鈴', '雲絮'], ['原', '牧場', '草原']],
  fields: [['金麥', '豐穗', '黃金', '麥浪', '稻香', '暖陽', '秋收', '琥珀'], ['田', '平原', '穀地']],
  mountains: [['鐵脊', '灰岩', '雪峰', '鷹巢', '龍脊', '寒鋒', '黑曜', '銀礦'], ['山', '山脈', '嶺']],
  desert: [['流沙', '焦土', '黃沙', '枯骨', '赤焰', '無垠'], ['荒原', '沙海', '大漠']],
};

function terrainOk(terrains) {
  // Each hex may touch at most one hex of its own terrain (spreads resources out).
  let worst = 0;
  for (const h of GEO.hexes) {
    let same = 0;
    for (const n of h.neighbors) if (terrains[n] === terrains[h.id]) same++;
    if (same > worst) worst = same;
  }
  return worst;
}

function numbersOk(terrains, numbers) {
  for (const h of GEO.hexes) {
    const a = numbers[h.id];
    if (!a) continue;
    for (const n of h.neighbors) {
      const b = numbers[n];
      if (!b) continue;
      if ((a === 6 || a === 8) && (b === 6 || b === 8)) return false;
      if (a === b) return false;
    }
  }
  return true;
}

function ringOrder(k, startCorner) {
  // Hexes of ring k, walked counter-clockwise (as seen on a north-up map), starting at a corner.
  if (k === 0) return [GEO.hexAt(0, 0)];
  const out = [];
  let q = AXIAL_DIRS[4][0] * k;
  let r = AXIAL_DIRS[4][1] * k;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < k; step++) {
      out.push(GEO.hexAt(q, r));
      q += AXIAL_DIRS[side][0];
      r += AXIAL_DIRS[side][1];
    }
  }
  const shift = (startCorner * k) % out.length;
  return out.slice(shift).concat(out.slice(0, shift));
}

function spiralNumbers(terrains, startCorner) {
  const order = [...ringOrder(2, startCorner), ...ringOrder(1, startCorner), ...ringOrder(0, 0)];
  const numbers = new Array(GEO.hexes.length).fill(0);
  let t = 0;
  for (const id of order) {
    if (terrains[id] === 'desert') continue;
    numbers[id] = SPIRAL_TOKENS[t++];
  }
  return numbers;
}

export function generateBoard(holder, opts = {}) {
  const method = opts.numbers === 'spiral' ? 'spiral' : 'balanced';
  const pool = [];
  for (const [t, c] of Object.entries(TERRAIN_COUNTS)) for (let i = 0; i < c; i++) pool.push(t);

  let terrains = null;
  let bestScore = 99;
  for (let attempt = 0; attempt < 400; attempt++) {
    const cand = shuffle(holder, pool.slice());
    const score = terrainOk(cand);
    if (score < bestScore) {
      bestScore = score;
      terrains = cand;
    }
    if (score <= 1) break;
  }

  let numbers = null;
  if (method === 'spiral') {
    const corners = shuffle(holder, [0, 1, 2, 3, 4, 5]);
    for (const c of corners) {
      const cand = spiralNumbers(terrains, c);
      if (numbersOk(terrains, cand)) {
        numbers = cand;
        break;
      }
    }
  }
  if (!numbers) {
    const land = GEO.hexes.filter((h) => terrains[h.id] !== 'desert').map((h) => h.id);
    for (let attempt = 0; attempt < 5000; attempt++) {
      const tokens = shuffle(holder, NUMBER_TOKENS.slice());
      const cand = new Array(GEO.hexes.length).fill(0);
      land.forEach((id, i) => (cand[id] = tokens[i]));
      numbers = cand;
      if (numbersOk(terrains, cand)) break;
    }
  }

  // Harbors on the coast with the standard spacing pattern.
  const coast = GEO.coastalEdges;
  const offset = Math.floor(rngFloat(holder) * coast.length);
  const types = shuffle(holder, HARBOR_TYPES.slice());
  const harbors = [];
  let pos = offset;
  for (let i = 0; i < 9; i++) {
    harbors.push({ edge: coast[pos % coast.length], type: types[i] });
    pos += HARBOR_GAPS[i];
  }
  const vertexHarbor = new Array(GEO.vertices.length).fill(null);
  for (const hb of harbors) for (const v of GEO.edges[hb.edge].v) vertexHarbor[v] = hb.type;

  // Province names.
  const used = {};
  const hexes = GEO.hexes.map((h) => {
    const terrain = terrains[h.id];
    const [pre, suf] = NAMES[terrain];
    used[terrain] = used[terrain] || shuffle(holder, pre.slice());
    const p = used[terrain].pop() || pre[0];
    const s = suf[Math.floor(rngFloat(holder) * suf.length)];
    return { terrain, number: numbers[h.id], name: p + s };
  });

  const desert = hexes.findIndex((h) => h.terrain === 'desert');
  return { hexes, harbors, vertexHarbor, robber: desert, method };
}
