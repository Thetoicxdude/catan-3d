// Maps players make (the map editor). A draft is what the author draws: hexes on the editor's grid
// (sea, land drawn at random, or a terrain they picked) and a few choices — how many play, the
// points to win, where the opening goes, the island bonus. The map definition (maps.js) is made from
// it: what the draft does not say comes from the standard game in proportion (the terrain of the
// random land, the number tokens, the harbors). The same draft always makes the same definition, on
// every page and on the server, so a map is stored and shared as its draft.
import { msg, N_ } from '../i18n/fill.js';
import { buildGeometry } from './geometry.js';

// a cell of the grid: sea, land drawn at random, or a terrain the author picked
export const CELL_KINDS = {
  s: 'sea',
  l: 'land',
  f: 'forest',
  h: 'hills',
  p: 'pasture',
  w: 'fields',
  m: 'mountains',
  d: 'desert',
  g: 'gold',
};
// the editor's grid (rows of hexes, odd rows half a hex east) and what a map may hold
export const LIMITS = { cols: 13, rows: 11, tiles: 80, land: 60, name: 16, vp: [6, 18] };

const DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
// the random land's terrain, as on the standard island (4 : 4 : 4 : 3 : 3, and one desert in 19 unless
// the author leaves deserts out)
const MIX = [
  ['forest', 4],
  ['pasture', 4],
  ['fields', 4],
  ['hills', 3],
  ['mountains', 3],
  ['desert', 1],
];
// the number tokens, as on the standard island (18), scaled to the land; a token left over goes to the
// first of these (the cooler numbers before 6 and 8)
const TOKENS = [
  [3, 2],
  [11, 2],
  [4, 2],
  [10, 2],
  [5, 2],
  [9, 2],
  [6, 2],
  [8, 2],
  [2, 1],
  [12, 1],
];
const DEV_56 = { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 };

const clampInt = (x, lo, hi, dflt) => (Number.isInteger(x) ? Math.min(hi, Math.max(lo, x)) : dflt);

// A draft as it may be stored: fields checked, cells on the grid, one per position, in order.
export function normalizeDraft(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const name =
    String(src.name || '')
      .replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '')
      .trim()
      .slice(0, LIMITS.name) || N_('未命名的島嶼');
  const kit = src.kit === 6 ? 6 : 4;
  const vp = clampInt(src.vp, LIMITS.vp[0], LIMITS.vp[1], 10);
  const start = src.start === 'main' ? 'main' : 'any';
  const bonus = src.bonus === 0 || src.bonus === 1 ? src.bonus : 2;
  const ships = src.ships === true;
  const desert = src.desert !== false;
  const at = new Map();
  for (const cell of Array.isArray(src.cells) ? src.cells.slice(0, LIMITS.cols * LIMITS.rows * 2) : []) {
    if (!Array.isArray(cell)) continue;
    const [c, r, k] = cell;
    if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= LIMITS.cols || r >= LIMITS.rows || !CELL_KINDS[k]) continue;
    at.set(r * LIMITS.cols + c, [c, r, k]);
  }
  const cells = [...at.keys()].sort((a, b) => a - b).map((i) => at.get(i));
  return { v: 1, name, kit, vp, start, bonus, ships, desert, cells };
}

// a short id for a draft, from its content (an edited draft is another map)
export function draftId(draft) {
  const s = JSON.stringify(normalizeDraft(draft));
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return 'my-' + a.toString(36).padStart(7, '0') + b.toString(36).padStart(7, '0').slice(0, 5);
}

// Shares of `total` by weight, by largest remainder (ties to the earlier entry).
function shares(total, weights) {
  const sum = weights.reduce((t, [, w]) => t + w, 0);
  const want = weights.map(([k, w]) => [k, (total * w) / sum]);
  const out = want.map(([k, x]) => [k, Math.floor(x)]);
  let left = total - out.reduce((t, [, n]) => t + n, 0);
  const order = want.map(([, x], i) => [x - Math.floor(x), i]).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i][1]++;
    left--;
  }
  return out;
}

// The draft's hexes in axial coordinates (centred), its land, islands and coast.
export function analyzeDraft(draft) {
  const d = normalizeDraft(draft);
  const cells = d.cells;
  const tiles = cells.map(([c, r, k]) => ({ q: c - (r - (r & 1)) / 2, r, k }));
  if (tiles.length) {
    const rs = tiles.map((t) => t.r);
    const dr = Math.floor((Math.min(...rs) + Math.max(...rs)) / 2);
    for (const t of tiles) t.r -= dr;
    const xs = tiles.map((t) => t.q + t.r / 2);
    const dq = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    for (const t of tiles) t.q -= dq;
  }
  const index = new Map(tiles.map((t, i) => [t.q + ',' + t.r, i]));
  const isLand = (i) => tiles[i].k !== 's';
  const island = new Array(tiles.length).fill(-1);
  const sizes = [];
  tiles.forEach((t, i) => {
    if (!isLand(i) || island[i] >= 0) return;
    const n = sizes.length;
    sizes.push(0);
    const stack = [i];
    island[i] = n;
    while (stack.length) {
      const j = stack.pop();
      sizes[n]++;
      for (const [a, b] of DIRS) {
        const k = index.get(tiles[j].q + a + ',' + (tiles[j].r + b));
        if (k !== undefined && isLand(k) && island[k] < 0) {
          island[k] = n;
          stack.push(k);
        }
      }
    }
  });
  // the coast: sides of land hexes facing sea or the edge of the map
  let coast = 0;
  tiles.forEach((t, i) => {
    if (!isLand(i)) return;
    for (const [a, b] of DIRS) {
      const k = index.get(t.q + a + ',' + (t.r + b));
      if (k === undefined || !isLand(k)) coast++;
    }
  });
  const count = {};
  for (const t of tiles) count[t.k] = (count[t.k] || 0) + 1;
  const land = tiles.length - (count.s || 0);
  const largest = sizes.length ? sizes.indexOf(Math.max(...sizes)) : -1;
  // ships when the author asks for them, and always with more than one island or a gold field
  const seafarers = d.ships || sizes.length > 1 || !!count.g;
  return { draft: d, tiles, island, sizes, largest, coast, count, land, seafarers };
}

// what the random land is drawn from
function randomPool(a) {
  const mix = a.draft.desert ? MIX : MIX.slice(0, 5);
  return Object.fromEntries(shares(a.count.l || 0, mix).filter(([, c]) => c > 0));
}

// The map definition of a draft.
export function draftToDef(draft, id) {
  const a = analyzeDraft(draft);
  const d = a.draft;
  const pool = randomPool(a);
  const numbered = a.land - (a.count.d || 0) - (pool.desert || 0);
  // harbors: about one for every three sides of coast (the standard island: 30 → 9) but no more than
  // one for every two hexes of land (a long thin island is nearly all coast), a little under half of
  // them 3:1, the rest one of each resource, then wool, grain, ore… again
  const nh = a.coast ? Math.min(16, Math.max(1, Math.round(Math.min(a.coast * 0.3, a.land * 0.5)))) : 0;
  const any = Math.round((nh * 4) / 9);
  const order = ['wood', 'brick', 'wool', 'grain', 'ore', 'wool', 'grain', 'ore', 'brick', 'wood'];
  const types = [...new Array(any).fill('any'), ...Array.from({ length: nh - any }, (_, i) => order[i % order.length])];
  const numbers = [];
  for (const [n, c] of shares(numbered, TOKENS)) for (let i = 0; i < c; i++) numbers.push(n);
  numbers.sort((x, y) => x - y);
  const main = d.start === 'main' && a.seafarers;
  const def = {
    id: id || draftId(d),
    name: d.name,
    short: d.name,
    custom: true,
    players: d.kit === 6 ? [5, 6] : [3, 4],
    vp: d.vp,
    tiles: a.tiles.map((t, i) => {
      const out = { q: t.q, r: t.r, t: t.k === 's' ? 'sea' : t.k === 'l' ? '?' : CELL_KINDS[t.k] };
      if (main && a.island[i] === a.largest) out.g = 'main';
      return out;
    }),
    pool,
    numbers,
    harbors: { types, perIsland: true },
  };
  if (d.kit === 6) Object.assign(def, { bank: 24, dev: { ...DEV_56 } });
  // the robber starts in a desert; without one, off the board until it is first moved
  if (!a.count.d && !pool.desert) def.robber = { off: true };
  const rules = {};
  if (a.seafarers) {
    rules.seafarers = true;
    if (main) def.setup = { group: 'main' };
    if (d.bonus) def.isleBonus = d.bonus;
  }
  if (d.kit === 6) rules.turns = 'paired';
  if (Object.keys(rules).length) def.rules = rules;
  return def;
}

// How many opening settlements fit on the islands the opening may use (a greedy count, never more
// than the true number), each on an intersection with land and none next to another.
function openingRoom(def) {
  const geo = buildGeometry(def);
  const land = def.tiles.map((t) => t.t !== 'sea');
  const ok = (h) => land[h] && (!def.setup || def.tiles[h].g === def.setup.group);
  const spots = geo.vertices.filter((v) => v.hexes.some(ok));
  // corners first (fewer neighbours), so the count comes close to the most that fit
  spots.sort((x, y) => x.neighbors.length - y.neighbors.length || x.id - y.id);
  const taken = new Set();
  let n = 0;
  for (const v of spots) {
    if (v.neighbors.some((u) => taken.has(u))) continue;
    taken.add(v.id);
    n++;
  }
  return n;
}

// Everything the editor shows about a draft: the definition (when the draft can be played), what
// stops it (errors), what may make it play badly (warnings), what follows from it (notes), and its
// numbers.
export function checkDraft(draft) {
  const a = analyzeDraft(draft);
  const d = a.draft;
  const errors = [];
  const warnings = [];
  const notes = [];
  // each message in Chinese (errors…) and as a key with its parameters (keys.errors…), which the page
  // shows in the player's language
  const keys = { errors: [], warnings: [], notes: [] };
  const add = (list, name, key, params) => {
    const m = msg(key, params);
    list.push(m.text);
    keys[name].push(m);
  };
  const players = d.kit === 6 ? 6 : 4;
  const stats = {
    tiles: a.tiles.length,
    land: a.land,
    sea: a.count.s || 0,
    islands: a.sizes.length,
    numbered: 0,
    seafarers: a.seafarers,
    harbors: 0,
    room: 0,
    pool: {},
  };
  if (!a.land) add(errors, 'errors', '先在格子上畫出陸地');
  if (a.tiles.length > LIMITS.tiles) add(errors, 'errors', '地圖最多 {max} 格（現在 {n} 格）', { max: LIMITS.tiles, n: a.tiles.length });
  if (a.land > LIMITS.land) add(errors, 'errors', '陸地最多 {max} 格（現在 {n} 格）', { max: LIMITS.land, n: a.land });
  let def = null;
  if (a.land && a.tiles.length <= LIMITS.tiles) {
    def = draftToDef(d);
    stats.harbors = def.harbors.types.length;
    stats.pool = def.pool;
    stats.numbered = def.numbers.length;
    stats.room = openingRoom(def);
    if (stats.room < players * 2)
      add(errors, 'errors', def.setup ? '開局位置不夠：{p} 國各放 2 個村莊需要 {need} 個互不相鄰的位置，最大的島只放得下 {room} 個' : '開局位置不夠：{p} 國各放 2 個村莊需要 {need} 個互不相鄰的位置，這張地圖只放得下 {room} 個', { p: players, need: players * 2, room: stats.room });
    else if (stats.room < players * 4) add(warnings, 'warnings', '地方很擠：開局之後每國只剩大約 {n} 個能蓋村莊的位置', { n: Math.max(0, Math.floor(stats.room / players) - 2) });
    if (stats.numbered < players * 2) add(warnings, 'warnings', '有數字的陸地只有 {n} 格，資源可能不夠 {p} 國分', { n: stats.numbered, p: players });
    if ((a.count.d || 0) + (def.pool.desert || 0) > a.land / 3) add(warnings, 'warnings', '沙漠太多：沙漠不產出資源');
    if (!stats.harbors) add(warnings, 'warnings', '沒有海岸，所以沒有港口');
    if (a.seafarers && !d.ships) add(notes, 'notes', a.count.g ? '有金礦，所以用航海家規則（船、海盜、金礦）' : '有好幾座島，所以用航海家規則（船、海盜）');
  }
  return { draft: d, def: errors.length ? null : def, errors, warnings, notes, keys, stats };
}
