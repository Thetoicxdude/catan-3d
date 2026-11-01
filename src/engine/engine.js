// Catan base-game rules engine (2–4 players, and 5–6 with the extension's turn rules), following the
// 5th-edition rulebook & almanac.
// Pure & deterministic: state is plain JSON; all randomness comes from the seeded rng in state.
// applyAction(state, action) validates, then mutates state and returns a list of events.
// Illegal actions throw RuleError (with a Traditional Chinese message) and leave state untouched.

import { GEO, useMap } from './geometry.js';
import { generateBoard, RES, TERRAIN_RES, pips, provinceName } from './board.js';
import { mapDef, DEFAULT_MAP } from './maps.js';
import { rngInt, shuffle, seedState } from './rng.js';
import { seaInfo, roadEdge, shipEdge, shipLegal, legalShipEdges, movableShips, shipTargets, pirateVictims, pirateEdges, tradeRouteFor, SHIP_COST, SHIPS } from './seafarers.js';

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
  constructor(msg) {
    super(msg);
    this.name = 'RuleError';
  }
}
function need(cond, msg) {
  if (!cond) throw new RuleError(msg);
}

const emptyRes = () => ({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
export const handSize = (res) => res.wood + res.brick + res.wool + res.grain + res.ore;
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

// opts.map: the map's id (maps.js); the standard island when left out
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
  if (n < lo || n > hi) throw new RuleError(`這張地圖需要 ${lo}–${hi} 位玩家`);
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
    targetVP: def.vp || opts.targetVP || 10,
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
  if (mapDef(def.id) !== def) st.mapDef = def;
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
    if (def.fog) st.fog = { pool: Object.entries(def.fog.pool).flatMap(([t, c]) => new Array(c).fill(t)), numbers: def.fog.numbers.slice() };
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
  return best;
}
export function tradeRatios(st, p) {
  const r = {};
  for (const res of RES) r[res] = tradeRatio(st, p, res);
  return r;
}

export function robberVictims(st, hex, p) {
  const set = new Set();
  for (const v of GEO.hexes[hex].vertices) {
    const b = st.vertices[v];
    if (b && b.p !== p) set.add(b.p);
  }
  return [...set].filter((q) => playerHandSize(st, q) > 0).sort((a, b) => a - b);
}

export function playerHandSize(st, p) {
  const pl = st.players[p];
  if (pl.res) return handSize(pl.res);
  return pl.resCount || 0; // redacted view
}

export function playableDev(st, p) {
  // Dev card types this player could play right now (ignores the extra parameters).
  const pl = st.players[p];
  if (st.phase !== 'play' || st.current !== p || st.devPlayed || st.pending || st.trade || !pl.dev || inSub(st, 'sbp')) return [];
  const out = new Set();
  for (const c of pl.dev) {
    if (c.type === 'victoryPoint' || c.turn >= st.turn) continue;
    if (c.type === 'roadBuilding' && !canBuildPaths(st, p)) continue;
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
    if (st.board.robber === hex.id) {
      if (hex.vertices.some((v) => st.vertices[v])) blocked = hex.id;
      continue;
    }
    for (const v of hex.vertices) {
      const b = st.vertices[v];
      if (!b) continue;
      const amt = b.t === 'c' ? 2 : 1;
      owed[res] = owed[res] || {};
      owed[res][b.p] = (owed[res][b.p] || 0) + amt;
      claims.push({ hex: hex.id, vertex: v, p: b.p, res, amt });
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
function noSub(st, what) {
  need(!st.sub, st.sub && st.sub.k === 'pair' ? `第二位不能${what}` : `特別建造階段不能${what}`);
}
function pendingMsg(pd) {
  if (!pd) return '';
  if (pd.type === 'discard') return '等待玩家棄牌';
  if (pd.type === 'robber') return '請先移動強盜';
  if (pd.type === 'steal') return '請先選擇要搶奪的玩家';
  if (pd.type === 'roadBuilding') return '請先放置道路建設的道路';
  return '請先完成目前的動作';
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
  need(pl.pieces.settlements > 0, '村莊已經用完了（可先升級城市）');
  need(canAfford(pl.res, COSTS.settlement), '資源不足：村莊需要 木材、磚塊、羊毛、小麥 各 1');
  need(distanceOK(st, v), st.vertices[v] ? '這個路口已有建築' : '距離規則：相鄰的路口不能有建築');
  need(settlementLegal(st, p, v), seafarers(st) ? '村莊必須連接到你的道路或船' : '村莊必須連接到你的道路');
  pay(st, pl, COSTS.settlement);
  st.vertices[v] = { p, t: 's' };
  pl.pieces.settlements--;
  ev.push({ type: 'build', what: 'settlement', p, vertex: v });
  // Seafarers: a player's first settlement on each island beyond the home island(s) earns bonus points
  const bonus = seafarers(st) && GEO.def.isleBonus;
  if (bonus) {
    const sea = seaInfo(st.board);
    const isle = sea.vIsland[v];
    if (isle >= 0 && !homeIslands(st, p).includes(isle) && !pl.isles.includes(isle)) {
      pl.isles.push(isle);
      pl.chits += bonus;
      ev.push({ type: 'isleBonus', p, vertex: v, vp: bonus });
    }
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
  if (!free) {
    requireMainTurn(st, p);
    need(canAfford(pl.res, COSTS.road), '資源不足：道路需要 木材、磚塊 各 1');
  }
  need(pl.pieces.roads > 0, '道路已經用完了');
  need(st.edges[e] === -1, '這條路已有道路');
  need(roadLegal(st, p, e), '道路必須連接你的道路、村莊或城市');
  if (!free) pay(st, pl, COSTS.road);
  st.edges[e] = p;
  pl.pieces.roads--;
  ev.push({ type: 'build', what: 'road', p, edge: e, free });
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
  need(mapTotal(res) === want, `請選擇 ${want} 張資源`);
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
  need(b && b.p === p && b.t === 's', '城市只能由你自己的村莊升級');
  need(pl.pieces.cities > 0, '城市已經用完了');
  need(canAfford(pl.res, COSTS.city), '資源不足：城市需要 小麥 2、礦石 3');
  pay(st, pl, COSTS.city);
  b.t = 'c';
  pl.pieces.cities--;
  pl.pieces.settlements++;
  ev.push({ type: 'build', what: 'city', p, vertex: v });
};

H.buyDev = (st, a, ev) => {
  const p = a.p;
  const pl = st.players[p];
  requireMainTurn(st, p);
  need(st.devDeck.length > 0, '發展卡已經賣完了');
  need(canAfford(pl.res, COSTS.dev), '資源不足：發展卡需要 羊毛、小麥、礦石 各 1');
  pay(st, pl, COSTS.dev);
  const card = st.devDeck.pop();
  pl.dev.push({ type: card, turn: st.turn });
  ev.push({ type: 'buyDev', p, card, left: st.devDeck.length });
};

H.roll = (st, a, ev) => {
  const p = a.p;
  need(st.phase === 'play', '現在不能擲骰');
  need(p === st.current, '還沒輪到你');
  need(!st.rolled, '本回合已經擲過骰子');
  need(!st.pending, pendingMsg(st.pending));
  need(!st.trade, '請先處理目前的交易提議');
  const d1 = rngInt(st, 1, 6);
  const d2 = rngInt(st, 1, 6);
  const sum = d1 + d2;
  st.dice = [d1, d2];
  st.rolled = true;
  st.rolls[sum]++;
  ev.push({ type: 'roll', p, dice: [d1, d2], sum });
  if (sum === 7) {
    const amounts = {};
    for (const pl of st.players) {
      const t = handSize(pl.res);
      if (t > 7) amounts[pl.id] = Math.floor(t / 2);
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
};

H.discard = (st, a, ev) => {
  const p = a.p;
  need(st.pending && st.pending.type === 'discard', '現在不需要棄牌');
  const amt = st.pending.amounts[p];
  need(amt !== undefined, '你不需要棄牌');
  const cards = a.cards;
  need(validResMap(cards), '無效的棄牌');
  need(mapTotal(cards) === amt, `需要剛好棄掉 ${amt} 張牌`);
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
  const from = st.board.robber;
  st.board.robber = hex;
  ev.push({ type: 'robber', p, from, to: hex, reason: st.pending.reason });
  const victims = robberVictims(st, hex, p);
  if (victims.length === 0) st.pending = null;
  else if (victims.length === 1) {
    st.pending = null;
    stealFrom(st, p, victims[0], ev);
  } else st.pending = { type: 'steal', hex, victims };
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
  need(!st.devPlayed, '每回合只能使用一張發展卡');
  need(a.card !== 'victoryPoint', '分數卡不需要使用，會自動計分');
  const idx = pl.dev.findIndex((c) => c.type === a.card && c.turn < st.turn);
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
  st.devPlayed = true;
  pl.played[a.card]++;
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
  need(pl.res[a.give] >= ratio, `需要 ${ratio} 張相同資源`);
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
  noSub(st, '與其他玩家交易');
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
  ev.push({ type: 'turnEnd', p, turn: st.turn });
  const n = st.players.length;
  const mode = st.rules && st.rules.turns;
  if ((mode === 'paired' || mode === 'sbp') && !st.sub) {
    // the main player is done: the second player, or everyone else in turn, follows
    const lead = st.current;
    const queue = mode === 'paired' ? [(lead + 3) % n] : Array.from({ length: n - 1 }, (_, i) => (lead + 1 + i) % n);
    st.sub = { k: mode === 'paired' ? 'pair' : 'sbp', lead, rest: queue.slice(1) };
    st.current = queue[0];
    st.devPlayed = false;
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
  const view = { ...st, viewer, rng: null, seed: over ? st.seed : null, devDeck: null, devDeckCount: st.devDeck.length };
  view.players = st.players.map((pl) => {
    const mine = pl.id === viewer || over;
    const base = {
      ...pl,
      resCount: handSize(pl.res),
      devCount: pl.dev.length,
      pieces: { ...pl.pieces },
      played: { ...pl.played },
    };
    if (mine) {
      base.res = { ...pl.res };
      base.dev = pl.dev.map((c) => ({ ...c }));
    } else {
      base.res = null;
      base.dev = null;
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
  if (e.type === 'steal' && e.p !== viewer && e.from !== viewer) return { ...e, res: null };
  return e;
}
