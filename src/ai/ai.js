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
} from '../engine/engine.js';

const LEVELS = {
  easy: { noise: 0.9, domestic: false, smartRobber: false, monopolyMin: 4 },
  normal: { noise: 0.2, domestic: true, smartRobber: true, monopolyMin: 3 },
  hard: { noise: 0.03, domestic: true, smartRobber: true, monopolyMin: 3 },
};

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
    const r = TERRAIN_RES[H.terrain];
    if (!r) continue;
    let pp = pips(H.number);
    if (view.board.robber === h && !opts.ignoreRobber) pp *= 0.6;
    score += pp * weights[r];
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
  return vp <= 4 ? 'early' : 'late';
}

// ───────────────────────── setup ─────────────────────────

function setupSettlement(view, p, lvl, rnd) {
  const spots = legalSettlementSpots(view, p, true);
  const weights = resWeights(view, p, 'early');
  const prod = production(view, p, { ignoreRobber: true });
  const second = view.setup.i >= view.players.length;
  let best = spots[0];
  let bestScore = -Infinity;
  for (const v of spots) {
    let s = vertexScore(view, v, p, weights, { ignoreRobber: true });
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
  const edges = GEO.vertices[from].edges.filter((e) => view.edges[e] === -1);
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
  return { type: 'road', p, edge: best };
}

// ───────────────────────── planning ─────────────────────────

// BFS over free paths from my network → settlement spots reachable with d new roads.
function reachableSpots(view, p, maxDepth = 3) {
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

  if (me.pieces.cities > 0) {
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
  if (me.pieces.settlements > 0) {
    for (const v of legalSettlementSpots(view, p)) {
      plans.push({
        kind: 'settlement',
        vertex: v,
        cost: COSTS.settlement,
        value: 1.3 + vertexScore(view, v, p, weights) * 0.085 + noise(2000 + v),
      });
    }
  }
  if (me.pieces.roads > 0) {
    // roads toward future settlement spots
    if (me.pieces.settlements > 0) {
      const reach = reachableSpots(view, p, 3).filter((s) => s.d >= 1);
      const byEdge = new Map();
      for (const s of reach) {
        if (s.edge === undefined || !roadLegal(view, p, s.edge)) continue;
        const val = (1.3 + vertexScore(view, s.v, p, weights) * 0.085) * Math.pow(0.52, s.d) * 1.15;
        if (!byEdge.has(s.edge) || byEdge.get(s.edge) < val) byEdge.set(s.edge, val);
      }
      for (const [e, val] of byEdge) plans.push({ kind: 'road', edge: e, cost: COSTS.road, value: val + noise(3000 + e) * 0.5 });
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
          plans.push({ kind: 'road', edge: e, cost: COSTS.road, value: val + noise(5000 + e) * 0.4, lr: takes });
        }
      }
    }
  }
  if (view.devDeckCount > 0) {
    let dv = 0.95 + (stage === 'late' ? 0.25 : 0);
    const la = view.largestArmy;
    const laSize = la >= 0 ? view.players[la].knights : 2;
    if (la !== p && me.knights + 1 >= laSize) dv += 0.25;
    plans.push({ kind: 'dev', cost: COSTS.dev, value: dv + noise(4000) });
  }
  plans.sort((a, b) => b.value - a.value);
  key = 0;
  return plans;
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
  if (handSize(me.res) > 7 && giveN > getN) margin += 0.15; // fewer cards to lose to a 7
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
  return s;
}

function chooseRobberHex(view, p, lvl, rnd) {
  const scored = GEO.hexes.map((h) => ({ h: h.id, s: robberScore(view, p, h.id, lvl) + (rnd() - 0.5) * lvl.noise * 3 }));
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
    const hurtsMe = GEO.hexes[rob].vertices.some((v) => view.vertices[v] && view.vertices[v].p === p) && pips(view.board.hexes[rob].number) >= 3;
    const la = view.largestArmy;
    const laSize = la >= 0 ? view.players[la].knights : 2;
    const grab = la !== p && me.knights + 1 > laSize && me.knights + 1 >= 3;
    if (hurtsMe || grab || (rnd() < 0.15 && me.knights < 3)) return { type: 'playDev', p, card: 'knight' };
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
    if (!canAfford(me.res, pl.cost)) continue;
    const gain = pl.kind === 'city' || pl.kind === 'settlement' ? 1 : pl.lr ? 2 : 0;
    if (gain && vp + gain >= view.targetVP) return pl;
  }
  return null;
}

function planToAction(p, pl) {
  if (pl.kind === 'city') return { type: 'city', p, vertex: pl.vertex };
  if (pl.kind === 'settlement') return { type: 'settlement', p, vertex: pl.vertex };
  if (pl.kind === 'road') return { type: 'road', p, edge: pl.edge };
  return { type: 'buyDev', p };
}

function mainMove(view, p, mem, lvl, rnd) {
  const me = view.players[p];
  if (mem.turn !== view.turn) {
    mem.turn = view.turn;
    mem.bankTrades = 0;
    mem.got = {};
  }
  const plans = buildPlans(view, p, lvl);

  const win = winningMove(view, p, plans);
  if (win) return planToAction(p, win);

  const dev = devMove(view, p, lvl, rnd, plans);
  if (dev) return dev;

  if (!plans.length) return { type: 'endTurn', p };
  const top = plans[0];

  if (canAfford(me.res, top.cost)) return planToAction(p, top);

  // the special building phase allows building only; the second player of a paired turn may trade
  // with the bank but not with other players
  const sbp = !!view.sub && view.sub.k === 'sbp';
  const tradeOk = (t) => t && !sbp && mem.bankTrades < 5 && !mem.got[t.give];
  const doTrade = (t) => {
    mem.bankTrades++;
    mem.got[t.get] = true;
    return t;
  };

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
  const big = handSize(me.res) > 7;
  for (const pl of plans.slice(1)) {
    if (!canAfford(me.res, pl.cost)) continue;
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
  return { type: 'endTurn', p };
}

export function aiAct(view, p, mem = {}, rnd = Math.random) {
  const lvl = LEVELS[(view.players[p].ai && view.players[p].ai.level) || 'normal'] || LEVELS.normal;
  if (view.phase === 'over') return null;

  if (view.phase === 'setup') {
    if (view.setup.order[view.setup.i] !== p) return null;
    return view.setup.step === 'settlement' ? setupSettlement(view, p, lvl, rnd) : setupRoad(view, p, lvl, rnd);
  }

  const pd = view.pending;
  if (pd && pd.type === 'discard') {
    if (pd.amounts[p] === undefined) return null;
    return { type: 'discard', p, cards: chooseDiscard(view, p, pd.amounts[p]) };
  }
  if (view.trade && view.trade.from !== p) {
    if (view.trade.resp[p] === null) {
      const lack = RES.some((r) => view.players[p].res[r] < (view.trade.get[r] || 0));
      return { type: 'respond', p, accept: !lack && evaluateOffer(view, p, view.trade, lvl, rnd), reason: lack ? 'lack' : undefined };
    }
    return null;
  }
  if (view.current !== p) return null;

  if (pd && pd.type === 'robber') return { type: 'robber', p, hex: chooseRobberHex(view, p, lvl, rnd) };
  if (pd && pd.type === 'steal') return { type: 'steal', p, target: chooseVictim(view, p, pd.victims) };
  if (pd && pd.type === 'roadBuilding') {
    const plans = buildPlans(view, p, lvl, rnd).filter((x) => x.kind === 'road');
    if (plans.length) return { type: 'road', p, edge: plans[0].edge };
    const any = legalRoadEdges(view, p);
    if (any.length) return { type: 'road', p, edge: any[Math.floor(rnd() * any.length)] };
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
      const hurt = GEO.hexes[rob].vertices.some((v) => view.vertices[v] && view.vertices[v].p === p) && pips(view.board.hexes[rob].number) >= 4;
      const la = view.largestArmy;
      const laSize = la >= 0 ? view.players[la].knights : 2;
      const grab = la !== p && view.players[p].knights + 1 > laSize && view.players[p].knights + 1 >= 3;
      if (hurt || grab) return { type: 'playDev', p, card: 'knight' };
    }
    return { type: 'roll', p };
  }

  return mainMove(view, p, mem, lvl, rnd);
}

export const AI_LEVELS = Object.keys(LEVELS);
export { settlementLegal };
