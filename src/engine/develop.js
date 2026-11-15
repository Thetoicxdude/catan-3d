// The development mode (發展模式): the rules a map with `rules.develop` plays by on top of the standard
// game (maps.js DEV4, DEV3). Three things are added:
//   developments  on a hex where a player has a settlement: one or two levels, each an extra card of a
//                 resource chosen when it is built, every time the hex produces
//   blueprints    the 7 cards a player brings to the game: the basic cards (road, settlement, city,
//                 development card: paid for only when brought, rules.cards) and the special buildings
//                 (from 18), attached beside the player's own settlements (a village holds one, a city
//                 two), at most one of them a world wonder
//   world wonders on the deserts, paid in three stages on three of the owner's turns; the robber
//                 destroys one unless its owner plays a knight
// The engine (engine.js) keeps the state and calls these; every function works on a state or a view,
// on the map in play (GEO).
//   st.plots[h]        the development on hex h: { p: its developer, r: [each level's resource] }
//   st.wonders         [{ h: its desert, k: which wonder, p: owner, s: stages paid (1–3), t: the turn
//                      the last stage was paid on, done: complete }]
//   st.used            what this turn has used up: market, guild (the merchant guild's bonus: once a
//                      turn, whoever's turn it is), road (the royal road's free road), library
//   players[p].bp      the blueprint
//   players[p].built   { building: the intersection of the settlement it stands beside }
//   players[p].yard    the shipyard's resource (2:1 with the bank)
//   players[p].bought  development cards bought (the academy's condition)
//   players[p].pick    (the academy) the two cards drawn, one to keep: the player's secret
import { GEO } from './geometry.js';
import { TERRAIN_RES, RES } from './board.js';
import { N_ } from '../i18n/fill.js';

// the five directions a building belongs to
export const DIRS = ['farm', 'trade', 'army', 'frontier', 'lore'];
export const DIR_NAMES = { farm: N_('農業'), trade: N_('商業'), army: N_('軍事'), frontier: N_('擴張'), lore: N_('學術') };

// kind: 'func' (1 point), 'score' (no point of its own; +3 while its condition holds), 'wonder'
export const BUILDINGS = {
  aqueduct: { dir: 'farm', kind: 'func', cost: { wood: 1, brick: 2, grain: 1, ore: 1 } },
  granary: { dir: 'farm', kind: 'func', cost: { wood: 2, brick: 1, grain: 2 } },
  market: { dir: 'trade', kind: 'func', cost: { wood: 1, wool: 2, grain: 2 } },
  shipyard: { dir: 'trade', kind: 'func', cost: { wood: 3, wool: 1, ore: 1 } },
  guild: { dir: 'trade', kind: 'func', cost: { wool: 2, grain: 1, ore: 2 } },
  barracks: { dir: 'army', kind: 'func', cost: { wood: 1, grain: 2, ore: 2 } },
  wall: { dir: 'army', kind: 'func', cost: { brick: 3, ore: 2 } },
  mercenaries: { dir: 'army', kind: 'func', cost: { wool: 1, grain: 2, ore: 2 } },
  adventurers: { dir: 'army', kind: 'score', cost: { wool: 2, grain: 2, ore: 2 } },
  post: { dir: 'frontier', kind: 'score', cost: { wood: 2, brick: 2, wool: 1 } },
  camp: { dir: 'frontier', kind: 'func', cost: { wood: 2, brick: 1, wool: 1, grain: 1 } },
  academy: { dir: 'lore', kind: 'func', cost: { brick: 1, wool: 2, grain: 1, ore: 1 } },
  press: { dir: 'lore', kind: 'func', cost: { wood: 2, wool: 2, ore: 1 } },
  // the wonders: three stages, 17 cards in all
  gardens: {
    dir: 'farm',
    kind: 'wonder',
    stages: [
      { wood: 2, brick: 2, grain: 1 },
      { brick: 2, wool: 2, grain: 2 },
      { wool: 1, grain: 3, ore: 2 },
    ],
  },
  lighthouse: {
    dir: 'trade',
    kind: 'wonder',
    stages: [
      { wood: 1, brick: 2, ore: 2 },
      { wood: 2, wool: 2, ore: 2 },
      { wood: 2, grain: 2, ore: 2 },
    ],
  },
  greatWall: {
    dir: 'army',
    kind: 'wonder',
    stages: [
      { brick: 3, ore: 2 },
      { wood: 2, brick: 2, ore: 2 },
      { brick: 1, grain: 2, ore: 3 },
    ],
  },
  royalRoad: {
    dir: 'frontier',
    kind: 'wonder',
    stages: [
      { wood: 2, brick: 2, grain: 1 },
      { wood: 2, brick: 2, wool: 2 },
      { brick: 2, grain: 2, ore: 2 },
    ],
  },
  library: {
    dir: 'lore',
    kind: 'wonder',
    stages: [
      { wood: 1, brick: 2, ore: 2 },
      { wood: 2, wool: 3, grain: 1 },
      { wool: 2, grain: 2, ore: 2 },
    ],
  },
};
export const BUILDING_IDS = Object.keys(BUILDINGS);
export const BUILDING_NAMES = {
  aqueduct: N_('水道橋'),
  granary: N_('糧倉'),
  market: N_('市集'),
  shipyard: N_('造船廠'),
  guild: N_('商會'),
  barracks: N_('兵營'),
  wall: N_('城牆'),
  mercenaries: N_('傭兵營'),
  adventurers: N_('冒險者公會'),
  post: N_('驛站'),
  camp: N_('拓荒營地'),
  academy: N_('學院'),
  press: N_('印刷坊'),
  gardens: N_('空中花園'),
  lighthouse: N_('大燈塔'),
  greatWall: N_('長城'),
  royalRoad: N_('皇家大道'),
  library: N_('大圖書館'),
};
export const isWonder = (k) => !!BUILDINGS[k] && BUILDINGS[k].kind === 'wonder';
export const isSpecial = (k) => !!BUILDINGS[k] && BUILDINGS[k].kind !== 'wonder';
export const WONDER_VP = 5;
export const SCORE_VP = 3;
export const BLUEPRINT_SIZE = 7;

// The basic cards (2026-11-15: the 7 cards of a blueprint include them, and they may be left out for
// another card). Without one a player cannot pay for that piece all game; what is not paid for needs no
// card: the opening's settlements and roads, the road building card's roads, the royal road's road and
// the great library's card. Improvements need no card at all.
export const BASIC = ['road', 'settlement', 'city', 'dev'];
export const BASIC_NAMES = { road: N_('道路'), settlement: N_('村莊'), city: N_('城市'), dev: N_('發展卡') };
export const isBasic = (k) => BASIC.includes(k);
// why a basic card left out cannot be paid for
export const NO_CARD = { road: N_('你的藍圖沒有道路卡'), settlement: N_('你的藍圖沒有村莊卡'), city: N_('你的藍圖沒有城市卡'), dev: N_('你的藍圖沒有發展卡') };
// a card of a blueprint: a basic card or a special building
export const isCard = (k) => isBasic(k) || !!BUILDINGS[k];
// whether p may pay for basic card k (st: a state or a view; games from before the basic cards, and
// the other modes, need none)
export function hasBasic(st, p, k) {
  if (!st.rules || !st.rules.cards) return true;
  const bp = st.players[p] && st.players[p].bp;
  return !bp || bp.includes(k);
}
// A game saved before the basic cards were cards: everyone keeps all four (and the rule is on, so every
// page reads the blueprints alike).
export function upgradeCards(st) {
  if (!st || !st.rules || !st.rules.develop || st.rules.cards) return st;
  st.rules.cards = true;
  for (const pl of st.players) if (Array.isArray(pl.bp)) pl.bp = [...BASIC.filter((k) => !pl.bp.includes(k)), ...pl.bp];
  return st;
}

// The five ready-made blueprints (the computer players pick one of these): the four basic cards, two
// buildings and a wonder.
export const PRESETS = {
  farm: [...BASIC, 'aqueduct', 'market', 'gardens'],
  port: [...BASIC, 'market', 'shipyard', 'lighthouse'],
  order: [...BASIC, 'barracks', 'mercenaries', 'greatWall'],
  frontier: [...BASIC, 'post', 'camp', 'royalRoad'],
  scholars: [...BASIC, 'academy', 'press', 'library'],
};
export const PRESET_IDS = Object.keys(PRESETS);
export const PRESET_NAMES = { farm: N_('穀倉'), port: N_('商港'), order: N_('騎士團§preset'), frontier: N_('拓荒'), scholars: N_('書院') };
export const DEFAULT_PRESET = 'port';

// Up to 7 different cards (basic cards and buildings), at most one of them a wonder. (A player brings
// the cards they own, meta/collection.js; the computer players always bring a full ready-made one.)
export function validBlueprint(bp) {
  if (!Array.isArray(bp) || bp.length > BLUEPRINT_SIZE) return false;
  if (new Set(bp).size !== bp.length || !bp.every(isCard)) return false;
  return bp.filter(isWonder).length <= 1;
}
// a blueprint from what a seat brings: a ready-made one's name, or the cards themselves (kept to a
// valid blueprint: the first seven different ones, the first wonder)
export function blueprintOf(x) {
  if (typeof x === 'string' && PRESETS[x]) return PRESETS[x].slice();
  const out = [];
  for (const k of Array.isArray(x) ? x : []) {
    if (!isCard(k) || out.includes(k) || (isWonder(k) && out.some(isWonder))) continue;
    if (out.length < BLUEPRINT_SIZE) out.push(k);
  }
  return out;
}
// the special buildings of a blueprint (its basic cards left out)
export const specialsOf = (bp) => (bp || []).filter((k) => !!BUILDINGS[k]);

export const developOn = (st) => !!(st && st.rules && st.rules.develop);

// ── developments ──

// level 1 (on the hex's own resource, or another), then level 2
export const PLOT_COST = [
  { local: { wood: 1, brick: 1, wool: 1 }, other: { wood: 1, brick: 1, wool: 1, grain: 1 } },
  { local: { grain: 2, ore: 2 }, other: { wool: 1, grain: 2, ore: 2 } },
];
export const PLOT_LEVELS = PLOT_COST.length;

// what the next level on hex h costs, choosing resource r (null when it is at the top already)
export function plotCost(st, h, r) {
  const plot = st.plots && st.plots[h];
  const lv = plot ? plot.r.length : 0;
  if (lv >= PLOT_LEVELS) return null;
  const local = TERRAIN_RES[st.board.hexes[h].terrain];
  return PLOT_COST[lv][r && r === local ? 'local' : 'other'];
}

// Why p may not develop hex h (or raise p's development there) now, whatever it costs: a message key,
// or null.
export function plotWhy(st, p, h) {
  const hex = st.board.hexes[h];
  if (!hex || !TERRAIN_RES[hex.terrain]) return hex && hex.terrain === 'desert' ? N_('沙漠不能開發') : N_('這裡不能開發');
  if (st.board.robber === h) return N_('強盜所在的地塊不能開發或升級');
  const plot = st.plots[h];
  if (plot) {
    if (plot.p !== p) return N_('這塊地已經有別人的開發');
    if (plot.r.length >= PLOT_LEVELS) return N_('這塊地已經是二級開發');
    return null;
  }
  if (!GEO.hexes[h].vertices.some((v) => st.vertices[v] && st.vertices[v].p === p)) return N_('你要在這塊地的路口上有村莊或城市');
  return null;
}
export function plotSpots(st, p) {
  const out = [];
  for (let h = 0; h < GEO.hexes.length; h++) if (!plotWhy(st, p, h)) out.push(h);
  return out;
}

// ── special buildings ──

export const hasBuilt = (st, p, k) => {
  const b = st.players[p].built;
  return !!b && b[k] !== undefined;
};
// the buildings beside the settlement at v
export function annexAt(st, v) {
  const b = st.vertices[v];
  if (!b) return [];
  const built = st.players[b.p].built || {};
  return Object.keys(built).filter((k) => built[k] === v);
}
// room left beside the settlement at v: a village holds one building, a city two
export function slotsAt(st, v) {
  const b = st.vertices[v];
  return b ? (b.t === 'c' ? 2 : 1) - annexAt(st, v).length : 0;
}
// a settlement with a wall: the robber neither stops it producing nor robs anyone for it
export function walled(st, v) {
  const b = st.vertices[v];
  const built = b && st.players[b.p].built;
  return !!built && built.wall === v;
}
// p has a harbor: a settlement on one, or a shipyard
export function hasHarbor(st, p) {
  if (hasBuilt(st, p, 'shipyard')) return true;
  return st.vertices.some((b, v) => b && b.p === p && st.board.vertexHarbor[v]);
}

// Why p may not build k at all now (the conditions about p, not where): a message key, or null.
export function specialWhy(st, p, k) {
  const pl = st.players[p];
  if (!isSpecial(k)) return N_('沒有這種建築');
  if (!pl.bp || !pl.bp.includes(k)) return N_('這座建築不在你的藍圖裡');
  if (hasBuilt(st, p, k)) return N_('這座建築每人只能蓋一座');
  if (k === 'guild' && !hasHarbor(st, p)) return N_('你要先有港口（聚落在港口上，或已有造船廠）');
  if (k === 'barracks' && !st.vertices.some((b) => b && b.p === p && b.t === 'c')) return N_('你要先有一座城市');
  if (k === 'mercenaries' && pl.knights < 1) return N_('你要先打出過 1 張騎士');
  if (k === 'adventurers' && pl.knights < 3) return N_('你要先打出過 3 張騎士');
  if (k === 'post' && !(st.roadLen && st.roadLen[p] >= 5)) return N_('你的最長道路要至少 5 條');
  if (k === 'academy' && (pl.bought || 0) < 2) return N_('你要先買過 2 張發展卡');
  return null;
}

// Why k may not stand beside the settlement at v (p's own): a message key, or null.
export function hostWhy(st, p, k, v) {
  const b = st.vertices[v];
  if (!b || b.p !== p) return N_('特殊建築要附在你自己的村莊或城市旁');
  if (slotsAt(st, v) <= 0) return b.t === 'c' ? N_('這座城市旁已經有兩座建築') : N_('這座村莊旁已經有建築了（升級成城市可以再附一座）');
  const hexes = GEO.vertices[v].hexes.map((h) => st.board.hexes[h]);
  const terrains = hexes.map((h) => h.terrain);
  if (k === 'aqueduct' && !GEO.vertices[v].hexes.some((h) => st.plots[h] && st.plots[h].p === p)) return N_('所附的聚落要相鄰你的開發地塊');
  if (k === 'granary' && !terrains.includes('fields')) return N_('所附的聚落要相鄰田地');
  if (k === 'market' && new Set(terrains.filter((t) => TERRAIN_RES[t])).size < 3) return N_('所附的聚落要相鄰 3 種不同的產資源地形');
  if (k === 'shipyard' && !GEO.vertices[v].coastal) return N_('所附的聚落要在海岸邊');
  if (k === 'press' && !terrains.includes('forest')) return N_('所附的聚落要相鄰森林');
  if (k === 'camp') {
    // a hex with no building on its corners but this settlement (and no wonder on it)
    const open = GEO.vertices[v].hexes.some((h) => !wonderAt(st, h) && GEO.hexes[h].vertices.every((u) => u === v || !st.vertices[u]));
    if (!open) return N_('所附的聚落要相鄰一塊沒有其他建築的地塊');
  }
  return null;
}

// where k may stand now (p's settlements with room that meet its conditions)
export function specialHosts(st, p, k) {
  if (specialWhy(st, p, k)) return [];
  const out = [];
  st.vertices.forEach((b, v) => {
    if (b && b.p === p && !hostWhy(st, p, k, v)) out.push(v);
  });
  return out;
}

// ── world wonders ──

export const wonderAt = (st, h) => (st.wonders || []).find((w) => w.h === h) || null;
export const wonderOf = (st, p) => (st.wonders || []).find((w) => w.p === p) || null;
export const wonderDone = (st, p, k) => (st.wonders || []).some((w) => w.p === p && w.k === k && w.done);
export const bpWonder = (st, p) => (st.players[p].bp || []).find(isWonder) || null;

// the cost of p's next stage (null: nothing to pay)
export function stageCost(st, p) {
  const k = bpWonder(st, p);
  if (!k) return null;
  const w = wonderOf(st, p);
  const s = w ? w.s : 0;
  return s < 3 ? BUILDINGS[k].stages[s] : null;
}

// Why p may not pay a stage of p's wonder on desert h now (whatever it costs): a message key, or null.
export function wonderWhy(st, p, h) {
  const k = bpWonder(st, p);
  if (!k) return N_('你的藍圖裡沒有世界奇觀');
  const mine = wonderOf(st, p);
  if (mine) {
    if (mine.h !== h) return N_('你的奇觀在另一塊沙漠上');
    if (mine.done) return N_('奇觀已經完工');
    if (mine.s >= 3) return N_('奇觀會在你的下一回合開始時完工');
    if (mine.t >= st.turn) return N_('付完一個階段，要到你的下一回合才能付下一階段');
    return null;
  }
  const hex = st.board.hexes[h];
  if (!hex || hex.terrain !== 'desert') return N_('世界奇觀要蓋在沙漠上');
  if (wonderAt(st, h)) return N_('這塊沙漠已經有奇觀');
  if ((st.wonders || []).some((w) => w.k === k)) return N_('這座奇觀已經有人開工了');
  if (st.board.robber === h) return N_('強盜所在的沙漠不能開工');
  if (!GEO.hexes[h].vertices.some((v) => st.vertices[v] && st.vertices[v].p === p)) return N_('沙漠的路口上要有你的村莊或城市');
  return null;
}
// the deserts where p may pay a stage now
export function wonderSpots(st, p) {
  const out = [];
  for (let h = 0; h < GEO.hexes.length; h++) if (!wonderWhy(st, p, h)) out.push(h);
  return out;
}

// ── the robber ──

// the hexes a complete great wall keeps the robber from: beside any settlement of its owner (and so
// the wall's own desert)
export function guardedHexes(st) {
  const out = new Set();
  for (const w of st.wonders || []) {
    if (w.k !== 'greatWall' || !w.done) continue;
    out.add(w.h);
    st.vertices.forEach((b, v) => {
      if (b && b.p === w.p) for (const h of GEO.vertices[v].hexes) out.add(h);
    });
  }
  return out;
}
// Why p may not move the robber to hex h: a message key, or null. (When nowhere is left, anywhere but
// where it stands: robberSpots.)
export function robberWhy(st, p, h, guarded = guardedHexes(st)) {
  if (h === st.board.robber) return N_('強盜必須移動到另一塊地形');
  const w = wonderAt(st, h);
  if (w && w.p === p) return N_('不能把強盜移到自己的奇觀上');
  if (guarded.has(h)) return N_('長城保護的地塊不能放強盜');
  return null;
}
export function robberSpots(st, p) {
  const guarded = guardedHexes(st);
  const out = [];
  for (let h = 0; h < GEO.hexes.length; h++) if (!robberWhy(st, p, h, guarded)) out.push(h);
  if (out.length) return out;
  for (let h = 0; h < GEO.hexes.length; h++) if (h !== st.board.robber) out.push(h);
  return out;
}

// ── points, limits, ratios ──

// the points the development mode adds: 1 a functional building, +3 for the adventurers' guild while
// holding the largest army and for the post station while holding the longest road, 5 a wonder
export function developVP(st, p) {
  const built = st.players[p].built || {};
  let vp = 0;
  for (const k of Object.keys(built)) if (BUILDINGS[k].kind === 'func') vp++;
  if (built.adventurers !== undefined && st.largestArmy === p) vp += SCORE_VP;
  if (built.post !== undefined && st.longestRoad === p) vp += SCORE_VP;
  for (const w of st.wonders || []) if (w.p === p && w.done) vp += WONDER_VP;
  return vp;
}
// the same, piece by piece (for the nations' panel)
export function developScore(st, p) {
  const built = st.players[p].built || {};
  const out = { buildings: 0, adventurers: 0, post: 0, wonder: 0 };
  for (const k of Object.keys(built)) if (BUILDINGS[k].kind === 'func') out.buildings++;
  if (built.adventurers !== undefined && st.largestArmy === p) out.adventurers = SCORE_VP;
  if (built.post !== undefined && st.longestRoad === p) out.post = SCORE_VP;
  for (const w of st.wonders || []) if (w.p === p && w.done) out.wonder += WONDER_VP;
  return out;
}

// the granary raises its owner's hand limit for a 7 by three (7 → 10)
export const GRANARY_EXTRA = 3;

// the scarcest resource in a hand (ties: wood, brick, wool, grain, ore)
export function scarcest(res) {
  let r = RES[0];
  for (const x of RES) if (res[x] < res[r]) r = x;
  return r;
}
// the resource a trade gave most of (ties in the same order)
export function mostOf(m) {
  let r = null;
  for (const x of RES) if ((m[x] || 0) > 0 && (r === null || m[x] > m[r])) r = x;
  return r;
}
