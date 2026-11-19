// The base game's rules engine (2–4 players, and 5–6 with the extension's turn rules), following the
// 5th-edition rulebook & almanac.
// Pure & deterministic: state is plain JSON; all randomness comes from the seeded rng in state.
// applyAction(state, action) validates, then mutates state and returns a list of events.
// Illegal actions throw RuleError and leave state untouched: its key is the message in Chinese (with {name}
// placeholders filled from its params), read in the player's language by the page (i18n t()).

import { GEO, useMap } from './geometry.js';
import { generateBoard, RES, TERRAIN_RES, pips, provinceName, richNumbers } from './board.js';
import { mapDef, isBuiltIn, DEFAULT_MAP } from './maps.js';
import { rngInt, shuffle, seedState } from './rng.js';
import { fill, N_ } from '../i18n/fill.js';
import { seaInfo, roadEdge, shipEdge, shipLegal, legalShipEdges, movableShips, shipTargets, pirateVictims, pirateEdges, tradeRouteFor, SHIP_COST, SHIPS } from './seafarers.js';
import {
  developOn,
  blueprintOf,
  hasBasic,
  NO_CARD,
  plotWhy,
  plotCost,
  specialWhy,
  hostWhy,
  isSpecial,
  BUILDINGS,
  hasBuilt,
  walled,
  wonderAt,
  wonderOf,
  wonderDone,
  wonderWhy,
  bpWonder,
  robberWhy,
  robberSpots,
  developVP,
  GRANARY_EXTRA,
  scarcest,
  mostOf,
  payFor,
  watchersAt,
  STORE_MAX,
  ROADWORKS_ROADS,
  NEW_TOWN_PIECES,
  ROYAL_ROADS,
  COUNTING_MIN,
  ALMS_MAX,
  TERRACE_NUMBERS,
  CARAVAN_GIVE,
} from './develop.js';

export { RES, TERRAIN_RES, pips };

// Put the map a state is played on in play (GEO). States saved before maps existed are on the
// standard island.
export function ensureMap(st) {
  const id = (st && st.map) || DEFAULT_MAP;
  if (GEO.id !== id) useMap(st.mapDef || id);
  return GEO;
}

export const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
  ship: SHIP_COST, // (Seafarers)
};
export const DEV_COUNTS = { knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 };
export const DEV_TYPES = Object.keys(DEV_COUNTS);
export const BANK_START = 19;
export const PIECES = { roads: 15, settlements: 5, cities: 4 };

export class RuleError extends Error {
  // key: the message in Chinese, {name} placeholders filled from params (the message itself is filled)
  constructor(key, params) {
    super(params ? fill(key, params) : key);
    this.name = 'RuleError';
    this.key = key;
    this.params = params || null;
  }
}
function need(cond, key, params) {
  if (!cond) throw new RuleError(key, params);
}

const emptyRes = () => ({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
export const handSize = (res) => res.wood + res.brick + res.wool + res.grain + res.ore;
// a 7 takes half the hand of every player holding more cards than this (a room may raise it)
export const handLimit = (st) => (st && st.rules && st.rules.discard) || 7;
// p's own limit: (the development mode) a granary raises it by three
export const handLimitOf = (st, p) => handLimit(st) + (developOn(st) && hasBuilt(st, p, 'granary') ? GRANARY_EXTRA : 0);
export function canAfford(res, cost) {
  for (const k in cost) if ((res[k] || 0) < cost[k]) return false;
  return true;
}
export function missingFor(res, cost) {
  const m = {};
  let n = 0;
  for (const k in cost) {
    const d = cost[k] - (res[k] || 0);
    if (d > 0) {
      m[k] = d;
      n += d;
    }
  }
  return { missing: m, count: n };
}

// ───────────────────────── game creation ─────────────────────────

// opts.map: the map's id (maps.js); the standard island when left out. opts.targetVP: the points to
// win on a map that sets none (a scenario sets its own), moved by opts.vpAdj (a room's choice).
// opts.rules: the room's rules on top of the map's (turns, discard: the hand limit, dice: 'deck').
// opts.board: numbers ('balanced' | 'spiral'), mix ('rich': numbers dealt more like the dice fall).
export function createGame(opts) {
  const def = mapDef(opts.map);
  useMap(def);
  const seed = opts.seed >>> 0;
  const holder = { rng: seedState(seed) };
  const board = generateBoard(holder, opts.board || {});
  // Online games re-seed with fresh entropy after the (public) board is laid out, so the
  // dev-card order and dice cannot be reconstructed from the board.
  if (opts.entropy) holder.rng = opts.entropy.slice(0, 4).map((x) => x >>> 0);
  const n = opts.players.length;
  const [lo, hi] = def.players || [2, 4];
  if (n < lo || n > hi) throw new RuleError('這張地圖需要 {lo}–{hi} 位玩家', { lo, hi });
  const deck = [];
  for (const [t, c] of Object.entries(def.dev || DEV_COUNTS)) for (let i = 0; i < c; i++) deck.push(t);
  shuffle(holder, deck);
  const start = opts.firstPlayer !== undefined ? opts.firstPlayer : rngInt(holder, 0, n - 1);
  const order = [];
  for (let i = 0; i < n; i++) order.push((start + i) % n);
  for (let i = n - 1; i >= 0; i--) order.push((start + i) % n);
  const bank = def.bank || BANK_START;
  const pieces = def.pieces || PIECES;

  const st = {
    v: 1,
    seed,
    mapSeed: opts.mapSeed != null ? opts.mapSeed >>> 0 : seed,
    rng: holder.rng,
    targetVP: Math.max(3, (def.vp || opts.targetVP || 10) + (Number(opts.vpAdj) || 0)),
    board,
    players: opts.players.map((p, i) => ({
      id: i,
      name: p.name,
      color: p.color,
      kind: p.kind || 'human',
      ai: p.ai || null,
      res: emptyRes(),
      dev: [],
      played: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
      knights: 0,
      pieces: { ...pieces },
    })),
    vertices: new Array(GEO.vertices.length).fill(null),
    edges: new Array(GEO.edges.length).fill(-1),
    bank: { wood: bank, brick: bank, wool: bank, grain: bank, ore: bank },
    devDeck: deck,
    phase: 'setup',
    setup: { order, i: 0, step: 'settlement', last: -1 },
    current: order[0],
    turn: 0,
    rolled: false,
    dice: null,
    devPlayed: false,
    pending: null,
    trade: null,
    longestRoad: -1,
    largestArmy: -1,
    roadLen: new Array(n).fill(0),
    winner: -1,
    seq: 0,
    rolls: new Array(13).fill(0),
    map: def.id,
  };
  // a map that is not built in (one a player made) travels with the game
  if (!isBuiltIn(def.id) || mapDef(def.id) !== def) st.mapDef = def;
  // the map's rules (5–6 players: how the turn is shared), which a room may change
  const rules = { ...(def.rules || {}), ...(opts.rules || {}) };
  if (Object.keys(rules).length) {
    st.rules = rules;
    if (rules.turns) st.sub = null;
  }
  // Seafarers: ships beside the roads, the pirate on the board, bonus points for new islands
  if (rules.seafarers) {
    st.ships = new Array(GEO.edges.length).fill(-1);
    st.newShips = [];
    st.shipMoved = false;
    for (const pl of st.players) {
      pl.pieces.ships = SHIPS;
      pl.chits = 0;
      pl.isles = [];
      pl.home = [];
    }
    // (the fog islands) what the fog hides: drawn one by one as hexes are discovered
    if (def.fog) st.fog = { pool: Object.entries(def.fog.pool).flatMap(([t, c]) => new Array(c).fill(t)), numbers: board.mix === 'rich' ? richNumbers(def.fog.numbers) : def.fog.numbers.slice() };
  }
  // the development mode (develop.js): developments, each seat's blueprint and buildings, the wonders
  if (rules.develop) {
    st.plots = new Array(GEO.hexes.length).fill(null);
    st.wonders = [];
    // (the ruins of wonders destroyed, until another is begun on their desert: the map shows them)
    st.ruins = [];
    st.used = {};
    st.players.forEach((pl, i) => {
      pl.bp = blueprintOf(opts.players[i].bp);
      pl.built = {};
      pl.bought = 0;
      pl.devGot = 0;
    });
    // (2026-11-18) the development cards played that go back in when the deck runs out; the cards
    // played this turn (the lecture hall) and whether one was a knight
    st.devDiscard = [];
    st.devPlays = 0;
    st.knightPlayed = false;
  }
  return st;
}

const seafarers = (st) => !!(st.rules && st.rules.seafarers);

// (Seafarers) p's home islands: the islands of p's opening settlements (on a map with a home group,
// a game saved before players kept them: that group's islands)
export function homeIslands(st, p) {
  const pl = st.players[p];
  if (pl.home && pl.home.length) return pl.home;
  return [...seaInfo(st.board).home];
}

// (Seafarers, the fog islands) p's road or ship has reached the intersections `vs`: every hidden hex
// beside them is discovered. What it is comes from the fog's pile, drawn with the game's dice (so no
// page can know it before), land takes a number from the fog's tokens, and p receives one resource
// of that land; gold, any one (picked like a gold field's).
function discover(st, p, vs, ev) {
  if (!st.fog || !st.fog.pool) return;
  const found = new Set();
  for (const v of vs) for (const h of GEO.vertices[v].hexes) if (st.board.hexes[h].terrain === 'fog') found.add(h);
  if (!found.size) return;
  const hexes = st.board.hexes.slice();
  let gold = 0;
  for (const h of [...found].sort((a, b) => a - b)) {
    const pool = st.fog.pool;
    const terrain = pool.length ? pool.splice(rngInt(st, 0, pool.length - 1), 1)[0] : 'sea';
    const nums = st.fog.numbers;
    const number = terrain !== 'sea' && nums.length ? nums.splice(rngInt(st, 0, nums.length - 1), 1)[0] : 0;
    hexes[h] = { terrain, number, name: provinceName(terrain, h) };
    const e = { type: 'discover', p, hex: h, terrain, number };
    const res = TERRAIN_RES[terrain];
    if (res && st.bank[res] > 0) {
      st.bank[res]--;
      st.players[p].res[res]++;
      e.res = res;
    }
    if (terrain === 'gold') gold++;
    ev.push(e);
  }
  // a new board (pages and caches notice the change)
  st.board = { ...st.board, hexes };
  if (gold) owedGold(st, p, gold);
}

// resources of p's choice owed for gold found in the fog: picked straight away, or once the road
// building card in play is done
function owedGold(st, p, n) {
  const pd = st.pending;
  if (pd && pd.type === 'roadBuilding') pd.gold = (pd.gold || 0) + n;
  else if (pd && pd.type === 'gold') pd.amounts[p] = (pd.amounts[p] || 0) + n;
  else st.pending = { type: 'gold', amounts: { [p]: n } };
}

export function cloneState(st) {
  return JSON.parse(JSON.stringify(st));
}

// ───────────────────────── queries ─────────────────────────

export function publicVP(st, p) {
  let vp = 0;
  for (const b of st.vertices) if (b && b.p === p) vp += b.t === 'c' ? 2 : 1;
  if (st.longestRoad === p) vp += 2;
  if (st.largestArmy === p) vp += 2;
  if (developOn(st)) vp += developVP(st, p);
  return vp + (st.players[p].chits || 0);
}
export function hiddenVP(st, p) {
  const pl = st.players[p];
  if (!pl.dev) return 0;
  return pl.dev.filter((c) => c.type === 'victoryPoint').length;
}
export function totalVP(st, p) {
  return publicVP(st, p) + hiddenVP(st, p);
}

export function distanceOK(st, v) {
  if (st.vertices[v]) return false;
  for (const n of GEO.vertices[v].neighbors) if (st.vertices[n]) return false;
  return true;
}

export function settlementLegal(st, p, v, setup = false) {
  if (!distanceOK(st, v)) return false;
  if (seafarers(st)) {
    // on land; the opening settlements on the home island; later ones reached by a road or a ship
    const sea = seaInfo(st.board);
    if (!sea.vLand[v]) return false;
    if (setup) return sea.home.has(sea.vIsland[v]);
    return GEO.vertices[v].edges.some((e) => st.edges[e] === p || st.ships[e] === p);
  }
  if (setup) return true;
  return GEO.vertices[v].edges.some((e) => st.edges[e] === p);
}

export function roadLegal(st, p, e) {
  if (st.edges[e] !== -1) return false;
  if (seafarers(st) && (st.ships[e] !== -1 || !roadEdge(st, e))) return false;
  for (const v of GEO.edges[e].v) {
    const b = st.vertices[v];
    if (b && b.p === p) return true;
    if (b && b.p !== p) continue; // an opponent's building cuts the connection here
    for (const e2 of GEO.vertices[v].edges) if (e2 !== e && st.edges[e2] === p) return true;
  }
  return false;
}

export function legalSettlementSpots(st, p, setup = false) {
  const out = [];
  for (let v = 0; v < GEO.vertices.length; v++) if (settlementLegal(st, p, v, setup)) out.push(v);
  return out;
}
export function legalRoadEdges(st, p) {
  if (st.phase === 'setup') {
    if (st.setup.step !== 'road') return [];
    return GEO.vertices[st.setup.last].edges.filter((e) => st.edges[e] === -1 && (!seafarers(st) || (st.ships[e] === -1 && roadEdge(st, e))));
  }
  const out = [];
  for (let e = 0; e < GEO.edges.length; e++) if (roadLegal(st, p, e)) out.push(e);
  return out;
}
export function legalCitySpots(st, p) {
  const out = [];
  st.vertices.forEach((b, v) => {
    if (b && b.p === p && b.t === 's') out.push(v);
  });
  return out;
}

// Seafarers: where p may put a ship now (in the opening: beside the settlement just placed)
export function legalShips(st, p) {
  if (!seafarers(st)) return [];
  if (st.phase === 'setup') {
    if (st.setup.step !== 'road') return [];
    return GEO.vertices[st.setup.last].edges.filter((e) => st.edges[e] === -1 && st.ships[e] === -1 && shipEdge(st, e));
  }
  return st.players[p].pieces.ships > 0 ? legalShipEdges(st, p) : [];
}
export { movableShips, shipTargets, seaInfo, pirateEdges };

// can p lay a road (or, in Seafarers, a ship) anywhere? (the road building card)
function canBuildPaths(st, p) {
  const pl = st.players[p];
  if (pl.pieces.roads > 0 && legalRoadEdges(st, p).length > 0) return true;
  return seafarers(st) && pl.pieces.ships > 0 && legalShipEdges(st, p).length > 0;
}

export function tradeRatio(st, p, res) {
  let best = 4;
  st.vertices.forEach((b, v) => {
    if (!b || b.p !== p) return;
    const h = st.board.vertexHarbor[v];
    if (h === 'any') best = Math.min(best, 3);
    else if (h === res) best = 2;
  });
  // (the development mode) the shipyard's resource, and every resource with the great lighthouse
  if (developOn(st) && (st.players[p].yard === res || wonderDone(st, p, 'lighthouse'))) best = 2;
  return best;
}
export function tradeRatios(st, p) {
  const r = {};
  for (const res of RES) r[res] = tradeRatio(st, p, res);
  return r;
}

export function robberVictims(st, hex, p) {
  const set = new Set();
  // (the development mode: never for a settlement with a wall, nor anyone with a temple)
  const dv = developOn(st);
  for (const v of GEO.hexes[hex].vertices) {
    const b = st.vertices[v];
    if (b && b.p !== p && !(dv && (walled(st, v) || hasBuilt(st, b.p, 'temple')))) set.add(b.p);
  }
  return [...set].filter((q) => playerHandSize(st, q) > 0).sort((a, b) => a - b);
}

export function playerHandSize(st, p) {
  const pl = st.players[p];
  if (pl.res) return handSize(pl.res);
  return pl.resCount || 0; // redacted view
}

// a card in p's hand may be played: bought before this turn (or, with a printing house, this turn too)
export const devReady = (st, p, c) => c.turn < st.turn || (developOn(st) && hasBuilt(st, p, 'press'));

export function playableDev(st, p) {
  // Dev card types this player could play right now (ignores the extra parameters).
  const pl = st.players[p];
  if (st.phase !== 'play' || st.current !== p || st.devPlayed || st.pending || st.trade || !pl.dev || inSub(st, 'sbp')) return [];
  const out = new Set();
  for (const c of pl.dev) {
    if (c.type === 'victoryPoint' || !devReady(st, p, c)) continue;
    if (c.type === 'roadBuilding' && !canBuildPaths(st, p)) continue;
    // (the lecture hall's second card: never a second knight)
    if (c.type === 'knight' && st.knightPlayed) continue;
    out.add(c.type);
  }
  return [...out];
}

export function longestRoadFor(st, p) {
  let best = 0;
  const used = new Uint8Array(GEO.edges.length);
  const starts = new Set();
  for (let e = 0; e < GEO.edges.length; e++) {
    if (st.edges[e] === p) {
      starts.add(GEO.edges[e].v[0]);
      starts.add(GEO.edges[e].v[1]);
    }
  }
  if (!starts.size) return 0;
  const dfs = (v, len) => {
    if (len > best) best = len;
    const b = st.vertices[v];
    if (len > 0 && b && b.p !== p) return; // cannot pass through an opponent's building
    for (const e of GEO.vertices[v].edges) {
      if (st.edges[e] !== p || used[e]) continue;
      used[e] = 1;
      const [a, c] = GEO.edges[e].v;
      dfs(a === v ? c : a, len + 1);
      used[e] = 0;
    }
  };
  for (const v of starts) dfs(v, 0);
  return best;
}

// Who must act now? (Several players may need to act at once: discards, trade responses.)
export function actorsNow(st) {
  if (st.phase === 'over') return [];
  // (a pick owed — even in the opening, for gold found in the fog — comes first)
  if (st.pending && (st.pending.type === 'discard' || st.pending.type === 'gold')) return Object.keys(st.pending.amounts).map(Number);
  // (the development mode) the owner of the wonder the robber came to: defend it or not; the roller
  // with an observatory: roll again or not
  if (st.pending && (st.pending.type === 'defend' || st.pending.type === 'reroll')) return [st.pending.p];
  if (st.phase === 'setup') return [st.setup.order[st.setup.i]];
  if (st.trade) {
    const waiting = Object.keys(st.trade.resp)
      .map(Number)
      .filter((q) => st.trade.resp[q] === null);
    return waiting.length ? [...waiting, st.trade.from] : [st.trade.from];
  }
  return [st.current];
}

// ───────────────────────── internal helpers ─────────────────────────

function pay(st, pl, cost) {
  for (const k in cost) {
    pl.res[k] -= cost[k];
    st.bank[k] += cost[k];
  }
}
// What p pays for something built (kind: 'special', 'wonder', or anything else), or null when p
// cannot: (the development mode) with the smithy and the discounts (develop.js payFor; a.skip, a.sub:
// the player's choices). Checked first, paid with payPlan once everything else is.
function buildPlan(st, p, cost, kind, a = {}) {
  if (!developOn(st)) return canAfford(st.players[p].res, cost) ? { cost } : null;
  return payFor(st, p, cost, kind, { skip: RES.includes(a.skip) ? a.skip : undefined, sub: RES.includes(a.sub) ? a.sub : undefined });
}
// pay a plan; what the event tells of it (what was paid, left out, what an ore stood for), or nothing
function payPlan(st, p, plan) {
  pay(st, st.players[p], plan.cost);
  if (plan.smith) st.used.smithy = true;
  if (plan.works) st.used.roadworks = true;
  if (!plan.skip && !plan.smith) return {};
  return { paid: { ...plan.cost }, ...(plan.skip ? { skip: plan.skip } : {}), ...(plan.smith ? { smith: plan.smith } : {}) };
}
// (the development mode) a development card from the deck, shuffled anew from the ones played when it
// has run out (2026-11-18); null when there is none
function drawDev(st, ev, { knight = false } = {}) {
  if (!st.devDeck.length && st.devDiscard && st.devDiscard.length) {
    st.devDeck = st.devDiscard.splice(0);
    shuffle(st, st.devDeck);
    ev.push({ type: 'devReshuffle', left: st.devDeck.length });
  }
  if (!st.devDeck.length) return null;
  if (knight && st.devDeck.includes('knight')) return st.devDeck.splice(st.devDeck.lastIndexOf('knight'), 1)[0];
  return st.devDeck.pop();
}
const devLeft = (st) => st.devDeck.length + (st.devDiscard ? st.devDiscard.length : 0);

function validResMap(m) {
  if (!m || typeof m !== 'object') return false;
  for (const k of Object.keys(m)) {
    if (!RES.includes(k)) return false;
    if (!Number.isInteger(m[k]) || m[k] < 0) return false;
  }
  return true;
}
const mapTotal = (m) => RES.reduce((s, k) => s + (m[k] || 0), 0);

function updateLongestRoad(st, ev) {
  // (Seafarers: the longest trade route, roads and ships together)
  const L = st.players.map((pl) => (seafarers(st) ? tradeRouteFor(st, pl.id) : longestRoadFor(st, pl.id)));
  st.roadLen = L;
  const max = Math.max(...L);
  const holder = st.longestRoad;
  let next;
  if (holder >= 0 && L[holder] >= 5 && L[holder] >= max) next = holder;
  else {
    const cands = [];
    L.forEach((l, i) => {
      if (l === max && max >= 5) cands.push(i);
    });
    next = cands.length === 1 ? cands[0] : -1;
  }
  if (next !== holder) {
    st.longestRoad = next;
    ev.push({ type: 'longestRoad', from: holder, to: next, length: next >= 0 ? L[next] : max });
  }
}

function updateLargestArmy(st, p, ev) {
  const k = st.players[p].knights;
  const h = st.largestArmy;
  if (h === p) return;
  if (k >= 3 && (h < 0 || k > st.players[h].knights)) {
    st.largestArmy = p;
    ev.push({ type: 'largestArmy', from: h, to: p, size: k });
  }
}

function produce(st, sum, ev) {
  const owed = {};
  const claims = [];
  const gold = {};
  let blocked = -1;
  const dv = developOn(st);
  for (const hex of GEO.hexes) {
    const H = st.board.hexes[hex.id];
    if (H.number !== sum) continue;
    if (H.terrain === 'gold') {
      // (Seafarers) a gold field: each building's owner picks any resources (see H.gold)
      if (st.board.robber === hex.id) {
        if (hex.vertices.some((v) => st.vertices[v])) blocked = hex.id;
        continue;
      }
      for (const v of hex.vertices) {
        const b = st.vertices[v];
        if (b) gold[b.p] = (gold[b.p] || 0) + (b.t === 'c' ? 2 : 1);
      }
      continue;
    }
    const res = TERRAIN_RES[H.terrain];
    if (!res) continue;
    const robbed = st.board.robber === hex.id;
    if (robbed) {
      if (hex.vertices.some((v) => st.vertices[v])) blocked = hex.id;
      // (the development mode: a settlement with a wall produces all the same)
      if (!dv) continue;
    }
    // (the terraces: one more card for each of their owner's settlements on the rare numbers)
    const rare = dv && TERRACE_NUMBERS.includes(sum);
    for (const v of hex.vertices) {
      const b = st.vertices[v];
      if (!b || (robbed && !walled(st, v))) continue;
      const amt = (b.t === 'c' ? 2 : 1) + (rare && hasBuilt(st, b.p, 'terraces') ? 1 : 0);
      owed[res] = owed[res] || {};
      owed[res][b.p] = (owed[res][b.p] || 0) + amt;
      claims.push({ hex: hex.id, vertex: v, p: b.p, res, amt });
    }
    // (the development mode) the development here: a card of each level's resource for its developer,
    // and one more of the first level's with the hanging gardens; never while the robber is here
    const plot = dv && !robbed && st.plots[hex.id];
    if (plot) {
      const extra = wonderDone(st, plot.p, 'gardens') ? [...plot.r, plot.r[0]] : plot.r;
      for (const r of extra) {
        owed[r] = owed[r] || {};
        owed[r][plot.p] = (owed[r][plot.p] || 0) + 1;
        claims.push({ hex: hex.id, vertex: null, p: plot.p, res: r, amt: 1, plot: true });
      }
    }
  }
  const paid = [];
  const shortages = [];
  for (const res of RES) {
    const o = owed[res];
    if (!o) continue;
    const pids = Object.keys(o).map(Number);
    const total = pids.reduce((s, q) => s + o[q], 0);
    if (total <= st.bank[res]) {
      for (const c of claims) if (c.res === res) paid.push(c);
      for (const q of pids) {
        st.players[q].res[res] += o[q];
        st.bank[res] -= o[q];
      }
    } else if (pids.length === 1) {
      // Only one player affected by the shortage: they receive whatever is left.
      let left = st.bank[res];
      const q = pids[0];
      shortages.push({ res, partial: true, p: q, got: left, owed: total });
      for (const c of claims) {
        if (c.res !== res || left <= 0) continue;
        const a = Math.min(c.amt, left);
        left -= a;
        paid.push({ ...c, amt: a });
      }
      st.players[q].res[res] += st.bank[res];
      st.bank[res] = 0;
    } else {
      shortages.push({ res, partial: false });
    }
  }
  const e = { type: 'produce', sum, paid, shortages, blocked };
  if (Object.keys(gold).length) {
    e.gold = { ...gold };
    st.pending = { type: 'gold', amounts: gold };
  }
  ev.push(e);
  // (the development mode) an aqueduct's owner who got nothing takes one of the scarcest resource in
  // hand, while the bank has it
  if (dv) {
    const got = new Set(paid.filter((c) => c.amt > 0).map((c) => c.p));
    for (const pl of st.players) {
      if (got.has(pl.id) || !hasBuilt(st, pl.id, 'aqueduct')) continue;
      const r = scarcest(pl.res);
      if (st.bank[r] <= 0) continue;
      st.bank[r]--;
      pl.res[r]++;
      ev.push({ type: 'aqueduct', p: pl.id, res: r });
    }
  }
}

function nextSetupStep(st, ev) {
  const su = st.setup;
  su.i++;
  if (su.i >= su.order.length) {
    st.phase = 'play';
    st.current = su.order[0];
    st.turn = 1;
    st.rolled = false;
    st.devPlayed = false;
    if (developOn(st)) {
      st.devPlays = 0;
      st.knightPlayed = false;
    }
    ev.push({ type: 'phase', phase: 'play' });
    ev.push({ type: 'turnStart', p: st.current, turn: st.turn });
  } else {
    su.step = 'settlement';
    su.last = -1;
    st.current = su.order[su.i];
  }
}

function requireMainTurn(st, p, { needRoll = true } = {}) {
  need(st.phase === 'play', st.phase === 'over' ? '遊戲已結束' : '開局階段尚未完成');
  need(p === st.current, '還沒輪到你');
  need(!st.pending, pendingMsg(st.pending));
  need(!st.trade, '請先處理目前的交易提議');
  if (needRoll) need(st.rolled, '請先擲骰');
}

// ── 5–6 players: the part of a turn after the main player's ──
// st.rules.turns: 'paired' — when the main player ends, the player three seats on (opposite at six)
// takes a second part: bank and harbor trades, building, one development card; no dice, no trading
// with players. 'sbp' — the special building phase: every other player in turn may build or buy
// development cards, nothing else. st.sub = { k: 'pair' | 'sbp', lead: the main player, rest: the
// players still to come } while it lasts (absent on maps without these rules).
export function inSub(st, k) {
  return !!st.sub && (!k || st.sub.k === k);
}
function noSubTrade(st) {
  need(!st.sub, st.sub && st.sub.k === 'pair' ? '第二位不能與其他玩家交易' : '特別建造階段不能與其他玩家交易');
}
function pendingMsg(pd) {
  if (!pd) return '';
  if (pd.type === 'discard') return N_('等待玩家棄牌');
  if (pd.type === 'robber') return N_('請先移動強盜');
  if (pd.type === 'steal') return N_('請先選擇要搶奪的玩家');
  if (pd.type === 'roadBuilding') return N_('請先放置道路建設的道路');
  if (pd.type === 'defend') return N_('等待奇觀的主人決定是否防衛');
  if (pd.type === 'pick') return N_('請先選擇要留下的發展卡');
  if (pd.type === 'reroll') return N_('請先決定要不要用天文台重擲');
  return N_('請先完成目前的動作');
}

function stealFrom(st, thief, victim, ev) {
  const vr = st.players[victim].res;
  const pool = [];
  for (const r of RES) for (let i = 0; i < vr[r]; i++) pool.push(r);
  if (!pool.length) {
    ev.push({ type: 'steal', p: thief, from: victim, res: null });
    return;
  }
  const res = pool[rngInt(st, 0, pool.length - 1)];
  vr[res]--;
  st.players[thief].res[res]++;
  ev.push({ type: 'steal', p: thief, from: victim, res });
}

// ───────────────────────── action handlers ─────────────────────────

const H = {};

H.settlement = (st, a, ev) => {
  const p = a.p;
  const v = a.vertex;
  need(Number.isInteger(v) && v >= 0 && v < GEO.vertices.length, '無效的位置');
  const pl = st.players[p];
  if (st.phase === 'setup') {
    const su = st.setup;
    need(p === su.order[su.i], '還沒輪到你');
    need(!st.pending, pendingMsg(st.pending));
    need(su.step === 'settlement', '請先放置道路');
    need(distanceOK(st, v), st.vertices[v] ? '這個路口已有建築' : '距離規則：相鄰的路口不能有建築');
    need(settlementLegal(st, p, v, true), GEO.def.setup && GEO.def.setup.group ? '開局的村莊要放在主島的陸地上' : '開局的村莊要放在陸地上');
    st.vertices[v] = { p, t: 's' };
    pl.pieces.settlements--;
    ev.push({ type: 'build', what: 'settlement', p, vertex: v, setup: true });
    // (Seafarers) the islands a player starts on are that player's home islands
    if (seafarers(st)) {
      const isle = seaInfo(st.board).vIsland[v];
      pl.home = pl.home || [];
      if (isle >= 0 && !pl.home.includes(isle)) pl.home.push(isle);
      discover(st, p, [v], ev);
    }
    if (su.i >= st.players.length) {
      const gains = emptyRes();
      for (const h of GEO.vertices[v].hexes) {
        const res = TERRAIN_RES[st.board.hexes[h].terrain];
        if (res && st.bank[res] > 0) {
          st.bank[res]--;
          pl.res[res]++;
          gains[res]++;
        }
      }
      ev.push({ type: 'startingResources', p, vertex: v, gains });
    }
    su.step = 'road';
    su.last = v;
    updateLongestRoad(st, ev);
    return;
  }
  requireMainTurn(st, p);
  need(hasBasic(st, p, 'settlement'), NO_CARD.settlement);
  need(pl.pieces.settlements > 0, '村莊已經用完了（可先升級城市）');
  const plan = buildPlan(st, p, COSTS.settlement, 'settlement', a);
  need(plan, '資源不足：村莊需要 木材、磚塊、羊毛、小麥 各 1');
  need(distanceOK(st, v), st.vertices[v] ? '這個路口已有建築' : '距離規則：相鄰的路口不能有建築');
  need(settlementLegal(st, p, v), seafarers(st) ? '村莊必須連接到你的道路或船' : '村莊必須連接到你的道路');
  const paid = payPlan(st, p, plan);
  st.vertices[v] = { p, t: 's' };
  pl.pieces.settlements--;
  ev.push({ type: 'build', what: 'settlement', p, vertex: v, ...paid });
  // Seafarers: a player's first settlement on each island beyond the home island(s) earns bonus points
  const bonus = seafarers(st) && GEO.def.isleBonus;
  // (on the new world only one island counts: isleBonusMax)
  if (bonus && !(GEO.def.isleBonusMax && pl.isles.length >= GEO.def.isleBonusMax)) {
    const sea = seaInfo(st.board);
    const isle = sea.vIsland[v];
    if (isle >= 0 && !homeIslands(st, p).includes(isle) && !pl.isles.includes(isle)) {
      pl.isles.push(isle);
      pl.chits += bonus;
      ev.push({ type: 'isleBonus', p, vertex: v, vp: bonus });
    }
  }
  // (the development mode) a frontier camp: a card from each hex beside a new village, as the second
  // opening settlement brings
  if (developOn(st) && hasBuilt(st, p, 'camp')) {
    const gains = emptyRes();
    for (const h of GEO.vertices[v].hexes) {
      const res = TERRAIN_RES[st.board.hexes[h].terrain];
      if (res && st.bank[res] > 0) {
        st.bank[res]--;
        pl.res[res]++;
        gains[res]++;
      }
    }
    ev.push({ type: 'startingResources', p, vertex: v, gains, camp: true });
  }
  updateLongestRoad(st, ev);
};

H.road = (st, a, ev) => {
  const p = a.p;
  const e = a.edge;
  need(Number.isInteger(e) && e >= 0 && e < GEO.edges.length, '無效的位置');
  const pl = st.players[p];
  if (st.phase === 'setup') {
    const su = st.setup;
    need(p === su.order[su.i], '還沒輪到你');
    need(!st.pending, pendingMsg(st.pending));
    need(su.step === 'road', '請先放置村莊');
    need(st.edges[e] === -1 && (!seafarers(st) || st.ships[e] === -1), '這條路已有道路');
    need(GEO.edges[e].v.includes(su.last), '道路必須連接剛放置的村莊');
    need(!seafarers(st) || roadEdge(st, e), '道路不能鋪在海上（可以改放船）');
    st.edges[e] = p;
    pl.pieces.roads--;
    ev.push({ type: 'build', what: 'road', p, edge: e, setup: true });
    discover(st, p, GEO.edges[e].v, ev);
    updateLongestRoad(st, ev);
    nextSetupStep(st, ev);
    return;
  }
  need(st.phase === 'play', '遊戲已結束');
  need(p === st.current, '還沒輪到你');
  const free = st.pending && st.pending.type === 'roadBuilding';
  // (the development mode) the royal road: a road a turn for nothing
  let royal = false;
  let plan = null;
  if (!free) {
    requireMainTurn(st, p);
    royal = freeRoad(st, p);
    if (!royal) need(hasBasic(st, p, 'road'), NO_CARD.road);
    if (!royal) {
      plan = buildPlan(st, p, COSTS.road, 'road', a);
      need(plan, '資源不足：道路需要 木材、磚塊 各 1');
    }
  }
  need(pl.pieces.roads > 0, '道路已經用完了');
  need(st.edges[e] === -1, '這條路已有道路');
  need(roadLegal(st, p, e), '道路必須連接你的道路、村莊或城市');
  const paid = plan ? payPlan(st, p, plan) : {};
  if (royal) st.used.road = true;
  st.edges[e] = p;
  pl.pieces.roads--;
  ev.push(royal ? { type: 'build', what: 'road', p, edge: e, free: true, royal } : { type: 'build', what: 'road', p, edge: e, free, ...paid });
  discover(st, p, GEO.edges[e].v, ev);
  updateLongestRoad(st, ev);
  if (free) freeBuilt(st, p, ev);
};

// one of the road building card's free pieces is down: done when both are, or nothing more fits
function freeBuilt(st, p, ev) {
  st.pending.left--;
  if (st.pending.left <= 0 || !canBuildPaths(st, p)) endFree(st, p, ev);
}
// (gold found in the fog meanwhile is picked now)
function endFree(st, p, ev) {
  const gold = st.pending && st.pending.gold;
  st.pending = gold ? { type: 'gold', amounts: { [p]: gold } } : null;
  ev.push({ type: 'roadBuildingDone', p });
}

// ── Seafarers: ships ──
H.ship = (st, a, ev) => {
  const p = a.p;
  const e = a.edge;
  need(seafarers(st), '這張地圖沒有船');
  need(Number.isInteger(e) && e >= 0 && e < GEO.edges.length, '無效的位置');
  const pl = st.players[p];
  if (st.phase === 'setup') {
    const su = st.setup;
    need(p === su.order[su.i], '還沒輪到你');
    need(!st.pending, pendingMsg(st.pending));
    need(su.step === 'road', '請先放置村莊');
    need(st.edges[e] === -1 && st.ships[e] === -1, '這條航道已有道路或船');
    need(GEO.edges[e].v.includes(su.last), '船必須連接剛放置的村莊');
    need(shipEdge(st, e), '船只能放在海上或海岸邊');
    st.ships[e] = p;
    pl.pieces.ships--;
    ev.push({ type: 'build', what: 'ship', p, edge: e, setup: true });
    discover(st, p, GEO.edges[e].v, ev);
    updateLongestRoad(st, ev);
    nextSetupStep(st, ev);
    return;
  }
  need(st.phase === 'play', '遊戲已結束');
  need(p === st.current, '還沒輪到你');
  const free = st.pending && st.pending.type === 'roadBuilding';
  if (!free) {
    requireMainTurn(st, p);
    need(canAfford(pl.res, COSTS.ship), '資源不足：船需要 木材、羊毛 各 1');
  }
  need(pl.pieces.ships > 0, '船已經用完了');
  need(shipLegal(st, p, e), pirateEdges(st).includes(e) ? '海盜旁邊不能造船' : '船必須接在你的船、或海岸邊的村莊或城市旁');
  if (!free) pay(st, pl, COSTS.ship);
  st.ships[e] = p;
  pl.pieces.ships--;
  st.newShips.push(e);
  ev.push({ type: 'build', what: 'ship', p, edge: e, free });
  discover(st, p, GEO.edges[e].v, ev);
  updateLongestRoad(st, ev);
  if (free) freeBuilt(st, p, ev);
};

// move one ship a turn: from the open end of a route, not one built this turn, not beside the pirate
H.moveShip = (st, a, ev) => {
  const p = a.p;
  need(seafarers(st), '這張地圖沒有船');
  requireMainTurn(st, p);
  need(!inSub(st, 'sbp'), '特別建造階段不能移動船');
  need(!st.shipMoved, '每回合只能移動一艘船');
  need(movableShips(st, p).includes(a.from), '這艘船不能移動：只能移動航線末端、之前回合建造、不在海盜旁的船');
  need(shipTargets(st, p, a.from).includes(a.to), '船不能移到那裡');
  st.ships[a.from] = -1;
  st.ships[a.to] = p;
  st.shipMoved = true;
  ev.push({ type: 'moveShip', p, from: a.from, to: a.to });
  discover(st, p, GEO.edges[a.to].v, ev);
  updateLongestRoad(st, ev);
};

// the resources a gold field gives: any, as many as owed (no more than the bank holds)
H.gold = (st, a, ev) => {
  const p = a.p;
  need(st.pending && st.pending.type === 'gold', '現在不需要選擇金礦資源');
  const amt = st.pending.amounts[p];
  need(amt !== undefined, '你沒有金礦資源可選');
  const res = a.res;
  need(validResMap(res), '無效的選擇');
  const want = Math.min(amt, mapTotal(st.bank));
  need(mapTotal(res) === want, '請選擇 {n} 張資源', { n: want });
  for (const r of RES) need(st.bank[r] >= (res[r] || 0), '銀行沒有足夠的該種資源');
  const pl = st.players[p];
  for (const r of RES) {
    const c = res[r] || 0;
    st.bank[r] -= c;
    pl.res[r] += c;
  }
  delete st.pending.amounts[p];
  ev.push({ type: 'gold', p, res: { ...res }, count: want });
  if (!Object.keys(st.pending.amounts).length) st.pending = null;
};

H.endRoadBuilding = (st, a, ev) => {
  need(st.pending && st.pending.type === 'roadBuilding' && a.p === st.current, '沒有進行中的道路建設');
  endFree(st, a.p, ev);
};

H.city = (st, a, ev) => {
  const p = a.p;
  const v = a.vertex;
  const pl = st.players[p];
  requireMainTurn(st, p);
  need(Number.isInteger(v) && v >= 0 && v < GEO.vertices.length, '無效的位置');
  const b = st.vertices[v];
  need(hasBasic(st, p, 'city'), NO_CARD.city);
  need(b && b.p === p && b.t === 's', '城市只能由你自己的村莊升級');
  need(pl.pieces.cities > 0, '城市已經用完了');
  const plan = buildPlan(st, p, COSTS.city, 'city', a);
  need(plan, '資源不足：城市需要 小麥 2、礦石 3');
  const paid = payPlan(st, p, plan);
  b.t = 'c';
  pl.pieces.cities--;
  pl.pieces.settlements++;
  ev.push({ type: 'build', what: 'city', p, vertex: v, ...paid });
  // (the scriptorium) a development card for nothing with every city, without the development card
  if (developOn(st) && hasBuilt(st, p, 'scriptorium')) {
    const card = drawDev(st, ev);
    if (card) {
      pl.dev.push({ type: card, turn: st.turn });
      pl.devGot = (pl.devGot || 0) + 1;
      ev.push({ type: 'buyDev', p, card, left: st.devDeck.length, how: 'scriptorium' });
    }
  }
};

// (the development mode) a.lib: paid with that one resource (the great library, once a turn);
// a.how: 'knight' (the barracks: the deck's top knight) or 'pick' (the academy: two drawn, one kept,
// pickDev)
H.buyDev = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  requireMainTurn(st, p);
  need(st.devDeck.length > 0 || (st.devDiscard && st.devDiscard.length > 0), '發展卡已經賣完了');
  let cost = COSTS.dev;
  if (a.lib !== undefined) {
    need(wonderDone(st, p, 'library'), '你沒有完工的大圖書館');
    need(!st.used.library, '大圖書館每回合只能用一次');
    need(RES.includes(a.lib), '請選擇一種資源');
    cost = { [a.lib]: 1 };
    need(pl.res[a.lib] > 0, '你沒有那種資源');
  } else {
    need(hasBasic(st, p, 'dev'), NO_CARD.dev);
    need(canAfford(pl.res, COSTS.dev), '資源不足：發展卡需要 羊毛、小麥、礦石 各 1');
  }
  need(a.how === undefined || a.how === 'knight' || a.how === 'pick', '無效的動作');
  if (a.how === 'knight') need(developOn(st) && hasBuilt(st, p, 'barracks'), '你沒有兵營');
  if (a.how === 'pick') need(developOn(st) && hasBuilt(st, p, 'academy'), '你沒有學院');
  pay(st, pl, cost);
  if (a.lib !== undefined) st.used.library = true;
  if (developOn(st)) pl.bought = (pl.bought || 0) + 1;
  const extra = a.lib !== undefined ? { cost: { ...cost } } : {};
  let card;
  if (a.how === 'pick') {
    // (two drawn, one kept; only one left: that one)
    card = developOn(st) ? drawDev(st, ev) : st.devDeck.pop();
    const second = developOn(st) ? drawDev(st, ev) : st.devDeck.pop() || null;
    if (second) {
      pl.pick = [card, second];
      st.pending = { type: 'pick', p };
      ev.push({ type: 'devDraw', p, cards: pl.pick.slice(), left: st.devDeck.length, ...extra });
      return;
    }
  } else card = developOn(st) ? drawDev(st, ev, { knight: a.how === 'knight' }) : st.devDeck.pop();
  if (developOn(st)) pl.devGot = (pl.devGot || 0) + 1;
  pl.dev.push({ type: card, turn: st.turn });
  ev.push(a.how || a.lib !== undefined ? { type: 'buyDev', p, card, left: st.devDeck.length, how: a.how, ...extra } : { type: 'buyDev', p, card, left: st.devDeck.length });
};

// (the development mode, the academy) keep one of the two cards drawn; the other goes under the deck
H.pickDev = (st, a, ev) => {
  const pd = st.pending;
  need(pd && pd.type === 'pick' && pd.p === a.p, '現在不需要選發展卡');
  need(a.i === 0 || a.i === 1, '請選擇要留下的發展卡');
  const pl = st.players[a.p];
  const card = pl.pick[a.i];
  st.devDeck.unshift(pl.pick[1 - a.i]);
  delete pl.pick;
  pl.devGot = (pl.devGot || 0) + 1;
  pl.dev.push({ type: card, turn: st.turn });
  st.pending = null;
  ev.push({ type: 'buyDev', p: a.p, card, left: st.devDeck.length, how: 'pick', paid: true });
};

// The dice deck (a room's choice, like the event cards): the 36 ways two dice can fall, a card each,
// shuffled with the game's dice. A few cards at the bottom are never turned, so the end of the deck
// can't be counted out; when it runs out it is shuffled anew. Over each deck every number comes up
// about as often as the dice say it should, instead of in streaks. (The order is the host's secret.)
function drawDice(st) {
  if (!st.diceDeck || !st.diceDeck.length) {
    const deck = [];
    for (let c = 0; c < 36; c++) deck.push(c);
    shuffle(st, deck);
    deck.splice(0, rngInt(st, 2, 5));
    st.diceDeck = deck;
  }
  const c = st.diceDeck.pop();
  return [Math.floor(c / 6) + 1, (c % 6) + 1];
}

H.roll = (st, a, ev) => {
  const p = a.p;
  need(st.phase === 'play', '現在不能擲骰');
  need(p === st.current, '還沒輪到你');
  need(!st.rolled, '本回合已經擲過骰子');
  need(!st.pending, pendingMsg(st.pending));
  need(!st.trade, '請先處理目前的交易提議');
  const pl = st.players[p];
  // (the almshouse) a card of the player's choice when the turn begins with few in hand
  if (developOn(st) && hasBuilt(st, p, 'almshouse') && !st.used.almshouse && handSize(pl.res) <= ALMS_MAX) bonusCard(st, p, a.alms, 'almshouse', ev);
  const [d1, d2] = rollDice(st);
  const sum = d1 + d2;
  st.dice = [d1, d2];
  st.rolled = true;
  st.rolls[sum]++;
  ev.push({ type: 'roll', p, dice: [d1, d2], sum });
  // (the observatory) the roller may pay a wool to roll again, once a turn: nothing comes of this roll
  // until they say
  if (developOn(st) && hasBuilt(st, p, 'observatory') && !st.used.observatory && pl.res.wool > 0) {
    st.pending = { type: 'reroll', p, sum };
    return;
  }
  resolveRoll(st, sum, ev);
};
const rollDice = (st) => (st.rules && st.rules.dice === 'deck' ? drawDice(st) : [rngInt(st, 1, 6), rngInt(st, 1, 6)]);

// (the observatory) yes: a wool for a second roll, whose result counts
H.reroll = (st, a, ev) => {
  const pd = st.pending;
  need(pd && pd.type === 'reroll' && pd.p === a.p, '現在不能重擲');
  const pl = st.players[a.p];
  st.pending = null;
  let sum = pd.sum;
  if (a.yes) {
    need(pl.res.wool > 0, '你沒有羊毛');
    pl.res.wool--;
    st.bank.wool++;
    st.used.observatory = true;
    const [d1, d2] = rollDice(st);
    st.rolls[sum]--;
    sum = d1 + d2;
    st.dice = [d1, d2];
    st.rolls[sum]++;
    ev.push({ type: 'roll', p: a.p, dice: [d1, d2], sum, again: true });
  }
  resolveRoll(st, sum, ev);
};

// (the counting house, the almshouse) a card from the bank: `res` if the player chose it and the bank
// has it, else the scarcest in hand that the bank has; once a turn each
function bonusCard(st, p, res, why, ev) {
  const pl = st.players[p];
  st.used[why] = true;
  let r = RES.includes(res) && st.bank[res] > 0 ? res : null;
  if (!r) r = RES.filter((x) => st.bank[x] > 0).sort((x, y) => pl.res[x] - pl.res[y])[0] || null;
  if (!r) return;
  st.bank[r]--;
  pl.res[r]++;
  ev.push({ type: 'bonus', p, res: r, why });
}

// the roll's result: a 7 (the discards, then the robber), or what the land produces
function resolveRoll(st, sum, ev) {
  if (sum === 7) {
    const amounts = {};
    for (const pl of st.players) {
      const t = handSize(pl.res);
      if (t > handLimitOf(st, pl.id)) amounts[pl.id] = Math.floor(t / 2);
    }
    if (Object.keys(amounts).length) {
      st.pending = { type: 'discard', amounts };
      ev.push({ type: 'discardRequired', amounts: { ...amounts } });
    } else {
      st.pending = { type: 'robber', reason: 'seven' };
    }
  } else {
    produce(st, sum, ev);
  }
}

H.discard = (st, a, ev) => {
  const p = a.p;
  need(st.pending && st.pending.type === 'discard', '現在不需要棄牌');
  const amt = st.pending.amounts[p];
  need(amt !== undefined, '你不需要棄牌');
  const cards = a.cards;
  need(validResMap(cards), '無效的棄牌');
  need(mapTotal(cards) === amt, '需要剛好棄掉 {n} 張牌', { n: amt });
  const pl = st.players[p];
  for (const r of RES) need((pl.res[r] || 0) >= (cards[r] || 0), '你沒有那麼多張牌');
  for (const r of RES) {
    const c = cards[r] || 0;
    pl.res[r] -= c;
    st.bank[r] += c;
  }
  delete st.pending.amounts[p];
  ev.push({ type: 'discard', p, cards: { ...cards }, count: amt });
  if (!Object.keys(st.pending.amounts).length) st.pending = { type: 'robber', reason: 'seven' };
};

H.robber = (st, a, ev) => {
  const p = a.p;
  need(st.pending && st.pending.type === 'robber', '現在不能移動強盜');
  need(p === st.current, '還沒輪到你');
  const hex = a.hex;
  need(Number.isInteger(hex) && hex >= 0 && hex < GEO.hexes.length, '無效的地形');
  if (seafarers(st) && !seaInfo(st.board).land[hex]) {
    // Seafarers: the pirate instead of the robber, onto another sea hex
    need(hex !== st.board.pirate, '海盜必須移動到另一片海域');
    need(st.board.hexes[hex].terrain !== 'fog', '海盜不能開進還沒探索的霧裡');
    const from = st.board.pirate;
    st.board.pirate = hex;
    ev.push({ type: 'pirate', p, from, to: hex, reason: st.pending.reason });
    const victims = pirateVictims(st, hex, p, playerHandSize);
    if (victims.length === 0) st.pending = null;
    else if (victims.length === 1) {
      st.pending = null;
      stealFrom(st, p, victims[0], ev);
    } else st.pending = { type: 'steal', hex, victims };
    return;
  }
  need(hex !== st.board.robber, '強盜必須移動到另一塊地形');
  // (the development mode: not onto one's own wonder, nor next to a great wall's owner)
  if (developOn(st)) {
    const why = robberWhy(st, p, hex);
    need(!why || robberSpots(st, p).includes(hex), why);
  }
  const from = st.board.robber;
  st.board.robber = hex;
  const reason = st.pending.reason;
  ev.push({ type: 'robber', p, from, to: hex, reason });
  // (a watchtower beside it: its owner takes a card from the one who moved the robber, at random)
  if (developOn(st)) for (const q of watchersAt(st, hex, p)) toll(st, q, p, ev);
  // a wonder here: its owner may play a knight to save it, before anyone is robbed
  const w = developOn(st) && wonderAt(st, hex);
  if (w && w.p !== p) {
    st.pending = { type: 'defend', p: w.p, hex, by: p, reason };
    ev.push({ type: 'siege', p: w.p, by: p, hex, k: w.k });
    return;
  }
  robberSteal(st, p, hex, ev);
};

// (the watchtower) a card at random from `from` to `to`, a toll, not a theft
function toll(st, to, from, ev) {
  const pool = [];
  for (const r of RES) for (let i = 0; i < st.players[from].res[r]; i++) pool.push(r);
  if (!pool.length) return;
  const res = pool[rngInt(st, 0, pool.length - 1)];
  st.players[from].res[res]--;
  st.players[to].res[res]++;
  ev.push({ type: 'toll', p: to, from, res });
}

// The robber is on hex: p robs a player with a settlement beside it (choosing when there are several;
// with a mercenary camp, every one of them).
function robberSteal(st, p, hex, ev) {
  const victims = robberVictims(st, hex, p);
  if (victims.length === 0) st.pending = null;
  else if (victims.length > 1 && developOn(st) && hasBuilt(st, p, 'mercenaries')) {
    st.pending = null;
    for (const q of victims) stealFrom(st, p, q, ev);
  } else if (victims.length === 1) {
    st.pending = null;
    stealFrom(st, p, victims[0], ev);
  } else st.pending = { type: 'steal', hex, victims };
}

// (the development mode) the wonder the robber came to: its owner plays a knight from hand to keep it
// (the knight counts toward the largest army; no limit of one card a turn), or it is lost. The robber
// stays, and the one who moved it robs as usual.
H.defend = (st, a, ev) => {
  const pd = st.pending;
  need(pd && pd.type === 'defend', '現在不需要防衛奇觀');
  need(a.p === pd.p, '這不是你的奇觀');
  const pl = st.players[a.p];
  const w = wonderAt(st, pd.hex);
  if (a.yes && a.pay) {
    // (the garrison) two cards of any kind instead of a knight
    need(hasBuilt(st, a.p, 'garrison'), '你沒有衛戍所');
    need(validResMap(a.pay) && mapTotal(a.pay) === 2, '請選 2 張資源');
    for (const r of RES) need(pl.res[r] >= (a.pay[r] || 0), '你沒有那麼多張牌');
    const paid = {};
    for (const r of RES) if (a.pay[r]) paid[r] = a.pay[r];
    pay(st, pl, paid);
    ev.push({ type: 'defend', p: a.p, by: pd.by, hex: pd.hex, k: w.k, knights: pl.knights, paid });
  } else if (a.yes) {
    const i = pl.dev.findIndex((c) => c.type === 'knight');
    need(i >= 0, '你手上沒有騎士');
    pl.dev.splice(i, 1);
    pl.played.knight++;
    pl.knights++;
    ev.push({ type: 'defend', p: a.p, by: pd.by, hex: pd.hex, k: w.k, knights: pl.knights });
    updateLargestArmy(st, a.p, ev);
  } else {
    st.wonders = st.wonders.filter((x) => x !== w);
    st.ruins = [...(st.ruins || []).filter((r) => r.h !== w.h), { h: w.h, k: w.k }];
    ev.push({ type: 'wonderLost', p: a.p, by: pd.by, hex: pd.hex, k: w.k, stage: w.s, done: w.done });
  }
  st.pending = null;
  robberSteal(st, pd.by, pd.hex, ev);
};

H.steal = (st, a, ev) => {
  const p = a.p;
  need(st.pending && st.pending.type === 'steal', '現在不能搶奪');
  need(p === st.current, '還沒輪到你');
  need(st.pending.victims.includes(a.target), '只能搶奪該地形旁有建築且有手牌的玩家');
  st.pending = null;
  stealFrom(st, p, a.target, ev);
};

H.playDev = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  need(st.phase === 'play', '現在不能使用發展卡');
  need(p === st.current, '只能在自己的回合使用發展卡');
  need(!inSub(st, 'sbp'), '特別建造階段不能使用發展卡');
  need(!st.pending, pendingMsg(st.pending));
  need(!st.trade, '請先處理目前的交易提議');
  const lecture = developOn(st) && hasBuilt(st, p, 'lectureHall');
  need(!st.devPlayed, lecture ? '每回合最多使用兩張發展卡' : '每回合只能使用一張發展卡');
  need(a.card !== 'victoryPoint', '分數卡不需要使用，會自動計分');
  need(!(a.card === 'knight' && st.knightPlayed), '每回合最多打出 1 張騎士');
  const idx = pl.dev.findIndex((c) => c.type === a.card && devReady(st, p, c));
  need(idx >= 0, pl.dev.some((c) => c.type === a.card) ? '本回合買的發展卡要下回合才能使用' : '你沒有這張發展卡');

  if (a.card === 'roadBuilding') {
    need(canBuildPaths(st, p), seafarers(st) ? '目前沒有可以建造道路或船的位置' : '目前沒有可以建造道路的位置');
  }
  let take = null;
  if (a.card === 'yearOfPlenty') {
    take = a.res;
    need(Array.isArray(take) && take.every((r) => RES.includes(r)), '請選擇資源');
    const bankTotal = mapTotal(st.bank);
    need(take.length === Math.min(2, bankTotal), '請選擇 2 張資源');
    const want = emptyRes();
    for (const r of take) want[r]++;
    for (const r of RES) need(st.bank[r] >= want[r], '銀行沒有足夠的該種資源');
  }
  if (a.card === 'monopoly') need(RES.includes(a.res), '請選擇一種資源');

  pl.dev.splice(idx, 1);
  // (the lecture hall: a second card, but not a second knight)
  if (developOn(st)) {
    st.devPlays = (st.devPlays || 0) + 1;
    if (a.card === 'knight') st.knightPlayed = true;
  }
  st.devPlayed = !(lecture && st.devPlays < 2);
  pl.played[a.card]++;
  // (the development mode) the cards that go back into the deck when it runs out
  if (st.devDiscard && a.card !== 'knight') st.devDiscard.push(a.card);
  if (a.card === 'knight') {
    pl.knights++;
    ev.push({ type: 'playDev', p, card: 'knight', knights: pl.knights });
    updateLargestArmy(st, p, ev);
    st.pending = { type: 'robber', reason: 'knight' };
  } else if (a.card === 'roadBuilding') {
    st.pending = { type: 'roadBuilding', left: Math.min(2, pl.pieces.roads + (pl.pieces.ships || 0)) };
    ev.push({ type: 'playDev', p, card: 'roadBuilding' });
  } else if (a.card === 'yearOfPlenty') {
    for (const r of take) {
      st.bank[r]--;
      pl.res[r]++;
    }
    ev.push({ type: 'playDev', p, card: 'yearOfPlenty', res: take.slice() });
  } else if (a.card === 'monopoly') {
    const r = a.res;
    const taken = {};
    let total = 0;
    for (const o of st.players) {
      if (o.id === p) continue;
      const c = o.res[r];
      if (c > 0) {
        taken[o.id] = c;
        total += c;
        o.res[r] = 0;
        pl.res[r] += c;
      }
    }
    ev.push({ type: 'playDev', p, card: 'monopoly', res: r, taken, total });
  }
};

H.bankTrade = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  requireMainTurn(st, p);
  need(!inSub(st, 'sbp'), '特別建造階段不能交易');
  need(RES.includes(a.give) && RES.includes(a.get), '無效的交易');
  need(a.give !== a.get, '不能用相同的資源交換');
  const ratio = tradeRatio(st, p, a.give);
  need(pl.res[a.give] >= ratio, '需要 {n} 張相同資源', { n: ratio });
  need(st.bank[a.get] > 0, '銀行已沒有這種資源');
  pl.res[a.give] -= ratio;
  st.bank[a.give] += ratio;
  pl.res[a.get]++;
  st.bank[a.get]--;
  ev.push({ type: 'bankTrade', p, give: a.give, get: a.get, ratio });
};

H.offer = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  requireMainTurn(st, p);
  noSubTrade(st);
  need(validResMap(a.give) && validResMap(a.get), '無效的交易');
  need(mapTotal(a.give) > 0 && mapTotal(a.get) > 0, '交易雙方都必須給出至少一張牌（不能贈送）');
  for (const r of RES) need(!((a.give[r] || 0) > 0 && (a.get[r] || 0) > 0), '不能用相同的資源交換');
  for (const r of RES) need(pl.res[r] >= (a.give[r] || 0), '你沒有足夠的資源');
  const give = {};
  const get = {};
  for (const r of RES) {
    if (a.give[r]) give[r] = a.give[r];
    if (a.get[r]) get[r] = a.get[r];
  }
  const resp = {};
  const to = Array.isArray(a.to) && a.to.length ? a.to : st.players.map((o) => o.id).filter((q) => q !== p);
  for (const q of to) if (q !== p && st.players[q]) resp[q] = null;
  need(Object.keys(resp).length > 0, '沒有交易對象');
  st.trade = { id: st.seq, from: p, give, get, resp };
  ev.push({ type: 'offer', p, give, get, to: Object.keys(resp).map(Number) });
};

H.respond = (st, a, ev) => {
  const p = a.p;
  const t = st.trade;
  need(t, '目前沒有交易提議');
  need(p !== t.from && p in t.resp, '這個交易不是給你的');
  need(t.resp[p] === null, '你已經回覆過了');
  if (a.accept) {
    const pr = st.players[p].res;
    for (const r of RES) need(pr[r] >= (t.get[r] || 0), '你沒有足夠的資源接受這筆交易');
  }
  // a decline may say "I don't have those cards" — only when it is true
  const lack = !a.accept && a.reason === 'lack' && RES.some((r) => st.players[p].res[r] < (t.get[r] || 0));
  t.resp[p] = a.accept ? 'yes' : lack ? 'lack' : 'no';
  ev.push({ type: 'respond', p, accept: !!a.accept, from: t.from, lack });
};

H.acceptOffer = (st, a, ev) => {
  const t = st.trade;
  need(t && a.p === t.from, '沒有你的交易提議');
  const q = a.with;
  need(t.resp[q] === 'yes', '對方尚未接受這筆交易');
  const A = st.players[t.from].res;
  const B = st.players[q].res;
  for (const r of RES) need(A[r] >= (t.give[r] || 0), '你的資源已不足');
  for (const r of RES) need(B[r] >= (t.get[r] || 0), '對方的資源已不足');
  for (const r of RES) {
    A[r] -= t.give[r] || 0;
    B[r] += t.give[r] || 0;
    B[r] -= t.get[r] || 0;
    A[r] += t.get[r] || 0;
  }
  ev.push({ type: 'trade', from: t.from, to: q, give: { ...t.give }, get: { ...t.get } });
  st.trade = null;
  // (the development mode) the merchant guild: when its owner trades with a player, both take one
  // more of what they received from the bank (of what they received most), once a turn
  if (developOn(st) && !st.used.guild && (hasBuilt(st, t.from, 'guild') || hasBuilt(st, q, 'guild'))) {
    st.used.guild = true;
    const bonus = {};
    for (const [who, got] of [
      [t.from, t.get],
      [q, t.give],
    ]) {
      const r = mostOf(got);
      if (!r || st.bank[r] <= 0) continue;
      st.bank[r]--;
      st.players[who].res[r]++;
      bonus[who] = r;
    }
    ev.push({ type: 'guildBonus', from: t.from, to: q, bonus });
  }
};

H.cancelOffer = (st, a, ev) => {
  const t = st.trade;
  need(t && a.p === t.from, '沒有你的交易提議');
  st.trade = null;
  ev.push({ type: 'offerCancelled', p: a.p });
};

H.endTurn = (st, a, ev) => {
  const p = a.p;
  need(st.phase === 'play', '現在不能結束回合');
  need(p === st.current, '還沒輪到你');
  need(st.rolled, '請先擲骰');
  need(!st.pending, pendingMsg(st.pending));
  if (st.trade) {
    st.trade = null;
    ev.push({ type: 'offerCancelled', p });
  }
  // (the counting house) a card of the player's choice for a full hand at the turn's end
  if (developOn(st) && hasBuilt(st, p, 'countingHouse') && !st.used.countingHouse && handSize(st.players[p].res) >= COUNTING_MIN) bonusCard(st, p, a.bonus, 'countingHouse', ev);
  ev.push({ type: 'turnEnd', p, turn: st.turn });
  if (developOn(st)) {
    st.devPlays = 0;
    st.knightPlayed = false;
  }
  const n = st.players.length;
  const mode = st.rules && st.rules.turns;
  if ((mode === 'paired' || mode === 'sbp') && !st.sub) {
    // the main player is done: the second player, or everyone else in turn, follows
    const lead = st.current;
    const queue = mode === 'paired' ? [(lead + 3) % n] : Array.from({ length: n - 1 }, (_, i) => (lead + 1 + i) % n);
    st.sub = { k: mode === 'paired' ? 'pair' : 'sbp', lead, rest: queue.slice(1) };
    st.current = queue[0];
    st.devPlayed = false;
    // (Seafarers) the second player may move a ship of their own too
    if (seafarers(st)) st.shipMoved = false;
    ev.push({ type: 'turnStart', p: st.current, turn: st.turn, sub: st.sub.k, lead });
    return;
  }
  if (st.sub && st.sub.rest.length) {
    st.current = st.sub.rest.shift();
    st.devPlayed = false;
    ev.push({ type: 'turnStart', p: st.current, turn: st.turn, sub: st.sub.k, lead: st.sub.lead });
    return;
  }
  const lead = st.sub ? st.sub.lead : st.current;
  if (st.sub) st.sub = null;
  st.current = (lead + 1) % n;
  st.turn++;
  if (seafarers(st)) {
    st.newShips = [];
    st.shipMoved = false;
  }
  st.rolled = false;
  st.dice = null;
  st.devPlayed = false;
  ev.push({ type: 'turnStart', p: st.current, turn: st.turn });
  // (the development mode) a new turn: the once-a-turn things are back, and a wonder whose last stage
  // was paid is complete (before the dice: its owner may win now)
  if (developOn(st)) {
    st.used = {};
    for (const w of st.wonders) {
      if (w.p !== st.current || w.done || w.s < 3) continue;
      w.done = true;
      ev.push({ type: 'wonderDone', p: w.p, hex: w.h, k: w.k });
      // (the royal road: room for its free roads, 2026-11-18)
      if (w.k === 'royalRoad') st.players[w.p].pieces.roads += ROYAL_ROADS;
    }
  }
};

// ── the development mode (develop.js) ──

// p's free road this turn (a complete royal road)
export const freeRoad = (st, p) => developOn(st) && wonderDone(st, p, 'royalRoad') && !st.used.road;

// a development on hex `hex`, or its second level: an extra card of resource `res` each time it
// produces (one card cheaper when res is the hex's own)
H.develop = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  need(developOn(st), '這個模式不能開發地塊');
  requireMainTurn(st, p);
  const h = a.hex;
  need(Number.isInteger(h) && h >= 0 && h < GEO.hexes.length, '無效的地形');
  need(RES.includes(a.res), '請選擇一種資源');
  const why = plotWhy(st, p, h);
  need(!why, why);
  const cost = plotCost(st, h, a.res);
  const plan = buildPlan(st, p, cost, 'develop', a);
  need(plan, '資源不足');
  const paid = payPlan(st, p, plan);
  if (st.plots[h]) st.plots[h].r.push(a.res);
  else st.plots[h] = { p, r: [a.res] };
  ev.push({ type: 'develop', p, hex: h, res: a.res, level: st.plots[h].r.length, cost: { ...plan.cost }, ...(paid.smith ? { smith: paid.smith } : {}) });
};

// a special building of p's blueprint beside p's settlement at `vertex` (res: the shipyard's resource)
H.special = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  need(developOn(st), '這個模式沒有特殊建築');
  requireMainTurn(st, p);
  const k = a.k;
  need(isSpecial(k), '沒有這種建築');
  const v = a.vertex;
  need(Number.isInteger(v) && v >= 0 && v < GEO.vertices.length, '無效的位置');
  const why = specialWhy(st, p, k) || hostWhy(st, p, k, v);
  need(!why, why);
  if (k === 'shipyard') need(RES.includes(a.res), '請選擇造船廠的資源');
  const plan = buildPlan(st, p, BUILDINGS[k].cost, 'special', a);
  need(plan, '資源不足');
  const paid = payPlan(st, p, plan);
  pl.built[k] = v;
  if (k === 'shipyard') pl.yard = a.res;
  // (the road bureau, the new town: more pieces)
  if (k === 'roadworks') pl.pieces.roads += ROADWORKS_ROADS;
  if (k === 'newTown') {
    pl.pieces.settlements += NEW_TOWN_PIECES;
    pl.pieces.cities += NEW_TOWN_PIECES;
  }
  if (k === 'warehouse') pl.store = pl.store || emptyRes();
  // (the lecture hall, built after the turn's first card: the second may follow)
  if (k === 'lectureHall' && st.devPlayed && (st.devPlays || 0) < 2) st.devPlayed = false;
  ev.push({ type: 'special', p, k, vertex: v, ...(k === 'shipyard' ? { res: a.res } : {}), ...paid });
};

// a stage of p's wonder: the first one on desert `hex` (which locks that wonder for everyone else),
// the next ones on later turns of p's; complete at the start of p's turn after the third
H.wonder = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  need(developOn(st), '這個模式沒有世界奇觀');
  requireMainTurn(st, p);
  const h = a.hex;
  need(Number.isInteger(h) && h >= 0 && h < GEO.hexes.length, '無效的地形');
  const why = wonderWhy(st, p, h);
  need(!why, why);
  const k = bpWonder(st, p);
  let w = wonderOf(st, p);
  const plan = buildPlan(st, p, BUILDINGS[k].stages[w ? w.s : 0], 'wonder', a);
  need(plan, '資源不足');
  const paid = payPlan(st, p, plan);
  if (w) {
    w.s++;
    w.t = st.turn;
  } else {
    w = { h, k, p, s: 1, t: st.turn, done: false };
    st.wonders.push(w);
    // (begun over the ruins of another: they are cleared away)
    if (st.ruins && st.ruins.some((r) => r.h === h)) st.ruins = st.ruins.filter((r) => r.h !== h);
  }
  ev.push({ type: 'wonder', p, k, hex: h, stage: w.s, ...paid });
};

// the market: two of a kind for one of any other from the bank, once a turn
H.market = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  requireMainTurn(st, p);
  need(developOn(st) && hasBuilt(st, p, 'market'), '你沒有市集');
  need(!st.used.market, '市集每回合只能用一次');
  need(RES.includes(a.give) && RES.includes(a.get), '無效的交易');
  need(a.give !== a.get, '不能用相同的資源交換');
  need(pl.res[a.give] >= 2, '需要 {n} 張相同資源', { n: 2 });
  need(st.bank[a.get] > 0, '銀行已沒有這種資源');
  pl.res[a.give] -= 2;
  st.bank[a.give] += 2;
  pl.res[a.get]++;
  st.bank[a.get]--;
  st.used.market = true;
  ev.push({ type: 'market', p, give: a.give, get: a.get });
};

// (the caravanserai) two different resources (CARAVAN_GIVE) for one of any kind from the bank, as often as liked
H.caravan = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  requireMainTurn(st, p);
  need(developOn(st) && hasBuilt(st, p, 'caravan'), '你沒有商隊旅館');
  const give = a.give;
  need(Array.isArray(give) && give.length === CARAVAN_GIVE && new Set(give).size === CARAVAN_GIVE && give.every((r) => RES.includes(r)), '請選 {n} 張不同的資源', { n: CARAVAN_GIVE });
  need(RES.includes(a.get), '請選擇要換的資源');
  for (const r of give) need(pl.res[r] >= 1, '你沒有那種資源');
  need(st.bank[a.get] > 0, '銀行已沒有這種資源');
  for (const r of give) {
    pl.res[r]--;
    st.bank[r]++;
  }
  pl.res[a.get]++;
  st.bank[a.get]--;
  ev.push({ type: 'caravan', p, give: give.slice(), get: a.get });
};

// (the warehouse) cards put away (`put`: after the roll, up to three in all) or taken back (`take`:
// any time in the player's own turn). Put away they are out of the hand: no thief, no 7, no monopoly
// reaches them.
H.warehouse = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  need(developOn(st) && hasBuilt(st, p, 'warehouse'), '你沒有貨棧');
  const put = a.put || {};
  const take = a.take || {};
  need(validResMap(put) && validResMap(take), '無效的動作');
  requireMainTurn(st, p, { needRoll: mapTotal(put) > 0 });
  pl.store = pl.store || emptyRes();
  for (const r of RES) need(pl.res[r] >= (put[r] || 0), '你沒有那麼多張牌');
  for (const r of RES) need(pl.store[r] >= (take[r] || 0), '貨棧裡沒有那麼多張牌');
  need(handSize(pl.store) + mapTotal(put) - mapTotal(take) <= STORE_MAX, '貨棧最多存 {n} 張', { n: STORE_MAX });
  need(mapTotal(put) + mapTotal(take) > 0, '請選擇要存或要拿的牌');
  for (const r of RES) {
    pl.res[r] += (take[r] || 0) - (put[r] || 0);
    pl.store[r] += (put[r] || 0) - (take[r] || 0);
  }
  ev.push({ type: 'warehouse', p, put: mapTotal(put), take: mapTotal(take), stored: handSize(pl.store) });
};

export const ACTION_TYPES = Object.keys(H);

export function applyAction(st, action) {
  ensureMap(st);
  if (!action || !H[action.type]) throw new RuleError('未知的動作');
  if (st.phase === 'over') throw new RuleError('遊戲已結束');
  if (!Number.isInteger(action.p) || !st.players[action.p]) throw new RuleError('無效的玩家');
  const ev = [];
  H[action.type](st, action, ev);
  st.seq++;
  // A player wins on their own turn. A paired turn belongs to both its players (the main player
  // first when both have reached the target); the special building phase is nobody's turn.
  if (st.phase === 'play' && st.winner < 0 && !inSub(st, 'sbp')) {
    const turnOf = inSub(st, 'pair') ? [st.sub.lead, st.current] : [st.current];
    const w = turnOf.find((q) => totalVP(st, q) >= st.targetVP);
    if (w !== undefined) {
      st.winner = w;
      st.phase = 'over';
      st.pending = null;
      st.trade = null;
      ev.push({ type: 'gameOver', winner: w, vp: totalVP(st, w) });
    }
  }
  return ev;
}

export function isLegal(st, action) {
  try {
    applyAction(cloneState(st), action);
    return true;
  } catch (e) {
    if (e instanceof RuleError) return false;
    throw e;
  }
}

// ───────────────────────── redacted views ─────────────────────────

// A view is the state as one seat may see it: other players' hands become counts,
// the dev deck becomes a count, and the rng is removed. UI and AI work on views only.
export function makeView(st, viewer) {
  ensureMap(st);
  const over = st.phase === 'over';
  const view = { ...st, viewer, rng: null, seed: over ? st.seed : null, devDeck: null, devDeckCount: st.devDeck.length, diceDeck: null };
  // (the development mode) the cards that go back into the deck when it runs out: only how many
  if (st.devDiscard) {
    view.devDiscard = null;
    view.devDiscardCount = st.devDiscard.length;
  }
  view.players = st.players.map((pl) => {
    const mine = pl.id === viewer || over;
    const base = {
      ...pl,
      resCount: handSize(pl.res),
      devCount: pl.dev.length,
      pieces: { ...pl.pieces },
      played: { ...pl.played },
    };
    if (pl.store) base.storeCount = handSize(pl.store);
    if (mine) {
      base.res = { ...pl.res };
      base.dev = pl.dev.map((c) => ({ ...c }));
      if (pl.store) base.store = { ...pl.store };
    } else {
      base.res = null;
      base.dev = null;
      // (the development mode, the academy) the two cards drawn are the player's secret; so are the
      // cards in a warehouse
      if (pl.pick) base.pick = null;
      if (pl.store) base.store = null;
    }
    return base;
  });
  view.board = st.board;
  view.vertices = st.vertices;
  view.edges = st.edges;
  view.bank = { ...st.bank };
  return view;
}

export function redactEvent(e, viewer) {
  if (e.type === 'buyDev' && e.p !== viewer) return { ...e, card: null };
  if (e.type === 'devDraw' && e.p !== viewer) return { ...e, cards: null };
  if (e.type === 'steal' && e.p !== viewer && e.from !== viewer) return { ...e, res: null };
  if (e.type === 'toll' && e.p !== viewer && e.from !== viewer) return { ...e, res: null };
  return e;
}
