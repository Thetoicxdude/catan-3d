// Targeted rule tests (geometry, longest road, production shortage, trading, dev-card timing, win timing).
import assert from 'node:assert/strict';
import { GEO } from '../src/engine/geometry.js';
import {
  createGame,
  applyAction,
  longestRoadFor,
  RuleError,
  tradeRatio,
  makeView,
  legalSettlementSpots,
  totalVP,
  publicVP,
  distanceOK,
  seaInfo,
  pirateEdges,
  shipTargets,
  legalShips,
  legalRoadEdges,
  actorsNow,
} from '../src/engine/engine.js';
import { tradeRouteFor } from '../src/engine/seafarers.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.log('FAIL', name, '\n ', e.message);
    process.exitCode = 1;
  }
}
const throwsRule = (fn, re) =>
  assert.throws(fn, (e) => e instanceof RuleError && (!re || re.test(e.message)));

const players = (n = 4) => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: '#fff', kind: 'human' }));
function fresh(seed = 1) {
  const st = createGame({ seed, players: players(), firstPlayer: 0 });
  // skip setup: jump straight to play with an empty board
  st.phase = 'play';
  st.turn = 5;
  st.current = 0;
  st.rolled = true;
  return st;
}
// walk a path of vertices, return the edge ids
function pathEdges(vs) {
  const out = [];
  for (let i = 0; i + 1 < vs.length; i++) {
    const e = GEO.edgeBetween(vs[i], vs[i + 1]);
    assert.ok(e >= 0, 'not adjacent ' + vs[i] + '-' + vs[i + 1]);
    out.push(e);
  }
  return out;
}
function walk(start, len, avoid = new Set()) {
  // deterministic simple path of `len` edges
  const vs = [start];
  const seen = new Set([start]);
  while (vs.length <= len) {
    const v = vs[vs.length - 1];
    const n = GEO.vertices[v].neighbors.filter((w) => !seen.has(w) && !avoid.has(w)).sort((a, b) => a - b)[0];
    if (n === undefined) break;
    vs.push(n);
    seen.add(n);
  }
  return vs;
}

test('geometry counts', () => {
  assert.equal(GEO.hexes.length, 19);
  assert.equal(GEO.vertices.length, 54);
  assert.equal(GEO.edges.length, 72);
  assert.equal(GEO.coastalEdges.length, 30);
  assert.equal(GEO.sea.length, 18);
  for (const v of GEO.vertices) assert.ok(v.neighbors.length >= 2 && v.neighbors.length <= 3);
});

test('board composition', () => {
  for (let s = 0; s < 50; s++) {
    const st = createGame({ seed: s, players: players(3) });
    const counts = {};
    for (const h of st.board.hexes) counts[h.terrain] = (counts[h.terrain] || 0) + 1;
    assert.deepEqual(counts, { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 });
    const nums = st.board.hexes.map((h) => h.number).filter(Boolean).sort((a, b) => a - b);
    assert.deepEqual(nums, [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    for (const h of GEO.hexes) {
      const a = st.board.hexes[h.id].number;
      for (const n of h.neighbors) {
        const b = st.board.hexes[n].number;
        assert.ok(!((a === 6 || a === 8) && (b === 6 || b === 8)), 'adjacent red numbers');
      }
    }
    assert.equal(st.board.harbors.length, 9);
    assert.equal(st.board.hexes[st.board.robber].terrain, 'desert');
    const hv = st.board.vertexHarbor.filter(Boolean).length;
    assert.equal(hv, 18);
  }
});

test('setup snake order + starting resources', () => {
  const st = createGame({ seed: 3, players: players(3), firstPlayer: 1 });
  assert.deepEqual(st.setup.order, [1, 2, 0, 0, 2, 1]);
  const spots = [];
  for (let k = 0; k < 6; k++) {
    const p = st.setup.order[k];
    const v = legalSettlementSpots(st, p, true)[k * 3];
    applyAction(st, { type: 'settlement', p, vertex: v });
    const e = GEO.vertices[v].edges.find((x) => st.edges[x] === -1);
    applyAction(st, { type: 'road', p, edge: e });
    spots.push(v);
  }
  assert.equal(st.phase, 'play');
  assert.equal(st.current, 1);
  // second-round settlements produced starting resources
  for (let k = 3; k < 6; k++) {
    const p = st.setup.order[k];
    const v = spots[k];
    const expect = GEO.vertices[v].hexes.filter((h) => st.board.hexes[h].terrain !== 'desert').length;
    const have = Object.values(st.players[p].res).reduce((a, b) => a + b, 0);
    assert.equal(have, expect);
  }
});

test('distance rule & road connection', () => {
  const st = fresh();
  const v = 20;
  st.vertices[v] = { p: 0, t: 's' };
  st.players[0].res = { wood: 5, brick: 5, wool: 5, grain: 5, ore: 5 };
  const n = GEO.vertices[v].neighbors[0];
  throwsRule(() => applyAction(st, { type: 'settlement', p: 0, vertex: n }), /距離/);
  // road must connect
  const far = GEO.edges.find((e) => !e.v.includes(v) && !e.v.some((w) => GEO.vertices[v].neighbors.includes(w)));
  throwsRule(() => applyAction(st, { type: 'road', p: 0, edge: far.id }), /連接/);
  const e = GEO.vertices[v].edges[0];
  applyAction(st, { type: 'road', p: 0, edge: e });
  assert.equal(st.edges[e], 0);
});

test('road cannot pass an opponent settlement', () => {
  const st = fresh();
  const vs = walk(10, 3);
  const es = pathEdges(vs);
  st.edges[es[0]] = 0;
  st.edges[es[1]] = 0;
  // opponent settlement on vs[2] (end of my road)
  st.vertices[vs[2]] = { p: 1, t: 's' };
  st.players[0].res.wood = 3;
  st.players[0].res.brick = 3;
  throwsRule(() => applyAction(st, { type: 'road', p: 0, edge: es[2] }), /連接/);
});

test('longest road: chain, loop, branch, broken', () => {
  const st = fresh();
  // chain of 5
  const vs = walk(0, 5);
  pathEdges(vs).forEach((e) => (st.edges[e] = 0));
  assert.equal(longestRoadFor(st, 0), 5);
  // loop around a hex = 6
  const st2 = fresh();
  const hx = GEO.hexes[9];
  hx.edges.forEach((e) => (st2.edges[e] = 1));
  assert.equal(longestRoadFor(st2, 1), 6);
  // loop + tail: 6 + 1 tail = 7
  const corner = hx.vertices[0];
  const tail = GEO.vertices[corner].edges.find((e) => !hx.edges.includes(e));
  st2.edges[tail] = 1;
  assert.equal(longestRoadFor(st2, 1), 7);
  // broken by opponent settlement in the middle of the 5-chain → 2 and 3 → longest 3
  st.vertices[vs[2]] = { p: 2, t: 's' };
  assert.equal(longestRoadFor(st, 0), 3);
  // branch: Y shape counts the longest single path only
  const st3 = fresh();
  const center = GEO.vertices.find((v) => v.neighbors.length === 3).id;
  const used = new Set([center, ...GEO.vertices[center].neighbors]);
  const arms = GEO.vertices[center].neighbors.map((n) => {
    used.delete(n);
    const avoid = new Set(used);
    const arm = walk(n, 2, avoid);
    // keep arms apart: block their vertices and neighbours for the next arm
    arm.forEach((w) => {
      used.add(w);
      GEO.vertices[w].neighbors.forEach((x) => used.add(x));
    });
    return arm;
  });
  arms.forEach((arm) => assert.equal(arm.length, 3, 'arm length'));
  arms.forEach((arm) => {
    st3.edges[GEO.edgeBetween(center, arm[0])] = 3;
    pathEdges(arm).forEach((e) => (st3.edges[e] = 3));
  });
  // each arm is 3 edges long → best path = 6
  assert.equal(longestRoadFor(st3, 3), 6);
});

test('longest road award, keep on tie, set aside on broken tie', () => {
  const st = fresh();
  st.players[0].res = { wood: 9, brick: 9, wool: 9, grain: 9, ore: 9 };
  const vs = walk(0, 6);
  const es = pathEdges(vs);
  st.vertices[vs[0]] = { p: 0, t: 's' };
  for (let i = 0; i < 4; i++) st.edges[es[i]] = 0;
  applyAction(st, { type: 'road', p: 0, edge: es[4] });
  assert.equal(st.longestRoad, 0);
  assert.equal(totalVP(st, 0), 3);
  // player 1 builds an equal-length road elsewhere: holder keeps
  const other = walk(40, 5, new Set(vs));
  const oe = pathEdges(other);
  st.current = 1;
  st.players[1].res = { wood: 9, brick: 9, wool: 9, grain: 9, ore: 9 };
  st.vertices[other[0]] = { p: 1, t: 's' };
  for (let i = 0; i < 4; i++) st.edges[oe[i]] = 1;
  applyAction(st, { type: 'road', p: 1, edge: oe[4] });
  assert.equal(st.longestRoad, 0, 'tie keeps holder');
  // player 1 extends to 6 → takes it
  const ext = GEO.vertices[other[5]].edges.find((e) => st.edges[e] === -1 && !GEO.edges[e].v.some((w) => vs.includes(w)));
  applyAction(st, { type: 'road', p: 1, edge: ext });
  assert.equal(st.longestRoad, 1);
});

test('production shortage rule', () => {
  const st = fresh();
  const hexId = st.board.hexes.findIndex((h) => h.terrain === 'fields' && h.number && h.number !== 7);
  const num = st.board.hexes[hexId].number;
  const hv = GEO.hexes[hexId].vertices;
  st.board.robber = st.board.hexes.findIndex((h) => h.terrain === 'desert');
  // two players on the same fields hex, bank has only 1 grain → nobody gets grain
  st.vertices[hv[0]] = { p: 0, t: 'c' };
  st.vertices[hv[3]] = { p: 1, t: 's' };
  st.bank.grain = 1;
  st.players[2].res.grain = 18;
  // force the dice: search an rng state that rolls `num`
  st.rolled = false;
  let tries = 0;
  for (;;) {
    const c = JSON.parse(JSON.stringify(st));
    const ev = applyAction(c, { type: 'roll', p: 0 });
    if (ev[0].sum === num) {
      const prod = ev.find((e) => e.type === 'produce');
      assert.ok(prod.shortages.some((s) => s.res === 'grain' && !s.partial));
      assert.equal(c.players[0].res.grain, 0);
      assert.equal(c.players[1].res.grain, 0);
      break;
    }
    st.rng[0] = (st.rng[0] + 12345) >>> 0;
    if (++tries > 500) throw new Error('no roll found');
  }
  // only one player affected → gets the remaining card
  st.vertices[hv[3]] = null;
  tries = 0;
  for (;;) {
    const c = JSON.parse(JSON.stringify(st));
    const ev = applyAction(c, { type: 'roll', p: 0 });
    if (ev[0].sum === num) {
      assert.equal(c.players[0].res.grain, 1);
      assert.equal(c.bank.grain, 0);
      break;
    }
    st.rng[0] = (st.rng[0] + 999) >>> 0;
    if (++tries > 500) throw new Error('no roll found');
  }
});

test('trades: harbor ratios, no gifts, no like-for-like', () => {
  const st = fresh();
  const hb = st.board.harbors.find((h) => h.type !== 'any');
  const v = GEO.edges[hb.edge].v[0];
  st.vertices[v] = { p: 0, t: 's' };
  assert.equal(tradeRatio(st, 0, hb.type), 2);
  const otherRes = ['wood', 'brick', 'wool', 'grain', 'ore'].find((r) => r !== hb.type);
  assert.equal(tradeRatio(st, 0, otherRes), 4);
  st.players[0].res[hb.type] = 2;
  applyAction(st, { type: 'bankTrade', p: 0, give: hb.type, get: otherRes });
  assert.equal(st.players[0].res[otherRes], 1);
  throwsRule(() => applyAction(st, { type: 'offer', p: 0, give: { [otherRes]: 1 }, get: {} }), /贈送/);
  st.players[0].res.wool = 2;
  throwsRule(() => applyAction(st, { type: 'offer', p: 0, give: { wool: 1 }, get: { wool: 1 } }), /相同/);
  st.players[1].res.ore = 1;
  applyAction(st, { type: 'offer', p: 0, give: { wool: 1 }, get: { ore: 1 } });
  throwsRule(() => applyAction(st, { type: 'respond', p: 2, accept: true }), /資源/);
  applyAction(st, { type: 'respond', p: 1, accept: true });
  applyAction(st, { type: 'acceptOffer', p: 0, with: 1 });
  assert.equal(st.players[0].res.ore, 1);
  assert.equal(st.players[1].res.wool, 1);
  assert.equal(st.trade, null);
});

test('dev cards: not on the turn bought, one per turn, playable before roll', () => {
  const st = fresh();
  st.devDeck.push('knight');
  st.players[0].res = { wood: 0, brick: 0, wool: 2, grain: 2, ore: 2 };
  applyAction(st, { type: 'buyDev', p: 0 });
  assert.equal(st.players[0].dev.at(-1).type, 'knight');
  throwsRule(() => applyAction(st, { type: 'playDev', p: 0, card: 'knight' }), /下回合/);
  // next own turn, before rolling
  st.turn += 4;
  st.rolled = false;
  st.players[0].dev.push({ type: 'monopoly', turn: 1 });
  applyAction(st, { type: 'playDev', p: 0, card: 'knight' });
  assert.equal(st.pending.type, 'robber');
  const target = (st.board.robber + 1) % 19;
  applyAction(st, { type: 'robber', p: 0, hex: target });
  throwsRule(() => applyAction(st, { type: 'playDev', p: 0, card: 'monopoly', res: 'ore' }), /一張/);
  applyAction(st, { type: 'roll', p: 0 });
});

test('seven: discard half rounded down, robber must move', () => {
  const st = fresh();
  st.rolled = false;
  st.players[1].res = { wood: 9, brick: 0, wool: 0, grain: 0, ore: 0 };
  st.players[2].res = { wood: 0, brick: 7, wool: 0, grain: 0, ore: 0 };
  for (let tries = 0; ; tries++) {
    const c = JSON.parse(JSON.stringify(st));
    const ev = applyAction(c, { type: 'roll', p: 0 });
    if (ev[0].sum === 7) {
      assert.deepEqual(c.pending, { type: 'discard', amounts: { 1: 4 } });
      throwsRule(() => applyAction(c, { type: 'discard', p: 1, cards: { wood: 3 } }), /4/);
      applyAction(c, { type: 'discard', p: 1, cards: { wood: 4 } });
      assert.equal(c.pending.type, 'robber');
      throwsRule(() => applyAction(c, { type: 'robber', p: 0, hex: c.board.robber }), /另一塊/);
      break;
    }
    st.rng[0] = (st.rng[0] + 777) >>> 0;
    if (tries > 1000) throw new Error('no seven');
  }
});

test('win only on own turn; VP cards count', () => {
  const st = fresh();
  st.players[1].dev = Array.from({ length: 5 }, () => ({ type: 'victoryPoint', turn: 1 }));
  // give player 1 five settlements worth of points (5 VP) → 10 total but it's player 0's turn
  const free = [];
  for (let v = 0; v < 54 && free.length < 5; v++) {
    if (GEO.vertices[v].neighbors.some((n) => free.includes(n)) || free.includes(v)) continue;
    free.push(v);
  }
  free.forEach((v) => (st.vertices[v] = { p: 1, t: 's' }));
  st.players[1].pieces.settlements = 0;
  assert.equal(totalVP(st, 1), 10);
  applyAction(st, { type: 'endTurn', p: 0 });
  assert.equal(st.winner, 1, 'wins at the start of own turn');
  assert.equal(st.phase, 'over');
});

test('views hide other hands', () => {
  const st = fresh();
  st.players[1].res.ore = 3;
  st.players[1].dev.push({ type: 'victoryPoint', turn: 1 });
  const v = makeView(st, 0);
  assert.equal(v.players[1].res, null);
  assert.equal(v.players[1].resCount, 3);
  assert.equal(v.players[1].dev, null);
  assert.equal(v.players[1].devCount, 1);
  assert.equal(v.devDeck, null);
  assert.equal(v.rng, null);
});

// ── 5–6 players ──
function fresh6(n = 6, turns) {
  const st = createGame({ seed: 9, players: players(n), firstPlayer: 0, map: 'base-6', rules: turns ? { turns } : undefined });
  st.phase = 'play';
  st.turn = 5;
  st.current = 0;
  st.rolled = true;
  return st;
}

test('5–6 player island: pieces, bank, deck, player range', () => {
  const st = fresh6(5);
  assert.equal(GEO.id, 'base-6');
  assert.equal(GEO.hexes.length, 30);
  const count = {};
  for (const h of st.board.hexes) count[h.terrain] = (count[h.terrain] || 0) + 1;
  assert.deepEqual(count, { forest: 6, pasture: 6, fields: 6, hills: 5, mountains: 5, desert: 2 });
  assert.equal(st.board.hexes.filter((h) => h.number).length, 28);
  assert.equal(st.board.harbors.length, 11);
  assert.equal(st.board.harbors.filter((h) => h.type === 'any').length, 5);
  assert.equal(st.board.harbors.filter((h) => h.type === 'wool').length, 2);
  assert.equal(new Set(st.board.harbors.map((h) => h.edge)).size, 11);
  assert.deepEqual(st.bank, { wood: 24, brick: 24, wool: 24, grain: 24, ore: 24 });
  assert.equal(st.devDeck.length, 34);
  assert.equal(st.devDeck.filter((c) => c === 'knight').length, 20);
  assert.equal(st.rules.turns, 'paired');
  throwsRule(() => createGame({ seed: 1, players: players(4), map: 'base-6' }), /5–6/);
  throwsRule(() => createGame({ seed: 1, players: players(5), map: 'base-4' }), /2–4/);
});

test('paired turns: the second player builds and trades with the bank only', () => {
  const st = fresh6(6);
  applyAction(st, { type: 'endTurn', p: 0 });
  assert.deepEqual(st.sub, { k: 'pair', lead: 0, rest: [] });
  assert.equal(st.current, 3);
  assert.equal(st.turn, 5);
  throwsRule(() => applyAction(st, { type: 'roll', p: 3 }));
  st.players[3].res = { wood: 4, brick: 1, wool: 0, grain: 0, ore: 0 };
  throwsRule(() => applyAction(st, { type: 'offer', p: 3, give: { wood: 1 }, get: { ore: 1 } }), /第二位/);
  applyAction(st, { type: 'bankTrade', p: 3, give: 'wood', get: 'ore' });
  assert.equal(st.players[3].res.ore, 1);
  // one development card, bought on an earlier turn
  st.players[3].dev = [{ type: 'monopoly', turn: 4 }, { type: 'yearOfPlenty', turn: 5 }];
  throwsRule(() => applyAction(st, { type: 'playDev', p: 3, card: 'yearOfPlenty', res: ['ore', 'ore'] }), /下回合/);
  applyAction(st, { type: 'playDev', p: 3, card: 'monopoly', res: 'wool' });
  // the markers pass left: the next main player rolls
  applyAction(st, { type: 'endTurn', p: 3 });
  assert.equal(st.sub, null);
  assert.equal(st.current, 1);
  assert.equal(st.turn, 6);
  assert.equal(st.rolled, false);
  applyAction(st, { type: 'roll', p: 1 });
  applyAction(st, { type: 'endTurn', p: 1 });
  assert.equal(st.current, 4);
  // five players: still three seats on
  const s5 = fresh6(5);
  s5.current = 3;
  applyAction(s5, { type: 'endTurn', p: 3 });
  assert.equal(s5.current, 1);
});

test('paired turns: the second player can win; the main player wins at once', () => {
  const st = fresh6(6);
  st.targetVP = 3;
  st.vertices[0] = { p: 3, t: 'c' };
  st.vertices[10] = { p: 3, t: 's' };
  applyAction(st, { type: 'endTurn', p: 0 });
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 3);
});

test('paired turns: the main player wins in the second part too, before the second player', () => {
  const st = fresh6(6);
  st.targetVP = 4;
  // the second player's part ends with both at the target: the main player wins
  applyAction(st, { type: 'endTurn', p: 0 });
  st.vertices[0] = { p: 0, t: 'c' };
  st.vertices[10] = { p: 0, t: 'c' };
  st.vertices[20] = { p: 3, t: 'c' };
  st.vertices[30] = { p: 3, t: 'c' };
  st.players[3].res.wood = 4;
  applyAction(st, { type: 'bankTrade', p: 3, give: 'wood', get: 'ore' });
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 0);
});

test('special building phase: everyone else builds in turn, no trades or cards, no win', () => {
  const st = fresh6(5, 'sbp');
  applyAction(st, { type: 'endTurn', p: 0 });
  assert.deepEqual(st.sub, { k: 'sbp', lead: 0, rest: [2, 3, 4] });
  assert.equal(st.current, 1);
  st.players[1].res = { wood: 4, brick: 1, wool: 1, grain: 1, ore: 1 };
  throwsRule(() => applyAction(st, { type: 'bankTrade', p: 1, give: 'wood', get: 'ore' }), /特別建造/);
  throwsRule(() => applyAction(st, { type: 'offer', p: 1, give: { wood: 1 }, get: { ore: 1 } }), /特別建造/);
  st.players[1].dev = [{ type: 'monopoly', turn: 1 }];
  throwsRule(() => applyAction(st, { type: 'playDev', p: 1, card: 'monopoly', res: 'wool' }), /特別建造/);
  applyAction(st, { type: 'buyDev', p: 1 });
  // reaching the target in the building phase does not win until the player's own turn
  st.targetVP = 2;
  st.vertices[0] = { p: 2, t: 'c' };
  applyAction(st, { type: 'endTurn', p: 1 });
  assert.equal(st.current, 2);
  assert.equal(st.phase, 'play');
  for (const p of [2, 3, 4]) applyAction(st, { type: 'endTurn', p });
  assert.equal(st.sub, null);
  assert.equal(st.current, 1);
  assert.equal(st.turn, 6);
  applyAction(st, { type: 'roll', p: 1 });
  applyAction(st, { type: 'endTurn', p: 1 });
  applyAction(st, { type: 'endTurn', p: 2 });
  // player 2's own turn begins as soon as the building phase after player 1 is over
  for (const p of [3, 4, 0]) applyAction(st, { type: 'endTurn', p });
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 2);
});

// ── Seafarers (scenario 1) ──
function freshSea(n = 4, seed = 21) {
  const st = createGame({ seed, players: players(n), firstPlayer: 0, map: 'sea-1' });
  st.phase = 'play';
  st.turn = 5;
  st.current = 0;
  st.rolled = true;
  return st;
}
// a coastal intersection of the home island with a pure-sea path next to it, and that path
function harborSpot(st) {
  const sea = seaInfo(st.board);
  for (let v = 0; v < GEO.vertices.length; v++) {
    if (!sea.coast[v] || !sea.home.has(sea.vIsland[v])) continue;
    const seaEdge = GEO.vertices[v].edges.find((e) => sea.eLand[e] === 0 && sea.eSea[e] > 0 && !pirateEdges(st).includes(e));
    if (seaEdge !== undefined) return { v, e: seaEdge };
  }
  throw new Error('no harbor spot');
}
const give = (st, p, res) => Object.assign(st.players[p].res, res);

test('Seafarers scenario 1: the islands, pieces and points', () => {
  const st = freshSea(4);
  assert.equal(GEO.id, 'sea-1');
  assert.equal(st.targetVP, 14);
  const count = {};
  for (const h of st.board.hexes) count[h.terrain] = (count[h.terrain] || 0) + 1;
  assert.equal(count.gold, 2);
  assert.equal(count.sea, 14);
  assert.equal(count.desert, 1);
  assert.equal(st.board.hexes[st.board.pirate].terrain, 'sea');
  assert.equal(st.board.hexes[st.board.robber].terrain, 'desert');
  assert.equal(st.board.harbors.length, 9);
  const sea = seaInfo(st.board);
  // harbors only round the home island
  for (const hb of st.board.harbors) assert.ok(GEO.edges[hb.edge].hexes.some((h) => sea.home.has(sea.island[h])));
  assert.ok(sea.islands >= 2, 'small islands besides the home island');
  assert.equal(st.players[0].pieces.ships, 15);
  assert.equal(st.ships.length, GEO.edges.length);
});

test('Seafarers: the frame round the map is sea', () => {
  const st = createGame({ seed: 21, players: players(4), firstPlayer: 0, map: 'sea-1' });
  const sea = seaInfo(st.board);
  // a path along the map's edge on the home island: land on one side, the frame on the other
  const spots = legalSettlementSpots(st, 0, true);
  const e = GEO.edges.findIndex((x) => x.hexes.length === 1 && sea.land[x.hexes[0]] && sea.home.has(sea.island[x.hexes[0]]) && x.v.some((v) => spots.includes(v)));
  assert.ok(e >= 0, 'the home island reaches the frame');
  assert.equal(sea.eLand[e], 1);
  assert.equal(sea.eSea[e], 1);
  applyAction(st, { type: 'settlement', p: 0, vertex: GEO.edges[e].v.find((v) => spots.includes(v)) });
  assert.ok(legalShips(st, 0).includes(e), 'a ship along the frame');
  assert.ok(legalRoadEdges(st, 0).includes(e), 'or a road along the coast');
});

test('Seafarers: opening on the home island, a ship instead of a road', () => {
  const st = createGame({ seed: 21, players: players(4), firstPlayer: 0, map: 'sea-1' });
  const sea = seaInfo(st.board);
  const spots = legalSettlementSpots(st, 0, true);
  assert.ok(spots.length > 10 && spots.every((v) => sea.home.has(sea.vIsland[v])), 'opening spots on the home island only');
  const { v, e } = harborSpot(st);
  applyAction(st, { type: 'settlement', p: 0, vertex: v });
  throwsRule(() => applyAction(st, { type: 'road', p: 0, edge: e }), /海上/);
  applyAction(st, { type: 'ship', p: 0, edge: e });
  assert.equal(st.ships[e], 0);
  assert.equal(st.players[0].pieces.ships, 14);
  assert.equal(st.setup.i, 1);
});

test('Seafarers: building ships, roads and ships meet only at a settlement', () => {
  const st = freshSea(4);
  const sea = seaInfo(st.board);
  const { v, e } = harborSpot(st);
  st.vertices[v] = { p: 0, t: 's' };
  give(st, 0, { wood: 5, wool: 5, brick: 5 });
  throwsRule(() => applyAction(st, { type: 'ship', p: 1, edge: e }));
  applyAction(st, { type: 'ship', p: 0, edge: e });
  assert.equal(st.players[0].res.wood, 4);
  assert.equal(st.players[0].res.wool, 4);
  // the next ship goes on from the ship's far end
  const far = GEO.edges[e].v.find((x) => x !== v);
  const next = GEO.vertices[far].edges.find((x) => x !== e && sea.eSea[x] > 0 && !pirateEdges(st).includes(x));
  applyAction(st, { type: 'ship', p: 0, edge: next });
  // a road can't continue from a ship's end (no settlement there)
  const landFrom = GEO.vertices[far].edges.find((x) => x !== e && sea.eLand[x] > 0 && st.ships[x] === -1);
  if (landFrom !== undefined) throwsRule(() => applyAction(st, { type: 'road', p: 0, edge: landFrom }));
  // an inland path takes no ship
  const inland = GEO.edges.findIndex((x, i) => sea.eSea[i] === 0 && x.hexes.length === 2);
  throwsRule(() => applyAction(st, { type: 'ship', p: 0, edge: inland }));
});

test('Seafarers: no ship by the pirate; the pirate robs ship owners', () => {
  const st = freshSea(4);
  const sea = seaInfo(st.board);
  // a ship of player 1 beside a sea hex, the pirate moved there by player 0's knight
  const hex = GEO.hexes.find((h) => !sea.land[h.id] && h.id !== st.board.pirate && h.edges.some((e) => GEO.edges[e].v.some((v) => sea.coast[v])));
  const e = hex.edges.find((x) => GEO.edges[x].v.some((v) => sea.coast[v]));
  st.ships[e] = 1;
  give(st, 1, { ore: 2 });
  st.players[0].dev = [{ type: 'knight', turn: 1 }];
  applyAction(st, { type: 'playDev', p: 0, card: 'knight' });
  applyAction(st, { type: 'robber', p: 0, hex: hex.id });
  assert.equal(st.board.pirate, hex.id);
  assert.equal(st.players[0].res.ore, 1, 'stole from the ship owner');
  // no new ship on the pirate's hex
  const other = hex.edges.find((x) => x !== e && st.ships[x] === -1);
  st.vertices[GEO.edges[other].v[0]] = { p: 1, t: 's' };
  give(st, 1, { wood: 1, wool: 1 });
  st.current = 1;
  throwsRule(() => applyAction(st, { type: 'ship', p: 1, edge: other }), /海盜/);
});

test('Seafarers: a settlement reached by sea, and the bonus for a new island', () => {
  const st = freshSea(4);
  const sea = seaInfo(st.board);
  // a coastal intersection of a small island, and a sea path from it
  const v = GEO.vertices.findIndex((x, i) => sea.coast[i] && sea.vIsland[i] >= 0 && !sea.home.has(sea.vIsland[i]) && GEO.vertices[i].edges.some((e) => sea.eLand[e] === 0 && !pirateEdges(st).includes(e)));
  const e = GEO.vertices[v].edges.find((x) => sea.eLand[x] === 0 && !pirateEdges(st).includes(x));
  st.ships[e] = 0;
  give(st, 0, { wood: 2, brick: 2, wool: 2, grain: 2 });
  const before = publicVP(st, 0);
  applyAction(st, { type: 'settlement', p: 0, vertex: v });
  assert.equal(st.players[0].chits, 2);
  assert.equal(publicVP(st, 0), before + 3, 'the settlement and two bonus points');
  // a second settlement on the same island earns nothing more
  const w = GEO.vertices.findIndex((x, i) => i !== v && sea.vIsland[i] === sea.vIsland[v] && distanceOK(st, i));
  if (w >= 0) {
    st.vertices[w] = null;
    const ew = GEO.vertices[w].edges[0];
    st.edges[ew] = sea.eLand[ew] ? 0 : -1;
    st.ships[ew] = sea.eLand[ew] ? -1 : 0;
    applyAction(st, { type: 'settlement', p: 0, vertex: w });
    assert.equal(st.players[0].chits, 2);
  }
});

test('Seafarers: moving a ship from the open end of a route, once a turn', () => {
  const st = freshSea(4);
  const sea = seaInfo(st.board);
  const { v, e } = harborSpot(st);
  st.vertices[v] = { p: 0, t: 's' };
  const far = GEO.edges[e].v.find((x) => x !== v);
  const next = GEO.vertices[far].edges.find((x) => x !== e && sea.eSea[x] > 0 && !pirateEdges(st).includes(x));
  st.ships[e] = 0;
  st.ships[next] = 0;
  // the ship at the open end moves; the one between the settlement and the other ship does not
  throwsRule(() => applyAction(st, { type: 'moveShip', p: 0, from: e, to: next }));
  const targets = shipTargets(st, 0, next);
  assert.ok(targets.length > 0);
  applyAction(st, { type: 'moveShip', p: 0, from: next, to: targets[0] });
  assert.equal(st.ships[next], -1);
  assert.equal(st.ships[targets[0]], 0);
  throwsRule(() => applyAction(st, { type: 'moveShip', p: 0, from: targets[0], to: next }), /每回合/);
  // a ship built this turn stays put
  applyAction(st, { type: 'endTurn', p: 0 });
  for (const p of [1, 2, 3]) {
    applyAction(st, { type: 'roll', p });
    while (st.pending) {
      if (st.pending.type === 'discard') for (const q of Object.keys(st.pending.amounts)) applyAction(st, { type: 'discard', p: +q, cards: st.players[q].res.wood >= st.pending.amounts[q] ? { wood: st.pending.amounts[q] } : (() => { const c = {}; let k = st.pending.amounts[q]; for (const r of ['wood', 'brick', 'wool', 'grain', 'ore']) { const t = Math.min(k, st.players[q].res[r]); if (t) c[r] = t; k -= t; } return c; })() });
      else if (st.pending.type === 'robber') applyAction(st, { type: 'robber', p, hex: GEO.hexes.find((h) => sea.land[h.id] && h.id !== st.board.robber).id });
      else if (st.pending.type === 'steal') applyAction(st, { type: 'steal', p, target: st.pending.victims[0] });
      else if (st.pending.type === 'gold') for (const q of Object.keys(st.pending.amounts)) applyAction(st, { type: 'gold', p: +q, res: { ore: st.pending.amounts[q] } });
    }
    applyAction(st, { type: 'endTurn', p });
  }
  assert.equal(st.shipMoved, false);
});

test('Seafarers: a gold field gives the resources its owners choose', () => {
  const st = freshSea(4);
  const gold = GEO.hexes.find((h) => st.board.hexes[h.id].terrain === 'gold');
  const n = st.board.hexes[gold.id].number;
  st.vertices[gold.vertices[0]] = { p: 2, t: 'c' };
  st.rolled = false;
  // roll until the gold field's number comes up
  for (let k = 0; k < 400 && !(st.pending && st.pending.type === 'gold'); k++) {
    st.rolled = false;
    st.pending = null;
    applyAction(st, { type: 'roll', p: 0 });
    if (st.dice[0] + st.dice[1] !== n) st.pending = null;
  }
  assert.deepEqual(st.pending, { type: 'gold', amounts: { 2: 2 } });
  throwsRule(() => applyAction(st, { type: 'endTurn', p: 0 }));
  throwsRule(() => applyAction(st, { type: 'gold', p: 2, res: { ore: 1 } }), /2 張/);
  const ore = st.players[2].res.ore;
  applyAction(st, { type: 'gold', p: 2, res: { ore: 1, grain: 1 } });
  assert.equal(st.players[2].res.ore, ore + 1);
  assert.equal(st.pending, null);
});

// ── Seafarers (scenario 2: the four islands) ──
test('Seafarers scenario 2: four islands, the robber on the 12, harbors round every island', () => {
  const st = createGame({ seed: 5, players: players(4), firstPlayer: 0, map: 'sea-2' });
  assert.equal(GEO.id, 'sea-2');
  assert.equal(st.targetVP, 13);
  const sea = seaInfo(st.board);
  assert.equal(sea.islands, 4);
  const count = {};
  for (const h of st.board.hexes) count[h.terrain] = (count[h.terrain] || 0) + 1;
  assert.equal(count.sea, 12);
  assert.equal(count.desert, undefined);
  assert.equal(count.gold, undefined);
  assert.equal(st.board.hexes.filter((h) => h.number).length, 23);
  assert.equal(st.board.hexes[st.board.robber].number, 12, 'the robber starts on the 12');
  assert.equal(st.board.hexes[st.board.pirate].terrain, 'sea');
  assert.equal(st.board.harbors.length, 9);
  const per = [0, 0, 0, 0];
  for (const hb of st.board.harbors) per[GEO.edges[hb.edge].hexes.map((h) => sea.island[h]).find((i) => i >= 0)]++;
  assert.ok(per.every((k) => k >= 2), 'harbors on every island: ' + per);
  const corners = new Set();
  for (const hb of st.board.harbors) for (const v of GEO.edges[hb.edge].v) {
    assert.ok(!corners.has(v), 'no two harbors share an intersection');
    corners.add(v);
  }
});

test('Seafarers scenario 2: the islands a player starts on are home; the others earn points', () => {
  const st = createGame({ seed: 5, players: players(4), firstPlayer: 0, map: 'sea-2' });
  const sea = seaInfo(st.board);
  const isles = new Set(legalSettlementSpots(st, 0, true).map((v) => sea.vIsland[v]));
  assert.equal(isles.size, 4, 'the opening may go on any island');
  // but never out at sea
  const wet = GEO.vertices.findIndex((x, i) => !sea.vLand[i]);
  throwsRule(() => applyAction(st, { type: 'settlement', p: 0, vertex: wet }), /陸地/);
  // player 0 starts on islands 0 and 1, the others on one island each (a ship where no road fits)
  const plan = { 0: [0, 1], 1: [1, 1], 2: [2, 2], 3: [3, 3] };
  const done = [0, 0, 0, 0];
  while (st.phase === 'setup') {
    const p = st.setup.order[st.setup.i];
    const v = legalSettlementSpots(st, p, true).find((x) => sea.vIsland[x] === plan[p][done[p]]);
    applyAction(st, { type: 'settlement', p, vertex: v });
    const roads = legalRoadEdges(st, p);
    applyAction(st, roads.length ? { type: 'road', p, edge: roads[0] } : { type: 'ship', p, edge: legalShips(st, p)[0] });
    done[p]++;
  }
  assert.deepEqual([...st.players[0].home].sort(), [0, 1]);
  assert.deepEqual(st.players[1].home, [1]);
  assert.deepEqual(st.players[3].home, [3]);
  st.current = 0;
  st.rolled = true;
  give(st, 0, { wood: 4, brick: 4, wool: 4, grain: 4 });
  const reach = (isle) => {
    const v = GEO.vertices.findIndex((x, i) => sea.vIsland[i] === isle && sea.coast[i] && distanceOK(st, i) && x.edges.some((e) => sea.eLand[e] === 0 && st.ships[e] === -1 && !pirateEdges(st).includes(e)));
    const e = GEO.vertices[v].edges.find((x) => sea.eLand[x] === 0 && st.ships[x] === -1 && !pirateEdges(st).includes(x));
    st.ships[e] = 0;
    return v;
  };
  // island 2 is foreign to player 0: 2 points; island 1 is home: none
  applyAction(st, { type: 'settlement', p: 0, vertex: reach(2) });
  assert.equal(st.players[0].chits, 2);
  assert.deepEqual(st.players[0].isles, [2]);
  applyAction(st, { type: 'settlement', p: 0, vertex: reach(1) });
  assert.equal(st.players[0].chits, 2, 'no points on a home island');
  // the home islands travel to the other pages
  const view = makeView(st, 1);
  assert.deepEqual([...view.players[0].home].sort(), [0, 1]);
});

// ── Seafarers (scenario 3: the fog islands) ──
function freshFog(seed = 31) {
  const st = createGame({ seed, players: players(4), firstPlayer: 0, map: 'sea-3' });
  st.phase = 'play';
  st.turn = 5;
  st.current = 0;
  st.rolled = true;
  return st;
}
// a path a ship can take to an intersection beside a hidden hex, and the ship that leads to it
function toTheFog(st) {
  const sea = seaInfo(st.board);
  const fogAt = (v) => GEO.vertices[v].hexes.some((h) => st.board.hexes[h].terrain === 'fog');
  for (let e = 0; e < GEO.edges.length; e++) {
    const E = GEO.edges[e];
    if (!sea.eSea[e] || E.hexes.some((h) => st.board.hexes[h].terrain === 'fog') || pirateEdges(st).includes(e)) continue;
    const [a, b] = E.v;
    const [from, to] = fogAt(a) ? [b, a] : fogAt(b) ? [a, b] : [-1, -1];
    if (from < 0 || fogAt(from)) continue;
    const lead = GEO.vertices[from].edges.find((x) => x !== e && sea.eSea[x] && !GEO.edges[x].v.some(fogAt) && !pirateEdges(st).includes(x));
    if (lead === undefined) continue;
    return { e, lead, to, hidden: GEO.vertices[to].hexes.filter((h) => st.board.hexes[h].terrain === 'fog') };
  }
  throw new Error('no way into the fog');
}

test('Seafarers scenario 3: the fog islands', () => {
  const st = createGame({ seed: 31, players: players(4), firstPlayer: 0, map: 'sea-3' });
  assert.equal(GEO.id, 'sea-3');
  assert.equal(st.targetVP, 12);
  const fog = st.board.hexes.filter((h) => h.terrain === 'fog');
  assert.equal(fog.length, 12);
  assert.ok(fog.every((h) => !h.number && !h.name), 'the fog shows nothing');
  assert.equal(st.board.hexes[st.board.robber].number, 12, 'the robber starts on the 12');
  assert.equal(st.board.hexes.filter((h) => h.number).length, 17);
  assert.equal(st.fog.pool.length, 12);
  assert.deepEqual([...st.fog.numbers].sort((a, b) => a - b), [3, 4, 5, 6, 8, 9, 10, 11, 11, 12]);
  const sea = seaInfo(st.board);
  assert.equal(sea.islands, 2, 'the upper and the lower island');
  assert.equal(st.board.harbors.length, 9);
  for (const hb of st.board.harbors) assert.ok(GEO.edges[hb.edge].hexes.every((h) => st.board.hexes[h].terrain !== 'fog'), 'no harbor faces the fog');
  for (const v of legalSettlementSpots(st, 0, true)) assert.ok(sea.vLand[v], 'the opening goes on land');
  // the fog's pile stays on the host: another player's view has no dice to draw it with
  assert.equal(makeView(st, 1).rng, null);
});

test('Seafarers scenario 3: a ship reaching the fog discovers what it hides', () => {
  const st = freshFog();
  const { e, lead, hidden } = toTheFog(st);
  st.ships[lead] = 0;
  give(st, 0, { wood: 1, wool: 1 });
  const bank = { ...st.bank };
  const res = { ...st.players[0].res };
  const ev = applyAction(st, { type: 'ship', p: 0, edge: e });
  const found = ev.filter((x) => x.type === 'discover');
  assert.equal(found.length, hidden.length);
  assert.equal(st.fog.pool.length, 12 - hidden.length);
  for (const f of found) {
    const H = st.board.hexes[f.hex];
    assert.equal(H.terrain, f.terrain);
    assert.notEqual(H.terrain, 'fog');
    if (f.terrain === 'sea') assert.equal(H.number, 0);
    else assert.ok(H.number >= 3 && H.number <= 12 && H.name, 'land takes a number and a name');
  }
  // one resource of each land found (gold: picked next)
  const paid = found.filter((f) => f.res).map((f) => f.res);
  for (const r of paid) {
    assert.equal(st.players[0].res[r], res[r] + paid.filter((x) => x === r).length - (r === 'wood' || r === 'wool' ? 1 : 0));
    assert.equal(st.bank[r], bank[r] - paid.filter((x) => x === r).length + (r === 'wood' || r === 'wool' ? 1 : 0));
  }
  const gold = found.filter((f) => f.terrain === 'gold').length;
  if (gold) assert.deepEqual(st.pending, { type: 'gold', amounts: { 0: gold } });
  else assert.equal(st.pending, null);
  // the pages that lay the board out themselves see the same thing
  assert.deepEqual(seaInfo(st.board).land.length, GEO.hexes.length);
});

test('Seafarers scenario 3: gold in the fog, the road building card, and the pirate', () => {
  const st = freshFog();
  const { e, lead, hidden } = toTheFog(st);
  st.ships[lead] = 0;
  st.fog.pool = st.fog.pool.map(() => 'gold');
  // found while the road building card is in play: picked once its pieces are down
  st.pending = { type: 'roadBuilding', left: 2 };
  applyAction(st, { type: 'ship', p: 0, edge: e });
  assert.equal(st.pending.type, 'roadBuilding');
  assert.equal(st.pending.gold, hidden.length);
  applyAction(st, { type: 'endRoadBuilding', p: 0 });
  assert.deepEqual(st.pending, { type: 'gold', amounts: { 0: hidden.length } });
  const before = st.players[0].res.ore;
  applyAction(st, { type: 'gold', p: 0, res: { ore: hidden.length } });
  assert.equal(st.players[0].res.ore, before + hidden.length);
  assert.equal(st.pending, null);
  // the pirate stays out of the fog
  const still = st.board.hexes.findIndex((h) => h.terrain === 'fog');
  st.pending = { type: 'robber', reason: 'seven' };
  throwsRule(() => applyAction(st, { type: 'robber', p: 0, hex: still }), /霧/);
});

test('Seafarers scenario 3: gold found in the opening is picked before the next placement', () => {
  const st = createGame({ seed: 31, players: players(4), firstPlayer: 0, map: 'sea-3' });
  st.fog.pool = st.fog.pool.map(() => 'gold');
  const sea = seaInfo(st.board);
  const fogAt = (v) => GEO.vertices[v].hexes.some((h) => st.board.hexes[h].terrain === 'fog');
  // an opening settlement whose ship reaches an intersection beside the fog
  let spot = null;
  for (const v of legalSettlementSpots(st, 0, true)) {
    const e = GEO.vertices[v].edges.find((x) => sea.eSea[x] && fogAt(GEO.edges[x].v.find((u) => u !== v)));
    if (e !== undefined) {
      spot = { v, e };
      break;
    }
  }
  if (!spot) return; // (this map keeps the fog out of an opening ship's reach)
  applyAction(st, { type: 'settlement', p: 0, vertex: spot.v });
  applyAction(st, { type: 'ship', p: 0, edge: spot.e });
  assert.equal(st.pending.type, 'gold');
  assert.deepEqual(actorsNow(st), [0], 'the pick comes before the next player places');
  const next = st.setup.order[st.setup.i];
  throwsRule(() => applyAction(st, { type: 'settlement', p: next, vertex: legalSettlementSpots(st, next, true)[0] }));
  applyAction(st, { type: 'gold', p: 0, res: { grain: st.pending.amounts[0] } });
  assert.equal(st.pending, null);
  applyAction(st, { type: 'settlement', p: next, vertex: legalSettlementSpots(st, next, true)[0] });
});

test('Seafarers: the longest trade route joins roads and ships at a settlement only', () => {
  const st = freshSea(4);
  const sea = seaInfo(st.board);
  const { v, e } = harborSpot(st);
  // a road of 2 to the coastal intersection, then 2 ships
  const road1 = GEO.vertices[v].edges.find((x) => sea.eLand[x] > 0 && x !== e);
  const v1 = GEO.edges[road1].v.find((x) => x !== v);
  const road2 = GEO.vertices[v1].edges.find((x) => x !== road1 && sea.eLand[x] > 0);
  st.edges[road1] = 0;
  st.edges[road2] = 0;
  const far = GEO.edges[e].v.find((x) => x !== v);
  const next = GEO.vertices[far].edges.find((x) => x !== e && sea.eSea[x] > 0);
  st.ships[e] = 0;
  st.ships[next] = 0;
  const len = (s) => tradeRouteFor(s, 0);
  assert.equal(len(st), 2, 'without a settlement where they meet, the longer of the two');
  st.vertices[v] = { p: 0, t: 's' };
  assert.equal(len(st), 4, 'joined at the settlement');
});

console.log(`${passed} tests passed`);
