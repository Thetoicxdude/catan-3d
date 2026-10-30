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
} from '../src/engine/engine.js';

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

console.log(`${passed} tests passed`);
