// Heuristic computer opponent. Works only on a redacted view of the game
// (its own hand, public board, opponents' card counts) — the same information a person has.
// aiAct(view, p, mem, rnd) returns one action object, or null if it has nothing to do right now.

import { GEO } from '../engine/geometry.js';
import {
  RES,
  TERRAIN_RES,
  pips,
  COSTS,
  canAfford,
  missingFor,
  handSize,
  handLimit,
  legalSettlementSpots,
  legalRoadEdges,
  legalCitySpots,
  settlementLegal,
  roadLegal,
  tradeRatio,
  robberVictims,
  publicVP,
  playableDev,
  longestRoadFor,
  distanceOK,
  legalShips,
  seaInfo,
  pirateEdges,
  homeIslands,
  handLimitOf,
  freeRoad,
} from '../engine/engine.js';
import {
  developOn,
  robberSpots,
  plotSpots,
  plotCost,
  specialHosts,
  isSpecial,
  BUILDINGS,
  hasBuilt,
  bpWonder,
  wonderOf,
  wonderAt,
  wonderSpots,
  wonderDone,
  PRESETS,
  PRESET_IDS,
  slotsAt,
  hasBasic,
  payFor,
  MOST_OF,
  MOST_MIN,
  specialCount,
  funcVP,
  scoring,
  GUILD_HALL_PER,
  STORE_MAX,
  COUNTING_MIN,
  ALMS_MAX,
  TERRACE_NUMBERS,
  isNeutral,
  CARAVAN_GIVE,
} from '../engine/develop.js';

const LEVELS = {
  easy: { noise: 0.9, domestic: false, smartRobber: false, monopolyMin: 4 },
  normal: { noise: 0.2, domestic: true, smartRobber: true, monopolyMin: 3 },
  hard: { noise: 0.03, domestic: true, smartRobber: true, monopolyMin: 3 },
};

// whether p's hand pays for a plan (the development mode: the smithy's ore for a card it lacks, the
// apprentice workshop's and the builders' yard's card left out; engine/develop.js payFor)
function canPay(view, p, pl) {
  const res = view.players[p].res;
  if (!developOn(view) || pl.kind === 'dev') return canAfford(res, pl.cost);
  const kind = pl.kind === 'special' ? 'special' : pl.kind === 'wonder' ? 'wonder' : pl.kind;
  return !!payFor(view, p, pl.cost, kind);
}

function boardScarcity(view) {
  const tot = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  for (const H of view.board.hexes) {
    const r = TERRAIN_RES[H.terrain];
    if (r) tot[r] += pips(H.number);
  }
  const avg = RES.reduce((s, r) => s + tot[r], 0) / 5;
  const sc = {};
  for (const r of RES) sc[r] = Math.max(0.75, Math.min(1.45, avg / Math.max(1, tot[r])));
  return sc;
}

export function production(view, p, { ignoreRobber = false } = {}) {
  const prod = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  view.vertices.forEach((b, v) => {
    if (!b || b.p !== p) return;
    for (const h of GEO.vertices[v].hexes) {
      const H = view.board.hexes[h];
      const r = TERRAIN_RES[H.terrain];
      if (!r) continue;
      if (!ignoreRobber && view.board.robber === h) continue;
      prod[r] += (pips(H.number) / 36) * (b.t === 'c' ? 2 : 1);
    }
  });
  return prod;
}

function resWeights(view, p, stage) {
  const sc = boardScarcity(view);
  const prod = production(view, p, { ignoreRobber: true });
  const base =
    stage === 'early'
      ? { wood: 1.15, brick: 1.15, wool: 0.85, grain: 1.0, ore: 0.85 }
      : { wood: 0.95, brick: 0.9, wool: 0.85, grain: 1.15, ore: 1.2 };
  const w = {};
  for (const r of RES) {
    const diminishing = 1 / (1 + prod[r] * 3.5);
    w[r] = base[r] * sc[r] * (0.55 + 0.45 * diminishing * 1.6);
  }
  return w;
}

function vertexScore(view, v, p, weights, opts = {}) {
  let score = 0;
  const kinds = new Set();
  for (const h of GEO.vertices[v].hexes) {
    const H = view.board.hexes[h];
    // (Seafarers) a gold field gives whatever is needed most
    const r = H.terrain === 'gold' ? 'gold' : TERRAIN_RES[H.terrain];
    if (!r) continue;
    let pp = pips(H.number);
    if (view.board.robber === h && !opts.ignoreRobber) pp *= 0.6;
    score += pp * (r === 'gold' ? Math.max(...RES.map((x) => weights[x])) * 1.1 : weights[r]);
    kinds.add(r);
  }
  score += kinds.size * 0.9;
  const hb = view.board.vertexHarbor[v];
  if (hb) {
    if (hb === 'any') score += 1.2;
    else {
      const prod = production(view, p, { ignoreRobber: true });
      let mine = prod[hb] * 36;
      for (const h of GEO.vertices[v].hexes) {
        const H = view.board.hexes[h];
        if (TERRAIN_RES[H.terrain] === hb) mine += pips(H.number);
      }
      score += mine >= 6 ? 2.2 : mine >= 3 ? 0.9 : 0.25;
    }
  }
  return score;
}

function stageOf(view, p) {
  const vp = publicVP(view, p);
  // (the first two-fifths of the way to the target: 4 of the standard 10)
  return vp <= Math.round((view.targetVP || 10) * 0.4) ? 'early' : 'late';
}

// ───────────────────────── setup ─────────────────────────

function setupSettlement(view, p, lvl, rnd) {
  const spots = legalSettlementSpots(view, p, true);
  const weights = resWeights(view, p, 'early');
  const prod = production(view, p, { ignoreRobber: true });
  const second = view.setup.i >= view.players.length;
  // (the development mode) a corner of a free desert, for the blueprint's wonder
  const site = developOn(view) ? wonderSite(view, p) : null;
  let best = spots[0];
  let bestScore = -Infinity;
  for (const v of spots) {
    let s = vertexScore(view, v, p, weights, { ignoreRobber: true });
    if (site && site(v)) s += 3.5;
    if (second) {
      // complement the first settlement; reward resources not yet produced
      for (const h of GEO.vertices[v].hexes) {
        const r = TERRAIN_RES[view.board.hexes[h].terrain];
        if (r && prod[r] < 0.01) s += 1.1;
      }
    }
    s += (rnd() - 0.5) * 2 * lvl.noise * 2;
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return { type: 'settlement', p, vertex: best };
}

function setupRoad(view, p, lvl, rnd) {
  const from = view.setup.last;
  // (Seafarers: a coastal settlement may get a ship instead; a road wherever there is land)
  const roads = new Set(legalRoadEdges(view, p));
  const edges = view.ships ? [...new Set([...roads, ...legalShips(view, p)])] : GEO.vertices[from].edges.filter((e) => view.edges[e] === -1);
  const weights = resWeights(view, p, 'early');
  let best = edges[0];
  let bestScore = -Infinity;
  for (const e of edges) {
    const [a, b] = GEO.edges[e].v;
    const w = a === from ? b : a;
    let s = 0;
    for (const n of GEO.vertices[w].neighbors) {
      if (n === from) continue;
      if (distanceOK(view, n)) s = Math.max(s, vertexScore(view, n, p, weights, { ignoreRobber: true }));
      for (const n2 of GEO.vertices[n].neighbors) {
        if (n2 === w) continue;
        if (distanceOK(view, n2)) s = Math.max(s, vertexScore(view, n2, p, weights, { ignoreRobber: true }) * 0.7);
      }
    }
    s += GEO.vertices[w].hexes.length * 0.4; // inland paths keep more options open
    s += (rnd() - 0.5) * lvl.noise * 2;
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  return { type: view.ships && !roads.has(best) ? 'ship' : 'road', p, edge: best };
}

// ───────────────────────── planning ─────────────────────────

// BFS over free paths from my network → settlement spots reachable with d new roads.
function reachableSpots(view, p, maxDepth = 3) {
  const sea = view.ships ? seaInfo(view.board) : null;
  const startSet = new Set();
  view.vertices.forEach((b, v) => {
    if (b && b.p === p) startSet.add(v);
  });
  for (let e = 0; e < GEO.edges.length; e++) {
    if (view.edges[e] !== p) continue;
    for (const v of GEO.edges[e].v) {
      const b = view.vertices[v];
      if (!b || b.p === p) startSet.add(v);
    }
  }
  const dist = new Map();
  const firstEdge = new Map();
  const queue = [];
  for (const v of startSet) {
    dist.set(v, 0);
    queue.push(v);
  }
  while (queue.length) {
    const v = queue.shift();
    const d = dist.get(v);
    if (d >= maxDepth) continue;
    const b = view.vertices[v];
    if (b && b.p !== p) continue;
    for (const e of GEO.vertices[v].edges) {
      if (view.edges[e] !== -1) continue;
      if (sea && (view.ships[e] !== -1 || !sea.eLand[e])) continue;
      const [a, c] = GEO.edges[e].v;
      const w = a === v ? c : a;
      if (dist.has(w)) continue;
      const wb = view.vertices[w];
      if (wb && wb.p !== p) continue;
      dist.set(w, d + 1);
      firstEdge.set(w, d === 0 ? e : firstEdge.get(v));
      queue.push(w);
    }
  }
  const out = [];
  for (const [v, d] of dist) {
    if (d === 0) continue;
    if (!distanceOK(view, v)) continue;
    out.push({ v, d, edge: firstEdge.get(v) });
  }
  return out;
}

// (Seafarers) BFS by sea from my coastal buildings and the ends of my ships: coastal spots a ship
// route could reach with d more ships, and the first ship to build toward each.
function seaSpots(view, p, maxDepth = 6) {
  const sea = seaInfo(view.board);
  const blocked = new Set(pirateEdges(view));
  const dist = new Map();
  const first = new Map();
  const queue = [];
  const start = (v) => {
    if (dist.has(v)) return;
    dist.set(v, 0);
    queue.push(v);
  };
  view.vertices.forEach((b, v) => b && b.p === p && sea.coast[v] && start(v));
  for (let e = 0; e < GEO.edges.length; e++) {
    if (view.ships[e] !== p) continue;
    for (const v of GEO.edges[e].v) if (!view.vertices[v] || view.vertices[v].p === p) start(v);
  }
  while (queue.length) {
    const v = queue.shift();
    const d = dist.get(v);
    if (d >= maxDepth) continue;
    const b = view.vertices[v];
    if (b && b.p !== p) continue;
    for (const e of GEO.vertices[v].edges) {
      if (view.edges[e] !== -1 || view.ships[e] !== -1 || !sea.eSea[e] || blocked.has(e)) continue;
      const [a, c] = GEO.edges[e].v;
      const w = a === v ? c : a;
      if (dist.has(w)) continue;
      const wb = view.vertices[w];
      if (wb && wb.p !== p) continue;
      dist.set(w, d + 1);
      first.set(w, d === 0 ? e : first.get(v));
      queue.push(w);
    }
  }
  const out = [];
  const home = homeIslands(view, p);
  // (the fog islands) intersections beside hidden hexes, where a ship discovers them
  out.fog = [];
  const hidden = view.board.hexes.map((h) => h.terrain === 'fog');
  for (const [v, d] of dist) {
    if (d === 0) continue;
    const n = GEO.vertices[v].hexes.filter((h) => hidden[h]).length;
    if (n) out.fog.push({ v, d, edge: first.get(v), n });
  }
  for (const [v, d] of dist) {
    if (d === 0 || !sea.vLand[v] || !distanceOK(view, v)) continue;
    const isle = sea.vIsland[v];
    out.push({ v, d, edge: first.get(v), newIsle: isle >= 0 && !home.includes(isle) && !(view.players[p].isles || []).includes(isle) });
  }
  return out;
}

function roadLengthWith(view, p, e) {
  const edges = view.edges.slice();
  edges[e] = p;
  return longestRoadFor({ ...view, edges }, p);
}

function hnoise(a, b, c) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function buildPlans(view, p, lvl) {
  const me = view.players[p];
  const stage = stageOf(view, p);
  const weights = resWeights(view, p, stage);
  const plans = [];
  // Stable within a turn so the AI doesn't flip-flop between goals (and trades) mid-turn.
  let key = 0;
  const noise = (k = key) => (hnoise(view.turn + 7, p + 3, k) - 0.5) * 2 * lvl.noise;

  // (the development mode: a basic card left out of the blueprint is never paid for)
  const card = (k) => hasBasic(view, p, k);
  if (me.pieces.cities > 0 && card('city')) {
    for (const v of legalCitySpots(view, p)) {
      let pv = 0;
      for (const h of GEO.vertices[v].hexes) {
        const H = view.board.hexes[h];
        const r = TERRAIN_RES[H.terrain];
        if (r) pv += pips(H.number) * weights[r] * (view.board.robber === h ? 0.6 : 1);
      }
      plans.push({ kind: 'city', vertex: v, cost: COSTS.city, value: 1.25 + pv * 0.09 + (stage === 'late' ? 0.35 : 0) + noise(1000 + v) });
    }
  }
  if (me.pieces.settlements > 0 && card('settlement')) {
    const site = developOn(view) ? wonderSite(view, p) : null;
    // (the development mode, 2026-11-18) a harbor office wants a second and third harbor; a governor's
    // house and a new town want settlements
    const harbors = developOn(view) && me.bp.includes('harborOffice') && MOST_OF.harborOffice(view, p) < MOST_MIN.harborOffice ? 0.55 : 0;
    const towns = developOn(view) ? (me.bp.includes('governor') ? 0.2 : 0) + (me.bp.includes('newTown') && !hasBuilt(view, p, 'newTown') ? 0.12 : 0) : 0;
    for (const v of legalSettlementSpots(view, p)) {
      plans.push({
        kind: 'settlement',
        vertex: v,
        cost: COSTS.settlement,
        value: 1.3 + vertexScore(view, v, p, weights) * 0.085 + (site && site(v) ? 0.8 : 0) + (harbors && view.board.vertexHarbor[v] ? harbors : 0) + towns + noise(2000 + v),
      });
    }
  }
  // (the development mode: the royal road's free road)
  const roadCost = freeRoad(view, p) ? {} : COSTS.road;
  if (me.pieces.roads > 0 && (card('road') || freeRoad(view, p))) {
    // roads toward future settlement spots
    if (me.pieces.settlements > 0) {
      const reach = reachableSpots(view, p, 3).filter((s) => s.d >= 1);
      const byEdge = new Map();
      for (const s of reach) {
        if (s.edge === undefined || !roadLegal(view, p, s.edge)) continue;
        const val = (1.3 + vertexScore(view, s.v, p, weights) * 0.085) * Math.pow(0.52, s.d) * 1.15;
        if (!byEdge.has(s.edge) || byEdge.get(s.edge) < val) byEdge.set(s.edge, val);
      }
      for (const [e, val] of byEdge) plans.push({ kind: 'road', edge: e, cost: roadCost, value: val + noise(3000 + e) * 0.5 });
    }
    // longest road grab
    const holder = view.longestRoad;
    const holderLen = holder >= 0 ? view.roadLen[holder] : 4;
    const myLen = view.roadLen[p];
    if (holder !== p && myLen + 2 > holderLen && myLen >= 3) {
      for (const e of legalRoadEdges(view, p)) {
        const nl = roadLengthWith(view, p, e);
        if (nl > myLen) {
          const takes = nl > holderLen && nl >= 5;
          const val = takes ? 2.1 : nl > myLen && nl + 1 > holderLen ? 0.7 : 0.25;
          plans.push({ kind: 'road', edge: e, cost: roadCost, value: val + noise(5000 + e) * 0.4, lr: takes });
        }
      }
    }
  }
  // (Seafarers) ships toward coasts worth settling, above all new islands (bonus points)
  if (view.ships && me.pieces.ships > 0 && me.pieces.settlements > 0) {
    const legal = new Set(legalShips(view, p));
    const bonus = GEO.def.isleBonus || 0;
    const byEdge = new Map();
    const spots = seaSpots(view, p);
    for (const s of spots) {
      if (s.edge === undefined || !legal.has(s.edge)) continue;
      const val = (1.3 + vertexScore(view, s.v, p, weights) * 0.085 + (s.newIsle ? 0.45 * bonus : 0)) * Math.pow(0.62, s.d) * 1.15;
      if (!byEdge.has(s.edge) || byEdge.get(s.edge) < val) byEdge.set(s.edge, val);
    }
    // (the fog islands) sail into the fog: a resource now, and land to settle later
    for (const f of spots.fog) {
      if (f.edge === undefined || !legal.has(f.edge)) continue;
      const val = (1.35 + 0.35 * f.n) * Math.pow(0.82, f.d - 1) * (stage === 'late' ? 0.85 : 1);
      if (!byEdge.has(f.edge) || byEdge.get(f.edge) < val) byEdge.set(f.edge, val);
    }
    for (const [e, val] of byEdge) plans.push({ kind: 'ship', edge: e, cost: COSTS.ship, value: val + noise(6000 + e) * 0.5 });
  }
  if (view.devDeckCount > 0) {
    let dv = 0.95 + (stage === 'late' ? 0.25 : 0);
    const la = view.largestArmy;
    const laSize = la >= 0 ? view.players[la].knights : 2;
    if (la !== p && me.knights + 1 >= laSize) dv += 0.25;
    if (developOn(view)) {
      // a knight in hand guards a wonder; the adventurers' guild wants the army
      const guard = guardsWonder(view, p) && !me.dev.some((c) => c.type === 'knight');
      if (guard) dv += 0.8;
      if (me.bp.includes('adventurers') && la !== p) dv += 0.15;
      const how = hasBuilt(view, p, 'barracks') && (guard || (la !== p && me.knights + 1 >= laSize)) ? 'knight' : hasBuilt(view, p, 'academy') ? 'pick' : undefined;
      // the great library: a card for one resource, the one held most
      if (wonderDone(view, p, 'library') && !view.used.library) {
        const r = RES.slice().sort((a, b) => me.res[b] - me.res[a])[0];
        if (me.res[r] > 0) plans.push({ kind: 'dev', cost: { [r]: 1 }, lib: r, how, value: dv + 0.45 + noise(4001) });
      }
      if (card('dev')) plans.push({ kind: 'dev', cost: COSTS.dev, how, value: dv + noise(4000) });
    } else plans.push({ kind: 'dev', cost: COSTS.dev, value: dv + noise(4000) });
  }
  if (developOn(view)) developPlans(view, p, lvl, weights, stage, noise, plans);
  plans.sort((a, b) => b.value - a.value);
  key = 0;
  return plans;
}

// ── the development mode ──

// p's wonder needs a knight in hand to save it from the robber: complete, or two stages paid
function guardsWonder(view, p) {
  const w = wonderOf(view, p);
  return !!w && (w.done || w.s >= 2);
}

// (the development mode) where p's wonder could go: a test for settlement spots on the corner of a
// free desert, while p's blueprint has a wonder nobody has begun and p has no settlement on such a
// desert yet (null when there is nothing to look for)
function wonderSite(view, p) {
  const k = bpWonder(view, p);
  if (!k || wonderOf(view, p) || view.wonders.some((w) => w.k === k)) return null;
  const free = GEO.hexes.filter((h) => view.board.hexes[h.id].terrain === 'desert' && !wonderAt(view, h.id)).map((h) => h.id);
  if (free.some((h) => GEO.hexes[h].vertices.some((v) => view.vertices[v] && view.vertices[v].p === p))) return null;
  return (v) => GEO.vertices[v].hexes.some((h) => free.includes(h));
}

// what a special building is worth to p now (1 point for a functional one, the rest for its effect)
function specialValue(view, p, k, v, weights, stage) {
  const me = view.players[p];
  const late = stage === 'late';
  const prod = production(view, p, { ignoreRobber: true });
  const la = view.largestArmy;
  const laSize = la >= 0 ? view.players[la].knights : 2;
  const lr = view.longestRoad;
  const lrLen = lr >= 0 ? view.roadLen[lr] : 4;
  switch (k) {
    case 'adventurers':
      return la === p ? 3.2 : me.knights >= laSize ? 1.4 : 0.35;
    case 'post':
      return lr === p ? 3.2 : view.roadLen[p] >= lrLen ? 1.4 : 0.35;
    case 'aqueduct':
      return 1.2;
    case 'granary':
      return 1.2 + (handSize(me.res) > 7 ? 0.2 : 0);
    case 'market':
      return 1.3;
    case 'shipyard':
      return 1.15 + Math.min(0.5, prod[yardRes(view, p)] * 36 * 0.06);
    case 'guild':
      return 1.15 + (stage === 'early' ? 0.1 : 0);
    case 'barracks':
      return 1.2 + (me.bp.includes('adventurers') || guardsWonder(view, p) ? 0.15 : 0);
    case 'wall': {
      let pp = 0;
      for (const h of GEO.vertices[v].hexes) pp += pips(view.board.hexes[h].number);
      return 1.1 + pp * 0.03 * (view.vertices[v].t === 'c' ? 1.5 : 1);
    }
    case 'mercenaries':
      return 1.2;
    case 'camp':
      return 1.05 + Math.min(0.5, me.pieces.settlements * 0.1) * (late ? 0.5 : 1);
    case 'academy':
      return 1.25;
    case 'press':
      return 1.15;
    // ── 2026-11-18 ──
    case 'grange':
    case 'harborOffice':
    case 'governor':
    case 'university':
      return mostValue(view, p, k);
    case 'farmstead': {
      // (the second-level developments beside its city go to a third)
      let n = 0;
      for (const h of GEO.vertices[v].hexes) if (view.plots[h] && view.plots[h].p === p) n += view.plots[h].r.length >= 2 ? 1 : 0.4;
      return 1.05 + Math.min(0.6, n * 0.3);
    }
    case 'homestead':
      return 1.0 + (late ? 0 : 0.15);
    case 'caravan':
      return 1.2;
    case 'roadworks':
      return 1.0 + (me.pieces.roads <= 3 ? 0.35 : 0);
    case 'newTown':
      return 1.0 + (me.pieces.settlements <= 1 ? 0.35 : 0) + (me.pieces.cities <= 1 ? 0.3 : 0);
    case 'townHall': {
      const waiting = me.bp.filter((x) => isSpecial(x) && x !== k && !hasBuilt(view, p, x)).length;
      return 1.05 + Math.min(0.4, waiting * 0.13);
    }
    case 'lectureHall':
      return 1.05 + (me.dev.length >= 2 ? 0.2 : 0);
    case 'scriptorium':
      return 1.1 + Math.min(0.4, me.pieces.cities * 0.1) * (late ? 0.6 : 1);
    case 'warehouse':
      return 1.0 + (handSize(me.res) > handLimitOf(view, p) - 2 ? 0.2 : 0);
    case 'countingHouse':
      return 1.05 + (handSize(me.res) >= COUNTING_MIN - 1 ? 0.15 : 0);
    case 'almshouse':
      return 1.0;
    case 'smithy':
      return 1.1 + Math.min(0.25, prod.ore * 1.2);
    case 'terraces': {
      let n = 0;
      view.vertices.forEach((b, u) => {
        if (b && b.p === p) for (const h of GEO.vertices[u].hexes) if (TERRACE_NUMBERS.includes(view.board.hexes[h].number) && TERRAIN_RES[view.board.hexes[h].terrain]) n += b.t === 'c' ? 2 : 1;
      });
      return 1.0 + Math.min(0.4, n * 0.12);
    }
    case 'observatory':
      return 1.05 + Math.min(0.15, prod.wool);
    case 'watchtower':
    case 'temple':
      return 1.05;
    case 'builders':
      return 1.0 + (bpWonder(view, p) && !(wonderOf(view, p) || {}).done ? 0.35 : 0);
    case 'garrison':
      return 1.0 + (bpWonder(view, p) ? 0.25 : 0);
    case 'workshop': {
      const waiting = me.bp.filter((x) => isSpecial(x) && x !== k && !hasBuilt(view, p, x)).length;
      return 1.0 + Math.min(0.35, waiting * 0.12);
    }
    case 'guildHall': {
      // its point the moment it stands, and the ones the blueprint's other buildings will bring
      const now = Math.floor((specialCount(view, p) + 1) / GUILD_HALL_PER);
      const all = Math.floor(me.bp.filter(isSpecial).length / GUILD_HALL_PER);
      return 0.45 + now * 1.0 + (all - now) * 0.35;
    }
    case 'monument':
      return late ? 2.15 : 1.7;
    default:
      return 1;
  }
}

// (a scoring building of 2026-11-18) +3 while p has the most of what it counts: worth that much when p
// has it already, a part of it when p is close
function mostValue(view, p, k) {
  const f = MOST_OF[k];
  const mine = f(view, p);
  const other = Math.max(0, ...view.players.filter((o) => o.id !== p).map((o) => f(view, o.id)));
  const need = Math.max(MOST_MIN[k], other);
  if (mine >= need) return 3.1;
  if (mine + 1 >= need) return 1.35;
  if (mine + 2 >= need) return 0.7;
  return 0.3;
}

// the shipyard's resource: the one p produces most
function yardRes(view, p) {
  const prod = production(view, p, { ignoreRobber: true });
  return RES.slice().sort((a, b) => prod[b] - prod[a])[0];
}

// where k goes among its hosts: the wall beside the settlement that produces most; anything else
// beside a city with room when there is one (a village keeps its one place free)
function bestHost(view, p, k, hosts) {
  const score = (v) => {
    let pp = 0;
    for (const h of GEO.vertices[v].hexes) pp += pips(view.board.hexes[h].number);
    const b = view.vertices[v];
    if (k === 'wall') return pp * (b.t === 'c' ? 2 : 1);
    return (b.t === 'c' ? 10 : 0) + slotsAt(view, v);
  };
  return hosts.slice().sort((a, b) => score(b) - score(a) || a - b)[0];
}

function developPlans(view, p, lvl, weights, stage, noise, plans) {
  const me = view.players[p];
  const late = stage === 'late';
  const gardens = me.bp.includes('gardens') ? (wonderDone(view, p, 'gardens') ? 0.5 : 0.3) : 0;
  // (2026-11-18) the grange counts developments (and asks a second level first), the farmstead takes
  // them to a third level, the homestead lets them go along the roads
  const grange = me.bp.includes('grange') ? 0.2 : 0;
  const farm = me.bp.includes('farmstead') ? 0.15 : 0;
  // (an aqueduct waits for a development beside one of p's settlements)
  const aqueduct = me.bp.includes('aqueduct') && !hasBuilt(view, p, 'aqueduct') ? 0.1 : 0;
  // developments: the hex's own resource (cheaper) unless another is wanted much more
  for (const h of plotSpots(view, p)) {
    const H = view.board.hexes[h];
    const pp = pips(H.number);
    if (pp < 2) continue;
    const local = TERRAIN_RES[H.terrain];
    let r = local;
    for (const x of RES) if (weights[x] > weights[r] * 1.35) r = x;
    const cost = plotCost(view, h, r);
    const level = view.plots[h] ? view.plots[h].r.length : 0;
    const more = grange + (level >= 1 ? farm : 0) + (grange && level === 1 && !hasBuilt(view, p, 'grange') ? 0.15 : 0);
    const value = 0.3 + pp * weights[r] * 0.105 * (late ? 0.75 : 1) + gardens + aqueduct + more + noise(7000 + h) * 0.5;
    plans.push({ kind: 'develop', hex: h, res: r, cost, value });
  }
  // the blueprint's special buildings
  me.bp.forEach((k, i) => {
    if (!isSpecial(k) || hasBuilt(view, p, k)) return;
    const hosts = specialHosts(view, p, k);
    if (!hosts.length) return;
    const v = bestHost(view, p, k, hosts);
    const plan = { kind: 'special', k, vertex: v, cost: BUILDINGS[k].cost, value: specialValue(view, p, k, v, weights, stage) + noise(8000 + i) * 0.6 };
    if (k === 'shipyard') plan.res = yardRes(view, p);
    plans.push(plan);
  });
  // the wonder: each stage worth more as it nears completion
  const k = bpWonder(view, p);
  if (k) {
    const w = wonderOf(view, p);
    for (const h of wonderSpots(view, p)) {
      const s = w ? w.s : 0;
      plans.push({ kind: 'wonder', hex: h, cost: BUILDINGS[k].stages[s], value: 2.9 + s * 0.35 + noise(9000 + h) * 0.6 });
    }
  }
}

// (the development mode) the market: two of a spare resource for one the cost lacks
function marketTradeFor(view, p, cost) {
  if (!hasBuilt(view, p, 'market') || view.used.market) return null;
  const me = view.players[p];
  const { missing } = missingFor(me.res, cost);
  const wants = Object.keys(missing).filter((r) => view.bank[r] > 0);
  if (!wants.length) return null;
  const give = RES.filter((g) => !missing[g] && me.res[g] - (cost[g] || 0) >= 2).sort((a, b) => me.res[b] - me.res[a])[0];
  if (!give) return null;
  wants.sort((a, b) => missing[b] - missing[a]);
  return { type: 'market', p, give, get: wants[0] };
}

// The blueprint a computer player brings: on easy any of the ten, otherwise the one that suits the
// land it will likely start on best. Each blueprint's fit is measured against its own spread over many
// starts (FIT_NORM: the deviation over 4000 seats of the 3- and 4-player islands, and the mean moved so
// that each is brought about as often on hard, 10%; 8–12% on normal), by the players whose land suits
// it most; `node tools/fitnorm.mjs` measures it again after a fit or a preset changes. (2026-11-19: the
// raw fits had the caravans' four kinds of land win 41% of the seats and the treasury none.)
const FIT_NORM = {
  farm: [8.86, 2.68],
  port: [7.43, 1.17],
  order: [7.32, 2.31],
  frontier: [8.98, 3.19],
  scholars: [8.04, 2.36],
  harvest: [6.74, 2.34],
  caravans: [11.31, 1.63],
  towns: [10.07, 1.91],
  lore: [7.72, 2.31],
  treasury: [8.62, 0.32],
};
export function chooseBlueprint(st, p, level = 'normal', rnd = Math.random) {
  if (level === 'easy') return PRESET_IDS[Math.floor(rnd() * PRESET_IDS.length)];
  const fit = blueprintFits(st, p);
  const noise = level === 'hard' ? 0.35 : 1;
  let pick = PRESET_IDS[0];
  let best = -Infinity;
  for (const k of PRESET_IDS) {
    const [mean, sd] = FIT_NORM[k];
    const z = (fit[k] - mean) / sd + rnd() * noise;
    if (z > best) {
      best = z;
      pick = k;
    }
  }
  return pick;
}

// How well each ready-made blueprint suits the land p will likely start on (the best intersections,
// drafted in the opening order), before it is set against the others (chooseBlueprint)
export function blueprintFits(st, p) {
  const flat = { wood: 1, brick: 1, wool: 1, grain: 1, ore: 1 };
  const view = { ...st, vertices: st.vertices.slice() };
  const score = GEO.vertices.map((v) => (v.hexes.length ? vertexScore(view, v.id, p, flat, { ignoreRobber: true }) : -1));
  const order = (st.setup && st.setup.order) || st.players.map((x) => x.id);
  const mine = [];
  for (const q of order) {
    let best = -1;
    for (let v = 0; v < score.length; v++) if (score[v] > 0 && distanceOK(view, v) && (best < 0 || score[v] > score[best])) best = v;
    if (best < 0) break;
    view.vertices[best] = { p: q, t: 's' };
    if (q === p) mine.push(best);
  }
  const prod = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  let harbor = 0;
  for (const v of mine) {
    for (const h of GEO.vertices[v].hexes) {
      const r = TERRAIN_RES[st.board.hexes[h].terrain];
      if (r) prod[r] += pips(st.board.hexes[h].number);
    }
    if (st.board.vertexHarbor[v]) harbor++;
  }
  const top = Math.max(...RES.map((r) => prod[r]));
  const kinds = RES.filter((r) => prod[r] > 0).length;
  const total = RES.reduce((n, r) => n + prod[r], 0);
  return {
    farm: prod.grain * 1.0 + prod.wood * 0.5 + prod.brick * 0.3,
    port: top * 0.9 + harbor * 4,
    order: prod.ore * 0.8 + prod.grain * 0.6 + prod.wool * 0.4,
    frontier: prod.wood * 0.9 + prod.brick * 0.9,
    scholars: prod.wool * 0.8 + prod.ore * 0.6 + prod.grain * 0.5,
    // (2026-11-18) cities on fields, many kinds inland, settlements everywhere, cards, a large hand
    harvest: prod.grain * 0.8 + prod.ore * 0.6 + prod.wool * 0.2,
    caravans: kinds * 2.2 + prod.ore * 0.3,
    towns: prod.wood * 0.7 + prod.brick * 0.7 + prod.grain * 0.35 + prod.wool * 0.35,
    lore: prod.wool * 0.75 + prod.ore * 0.65 + prod.grain * 0.45,
    treasury: total * 0.38,
  };
}

function bankTradeFor(view, p, cost, protect = null) {
  // One bank/harbor trade that reduces what is missing for `cost`, never giving away what cost needs.
  const me = view.players[p];
  const { missing } = missingFor(me.res, cost);
  const wants = Object.keys(missing).filter((r) => view.bank[r] > 0);
  if (!wants.length) return null;
  let best = null;
  for (const g of RES) {
    if (missing[g]) continue;
    const ratio = tradeRatio(view, p, g);
    const keep = (cost[g] || 0) + (protect ? protect[g] || 0 : 0);
    const spare = me.res[g] - keep;
    if (spare >= ratio) {
      const score = spare - ratio * 0.9;
      if (!best || score > best.score) best = { give: g, score };
    }
  }
  if (!best) return null;
  // ask for the most-missing resource
  wants.sort((a, b) => missing[b] - missing[a]);
  return { type: 'bankTrade', p, give: best.give, get: wants[0] };
}

function totalTradeable(view, p, cost) {
  // can bank trades alone cover the missing cards?
  const me = view.players[p];
  const { missing, count } = missingFor(me.res, cost);
  if (!count) return true;
  let canGet = 0;
  for (const g of RES) {
    if (missing[g]) continue;
    const spare = me.res[g] - (cost[g] || 0);
    if (spare > 0) canGet += Math.floor(spare / tradeRatio(view, p, g));
  }
  for (const r of Object.keys(missing)) if (view.bank[r] < missing[r]) return false;
  return canGet >= count;
}

function handPotential(view, p, res) {
  // Lower is better: how many cards away is each main goal?
  const me = view.players[p];
  const goals = [];
  if (me.pieces.cities > 0 && legalCitySpots(view, p).length) goals.push(COSTS.city);
  if (me.pieces.settlements > 0 && (legalSettlementSpots(view, p).length || reachableSpots(view, p, 2).length)) goals.push(COSTS.settlement);
  goals.push(COSTS.dev);
  if (me.pieces.roads > 0) goals.push(COSTS.road);
  const misses = goals.map((c) => missingFor(res, c).count).sort((a, b) => a - b);
  return misses[0] * 1.0 + (misses[1] || 0) * 0.35 + (misses[2] || 0) * 0.1 - handSize(res) * 0.04;
}

// Would this player take the offer? Progress toward its builds dominates (it never gives away a card
// its next build needs for nothing), but like a person it also values getting more cards than it
// gives, cards it does not produce or has none of, shedding a surplus, and getting under the
// robber's 7-card limit. It will not feed someone close to winning.
export function evaluateOffer(view, p, t, lvl, rnd = Math.random) {
  const me = view.players[p];
  for (const r of RES) if (me.res[r] < (t.get[r] || 0)) return false;
  const offererVP = publicVP(view, t.from);
  if (offererVP >= view.targetVP - 2) return false;
  const after = { ...me.res };
  for (const r of RES) after[r] = after[r] - (t.get[r] || 0) + (t.give[r] || 0);
  const before = handPotential(view, p, me.res);
  const now = handPotential(view, p, after);
  const giveN = RES.reduce((s, r) => s + (t.get[r] || 0), 0);
  const getN = RES.reduce((s, r) => s + (t.give[r] || 0), 0);
  const prod = production(view, p);
  let margin = before - now + (getN - giveN) * 0.3;
  for (const r of RES) {
    const got = t.give[r] || 0;
    const gave = t.get[r] || 0;
    if (got) {
      if (me.res[r] === 0) margin += 0.14; // something it had none of
      margin += 0.12 * (1 - Math.min(1, prod[r] * 4)) * got; // something its land does not produce
    }
    if (gave) {
      if (me.res[r] - gave >= 2) margin += 0.07 * gave; // it keeps plenty
      if (me.res[r] - gave === 0) margin -= 0.08; // its last one
      margin += 0.05 * Math.min(1, prod[r] * 4) * gave; // it will soon get more
    }
  }
  if (handSize(me.res) > handLimitOf(view, p) && giveN > getN) margin += 0.15; // fewer cards to lose to a 7
  // (the development mode) a merchant guild's bonus card on the way
  if (developOn(view) && !view.used.guild && (hasBuilt(view, p, 'guild') || hasBuilt(view, t.from, 'guild'))) margin += 0.25;
  if (offererVP >= view.targetVP - 3) margin -= 0.3;
  if (lvl.noise > 0.5) margin += (rnd() - 0.5) * 0.8;
  else if (lvl.noise > 0.1) margin += (rnd() - 0.5) * 0.12;
  return margin > (lvl.noise < 0.05 ? 0.1 : 0.03);
}

function domesticOfferFor(view, p, cost) {
  const me = view.players[p];
  const { missing } = missingFor(me.res, cost);
  const wants = Object.keys(missing);
  if (!wants.length) return null;
  let give = null;
  let spare = 0;
  for (const g of RES) {
    if (missing[g]) continue;
    const s = me.res[g] - (cost[g] || 0);
    if (s > spare) {
      spare = s;
      give = g;
    }
  }
  if (!give) return null;
  const want = wants.sort((a, b) => missing[b] - missing[a])[0];
  const giveCount = spare >= 3 ? 2 : 1;
  return { type: 'offer', p, give: { [give]: giveCount }, get: { [want]: 1 } };
}

// (Seafarers) the resources a gold field gives: what the best plan lacks, then what I hold least of
function chooseGold(view, p, amount, lvl) {
  const me = view.players[p];
  const bank = { ...view.bank };
  const want = Math.min(amount, RES.reduce((s, r) => s + bank[r], 0));
  const out = {};
  const hand = { ...me.res };
  const take = (r) => {
    out[r] = (out[r] || 0) + 1;
    hand[r]++;
    bank[r]--;
  };
  const plans = buildPlans(view, p, lvl);
  for (const pl of plans.slice(0, 3)) {
    const { missing } = missingFor(hand, pl.cost);
    for (const r of RES) {
      while ((missing[r] || 0) > 0 && bank[r] > 0 && Object.values(out).reduce((a, b) => a + b, 0) < want) {
        take(r);
        missing[r]--;
      }
    }
  }
  while (Object.values(out).reduce((a, b) => a + b, 0) < want) {
    const r = RES.filter((x) => bank[x] > 0).sort((a, b) => hand[a] - hand[b])[0];
    take(r);
  }
  return out;
}

function chooseDiscard(view, p, amount) {
  const me = view.players[p];
  const hand = { ...me.res };
  const plans = buildPlans(view, p, LEVELS.hard, () => 0.5);
  const keepCost = {};
  for (const pl of plans.slice(0, 2)) for (const r in pl.cost) keepCost[r] = Math.max(keepCost[r] || 0, pl.cost[r]);
  const out = {};
  for (let i = 0; i < amount; i++) {
    let pick = null;
    let pickScore = -Infinity;
    for (const r of RES) {
      if (hand[r] <= 0) continue;
      const over = hand[r] - (keepCost[r] || 0);
      const s = over * 2 + hand[r] * 0.3 - (keepCost[r] ? 1 : 0);
      if (s > pickScore) {
        pickScore = s;
        pick = r;
      }
    }
    hand[pick]--;
    out[pick] = (out[pick] || 0) + 1;
  }
  return out;
}

function robberScore(view, p, h, lvl) {
  if (h === view.board.robber) return -Infinity;
  const H = view.board.hexes[h];
  const pp = pips(H.number);
  let s = 0;
  let mineHere = false;
  const leaderVP = Math.max(...view.players.map((o) => (o.id === p ? 0 : publicVP(view, o.id))));
  for (const v of GEO.hexes[h].vertices) {
    const b = view.vertices[v];
    if (!b) continue;
    const mult = b.t === 'c' ? 2 : 1;
    if (b.p === p) {
      s -= pp * mult * 3;
      mineHere = true;
    } else {
      const vp = publicVP(view, b.p);
      s += pp * mult * (1 + (lvl.smartRobber ? (vp / Math.max(1, leaderVP)) * 0.8 : 0.3));
    }
  }
  const victims = robberVictims(view, h, p);
  if (victims.length) s += 1.5 + Math.max(...victims.map((q) => view.players[q].resCount)) * 0.15;
  if (mineHere) s -= 2;
  // (the development mode) a rival's wonder: lost unless its owner has a knight to spare
  const w = developOn(view) && wonderAt(view, h);
  if (w && w.p !== p) {
    // (a card in its owner's hand may be a knight: then the attack only spends it)
    const sure = view.players[w.p].devCount ? 0.6 : 1;
    s += (w.done ? 40 : 9 * w.s) * sure * (lvl.smartRobber ? 1 : 0.5);
  }
  return s;
}

// (Seafarers) what the robber holds back where it stands now: it stays there when the pirate moves
function robberStays(view, p, lvl) {
  const h = view.board.robber;
  if (h == null || h < 0) return 0;
  const pp = pips(view.board.hexes[h].number);
  const leaderVP = Math.max(...view.players.map((o) => (o.id === p ? 0 : publicVP(view, o.id))));
  let s = 0;
  for (const v of GEO.hexes[h].vertices) {
    const b = view.vertices[v];
    if (!b) continue;
    const mult = b.t === 'c' ? 2 : 1;
    if (b.p === p) s -= pp * mult * 3;
    else s += pp * mult * (1 + (lvl.smartRobber ? (publicVP(view, b.p) / Math.max(1, leaderVP)) * 0.8 : 0.3));
  }
  return s;
}

// (Seafarers) the pirate on sea hex h: a card from a rival with a ship beside it, and the rivals'
// ships there held up (no moving them, no building on past it); never beside our own ships
function pirateScore(view, p, h, lvl) {
  if (h === view.board.pirate) return -Infinity;
  let s = 0;
  const rivals = new Set();
  for (const e of GEO.hexes[h].edges) {
    const q = view.ships[e];
    if (q < 0) continue;
    if (q === p) s -= 1.5;
    else {
      rivals.add(q);
      s += 0.8 * (lvl.smartRobber ? 0.5 + publicVP(view, q) / 10 : 1);
    }
  }
  const victims = [...rivals].filter((q) => view.players[q].resCount > 0);
  if (victims.length) s += 1.5 + Math.max(...victims.map((q) => view.players[q].resCount)) * 0.15;
  return s;
}

function chooseRobberHex(view, p, lvl, rnd) {
  const sea = view.ships ? seaInfo(view.board) : null;
  // (the development mode: never onto our own wonder or beside a great wall's owner)
  const legal = developOn(view) ? new Set(robberSpots(view, p)) : null;
  const scored = GEO.hexes.filter((h) => (!sea || sea.land[h.id]) && (!legal || legal.has(h.id))).map((h) => ({ h: h.id, s: robberScore(view, p, h.id, lvl) + (rnd() - 0.5) * lvl.noise * 3 }));
  if (sea) {
    // or the pirate (the robber then stays put); moving it is worth more while it holds up our ships
    const cur = view.board.pirate;
    const stuck = cur != null && cur >= 0 ? GEO.hexes[cur].edges.filter((e) => view.ships[e] === p).length : 0;
    const stay = robberStays(view, p, lvl) + stuck * 1.5;
    for (const h of GEO.hexes) {
      if (sea.land[h.id] || view.board.hexes[h.id].terrain === 'fog') continue;
      const s = pirateScore(view, p, h.id, lvl);
      if (s > -Infinity) scored.push({ h: h.id, s: s + stay + (rnd() - 0.5) * lvl.noise * 3 });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  return scored[0].h;
}

function chooseVictim(view, p, victims) {
  let best = victims[0];
  let bs = -Infinity;
  for (const q of victims) {
    const s = publicVP(view, q) * 2 + view.players[q].resCount * 0.6;
    if (s > bs) {
      bs = s;
      best = q;
    }
  }
  return best;
}

function estimateHoldings(view, p, r) {
  // Expected count of resource r across opponents, from their hand sizes and production mix.
  let est = 0;
  for (const o of view.players) {
    if (o.id === p) continue;
    const prod = production(view, o.id, { ignoreRobber: true });
    const tot = RES.reduce((s, x) => s + prod[x], 0) || 1;
    est += o.resCount * (prod[r] / tot);
  }
  return est;
}

function devMove(view, p, lvl, rnd, plans) {
  const devs = playableDev(view, p);
  if (!devs.length) return null;
  const me = view.players[p];
  const top = plans[0];

  if (devs.includes('knight')) {
    const rob = view.board.robber;
    // (the robber may still be off the board: the new world)
    const hurtsMe = rob >= 0 && GEO.hexes[rob].vertices.some((v) => view.vertices[v] && view.vertices[v].p === p) && pips(view.board.hexes[rob].number) >= 3;
    const la = view.largestArmy;
    const laSize = la >= 0 ? view.players[la].knights : 2;
    const grab = la !== p && me.knights + 1 > laSize && me.knights + 1 >= 3;
    // (the development mode) the last knight in hand stays to guard a wonder
    const keep = developOn(view) && guardsWonder(view, p) && me.dev.filter((c) => c.type === 'knight').length <= 1;
    if (!keep && (hurtsMe || grab || (rnd() < 0.15 && me.knights < 3))) return { type: 'playDev', p, card: 'knight' };
  }
  if (devs.includes('roadBuilding') && plans.some((pl) => pl.kind === 'road') && me.pieces.roads >= 1) {
    return { type: 'playDev', p, card: 'roadBuilding' };
  }
  if (devs.includes('yearOfPlenty') && top) {
    const { missing, count } = missingFor(me.res, top.cost);
    const bankTotal = RES.reduce((s, r) => s + view.bank[r], 0);
    if (count >= 1 && count <= 2 && bankTotal >= 2) {
      const take = [];
      for (const r of Object.keys(missing)) for (let i = 0; i < missing[r]; i++) take.push(r);
      while (take.length < 2) {
        const extra = top.cost.ore ? 'ore' : top.cost.grain ? 'grain' : 'wood';
        take.push(extra);
      }
      const want = {};
      for (const r of take) want[r] = (want[r] || 0) + 1;
      if (RES.every((r) => view.bank[r] >= (want[r] || 0))) return { type: 'playDev', p, card: 'yearOfPlenty', res: take.slice(0, 2) };
    }
  }
  if (devs.includes('monopoly')) {
    let best = null;
    let bestVal = 0;
    for (const r of RES) {
      const est = estimateHoldings(view, p, r);
      const need = top && top.cost[r] ? 1.3 : 1;
      const harbor = tradeRatio(view, p, r) === 2 ? 1.25 : 1;
      const val = est * need * harbor;
      if (val > bestVal) {
        bestVal = val;
        best = r;
      }
    }
    if (best && bestVal >= lvl.monopolyMin) return { type: 'playDev', p, card: 'monopoly', res: best };
  }
  return null;
}

function winningMove(view, p, plans) {
  const me = view.players[p];
  const vp = publicVP(view, p) + me.dev.filter((c) => c.type === 'victoryPoint').length;
  for (const pl of plans) {
    if (!canPay(view, p, pl)) continue;
    const gain = pl.kind === 'city' || pl.kind === 'settlement' ? 1 : pl.lr ? 2 + (developOn(view) && hasBuilt(view, p, 'post') ? 3 : 0) : pl.kind === 'special' ? specialGain(view, p, pl.k) : 0;
    if (gain && vp + gain >= view.targetVP) return pl;
  }
  return null;
}

// the points a special building brings the moment it stands
function specialGain(view, p, k) {
  // (the guild hall: a point for every three special buildings, itself among them)
  if (k === 'guildHall') return Math.floor((specialCount(view, p) + 1) / GUILD_HALL_PER);
  if (BUILDINGS[k].kind === 'func') return funcVP(k) + (hasBuilt(view, p, 'guildHall') && (specialCount(view, p) + 1) % GUILD_HALL_PER === 0 ? 1 : 0);
  if (k === 'adventurers') return view.largestArmy === p ? 3 : 0;
  if (k === 'post') return view.longestRoad === p ? 3 : 0;
  return scoring(view, p, k) ? 3 : 0;
}

function planToAction(p, pl) {
  if (pl.kind === 'ship') return { type: 'ship', p, edge: pl.edge };
  if (pl.kind === 'city') return { type: 'city', p, vertex: pl.vertex };
  if (pl.kind === 'settlement') return { type: 'settlement', p, vertex: pl.vertex };
  if (pl.kind === 'road') return { type: 'road', p, edge: pl.edge };
  if (pl.kind === 'develop') return { type: 'develop', p, hex: pl.hex, res: pl.res };
  if (pl.kind === 'special') return pl.res ? { type: 'special', p, k: pl.k, vertex: pl.vertex, res: pl.res } : { type: 'special', p, k: pl.k, vertex: pl.vertex };
  if (pl.kind === 'wonder') return { type: 'wonder', p, hex: pl.hex };
  const a = { type: 'buyDev', p };
  if (pl.how) a.how = pl.how;
  if (pl.lib) a.lib = pl.lib;
  return a;
}

function mainMove(view, p, mem, lvl, rnd) {
  const me = view.players[p];
  if (mem.turn !== view.turn) {
    mem.turn = view.turn;
    mem.bankTrades = 0;
    mem.got = {};
    mem.stored = false;
  }
  // (the warehouse) what was put away comes back first, to build with
  const stored = me.store ? handSize(me.store) : 0;
  if (stored && !mem.stored && developOn(view)) {
    mem.stored = true;
    const take = {};
    for (const r of RES) if (me.store[r]) take[r] = me.store[r];
    return { type: 'warehouse', p, take };
  }
  const plans = buildPlans(view, p, lvl);
  const endTurn = () => endTurnMove(view, p, mem, plans);

  const win = winningMove(view, p, plans);
  if (win) return planToAction(p, win);

  const dev = devMove(view, p, lvl, rnd, plans);
  if (dev) return dev;

  if (!plans.length) return endTurn();
  const top = plans[0];

  if (canPay(view, p, top)) return planToAction(p, top);

  // the special building phase allows building only; the second player of a paired turn may trade
  // with the bank but not with other players
  const sbp = !!view.sub && view.sub.k === 'sbp';
  const tradeOk = (t) => t && !sbp && mem.bankTrades < 5 && !mem.got[t.give];
  const doTrade = (t) => {
    mem.bankTrades++;
    mem.got[t.get] = true;
    return t;
  };

  // (the development mode) the market's two-for-one first, then the caravanserai's two different for one
  if (developOn(view) && !sbp) {
    const m = marketTradeFor(view, p, top.cost);
    if (m) return m;
    const c = mem.bankTrades < 5 ? caravanTradeFor(view, p, top.cost) : null;
    if (c) {
      mem.bankTrades++;
      return c;
    }
  }
  // Try bank/harbor trades toward the top plan.
  if (totalTradeable(view, p, top.cost)) {
    const t = bankTradeFor(view, p, top.cost);
    if (tradeOk(t)) return doTrade(t);
  }

  // One domestic offer per turn toward the top plan when it is close.
  const { count } = missingFor(me.res, top.cost);
  if (lvl.domestic && !view.sub && count <= 2 && mem.offerTurn !== view.turn) {
    const offer = domesticOfferFor(view, p, top.cost);
    if (offer) {
      mem.offerTurn = view.turn;
      return offer;
    }
  }

  // Fall back to the best affordable plan that doesn't eat the top plan's resources,
  // or any affordable plan when holding too many cards (7 risk).
  const big = handSize(me.res) > handLimitOf(view, p);
  for (const pl of plans.slice(1)) {
    if (!canPay(view, p, pl)) continue;
    if (pl.value < 0.3) continue;
    let conflicts = false;
    for (const r in pl.cost) if (top.cost[r] && me.res[r] - pl.cost[r] < top.cost[r]) conflicts = true;
    if (!conflicts || big || count >= 3) return planToAction(p, pl);
  }
  if (big) {
    for (const pl of plans) {
      if (!totalTradeable(view, p, pl.cost)) continue;
      const t = bankTradeFor(view, p, pl.cost);
      if (tradeOk(t)) return doTrade(t);
    }
  }
  return endTurn();
}

// ── the buildings of 2026-11-18 ──

// The turn's end: a hand at risk goes into the warehouse first (the most plentiful cards); with a
// counting house and a full hand, the card it brings is the one the best plan lacks.
function endTurnMove(view, p, mem, plans) {
  const me = view.players[p];
  if (!developOn(view)) return { type: 'endTurn', p };
  const hand = handSize(me.res);
  if (hasBuilt(view, p, 'warehouse') && me.store && mem.put !== view.turn) {
    const room = STORE_MAX - handSize(me.store);
    // (worth it with a 7 to fear, or a thief: more than a few cards)
    if (room > 0 && hand >= Math.min(handLimitOf(view, p) - 1, 6)) {
      mem.put = view.turn;
      const left = { ...me.res };
      const put = {};
      for (let i = 0; i < room; i++) {
        const r = RES.slice().sort((a, b) => left[b] - left[a])[0];
        if (!left[r]) break;
        left[r]--;
        put[r] = (put[r] || 0) + 1;
      }
      if (Object.keys(put).length) return { type: 'warehouse', p, put };
    }
  }
  if (hasBuilt(view, p, 'countingHouse') && !view.used.countingHouse && hand >= COUNTING_MIN) return { type: 'endTurn', p, bonus: wantedRes(view, p, plans) };
  return { type: 'endTurn', p };
}

// the card p wants most from the bank: one the best plan lacks, else the scarcest of p's hand (that the
// bank has)
function wantedRes(view, p, plans) {
  const me = view.players[p];
  const top = (plans || []).find((x) => x.cost && Object.keys(x.cost).length);
  if (top) {
    const { missing } = missingFor(me.res, top.cost);
    const r = RES.filter((x) => missing[x] && view.bank[x] > 0).sort((a, b) => missing[b] - missing[a])[0];
    if (r) return r;
  }
  return RES.filter((x) => view.bank[x] > 0).sort((a, b) => me.res[a] - me.res[b])[0];
}

// (the caravanserai) two different spare cards (CARAVAN_GIVE) for the one the cost lacks most, when no
// harbor does it for two of one kind
function caravanTradeFor(view, p, cost) {
  if (!hasBuilt(view, p, 'caravan')) return null;
  const me = view.players[p];
  const { missing, count } = missingFor(me.res, cost);
  if (!count) return null;
  const get = RES.filter((r) => missing[r] && view.bank[r] > 0).sort((a, b) => missing[b] - missing[a])[0];
  if (!get) return null;
  const spare = RES.filter((r) => r !== get && me.res[r] - (cost[r] || 0) >= 1);
  if (spare.length < CARAVAN_GIVE) return null;
  // (a harbor's two for one of a spare card is better)
  if (spare.some((r) => tradeRatio(view, p, r) === 2 && me.res[r] - (cost[r] || 0) >= 2)) return null;
  spare.sort((a, b) => me.res[b] - (cost[b] || 0) - (me.res[a] - (cost[a] || 0)));
  return { type: 'caravan', p, give: spare.slice(0, CARAVAN_GIVE), get };
}

// (the observatory) a wool for a second roll: when this one brings p nothing and p's land usually
// brings much more, or when it is a 7 and p's hand would be halved
function rerollWanted(view, p) {
  const me = view.players[p];
  const sum = view.pending.sum;
  if (me.res.wool < 1) return false;
  if (sum === 7) return handSize(me.res) > handLimitOf(view, p);
  let got = 0;
  let mean = 0;
  for (const H of GEO.hexes) {
    const hx = view.board.hexes[H.id];
    if (!TERRAIN_RES[hx.terrain] || view.board.robber === H.id) continue;
    let n = 0;
    for (const v of H.vertices) {
      const b = view.vertices[v];
      if (b && b.p === p) n += b.t === 'c' ? 2 : 1;
    }
    if (view.plots && view.plots[H.id] && view.plots[H.id].p === p) n += view.plots[H.id].r.length;
    if (hx.number === sum) got += n;
    mean += (n * pips(hx.number)) / 36;
  }
  return got === 0 && mean >= 1.6;
}

// (the garrison) a wonder worth saving and no knight: the two cards p needs least
function garrisonPay(view, p) {
  const me = view.players[p];
  if (!hasBuilt(view, p, 'garrison') || handSize(me.res) < 2) return null;
  const w = (view.wonders || []).find((x) => x.h === view.pending.hex);
  if (!w || !(w.done || w.s >= 2)) return null;
  const left = { ...me.res };
  const pay = {};
  for (let i = 0; i < 2; i++) {
    const r = RES.slice().sort((a, b) => left[b] - left[a])[0];
    left[r]--;
    pay[r] = (pay[r] || 0) + 1;
  }
  return pay;
}

// (the development mode) defend the wonder with a knight from hand: always a complete one, one being
// built once two of its stages are paid
function defendWonder(view, p) {
  const me = view.players[p];
  if (!me.dev.some((c) => c.type === 'knight')) return false;
  const w = (view.wonders || []).find((x) => x.h === view.pending.hex);
  return !!w && (w.done || w.s >= 2);
}
// (the academy) of the two cards drawn, the one worth more now
function pickDevCard(view, p) {
  const cards = view.players[p].pick || [];
  const worth = { victoryPoint: 5, knight: 3, roadBuilding: 2, yearOfPlenty: 2.5, monopoly: 2 };
  return (worth[cards[1]] || 0) > (worth[cards[0]] || 0) ? 1 : 0;
}

export function aiAct(view, p, mem = {}, rnd = Math.random) {
  const lvl = LEVELS[(view.players[p].ai && view.players[p].ai.level) || 'normal'] || LEVELS.normal;
  if (view.phase === 'over') return null;

  const pd = view.pending;
  // (gold found in the fog may be owed even in the opening)
  if (pd && pd.type === 'gold') {
    if (pd.amounts[p] === undefined) return null;
    return { type: 'gold', p, res: chooseGold(view, p, pd.amounts[p], lvl) };
  }
  if (view.phase === 'setup') {
    if (pd || view.setup.order[view.setup.i] !== p) return null;
    return view.setup.step === 'settlement' ? setupSettlement(view, p, lvl, rnd) : setupRoad(view, p, lvl, rnd);
  }

  if (pd && pd.type === 'discard') {
    if (pd.amounts[p] === undefined) return null;
    return { type: 'discard', p, cards: chooseDiscard(view, p, pd.amounts[p]) };
  }
  // (the development mode) the robber at our wonder: a knight saves it (or the garrison's two cards)
  if (pd && pd.type === 'defend') {
    if (pd.p !== p) return null;
    if (defendWonder(view, p)) return { type: 'defend', p, yes: true };
    const pay = garrisonPay(view, p);
    return pay ? { type: 'defend', p, yes: true, pay } : { type: 'defend', p, yes: false };
  }
  // (the observatory) the roller: keep the dice, or a wool for a second roll
  if (pd && pd.type === 'reroll') return pd.p === p ? { type: 'reroll', p, yes: rerollWanted(view, p) } : null;
  if (view.trade && view.trade.from !== p) {
    if (view.trade.resp[p] === null) {
      const lack = RES.some((r) => view.players[p].res[r] < (view.trade.get[r] || 0));
      return { type: 'respond', p, accept: !lack && evaluateOffer(view, p, view.trade, lvl, rnd), reason: lack ? 'lack' : undefined };
    }
    return null;
  }
  if (view.current !== p) return null;

  if (pd && pd.type === 'robber') return { type: 'robber', p, hex: chooseRobberHex(view, p, lvl, rnd) };
  if (pd && pd.type === 'pick') return { type: 'pickDev', p, i: pickDevCard(view, p) };
  if (pd && pd.type === 'steal') return { type: 'steal', p, target: chooseVictim(view, p, pd.victims) };
  if (pd && pd.type === 'roadBuilding') {
    const me = view.players[p];
    const plans = buildPlans(view, p, lvl, rnd).filter((x) => (x.kind === 'road' && me.pieces.roads > 0) || (x.kind === 'ship' && me.pieces.ships > 0));
    if (plans.length) return planToAction(p, plans[0]);
    const any = me.pieces.roads > 0 ? legalRoadEdges(view, p) : [];
    if (any.length) return { type: 'road', p, edge: any[Math.floor(rnd() * any.length)] };
    const ships = me.pieces.ships > 0 ? legalShips(view, p) : [];
    if (ships.length) return { type: 'ship', p, edge: ships[Math.floor(rnd() * ships.length)] };
    return { type: 'endRoadBuilding', p };
  }

  if (view.trade && view.trade.from === p) {
    const yes = Object.keys(view.trade.resp)
      .map(Number)
      .filter((q) => view.trade.resp[q] === 'yes');
    if (yes.length) {
      yes.sort((a, b) => publicVP(view, a) - publicVP(view, b));
      return { type: 'acceptOffer', p, with: yes[0] };
    }
    const waiting = Object.values(view.trade.resp).some((x) => x === null);
    return waiting ? null : { type: 'cancelOffer', p };
  }

  if (!view.rolled) {
    const devs = playableDev(view, p);
    if (devs.includes('knight')) {
      const rob = view.board.robber;
      const hurt = rob >= 0 && GEO.hexes[rob].vertices.some((v) => view.vertices[v] && view.vertices[v].p === p) && pips(view.board.hexes[rob].number) >= 4;
      const la = view.largestArmy;
      const laSize = la >= 0 ? view.players[la].knights : 2;
      const grab = la !== p && view.players[p].knights + 1 > laSize && view.players[p].knights + 1 >= 3;
      if (hurt || grab) return { type: 'playDev', p, card: 'knight' };
    }
    // (the almshouse: with a small hand, a card of the computer's choice before the dice)
    const me = view.players[p];
    if (developOn(view) && hasBuilt(view, p, 'almshouse') && !view.used.almshouse && handSize(me.res) <= ALMS_MAX) return { type: 'roll', p, alms: wantedRes(view, p, buildPlans(view, p, lvl)) };
    return { type: 'roll', p };
  }

  return mainMove(view, p, mem, lvl, rnd);
}

export const AI_LEVELS = Object.keys(LEVELS);
export { settlementLegal };
