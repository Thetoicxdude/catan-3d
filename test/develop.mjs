// The development mode's rules (src/engine/develop.js and its hooks in the engine): the maps,
// blueprints, developments, special buildings beside settlements, world wonders and their defence.
import assert from 'node:assert/strict';
import { GEO } from '../src/engine/geometry.js';
import { createGame, applyAction, RuleError, tradeRatio, makeView, totalVP, publicVP, actorsNow, robberVictims, handLimitOf, playableDev, redactEvent } from '../src/engine/engine.js';
import { mapDef, developMap } from '../src/engine/maps.js';
import { PRESETS, validBlueprint, BUILDINGS, slotsAt, specialHosts, plotSpots, wonderSpots, robberSpots, guardedHexes, BASIC, hasBasic, upgradeCards, NO_CARD } from '../src/engine/develop.js';
import { TERRAIN_RES, RES } from '../src/engine/board.js';
import { seedState } from '../src/engine/rng.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.log('FAIL', name, '\n ', e.stack.split('\n').slice(0, 3).join('\n  '));
    process.exitCode = 1;
  }
}
const throwsRule = (fn, re) => assert.throws(fn, (e) => e instanceof RuleError && (!re || re.test(e.message)));
const act = (st, a) => applyAction(st, a);

// bp: one blueprint (a preset's name or the buildings) for every seat, or a list of them, seat by seat
const seats = (n, bp = 'port') => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: '#fff', kind: 'human', bp: Array.isArray(bp) && typeof bp[0] !== 'string' ? bp[i] : bp }));
// a game in play on an empty board: player 0 to move, dice rolled
function fresh(bp, n = 4, seed = 5) {
  const st = createGame({ seed, players: seats(n, bp), map: developMap(n).id, firstPlayer: 0 });
  // (a list of buildings: the four basic cards with all of them, whatever their number, as the tests
  // here are about the buildings; the basic cards themselves: their own test)
  st.players.forEach((pl, i) => {
    const b = Array.isArray(bp) && typeof bp[0] !== 'string' ? bp[i] : bp;
    if (Array.isArray(b)) pl.bp = [...BASIC.filter((k) => !b.includes(k)), ...b];
  });
  st.phase = 'play';
  st.turn = 5;
  st.current = 0;
  st.rolled = true;
  // the robber out of the way (on a desert no test uses: the last one)
  return st;
}
const give = (st, p, res) => Object.assign(st.players[p].res, res);
const all = (n) => ({ wood: n, brick: n, wool: n, grain: n, ore: n });
const place = (st, p, v, t = 's') => (st.vertices[v] = { p, t });
const terr = (st, h) => st.board.hexes[h].terrain;
// an intersection with three land hexes whose hexes pass test(terrains)
function spot(st, test, avoid = []) {
  for (const v of GEO.vertices) {
    if (v.hexes.length !== 3 || avoid.includes(v.id)) continue;
    if (test(v.hexes.map((h) => terr(st, h)), v)) return v.id;
  }
  return -1;
}
const deserts = (st) => st.board.hexes.map((h, i) => (h.terrain === 'desert' ? i : -1)).filter((i) => i >= 0);
// the robber onto a hex that touches none of the given ones
function robberAway(st, keep = []) {
  const near = new Set(keep.flatMap((h) => [h, ...GEO.hexes[h].neighbors]));
  st.board.robber = GEO.hexes.find((h) => !near.has(h.id) && terr(st, h.id) !== 'desert').id;
}
// a roll of exactly `sum` (the dice are the game's: try seeds of the rng until it comes)
function rollSum(st, sum) {
  const save = JSON.stringify(st);
  for (let k = 0; k < 500; k++) {
    const s = JSON.parse(save);
    s.rng = seedState(k + 1);
    s.rolled = false;
    const ev = act(s, { type: 'roll', p: s.current });
    if (ev[0].sum === sum) {
      Object.assign(st, s);
      return ev;
    }
  }
  throw new Error('no roll of ' + sum);
}

test('maps: 37 hexes at four players, 30 at two or three; pieces, bank, deck, points', () => {
  const st = createGame({ seed: 3, players: seats(4), map: 'dev-4' });
  assert.equal(GEO.hexes.length, 37);
  assert.equal(deserts(st).length, 3);
  assert.equal(st.board.hexes.filter((h) => h.number).length, 34);
  assert.equal(st.board.harbors.length, 12);
  assert.equal(st.devDeck.length, 35);
  assert.equal(st.bank.wood, 30);
  assert.deepEqual(st.players[0].pieces, { roads: 25, settlements: 7, cities: 5 });
  assert.equal(st.targetVP, 18);
  assert.equal(st.board.hexes[st.board.robber].terrain, 'desert');
  assert.equal(createGame({ seed: 3, players: seats(4), map: 'dev-4', vpAdj: -3 }).targetVP, 15);
  const st3 = createGame({ seed: 3, players: seats(3), map: 'dev-3' });
  assert.equal(GEO.hexes.length, 30);
  assert.equal(deserts(st3).length, 2);
  assert.equal(st3.board.hexes.filter((h) => h.number).length, 28);
  assert.equal(st3.board.harbors.length, 11);
  throwsRule(() => createGame({ seed: 3, players: seats(4), map: 'dev-3' }));
  throwsRule(() => createGame({ seed: 3, players: seats(3), map: 'dev-4' }));
  assert.equal(developMap(2).id, 'dev-3');
  assert.equal(mapDef('dev-4').rules.develop, true);
});

test('maps: deserts apart, some inland; no patch over three; numbers spread', () => {
  for (const id of ['dev-4', 'dev-3']) {
    for (let seed = 1; seed <= 40; seed++) {
      const st = createGame({ seed, players: seats(id === 'dev-4' ? 4 : 3), map: id });
      const T = st.board.hexes.map((h) => h.terrain);
      const d = deserts(st);
      for (const h of d) assert.ok(!GEO.hexes[h].neighbors.some((n) => T[n] === 'desert'), 'deserts touch');
      assert.ok(d.filter((h) => GEO.hexes[h].neighbors.length === 6).length >= (id === 'dev-4' ? 2 : 1), 'inland deserts');
      for (const h of GEO.hexes) {
        const a = st.board.hexes[h.id].number;
        for (const n of h.neighbors) {
          const b = st.board.hexes[n].number;
          if (a && b) assert.ok(a !== b && !([6, 8].includes(a) && [6, 8].includes(b)), 'numbers touch');
        }
      }
    }
  }
});

test('blueprints: up to seven cards (basic cards and buildings), one wonder at most; a preset by name; what a seat brings', () => {
  assert.ok(Object.values(PRESETS).every(validBlueprint));
  assert.ok(Object.values(PRESETS).every((bp) => bp.length === 7 && BASIC.every((k) => bp.includes(k))), 'the computers bring the four basic cards and three buildings');
  assert.ok(!validBlueprint(['market', 'market', 'shipyard']));
  assert.ok(!validBlueprint(['market', 'gardens', 'library']));
  assert.ok(!validBlueprint([...PRESETS.port, 'wall']));
  assert.ok(!validBlueprint(['market', 'x']));
  assert.ok(validBlueprint([]));
  assert.ok(validBlueprint([...BASIC, 'granary', 'market', 'aqueduct']), "a new player's");
  assert.ok(validBlueprint(['road', 'settlement', 'granary', 'market', 'guild', 'wall', 'gardens']), 'basic cards left out for buildings');
  const st = createGame({ seed: 1, players: [{ name: 'a', bp: 'order' }, { name: 'b', bp: ['x', 'road', 'granary', 'granary', 'gardens', 'library'] }, { name: 'c' }, { name: 'd', bp: PRESETS.farm }], map: 'dev-4' });
  assert.deepEqual(st.players[0].bp, PRESETS.order);
  assert.deepEqual(st.players[1].bp, ['road', 'granary', 'gardens']);
  assert.deepEqual(st.players[2].bp, []);
  assert.deepEqual(st.players[3].bp, PRESETS.farm);
  assert.equal(st.rules.cards, true);
  // the standard game has none of it
  const std = createGame({ seed: 1, players: seats(4) });
  assert.equal(std.plots, undefined);
  assert.equal(std.players[0].bp, undefined);
  throwsRule(() => act(Object.assign(std, { phase: 'play', rolled: true, current: 0 }), { type: 'develop', p: 0, hex: 0, res: 'wood' }));
});

test('basic cards: a piece left out is never paid for; the opening, the royal road and the library need none', () => {
  const st = createGame({ seed: 9, players: seats(4, 'port'), map: 'dev-4', firstPlayer: 0 });
  // player 0 brings no road, settlement, city or development card
  st.players[0].bp = ['granary', 'market', 'royalRoad', 'library'];
  assert.ok(!hasBasic(st, 0, 'road') && hasBasic(st, 1, 'road'));
  // the opening as usual
  const v = GEO.vertices.find((x) => x.hexes.length === 3 && x.hexes.every((h) => terr(st, h) !== 'desert')).id;
  act(st, { type: 'settlement', p: 0, vertex: v });
  act(st, { type: 'road', p: 0, edge: GEO.vertices[v].edges[0] });
  assert.equal(st.vertices[v].p, 0);
  // in play: nothing of the four for money
  st.phase = 'play';
  st.setup = null;
  st.turn = 9;
  st.current = 0;
  st.rolled = true;
  give(st, 0, all(9));
  const e = GEO.edges.find((x) => st.edges[x.id] === -1 && x.v.some((u) => GEO.vertices[u].edges.some((f) => st.edges[f] === 0))).id;
  throwsRule(() => act(st, { type: 'road', p: 0, edge: e }), new RegExp(NO_CARD.road));
  throwsRule(() => act(st, { type: 'city', p: 0, vertex: v }), new RegExp(NO_CARD.city));
  throwsRule(() => act(st, { type: 'buyDev', p: 0 }), new RegExp(NO_CARD.dev));
  const far = GEO.vertices.find((x) => !st.vertices[x.id] && x.edges.some((f) => st.edges[f] === 0) && !x.neighbors.some((u) => st.vertices[u])) || GEO.vertices[0];
  throwsRule(() => act(st, { type: 'settlement', p: 0, vertex: far.id }), new RegExp(NO_CARD.settlement));
  // the royal road's road and the great library's card come without the cards
  const d = deserts(st)[0];
  st.wonders.push({ h: d, k: 'royalRoad', p: 0, s: 3, t: 1, done: true }, { h: deserts(st)[1], k: 'library', p: 0, s: 3, t: 1, done: true });
  act(st, { type: 'road', p: 0, edge: e });
  assert.equal(st.edges[e], 0);
  const before = st.players[0].dev.length;
  act(st, { type: 'buyDev', p: 0, lib: 'wood' });
  assert.equal(st.players[0].dev.length, before + 1);
  // a player with the cards as before
  st.current = 1;
  give(st, 1, all(5));
  assert.doesNotThrow(() => act(st, { type: 'buyDev', p: 1 }));
  // the standard game and games saved before: no card needed
  const std = createGame({ seed: 1, players: seats(4) });
  assert.ok(hasBasic(std, 0, 'road'));
  const old = createGame({ seed: 2, players: seats(4, 'port'), map: 'dev-4' });
  delete old.rules.cards;
  old.players[0].bp = ['market', 'shipyard', 'guild', 'granary', 'post', 'camp', 'lighthouse'];
  upgradeCards(old);
  assert.equal(old.rules.cards, true);
  assert.deepEqual(old.players[0].bp.slice(0, 4), BASIC);
  assert.equal(old.players[0].bp.length, 11, 'the old blueprint keeps all its buildings');
});

test('developments: on a hex beside your settlement, one developer per hex, two levels; costs', () => {
  const st = fresh('port');
  const v = spot(st, (t) => t.every((x) => TERRAIN_RES[x]));
  const [h] = GEO.vertices[v].hexes;
  robberAway(st, [h]);
  const local = TERRAIN_RES[terr(st, h)];
  const other = RES.find((r) => r !== local);
  throwsRule(() => act(st, { type: 'develop', p: 0, hex: h, res: local }), /路口上有村莊或城市/);
  place(st, 0, v);
  give(st, 0, { wood: 1, brick: 1, wool: 1 });
  assert.ok(plotSpots(st, 0).includes(h));
  act(st, { type: 'develop', p: 0, hex: h, res: local });
  assert.deepEqual(st.plots[h], { p: 0, r: [local] });
  assert.equal(st.players[0].res.wood + st.players[0].res.brick + st.players[0].res.wool, 0);
  // the second level: another resource costs one more card
  give(st, 0, { grain: 2, ore: 2 });
  throwsRule(() => act(st, { type: 'develop', p: 0, hex: h, res: other }), /資源不足/);
  give(st, 0, { wool: 1 });
  act(st, { type: 'develop', p: 0, hex: h, res: other });
  assert.deepEqual(st.plots[h].r, [local, other]);
  give(st, 0, all(5));
  throwsRule(() => act(st, { type: 'develop', p: 0, hex: h, res: local }), /二級/);
  // someone else's settlement on the hex does not make it theirs
  const v2 = GEO.hexes[h].vertices.find((u) => u !== v && !GEO.vertices[u].neighbors.includes(v));
  place(st, 1, v2);
  st.current = 1;
  give(st, 1, all(5));
  throwsRule(() => act(st, { type: 'develop', p: 1, hex: h, res: local }), /別人的開發/);
  // not the desert, not under the robber
  const d = deserts(st)[0];
  const vd = GEO.hexes[d].vertices[0];
  place(st, 1, vd);
  throwsRule(() => act(st, { type: 'develop', p: 1, hex: d, res: 'wood' }), /沙漠/);
  const h2 = GEO.vertices[v2].hexes.find((x) => x !== h && TERRAIN_RES[terr(st, x)] && !st.plots[x]);
  st.board.robber = h2;
  throwsRule(() => act(st, { type: 'develop', p: 1, hex: h2, res: 'wood' }), /強盜/);
  // only in the build phase of your own turn
  st.board.robber = d;
  st.rolled = false;
  throwsRule(() => act(st, { type: 'develop', p: 1, hex: h2, res: 'wood' }), /擲骰/);
});

test('developments: an extra card a level when the hex produces, not under the robber; the bank shared', () => {
  const st = fresh('port');
  const v = spot(st, (t) => t.every((x) => TERRAIN_RES[x]));
  const h = GEO.vertices[v].hexes.find((x) => st.board.hexes[x].number);
  const num = st.board.hexes[h].number;
  robberAway(st, [h]);
  place(st, 0, v);
  st.plots[h] = { p: 0, r: ['ore', 'wool'] };
  const local = TERRAIN_RES[terr(st, h)];
  const before = { ...st.players[0].res };
  const ev = rollSum(st, num);
  const got = (r) => st.players[0].res[r] - before[r];
  // the settlement's card(s) of the hex's resource, plus one ore and one wool; other hexes may add more
  const prod = ev.find((e) => e.type === 'produce');
  const plotClaims = prod.paid.filter((c) => c.plot);
  assert.deepEqual(plotClaims.map((c) => c.res).sort(), ['ore', 'wool']);
  assert.ok(plotClaims.every((c) => c.hex === h && c.vertex === null && c.p === 0));
  assert.ok(got('ore') >= 1 && got('wool') >= 1 && got(local) >= 1);
  // the robber stops the development (and the settlement)
  st.current = 0;
  st.board.robber = h;
  st.turn++;
  const ev2 = rollSum(st, num);
  const prod2 = ev2.find((e) => e.type === 'produce');
  assert.ok(!prod2.paid.some((c) => c.hex === h));
  // a resource the bank cannot give everyone: no one gets it (the developer's bonus counted with the
  // settlements)
  st.board.robber = deserts(st)[0];
  const st2 = JSON.parse(JSON.stringify(st));
  const v2 = GEO.hexes[h].vertices.find((u) => u !== v && !GEO.vertices[u].neighbors.includes(v));
  place(st2, 1, v2);
  st2.bank.ore = 0;
  st2.bank.wool = 1;
  st2.bank[local] = 1;
  const p0 = { ...st2.players[0].res };
  const p1 = { ...st2.players[1].res };
  st2.turn++;
  const ev3 = rollSum(st2, num);
  const prod3 = ev3.find((e) => e.type === 'produce');
  assert.equal(st2.players[0].res.ore, p0.ore);
  if (local !== 'wool') {
    assert.ok(prod3.shortages.some((x) => x.res === local && !x.partial));
    assert.equal(st2.players[1].res[local], p1[local]);
  }
});

test('special buildings: beside your own settlement, a village holds one, a city two; once each', () => {
  const st = fresh(['wall', 'granary', 'market', 'shipyard', 'press', 'post', 'camp']);
  const v = spot(st, (t) => t.includes('fields'));
  place(st, 0, v);
  give(st, 0, all(20));
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'barracks', vertex: v }), /藍圖/);
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'granary', vertex: GEO.vertices[v].neighbors[0] }), /自己的村莊或城市/);
  act(st, { type: 'special', p: 0, k: 'granary', vertex: v });
  assert.equal(st.players[0].built.granary, v);
  assert.equal(slotsAt(st, v), 0);
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'wall', vertex: v }), /已經有建築/);
  st.vertices[v].t = 'c';
  assert.equal(slotsAt(st, v), 1);
  act(st, { type: 'special', p: 0, k: 'wall', vertex: v });
  assert.equal(slotsAt(st, v), 0);
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'market', vertex: v }), /兩座建築/);
  // it neither takes the intersection nor cuts a road: the settlement rules are unchanged
  assert.equal(st.vertices[v].p, 0);
  const v2 = spot(st, (t) => t.includes('fields'), [v, ...GEO.vertices[v].neighbors]);
  place(st, 0, v2);
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'granary', vertex: v2 }), /只能蓋一座/);
  // points: a functional building is 1
  assert.equal(publicVP(st, 0), 2 + 1 + 2);
});

test('special buildings: the conditions of the settlement they stand beside, checked when built', () => {
  const st = fresh(['granary', 'market', 'shipyard', 'press', 'camp', 'aqueduct', 'wall']);
  give(st, 0, all(30));
  const noFields = spot(st, (t) => !t.includes('fields'));
  place(st, 0, noFields);
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'granary', vertex: noFields }), /田地/);
  const noForest = spot(st, (t) => !t.includes('forest'), [noFields, ...GEO.vertices[noFields].neighbors]);
  place(st, 0, noForest);
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'press', vertex: noForest }), /森林/);
  const two = spot(st, (t) => new Set(t.filter((x) => TERRAIN_RES[x])).size < 3, [...GEO.vertices[noFields].neighbors, ...GEO.vertices[noForest].neighbors, noFields, noForest]);
  if (two >= 0) {
    place(st, 0, two);
    throwsRule(() => act(st, { type: 'special', p: 0, k: 'market', vertex: two }), /3 種/);
    delete st.vertices[two];
    st.vertices[two] = null;
  }
  // inland: no shipyard
  const inland = GEO.vertices.find((x) => !x.coastal && !st.vertices[x.id] && x.neighbors.every((n) => !st.vertices[n])).id;
  place(st, 0, inland);
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'shipyard', vertex: inland, res: 'wool' }), /海岸/);
  // the aqueduct wants a development of yours beside it
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'aqueduct', vertex: inland }), /開發地塊/);
  const ph = GEO.vertices[inland].hexes.find((h) => TERRAIN_RES[terr(st, h)]);
  st.plots[ph] = { p: 0, r: ['wood'] };
  assert.ok(specialHosts(st, 0, 'aqueduct').includes(inland));
  act(st, { type: 'special', p: 0, k: 'aqueduct', vertex: inland });
  // the frontier camp: beside a hex with no other building
  const lonely = GEO.vertices.find((x) => !st.vertices[x.id] && x.neighbors.every((n) => !st.vertices[n]) && x.hexes.length === 3 && x.hexes.every((h) => GEO.hexes[h].vertices.every((u) => !st.vertices[u]))).id;
  place(st, 0, lonely);
  assert.ok(specialHosts(st, 0, 'camp').includes(lonely));
  for (const h of GEO.vertices[lonely].hexes) {
    const u = GEO.hexes[h].vertices.find((x) => x !== lonely && !GEO.vertices[lonely].neighbors.includes(x) && !GEO.vertices[x].neighbors.some((n) => st.vertices[n]) && !st.vertices[x]);
    if (u !== undefined) place(st, 1, u);
  }
  assert.ok(!specialHosts(st, 0, 'camp').includes(lonely) || GEO.vertices[lonely].hexes.some((h) => GEO.hexes[h].vertices.every((u) => u === lonely || !st.vertices[u])));
});

test('special buildings: the conditions about the player', () => {
  const st = fresh(['guild', 'barracks', 'mercenaries', 'adventurers', 'post', 'academy', 'shipyard']);
  give(st, 0, all(30));
  const v = spot(st, () => true);
  place(st, 0, v);
  st.vertices[v].t = 'c';
  for (const [k, re] of [
    ['guild', /港口/],
    ['mercenaries', /1 張騎士/],
    ['adventurers', /3 張騎士/],
    ['post', /最長道路/],
    ['academy', /2 張發展卡/],
  ])
    throwsRule(() => act(st, { type: 'special', p: 0, k, vertex: v }), re);
  // barracks: a city
  st.vertices[v].t = 's';
  throwsRule(() => act(st, { type: 'special', p: 0, k: 'barracks', vertex: v }), /城市/);
  st.vertices[v].t = 'c';
  act(st, { type: 'special', p: 0, k: 'barracks', vertex: v });
  st.players[0].knights = 3;
  st.players[0].played.knight = 3;
  act(st, { type: 'special', p: 0, k: 'adventurers', vertex: v });
  // the guild once there is a harbor: a shipyard counts
  const coast = GEO.vertices.find((x) => x.coastal && x.hexes.length >= 1 && !st.vertices[x.id] && x.neighbors.every((n) => !st.vertices[n])).id;
  place(st, 0, coast);
  act(st, { type: 'special', p: 0, k: 'shipyard', vertex: coast, res: 'grain' });
  assert.equal(st.players[0].yard, 'grain');
  assert.equal(tradeRatio(st, 0, 'grain'), 2);
  const v3 = GEO.vertices.find((x) => !st.vertices[x.id] && x.neighbors.every((n) => !st.vertices[n])).id;
  place(st, 0, v3);
  act(st, { type: 'special', p: 0, k: 'guild', vertex: v3 });
  // the adventurers' guild: +3 only while holding the largest army
  const base = publicVP(st, 0);
  st.largestArmy = 0;
  assert.equal(publicVP(st, 0), base + 2 + 3);
  st.largestArmy = 1;
  assert.equal(publicVP(st, 0), base);
});

test('the post station: +3 with the longest road; the score buildings are worth nothing else', () => {
  const st = fresh(['post', 'camp', 'market', 'aqueduct', 'wall', 'shipyard', 'royalRoad']);
  const v = spot(st, () => true);
  place(st, 0, v);
  st.roadLen[0] = 6;
  give(st, 0, { wood: 2, brick: 2, wool: 1 });
  act(st, { type: 'special', p: 0, k: 'post', vertex: v });
  assert.equal(publicVP(st, 0), 1);
  st.longestRoad = 0;
  assert.equal(publicVP(st, 0), 1 + 2 + 3);
});

test('the granary: a hand limit of 10 for a 7', () => {
  const st = fresh(['granary', 'market', 'shipyard', 'guild', 'post', 'camp', 'lighthouse']);
  const v = spot(st, (t) => t.includes('fields'));
  place(st, 0, v);
  give(st, 0, { wood: 2, brick: 1, grain: 2 });
  act(st, { type: 'special', p: 0, k: 'granary', vertex: v });
  assert.equal(handLimitOf(st, 0), 10);
  assert.equal(handLimitOf(st, 1), 7);
  give(st, 0, { wood: 9 });
  give(st, 1, { wood: 9 });
  st.turn++;
  const ev = rollSum(st, 7);
  const req = ev.find((e) => e.type === 'discardRequired');
  assert.ok(req && req.amounts[1] === 4 && req.amounts[0] === undefined);
});

test('the wall: its settlement produces under the robber and is never robbed', () => {
  const st = fresh(['wall', 'granary', 'market', 'shipyard', 'press', 'post', 'camp']);
  const v = spot(st, (t) => t.every((x) => TERRAIN_RES[x]));
  const h = GEO.vertices[v].hexes.find((x) => st.board.hexes[x].number);
  place(st, 0, v);
  const v2 = GEO.hexes[h].vertices.find((u) => u !== v && !GEO.vertices[u].neighbors.includes(v));
  place(st, 1, v2);
  give(st, 0, { brick: 3, ore: 2 });
  act(st, { type: 'special', p: 0, k: 'wall', vertex: v });
  st.plots[h] = { p: 0, r: ['wool'] };
  st.board.robber = h;
  const res = TERRAIN_RES[terr(st, h)];
  const b0 = st.players[0].res[res];
  st.turn++;
  const ev = rollSum(st, st.board.hexes[h].number);
  const prod = ev.find((e) => e.type === 'produce');
  assert.ok(prod.paid.some((c) => c.hex === h && c.p === 0 && !c.plot), 'the walled settlement produced');
  assert.ok(!prod.paid.some((c) => c.hex === h && c.p === 1), 'the other did not');
  assert.ok(!prod.paid.some((c) => c.plot && c.hex === h), 'the development did not');
  assert.ok(st.players[0].res[res] > b0);
  // robbing: player 1 moves the robber here, player 0 cannot be robbed for the walled settlement
  give(st, 0, all(2));
  assert.deepEqual(robberVictims(st, h, 1), []);
});

test('the aqueduct: nothing from a roll → one of the scarcest resource', () => {
  const st = fresh(['aqueduct', 'granary', 'market', 'shipyard', 'camp', 'academy', 'gardens']);
  const v = spot(st, (t) => t.every((x) => TERRAIN_RES[x]));
  const h = GEO.vertices[v].hexes[0];
  place(st, 0, v);
  st.plots[h] = { p: 0, r: ['wood'] };
  give(st, 0, { wood: 1, brick: 2, grain: 1, ore: 1 });
  act(st, { type: 'special', p: 0, k: 'aqueduct', vertex: v });
  give(st, 0, { wood: 2, brick: 2, wool: 1, grain: 0, ore: 3 });
  const mine = new Set(GEO.vertices[v].hexes.map((x) => st.board.hexes[x].number));
  const sum = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].find((n) => !mine.has(n));
  st.turn++;
  const ev = rollSum(st, sum);
  const aq = ev.find((e) => e.type === 'aqueduct');
  assert.ok(aq && aq.p === 0 && aq.res === 'grain');
  assert.equal(st.players[0].res.grain, 1);
});

test('the market: two of a kind for one, once a turn', () => {
  const st = fresh('port');
  const v = spot(st, (t) => new Set(t.filter((x) => TERRAIN_RES[x])).size === 3);
  place(st, 0, v);
  give(st, 0, { wood: 1, wool: 2, grain: 2 });
  act(st, { type: 'special', p: 0, k: 'market', vertex: v });
  give(st, 0, { ore: 4 });
  throwsRule(() => act(st, { type: 'market', p: 0, give: 'ore', get: 'ore' }));
  act(st, { type: 'market', p: 0, give: 'ore', get: 'brick' });
  assert.equal(st.players[0].res.ore, 2);
  assert.equal(st.players[0].res.brick, 1);
  throwsRule(() => act(st, { type: 'market', p: 0, give: 'ore', get: 'brick' }), /每回合/);
  // a new turn: again
  st.players.forEach((pl) => (pl.res = { ...pl.res }));
  act(st, { type: 'endTurn', p: 0 });
  assert.deepEqual(st.used, {});
});

test('the merchant guild: both sides of a trade with its owner take one more, once a turn', () => {
  const st = fresh('port');
  st.used = {};
  st.players[1].built = { guild: 0 };
  give(st, 0, { wood: 3 });
  give(st, 1, { ore: 2, grain: 1 });
  act(st, { type: 'offer', p: 0, give: { wood: 2 }, get: { ore: 2, grain: 1 }, to: [1] });
  act(st, { type: 'respond', p: 1, accept: true });
  const ev = act(st, { type: 'acceptOffer', p: 0, with: 1 });
  const gb = ev.find((e) => e.type === 'guildBonus');
  assert.deepEqual(gb.bonus, { 0: 'ore', 1: 'wood' });
  assert.equal(st.players[0].res.ore, 3);
  assert.equal(st.players[1].res.wood, 3);
  // once a turn
  act(st, { type: 'offer', p: 0, give: { wood: 1 }, get: { wood: 0, ore: 1 }, to: [1] });
  act(st, { type: 'respond', p: 1, accept: false });
  st.trade = null;
  give(st, 1, { brick: 1 });
  act(st, { type: 'offer', p: 0, give: { ore: 1 }, get: { brick: 1 }, to: [1] });
  act(st, { type: 'respond', p: 1, accept: true });
  const ev2 = act(st, { type: 'acceptOffer', p: 0, with: 1 });
  assert.ok(!ev2.some((e) => e.type === 'guildBonus'));
});

test('the barracks takes the top knight; the academy draws two to keep one; the press plays at once', () => {
  const st = fresh(['barracks', 'academy', 'press', 'wall', 'mercenaries', 'adventurers', 'greatWall']);
  st.players[0].built = { barracks: 1, academy: 2, press: 3 };
  st.devDeck = ['knight', 'monopoly', 'knight', 'victoryPoint', 'yearOfPlenty'];
  give(st, 0, all(10));
  const ev = act(st, { type: 'buyDev', p: 0, how: 'knight' });
  assert.equal(ev[0].card, 'knight');
  assert.deepEqual(st.devDeck, ['knight', 'monopoly', 'victoryPoint', 'yearOfPlenty']);
  // the academy: two drawn, one kept, the other to the bottom
  const ev2 = act(st, { type: 'buyDev', p: 0, how: 'pick' });
  assert.equal(ev2[0].type, 'devDraw');
  assert.deepEqual(ev2[0].cards, ['yearOfPlenty', 'victoryPoint']);
  assert.equal(redactEvent(ev2[0], 1).cards, null);
  assert.equal(st.pending.type, 'pick');
  assert.equal(makeView(st, 1).players[0].pick, null);
  assert.deepEqual(makeView(st, 0).players[0].pick, ['yearOfPlenty', 'victoryPoint']);
  throwsRule(() => act(st, { type: 'buyDev', p: 0 }), /留下的發展卡/);
  act(st, { type: 'pickDev', p: 0, i: 1 });
  assert.deepEqual(st.devDeck, ['yearOfPlenty', 'knight', 'monopoly']);
  assert.equal(st.players[0].dev[1].type, 'victoryPoint');
  assert.equal(st.players[0].bought, 2);
  // the press: the knight bought this turn may be played now (one card a turn still)
  assert.ok(playableDev(st, 0).includes('knight'));
  act(st, { type: 'playDev', p: 0, card: 'knight' });
  assert.equal(st.pending.type, 'robber');
  // without the buildings: no such purchases
  st.pending = null;
  st.players[0].built = {};
  throwsRule(() => act(st, { type: 'buyDev', p: 0, how: 'knight' }), /兵營/);
  throwsRule(() => act(st, { type: 'buyDev', p: 0, how: 'pick' }), /學院/);
});

test('the frontier camp: a card from each hex beside a new village', () => {
  const st = fresh(['camp', 'post', 'market', 'aqueduct', 'wall', 'shipyard', 'royalRoad']);
  st.players[0].built = { camp: 0 };
  const v = spot(st, (t) => t.every((x) => TERRAIN_RES[x]));
  const e = GEO.vertices[v].edges[0];
  st.edges[e] = 0;
  const u = GEO.edges[e].v.find((x) => x !== v);
  place(st, 0, GEO.vertices[u].neighbors.find((x) => x !== v && GEO.vertices[x].neighbors.every((n) => n === u || !st.vertices[n])));
  give(st, 0, { wood: 1, brick: 1, wool: 1, grain: 1 });
  const ev = act(st, { type: 'settlement', p: 0, vertex: v });
  const sr = ev.find((x) => x.type === 'startingResources');
  assert.ok(sr && sr.camp);
  assert.equal(Object.values(sr.gains).reduce((a, b) => a + b, 0), 3);
});

test('mercenaries: the robber robs every rival beside it', () => {
  const st = fresh('order');
  st.players[0].built = { mercenaries: 0 };
  const h = GEO.hexes.find((x) => terr(st, x.id) !== 'desert' && x.id !== st.board.robber).id;
  const [a, , c] = GEO.hexes[h].vertices;
  place(st, 1, a);
  place(st, 2, c);
  give(st, 1, { wood: 2 });
  give(st, 2, { ore: 2 });
  st.pending = { type: 'robber', reason: 'seven' };
  const ev = act(st, { type: 'robber', p: 0, hex: h });
  assert.equal(ev.filter((e) => e.type === 'steal').length, 2);
  assert.equal(st.pending, null);
  assert.equal(st.players[0].res.wood + st.players[0].res.ore, 2);
});

// a wonder: player 0 holds a settlement on desert d's corner
function wonderGame(bp = 'port') {
  const st = fresh(bp);
  const d = deserts(st).find((x) => x !== st.board.robber);
  const v = GEO.hexes[d].vertices.find((u) => GEO.vertices[u].hexes.length === 3) ?? GEO.hexes[d].vertices[0];
  place(st, 0, v);
  return { st, d, v };
}
const pass = (st) => {
  // everyone ends a turn until it is player 0's again (dice rolled for each)
  do {
    act(st, { type: 'endTurn', p: st.current });
    st.rolled = true;
  } while (st.current !== 0);
};

test('wonders: three stages on three turns, locked once begun; complete at the start of the turn after', () => {
  const { st, d } = wonderGame('port');
  give(st, 0, all(20));
  assert.deepEqual(wonderSpots(st, 0), [d]);
  // not under the robber, not without a settlement on its corners
  const other = deserts(st).find((x) => x !== d);
  throwsRule(() => act(st, { type: 'wonder', p: 0, hex: other }));
  act(st, { type: 'wonder', p: 0, hex: d });
  assert.deepEqual(st.wonders, [{ h: d, k: 'lighthouse', p: 0, s: 1, t: st.turn, done: false }]);
  throwsRule(() => act(st, { type: 'wonder', p: 0, hex: d }), /下一回合/);
  // locked: player 1 with the same wonder cannot begin it elsewhere
  st.players[1].bp = PRESETS.port.slice();
  const v1 = GEO.hexes[other].vertices[0];
  place(st, 1, v1);
  st.current = 1;
  give(st, 1, all(20));
  st.board.robber = GEO.hexes.find((h) => terr(st, h.id) !== 'desert').id;
  throwsRule(() => act(st, { type: 'wonder', p: 1, hex: other }), /有人開工/);
  st.current = 0;
  pass(st);
  act(st, { type: 'wonder', p: 0, hex: d });
  pass(st);
  act(st, { type: 'wonder', p: 0, hex: d });
  assert.equal(st.wonders[0].s, 3);
  assert.equal(st.wonders[0].done, false);
  assert.equal(tradeRatio(st, 0, 'wood'), 4);
  const vp = publicVP(st, 0);
  // the next turn of the owner: complete before the dice, 5 points and the bonus
  let ev;
  do {
    ev = act(st, { type: 'endTurn', p: st.current });
    st.rolled = st.current !== 0;
  } while (st.current !== 0);
  assert.ok(ev.some((e) => e.type === 'wonderDone' && e.k === 'lighthouse'));
  assert.equal(publicVP(st, 0), vp + 5);
  assert.equal(tradeRatio(st, 0, 'wood'), 2);
  assert.equal(st.rolled, false);
});

test('wonders: completion at the start of the turn can win the game', () => {
  const { st, d } = wonderGame('port');
  st.wonders = [{ h: d, k: 'lighthouse', p: 0, s: 3, t: st.turn, done: false }];
  st.players[0].dev = Array.from({ length: 12 }, () => ({ type: 'victoryPoint', turn: 1 }));
  assert.equal(totalVP(st, 0), 13);
  act(st, { type: 'endTurn', p: 0 });
  st.rolled = true;
  act(st, { type: 'endTurn', p: 1 });
  st.rolled = true;
  act(st, { type: 'endTurn', p: 2 });
  st.rolled = true;
  const ev = act(st, { type: 'endTurn', p: 3 });
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 0);
  assert.ok(ev.some((e) => e.type === 'gameOver'));
});

test('wonders: the robber destroys one unless its owner plays a knight (which counts for the army)', () => {
  const { st, d, v } = wonderGame('port');
  st.wonders = [{ h: d, k: 'lighthouse', p: 0, s: 2, t: 1, done: false }];
  // player 1 moves the robber to the wonder
  st.current = 1;
  st.pending = { type: 'robber', reason: 'seven' };
  throwsRule(() => act(st, { type: 'robber', p: 1, hex: st.board.robber }));
  st.players[0].dev = [{ type: 'knight', turn: st.turn }];
  st.players[0].knights = 2;
  st.players[0].played.knight = 2;
  give(st, 0, { wood: 1 });
  const ev = act(st, { type: 'robber', p: 1, hex: d });
  assert.equal(st.pending.type, 'defend');
  assert.deepEqual(actorsNow(st), [0]);
  throwsRule(() => act(st, { type: 'endTurn', p: 1 }), /奇觀/);
  assert.ok(ev.some((e) => e.type === 'siege'));
  const ev2 = act(st, { type: 'defend', p: 0, yes: true });
  assert.ok(ev2.some((e) => e.type === 'defend'));
  assert.equal(st.players[0].knights, 3);
  assert.equal(st.largestArmy, 0);
  assert.equal(st.wonders.length, 1);
  // the mover still robs (player 0's settlement is beside the desert)
  assert.ok(ev2.some((e) => e.type === 'steal' && e.from === 0));
  assert.equal(st.board.robber, d);
  // again, with no knight: lost, and its stages are not paid back
  st.board.robber = GEO.hexes.find((h) => terr(st, h.id) !== 'desert').id;
  st.pending = { type: 'robber', reason: 'knight' };
  act(st, { type: 'robber', p: 1, hex: d });
  throwsRule(() => act(st, { type: 'defend', p: 0, yes: true }), /騎士/);
  throwsRule(() => act(st, { type: 'defend', p: 1, yes: false }), /不是你的/);
  const ev3 = act(st, { type: 'defend', p: 0, yes: false });
  assert.ok(ev3.some((e) => e.type === 'wonderLost' && e.k === 'lighthouse'));
  assert.deepEqual(st.wonders, []);
  // its ruins stay on the desert (the map shows them; everyone's view and the public snapshot carry them)
  assert.deepEqual(st.ruins, [{ h: d, k: 'lighthouse' }]);
  assert.deepEqual(makeView(st, 1).ruins, [{ h: d, k: 'lighthouse' }]);
  // unlocked: it can be begun again, and the ruins are cleared away when it is
  st.current = 0;
  st.pending = null;
  st.board.robber = GEO.hexes.find((h) => terr(st, h.id) !== 'desert').id;
  assert.deepEqual(wonderSpots(st, 0), [d]);
  give(st, 0, BUILDINGS.lighthouse.stages[0]);
  act(st, { type: 'wonder', p: 0, hex: d });
  assert.deepEqual(st.ruins, []);
  assert.ok(v >= 0);
});

test('wonders: not onto your own wonder; the great wall keeps the robber from its owner', () => {
  const { st, d, v } = wonderGame('order');
  st.wonders = [{ h: d, k: 'greatWall', p: 0, s: 3, t: 1, done: false }];
  st.pending = { type: 'robber', reason: 'seven' };
  throwsRule(() => act(st, { type: 'robber', p: 0, hex: d }), /自己的奇觀/);
  assert.ok(!robberSpots(st, 0).includes(d));
  st.wonders[0].done = true;
  const guarded = guardedHexes(st);
  for (const h of GEO.vertices[v].hexes) assert.ok(guarded.has(h));
  st.current = 1;
  const h = GEO.vertices[v].hexes.find((x) => x !== d && x !== st.board.robber);
  throwsRule(() => act(st, { type: 'robber', p: 1, hex: h }), /長城/);
  throwsRule(() => act(st, { type: 'robber', p: 1, hex: d }), /長城/);
});

test('wonders: the royal road, a free road a turn; the library, a card for one resource; the gardens', () => {
  const { st, d, v } = wonderGame(['post', 'camp', 'market', 'aqueduct', 'wall', 'shipyard', 'royalRoad']);
  st.wonders = [{ h: d, k: 'royalRoad', p: 0, s: 3, t: 1, done: true }];
  const e = GEO.vertices[v].edges[0];
  const ev = act(st, { type: 'road', p: 0, edge: e });
  assert.ok(ev[0].free && ev[0].royal);
  const e2 = GEO.vertices[v].edges[1];
  throwsRule(() => act(st, { type: 'road', p: 0, edge: e2 }), /資源不足/);
  // the library
  st.players[0].bp = PRESETS.scholars.slice();
  st.wonders = [{ h: d, k: 'library', p: 0, s: 3, t: 1, done: true }];
  give(st, 0, { brick: 2 });
  const ev2 = act(st, { type: 'buyDev', p: 0, lib: 'brick' });
  assert.deepEqual(ev2[0].cost, { brick: 1 });
  assert.equal(st.players[0].res.brick, 1);
  throwsRule(() => act(st, { type: 'buyDev', p: 0, lib: 'brick' }), /每回合/);
  // the gardens: one more card of the first level's resource
  const g = createGame({ seed: 9, players: seats(4, 'farm'), map: 'dev-4', firstPlayer: 0 });
  Object.assign(g, { phase: 'play', turn: 5, current: 0, rolled: false });
  const gv = GEO.vertices.find((x) => x.hexes.length === 3 && x.hexes.every((h) => TERRAIN_RES[terr(g, h)])).id;
  const gh = GEO.vertices[gv].hexes[0];
  robberAway(g, [gh]);
  place(g, 0, gv);
  g.plots[gh] = { p: 0, r: ['wool'] };
  g.wonders = [{ h: deserts(g)[0], k: 'gardens', p: 0, s: 3, t: 1, done: true }];
  const pev = rollSum(g, g.board.hexes[gh].number);
  const plotCards = pev.find((x) => x.type === 'produce').paid.filter((c) => c.plot);
  assert.deepEqual(plotCards.map((c) => c.res), ['wool', 'wool']);
});

test('views and points: blueprints and buildings are public; the 18 points win on your own turn', () => {
  const st = fresh('farm');
  const view = makeView(st, 2);
  assert.deepEqual(view.players[0].bp, PRESETS.farm);
  assert.deepEqual(view.players[0].built, {});
  assert.equal(Object.keys(BUILDINGS).length, 18);
});

console.log(`develop: ${passed} passed`);
