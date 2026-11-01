// Board generation for a map (maps.js): terrain shuffle, number tokens, harbors, province names.
// The map must be in play (useMap) — the board is laid out on GEO.
import { GEO, AXIAL_DIRS, useMap } from './geometry.js';
import { BASE4 } from './maps.js';
import { rngFloat, rngInt, shuffle } from './rng.js';

export const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
export const TERRAIN_RES = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  desert: null,
  sea: null,
};
// the standard island's pieces (other maps bring their own, see maps.js)
export const TERRAIN_COUNTS = BASE4.pool;
export const NUMBER_TOKENS = BASE4.numbers;
// Official token order (A–R) for the spiral placement method.
export const SPIRAL_TOKENS = BASE4.spiral;
export const HARBOR_TYPES = BASE4.harbors.types;

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
    if (h.sea) continue;
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

// the official spiral: the outer ring first, then inwards (hexagonal maps only)
function spiralNumbers(def, terrains, fixed, startCorner) {
  const order = [];
  for (let k = def.radius; k >= 0; k--) order.push(...ringOrder(k, k ? startCorner : 0));
  const numbers = fixed.slice();
  let t = 0;
  for (const id of order) {
    if (!dealt(terrains[id]) || fixed[id]) continue;
    numbers[id] = def.spiral[t++];
  }
  return numbers;
}

// terrains that take a number token
const dealt = (terrain) => !!terrain && terrain !== 'desert' && terrain !== 'sea';

// ── generation for maps other than the standard island ──
// (the standard island keeps its original generator — `legacy` — so every seed still lays out the
// same board as before)

// Spread the drawn terrain: swap pairs of drawn tiles while that does not leave more neighbours of the
// same terrain (equal swaps are kept, so the search wanders across plateaus).
function spreadTerrain(holder, terrains, free) {
  if (free.length < 2) return;
  const same = (id) => {
    let n = 0;
    for (const nb of GEO.hexes[id].neighbors) if (terrains[nb] === terrains[id]) n++;
    return n;
  };
  for (let k = free.length * 80; k > 0; k--) {
    const a = free[rngInt(holder, 0, free.length - 1)];
    const b = free[rngInt(holder, 0, free.length - 1)];
    if (terrains[a] === terrains[b]) continue;
    const before = same(a) + same(b);
    [terrains[a], terrains[b]] = [terrains[b], terrains[a]];
    if (same(a) + same(b) > before) [terrains[a], terrains[b]] = [terrains[b], terrains[a]];
  }
}

// Repair shuffled number tokens: swap tokens between land tiles until no 6/8 touch another 6/8 and no
// two equal numbers touch (or the attempts run out).
function repairNumbers(holder, numbers, land) {
  const hot = (n) => n === 6 || n === 8;
  const bad = (id) => {
    const a = numbers[id];
    let n = 0;
    for (const nb of GEO.hexes[id].neighbors) {
      const b = numbers[nb];
      if (b && (a === b || (hot(a) && hot(b)))) n++;
    }
    return n;
  };
  for (let k = land.length * 200; k > 0; k--) {
    const sore = land.filter((id) => bad(id) > 0);
    if (!sore.length) return true;
    const a = sore[rngInt(holder, 0, sore.length - 1)];
    const b = land[rngInt(holder, 0, land.length - 1)];
    if (numbers[a] === numbers[b]) continue;
    const before = bad(a) + bad(b);
    [numbers[a], numbers[b]] = [numbers[b], numbers[a]];
    if (bad(a) + bad(b) > before) [numbers[a], numbers[b]] = [numbers[b], numbers[a]];
  }
  return land.every((id) => bad(id) === 0);
}

// opts.numbers: 'spiral' (the official order, on maps that have one) or 'balanced' (shuffled until
// no 6/8 and no equal numbers touch). The map is the one in play unless opts.map names another.
export function generateBoard(holder, opts = {}) {
  if (opts.map) useMap(opts.map);
  const def = GEO.def;
  const method = opts.numbers === 'spiral' && def.spiral && def.radius != null ? 'spiral' : 'balanced';
  const pool = [];
  for (const [t, c] of Object.entries(def.pool)) for (let i = 0; i < c; i++) pool.push(t);

  // tiles drawn from the pool ('?'), the others keep the terrain the map gives them
  const free = [];
  const base = def.tiles.map((t, id) => {
    if (t.t === '?' || !t.t) {
      free.push(id);
      return null;
    }
    return t.t;
  });
  if (pool.length < free.length) throw new Error('地圖的地形不夠分配');

  let terrains = null;
  if (def.legacy) {
    let bestScore = 99;
    for (let attempt = 0; attempt < 400; attempt++) {
      const drawn = shuffle(holder, pool.slice());
      const cand = base.slice();
      free.forEach((id, i) => (cand[id] = drawn[i]));
      const score = terrainOk(cand);
      if (score < bestScore) {
        bestScore = score;
        terrains = cand;
      }
      if (score <= 1) break;
    }
  } else {
    const drawn = shuffle(holder, pool.slice());
    terrains = base.slice();
    free.forEach((id, i) => (terrains[id] = drawn[i]));
    spreadTerrain(holder, terrains, free);
  }

  // numbers the map fixes; the tokens go to the other land tiles
  const fixed = def.tiles.map((t) => t.n || 0);
  let numbers = null;
  if (method === 'spiral') {
    const corners = shuffle(holder, [0, 1, 2, 3, 4, 5]);
    for (const c of corners) {
      const cand = spiralNumbers(def, terrains, fixed, c);
      if (numbersOk(terrains, cand)) {
        numbers = cand;
        break;
      }
    }
  }
  if (!numbers) {
    const land = GEO.hexes.filter((h) => dealt(terrains[h.id]) && !fixed[h.id]).map((h) => h.id);
    if (def.legacy) {
      for (let attempt = 0; attempt < 5000; attempt++) {
        const tokens = shuffle(holder, def.numbers.slice());
        const cand = fixed.slice();
        land.forEach((id, i) => (cand[id] = tokens[i] || 0));
        numbers = cand;
        if (numbersOk(terrains, cand)) break;
      }
    } else {
      const tokens = shuffle(holder, def.numbers.slice());
      numbers = fixed.slice();
      land.forEach((id, i) => (numbers[id] = tokens[i] || 0));
      repairNumbers(holder, numbers, land.filter((id) => numbers[id]));
    }
  }

  // Harbors round the coast: from a random start, `gaps` coastal paths apart.
  const coast = GEO.coastalEdges;
  const offset = Math.floor(rngFloat(holder) * coast.length);
  const types = shuffle(holder, def.harbors.types.slice());
  const harbors = [];
  let pos = offset;
  for (let i = 0; i < types.length; i++) {
    harbors.push({ edge: coast[pos % coast.length], type: types[i] });
    pos += def.harbors.gaps[i];
  }
  const vertexHarbor = new Array(GEO.vertices.length).fill(null);
  for (const hb of harbors) for (const v of GEO.edges[hb.edge].v) vertexHarbor[v] = hb.type;

  // Province names (the sea has none).
  const used = {};
  const hexes = GEO.hexes.map((h) => {
    const terrain = terrains[h.id];
    if (!NAMES[terrain]) return { terrain, number: numbers[h.id], name: '' };
    const [pre, suf] = NAMES[terrain];
    used[terrain] = used[terrain] || shuffle(holder, pre.slice());
    const p = used[terrain].pop() || pre[0];
    const s = suf[Math.floor(rngFloat(holder) * suf.length)];
    return { terrain, number: numbers[h.id], name: p + s };
  });

  const desert = hexes.findIndex((h) => h.terrain === 'desert');
  return { hexes, harbors, vertexHarbor, robber: desert, method };
}
