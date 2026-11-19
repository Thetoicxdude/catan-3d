// The development mode's buildings of 2026-11-18 (the proposal 「發展模式：新增特殊建築」): twelve of the
// five directions, each lifting a limit of the game, thirteen neutral ones with no condition; and the
// two notes (the royal road's roads, the deck shuffled anew from the cards played).
import assert from 'node:assert/strict';
import { GEO } from '../src/engine/geometry.js';
import { createGame, applyAction, RuleError, makeView, totalVP, actorsNow, robberVictims, playableDev, redactEvent, roadLegal } from '../src/engine/engine.js';
import { developMap } from '../src/engine/maps.js';
import { BUILDINGS, BASIC, slotsAt, specialWhy, hostWhy, plotWhy, plotCost, payFor, robberWhy, developScore, holdsMost, harborCount, MOST_MIN, isSpecial, isNeutral, DIRS } from '../src/engine/develop.js';
import { TERRAIN_RES, RES } from '../src/engine/board.js';
import { seedState } from '../src/engine/rng.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    const at = e.stack.split('\n').find((l) => l.includes('develop2.mjs:')) || '';
    console.log('FAIL', name, '\n ', e.stack.split('\n').slice(0, 3).join('\n  '), '\n ', at.trim());
    process.exitCode = 1;
  }
}
const throwsRule = (fn, re) => assert.throws(fn, (e) => e instanceof RuleError && (!re || re.test(e.message)));
const act = (st, a) => applyAction(st, a);
const seats = (n) => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: '#fff', kind: 'human', bp: 'port' }));
// a game in play on an empty board, player 0 to move, dice rolled; everyone's blueprint the four basic
// cards and `bp`
function fresh(bp = [], n = 4, seed = 5) {
  const st = createGame({ seed, players: seats(n), map: developMap(n).id, firstPlayer: 0 });
  for (const pl of st.players) pl.bp = [...BASIC, ...bp];
  st.phase = 'play';
  st.turn = 5;
  st.current = 0;
  st.rolled = true;
  return st;
}
const give = (st, p, res) => Object.assign(st.players[p].res, res);
const none = () => ({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
const all = (n) => ({ wood: n, brick: n, wool: n, grain: n, ore: n });
const place = (st, p, v, t = 's') => (st.vertices[v] = { p, t });
const hand = (st, p) => RES.reduce((n, r) => n + st.players[p].res[r], 0);
const land = (st, h) => !!TERRAIN_RES[st.board.hexes[h].terrain];
// an intersection whose three hexes are all land, coastal or not, away from the ones given
function corner(st, { coastal = false, avoid = [] } = {}) {
  for (const v of GEO.vertices) {
    if (avoid.includes(v.id) || v.hexes.length !== 3 || !v.hexes.every((h) => land(st, h))) continue;
    if (!!v.coastal === coastal && v.neighbors.every((u) => !avoid.includes(u))) return v.id;
  }
  for (const v of GEO.vertices) if (!avoid.includes(v.id) && !!v.coastal === coastal && v.hexes.some((h) => land(st, h))) return v.id;
  return -1;
}
// the robber away from the given hexes
function robberAway(st, keep = []) {
  const near = new Set(keep.flatMap((h) => [h, ...GEO.hexes[h].neighbors]));
  st.board.robber = GEO.hexes.find((h) => !near.has(h.id) && st.board.hexes[h.id].terrain !== 'desert').id;
}
// a roll of exactly `sum`
function rollSum(st, sum, extra = {}) {
  const save = JSON.stringify(st);
  for (let k = 0; k < 800; k++) {
    const s = JSON.parse(save);
    s.rng = seedState(k + 1);
    s.rolled = false;
    const ev = act(s, { type: 'roll', p: s.current, ...extra });
    const r = ev.find((e) => e.type === 'roll');
    if (r.sum === sum) {
      Object.assign(st, s);
      return ev;
    }
  }
  throw new Error('no roll of ' + sum);
}
// a building p has, standing beside p's settlement at v (a city when asked)
function built(st, p, k, v, city = false) {
  if (!st.vertices[v]) place(st, p, v, city ? 'c' : 's');
  st.players[p].built[k] = v;
  if (k === 'warehouse') st.players[p].store = none();
}

test('the 25 new buildings: 12 of the directions, 13 neutral; 5 cards for a functional one (the scriptorium 6, the caravanserai 4), 6 for a scoring one (the grange 5, the harbor office 7), 8 the monument', () => {
  const fresh25 = Object.keys(BUILDINGS).slice(13, 38);
  assert.equal(fresh25.length, 25);
  assert.equal(fresh25.filter(isNeutral).length, 13);
  assert.ok(DIRS.includes('neutral'));
  for (const k of fresh25) {
    const b = BUILDINGS[k];
    assert.ok(isSpecial(k), k);
    const n = Object.values(b.cost).reduce((a, c) => a + c, 0);
    // (the balance's changes: the scriptorium and the harbor office one card more, the grange and the
    // caravanserai one less)
    assert.equal(n, k === 'monument' ? 8 : k === 'scriptorium' ? 6 : k === 'grange' ? 5 : k === 'caravan' ? 4 : k === 'harborOffice' ? 7 : b.kind === 'score' ? 6 : 5, k);
  }
  // (no condition on a neutral one beyond a place to stand)
  const st = fresh(fresh25.filter(isNeutral));
  for (const k of fresh25.filter(isNeutral)) assert.equal(specialWhy(st, 0, k), null, k);
});

test('farmstead: beside a city; the developments beside it reach a third level, one more card each time', () => {
  const st = fresh(['farmstead']);
  const v = corner(st);
  place(st, 0, v, 's');
  assert.match(hostWhy(st, 0, 'farmstead', v), /城市/);
  st.vertices[v].t = 'c';
  assert.equal(hostWhy(st, 0, 'farmstead', v), null);
  const h = GEO.vertices[v].hexes[0];
  const r = TERRAIN_RES[st.board.hexes[h].terrain];
  st.plots[h] = { p: 0, r: [r, r] };
  assert.match(plotWhy(st, 0, h), /二級/);
  give(st, 0, all(9));
  act(st, { type: 'special', p: 0, k: 'farmstead', vertex: v });
  assert.equal(plotWhy(st, 0, h), null);
  assert.deepEqual(plotCost(st, h, r), { wool: 1, grain: 2, ore: 2 });
  act(st, { type: 'develop', p: 0, hex: h, res: r });
  assert.equal(st.plots[h].r.length, 3);
  assert.match(plotWhy(st, 0, h), /三級/);
  // (elsewhere the top is still two)
  const far = GEO.hexes.find((x) => land(st, x.id) && !GEO.vertices[v].hexes.includes(x.id)).id;
  st.plots[far] = { p: 0, r: [r, r] };
  assert.match(plotWhy(st, 0, far), /二級/);
  // a roll of its number: the city's two, and three from the development
  robberAway(st, [h]);
  const before = st.players[0].res[r];
  const ev = rollSum(st, st.board.hexes[h].number);
  const got = ev.find((e) => e.type === 'produce').paid.filter((c) => c.p === 0 && c.hex === h && c.plot).length;
  assert.equal(got, 3);
  assert.ok(st.players[0].res[r] >= before + 3);
});

test('homestead: after a development, a hex beside a road of yours may be developed with no settlement', () => {
  const st = fresh(['homestead']);
  const v = corner(st);
  place(st, 0, v);
  give(st, 0, all(9));
  assert.match(specialWhy(st, 0, 'homestead'), /1 個開發/);
  const [h1] = GEO.vertices[v].hexes;
  st.plots[h1] = { p: 0, r: ['wood'] };
  assert.equal(specialWhy(st, 0, 'homestead'), null);
  act(st, { type: 'special', p: 0, k: 'homestead', vertex: v });
  // a hex far from any settlement, with a road of p's on one of its sides
  const h = GEO.hexes.find((x) => land(st, x.id) && x.vertices.every((u) => !st.vertices[u]) && st.board.robber !== x.id).id;
  assert.match(plotWhy(st, 0, h), /道路/);
  st.edges[GEO.hexes[h].edges[0]] = 0;
  assert.equal(plotWhy(st, 0, h), null);
  act(st, { type: 'develop', p: 0, hex: h, res: 'grain' });
  assert.equal(st.plots[h].p, 0);
});

test('the scoring buildings: the most developments, harbors, villages, development cards (a tie counts), +3', () => {
  const st = fresh(['grange', 'harborOffice', 'governor', 'university']);
  const hexes = GEO.hexes.filter((x) => land(st, x.id)).map((x) => x.id);
  // grange: three developments, nobody more
  for (const h of hexes.slice(0, 3)) st.plots[h] = { p: 0, r: ['wood', 'wood'] };
  st.players[0].built.grange = corner(st);
  place(st, 0, st.players[0].built.grange, 'c');
  assert.equal(holdsMost(st, 0, 'grange'), true);
  for (const h of hexes.slice(3, 6)) st.plots[h] = { p: 1, r: ['ore'] };
  assert.equal(holdsMost(st, 0, 'grange'), true, 'a tie counts');
  st.plots[hexes[6]] = { p: 1, r: ['ore'] };
  assert.equal(holdsMost(st, 0, 'grange'), false);
  // university: five cards taken
  st.players[0].built.university = st.players[0].built.grange;
  st.players[0].devGot = 4;
  assert.equal(holdsMost(st, 0, 'university'), false);
  st.players[0].devGot = 5;
  assert.equal(holdsMost(st, 0, 'university'), true);
  const s = developScore(st, 0);
  assert.equal(s.scoring, 3);
  // governor: four villages (cities don't count)
  st.players[0].built.governor = st.players[0].built.grange;
  const vs = [];
  for (let i = 0; i < 4; i++) vs.push(corner(st, { avoid: [...vs, st.players[0].built.grange] }));
  vs.forEach((v) => place(st, 0, v));
  assert.equal(holdsMost(st, 0, 'governor'), true);
  st.vertices[vs[0]].t = 'c';
  assert.equal(holdsMost(st, 0, 'governor'), false);
  // harbor office: two harbors at least (2026-11-19: the proposal's three), the shipyard one of them
  const hb = st.board.harbors;
  st.players[0].built.harborOffice = st.players[0].built.grange;
  place(st, 0, GEO.edges[hb[0].edge].v[0]);
  assert.equal(harborCount(st, 0), 1);
  assert.equal(holdsMost(st, 0, 'harborOffice'), false);
  st.players[0].built.shipyard = GEO.edges[hb[0].edge].v[0];
  assert.equal(harborCount(st, 0), 2);
  assert.equal(holdsMost(st, 0, 'harborOffice'), true);
  place(st, 1, GEO.edges[hb[2].edge].v[0]);
  place(st, 1, GEO.edges[hb[3].edge].v[0]);
  assert.equal(holdsMost(st, 0, 'harborOffice'), true, 'a tie counts');
  place(st, 0, GEO.edges[hb[1].edge].v[0]);
  assert.equal(harborCount(st, 0), 3);
  assert.equal(MOST_MIN.harborOffice, 2);
});

test('their conditions: a level-two development, a harbor, 8 roads, 5 settlements, 3 villages, 2 cards played, a city, 3 cards taken', () => {
  const st = fresh(['grange', 'harborOffice', 'roadworks', 'newTown', 'governor', 'lectureHall', 'scriptorium', 'university']);
  assert.match(specialWhy(st, 0, 'grange'), /二級開發/);
  assert.match(specialWhy(st, 0, 'harborOffice'), /1 個港口/);
  place(st, 0, GEO.edges[st.board.harbors[0].edge].v[0]);
  assert.equal(specialWhy(st, 0, 'harborOffice'), null);
  assert.match(specialWhy(st, 0, 'roadworks'), /8 條道路/);
  assert.match(specialWhy(st, 0, 'newTown'), /5 座/);
  assert.match(specialWhy(st, 0, 'governor'), /3 座村莊/);
  assert.match(specialWhy(st, 0, 'lectureHall'), /2 張發展卡/);
  assert.match(specialWhy(st, 0, 'scriptorium'), /城市/);
  assert.match(specialWhy(st, 0, 'university'), /3 張發展卡/);
  st.players[0].played.knight = 1;
  st.players[0].played.monopoly = 1;
  assert.equal(specialWhy(st, 0, 'lectureHall'), null);
  st.players[0].devGot = 3;
  assert.equal(specialWhy(st, 0, 'university'), null);
});

test('caravanserai: not by the coast; two different cards for one of any kind, as often as liked', () => {
  const st = fresh(['caravan']);
  const c = corner(st, { coastal: true });
  place(st, 0, c);
  assert.match(hostWhy(st, 0, 'caravan', c), /海岸/);
  const v = corner(st, { avoid: [c] });
  place(st, 0, v);
  assert.equal(hostWhy(st, 0, 'caravan', v), null);
  give(st, 0, all(9));
  act(st, { type: 'special', p: 0, k: 'caravan', vertex: v });
  const before = { ...st.players[0].res };
  act(st, { type: 'caravan', p: 0, give: ['wood', 'brick'], get: 'ore' });
  act(st, { type: 'caravan', p: 0, give: ['wood', 'grain'], get: 'ore' });
  act(st, { type: 'caravan', p: 0, give: ['wool', 'grain'], get: 'ore' });
  assert.equal(st.players[0].res.ore, before.ore + 3);
  assert.equal(st.players[0].res.wood, before.wood - 2);
  assert.equal(st.players[0].res.grain, before.grain - 2);
  throwsRule(() => act(st, { type: 'caravan', p: 0, give: ['wood', 'wood'], get: 'ore' }), /不同/);
  throwsRule(() => act(st, { type: 'caravan', p: 0, give: ['wood', 'brick', 'wool'], get: 'ore' }), /不同/);
  throwsRule(() => act(st, { type: 'caravan', p: 1, give: ['wood', 'brick'], get: 'ore' }));
});

test('road bureau +10 roads, new town +2 settlements and +2 cities, the royal road complete +10 roads', () => {
  const st = fresh(['roadworks', 'newTown', 'royalRoad']);
  const pl = st.players[0];
  give(st, 0, all(9));
  const v = corner(st);
  place(st, 0, v, 'c');
  // eight roads, five settlements
  let n = 0;
  for (let e = 0; e < GEO.edges.length && n < 8; e++) if (st.edges[e] < 0) (st.edges[e] = 0), n++;
  const vs = [v];
  for (let i = 0; i < 4; i++) vs.push(corner(st, { avoid: vs }));
  vs.slice(1).forEach((u) => place(st, 0, u));
  const roads = pl.pieces.roads;
  const towns = pl.pieces.settlements;
  const cities = pl.pieces.cities;
  act(st, { type: 'special', p: 0, k: 'roadworks', vertex: v });
  assert.equal(pl.pieces.roads, roads + 10);
  act(st, { type: 'special', p: 0, k: 'newTown', vertex: v });
  assert.equal(pl.pieces.settlements, towns + 2);
  assert.equal(pl.pieces.cities, cities + 2);
  // the royal road: its third stage paid, complete at the start of p's next turn
  const desert = st.board.hexes.findIndex((x) => x.terrain === 'desert');
  st.wonders.push({ h: desert, k: 'royalRoad', p: 0, s: 3, t: st.turn, done: false });
  const r2 = pl.pieces.roads;
  for (let q = 0; q < 4; q++) {
    st.rolled = true;
    st.pending = null;
    act(st, { type: 'endTurn', p: st.current });
  }
  assert.equal(st.current, 0);
  assert.ok(st.wonders[0].done);
  assert.equal(pl.pieces.roads, r2 + 10);
});

test('town hall: beside a city; then every settlement of its owner holds one building more', () => {
  const st = fresh(['townHall']);
  const v = corner(st);
  const u = corner(st, { avoid: [v] });
  place(st, 0, v, 'c');
  place(st, 0, u, 's');
  assert.match(hostWhy(st, 0, 'townHall', u), /城市/);
  assert.equal(slotsAt(st, u), 1);
  assert.equal(slotsAt(st, v), 2);
  give(st, 0, all(9));
  act(st, { type: 'special', p: 0, k: 'townHall', vertex: v });
  assert.equal(slotsAt(st, u), 2);
  assert.equal(slotsAt(st, v), 2, 'a city: three, one of them the town hall');
});

test('lecture hall: two development cards a turn, never two knights', () => {
  const st = fresh(['lectureHall']);
  const pl = st.players[0];
  built(st, 0, 'lectureHall', corner(st));
  pl.dev = [
    { type: 'knight', turn: 1 },
    { type: 'knight', turn: 1 },
    { type: 'yearOfPlenty', turn: 1 },
    { type: 'monopoly', turn: 1 },
  ];
  st.pending = null;
  act(st, { type: 'playDev', p: 0, card: 'knight' });
  st.pending = null;
  assert.ok(!playableDev(st, 0).includes('knight'));
  throwsRule(() => act(st, { type: 'playDev', p: 0, card: 'knight' }), /騎士/);
  act(st, { type: 'playDev', p: 0, card: 'yearOfPlenty', res: ['ore', 'ore'] });
  throwsRule(() => act(st, { type: 'playDev', p: 0, card: 'monopoly', res: 'ore' }), /兩張/);
  // without it: one
  const s2 = fresh();
  s2.players[0].dev = [{ type: 'yearOfPlenty', turn: 1 }, { type: 'monopoly', turn: 1 }];
  act(s2, { type: 'playDev', p: 0, card: 'yearOfPlenty', res: ['ore', 'ore'] });
  throwsRule(() => act(s2, { type: 'playDev', p: 0, card: 'monopoly', res: 'ore' }), /一張/);
});

test('scriptorium: a free development card with every city, even with no development card in the blueprint', () => {
  const st = fresh(['scriptorium']);
  const pl = st.players[0];
  pl.bp = pl.bp.filter((k) => k !== 'dev');
  const v = corner(st);
  built(st, 0, 'scriptorium', v, true);
  const u = corner(st, { avoid: [v] });
  place(st, 0, u, 's');
  give(st, 0, { grain: 2, ore: 3 });
  const deck = st.devDeck.length;
  const ev = act(st, { type: 'city', p: 0, vertex: u });
  assert.equal(pl.dev.length, 1);
  assert.equal(st.devDeck.length, deck - 1);
  assert.equal(pl.devGot, 1);
  const e = ev.find((x) => x.type === 'buyDev');
  assert.equal(e.how, 'scriptorium');
  assert.equal(redactEvent(e, 1).card, null);
});

test("warehouse: up to three cards put away after the roll, out of reach of the robber, the 7 and a monopoly; taken back on the owner's turn", () => {
  const st = fresh(['warehouse']);
  const P = () => st.players[0];
  built(st, 0, 'warehouse', corner(st));
  give(st, 0, { wood: 0, brick: 0, wool: 0, grain: 2, ore: 10 });
  throwsRule(() => act(st, { type: 'warehouse', p: 0, put: { ore: 4 } }), /3/);
  act(st, { type: 'warehouse', p: 0, put: { ore: 3 } });
  assert.equal(P().store.ore, 3);
  assert.equal(P().res.ore, 7);
  // another's view: how many, not which
  const view = makeView(st, 1);
  assert.equal(view.players[0].store, null);
  assert.equal(view.players[0].storeCount, 3);
  assert.deepEqual(makeView(st, 0).players[0].store, { ...none(), ore: 3 });
  // a 7: half of the hand only (9 in hand → 4)
  st.current = 1;
  st.rolled = false;
  const ev = rollSum(st, 7);
  const req = ev.find((e) => e.type === 'discardRequired');
  assert.equal(req.amounts[0], 4);
  // a monopoly takes what is in hand
  st.pending = null;
  st.rolled = true;
  st.players[1].dev = [{ type: 'monopoly', turn: 1 }];
  act(st, { type: 'playDev', p: 1, card: 'monopoly', res: 'ore' });
  assert.equal(P().res.ore, 0);
  assert.equal(P().store.ore, 3);
  // taken back on its owner's turn (before the roll too)
  st.current = 0;
  st.rolled = false;
  st.devPlayed = false;
  throwsRule(() => act(st, { type: 'warehouse', p: 0, put: { grain: 1 } }), /擲骰/);
  act(st, { type: 'warehouse', p: 0, take: { ore: 3 } });
  assert.equal(P().res.ore, 3);
  assert.equal(P().store.ore, 0);
});

test("counting house: a card of the owner's choice for 8 cards or more at the turn's end; almshouse: for 2 or fewer at its start", () => {
  const st = fresh(['countingHouse', 'almshouse']);
  const pl = st.players[0];
  built(st, 0, 'countingHouse', corner(st));
  give(st, 0, { ...none(), ore: 8 });
  const ev = act(st, { type: 'endTurn', p: 0, bonus: 'wool' });
  assert.equal(pl.res.wool, 1);
  assert.ok(ev.some((e) => e.type === 'bonus' && e.why === 'countingHouse' && e.res === 'wool'));
  // the almshouse: player 1 starts with one card
  const p1 = st.players[1];
  built(st, 1, 'almshouse', corner(st, { avoid: [pl.built.countingHouse] }));
  Object.assign(p1.res, { ...none(), wood: 1 });
  const ev2 = act(st, { type: 'roll', p: 1, alms: 'brick' });
  assert.ok(ev2[0].type === 'bonus' && ev2[0].res === 'brick');
  assert.ok(p1.res.brick >= 1);
});

test('road bureau: from 8 roads; the first road of each turn a card less (the one the hand lacks, or keeps fewest of)', () => {
  const st = fresh(['roadworks']);
  const pl = st.players[0];
  const v = corner(st);
  place(st, 0, v);
  give(st, 0, all(9));
  let n = 0;
  for (let e = 0; e < GEO.edges.length && n < 7; e++) if (st.edges[e] < 0 && !GEO.edges[e].v.includes(v)) (st.edges[e] = 0), n++;
  assert.match(specialWhy(st, 0, 'roadworks'), /8 條道路/);
  const e0 = GEO.vertices[v].edges.find((x) => st.edges[x] < 0);
  act(st, { type: 'road', p: 0, edge: e0 });
  assert.equal(specialWhy(st, 0, 'roadworks'), null);
  act(st, { type: 'special', p: 0, k: 'roadworks', vertex: v });
  st.used = {};
  // a brick only: the wood left out
  const near = (u) => GEO.vertices[u].edges.find((x) => st.edges[x] < 0 && roadLegal(st, 0, x));
  give(st, 0, { ...none(), wood: 1, brick: 2 });
  const e1 = [v, ...GEO.vertices[v].neighbors].map(near).find((x) => x !== undefined);
  const ev = act(st, { type: 'road', p: 0, edge: e1 });
  const b = ev.find((x) => x.type === 'build');
  assert.equal(b.skip, 'wood');
  assert.deepEqual([pl.res.wood, pl.res.brick], [1, 1]);
  assert.ok(st.used.roadworks);
  // the second road of the turn: the whole cost
  give(st, 0, { ...none(), wood: 0, brick: 1 });
  const e2 = GEO.edges.findIndex((x, i) => st.edges[i] < 0 && roadLegal(st, 0, i));
  throwsRule(() => act(st, { type: 'road', p: 0, edge: e2 }), /資源不足/);
  // a hand without the brick: the brick left out
  st.used = {};
  give(st, 0, { ...none(), wood: 1, brick: 0 });
  const plan = payFor(st, 0, { wood: 1, brick: 1 }, 'road');
  assert.deepEqual(plan.cost, { wood: 1 });
  assert.equal(plan.works, true);
});

test('smithy: once a turn an ore stands for the one card a build lacks (or for a chosen one)', () => {
  const st = fresh(['smithy']);
  const pl = st.players[0];
  const v = corner(st);
  built(st, 0, 'smithy', v);
  const e = GEO.vertices[v].edges.find((x) => st.edges[x] < 0);
  give(st, 0, { ...none(), wood: 1, ore: 1 });
  const ev = act(st, { type: 'road', p: 0, edge: e });
  assert.equal(ev[0].smith, 'brick');
  assert.equal(pl.res.ore, 0);
  assert.equal(pl.res.wood, 0);
  assert.ok(st.used.smithy);
  // the second time in a turn: no
  const e2 = GEO.vertices[v].edges.find((x) => st.edges[x] < 0);
  give(st, 0, { ...none(), wood: 1, ore: 1 });
  throwsRule(() => act(st, { type: 'road', p: 0, edge: e2 }), /資源不足/);
  // a chosen card, even when the hand has it
  st.used = {};
  give(st, 0, { ...none(), wood: 1, brick: 1, ore: 1 });
  const plan = payFor(st, 0, { wood: 1, brick: 1 }, 'road', { sub: 'wood' });
  assert.deepEqual(plan.cost, { brick: 1, ore: 1 });
});

test('a discount not chosen: the card the hand lacks, or else the one it would have the fewest of left', () => {
  const st = fresh(['workshop', 'market']);
  st.players[0].built.workshop = corner(st);
  // the market: wood, 2 wool, 2 grain
  Object.assign(st.players[0].res, { wood: 1, brick: 0, wool: 1, grain: 5, ore: 0 });
  assert.equal(payFor(st, 0, BUILDINGS.market.cost, 'special').skip, 'wool');
  Object.assign(st.players[0].res, { wood: 3, brick: 0, wool: 2, grain: 5, ore: 0 });
  assert.equal(payFor(st, 0, BUILDINGS.market.cost, 'special').skip, 'wool');
  Object.assign(st.players[0].res, { wood: 1, brick: 0, wool: 4, grain: 5, ore: 0 });
  assert.equal(payFor(st, 0, BUILDINGS.market.cost, 'special').skip, 'wood');
});

test('terraces: one more card for each settlement on a 2, 3, 11 or 12', () => {
  const st = fresh(['terraces']);
  const h = GEO.hexes.find((x) => land(st, x.id) && [2, 3, 11, 12].includes(st.board.hexes[x.id].number)).id;
  const v = GEO.hexes[h].vertices[0];
  built(st, 0, 'terraces', v);
  robberAway(st, [h]);
  const ev = rollSum(st, st.board.hexes[h].number);
  const c = ev.find((e) => e.type === 'produce').paid.find((x) => x.p === 0 && x.hex === h && !x.plot);
  assert.equal(c.amt, 2);
});

test('observatory: after the roll, a wool for a second roll, once a turn; nothing comes of the first', () => {
  const st = fresh(['observatory']);
  const pl = st.players[0];
  built(st, 0, 'observatory', corner(st));
  give(st, 0, { ...none(), wool: 2 });
  st.rolled = false;
  const ev = act(st, { type: 'roll', p: 0 });
  assert.equal(st.pending.type, 'reroll');
  assert.deepEqual(actorsNow(st), [0]);
  assert.ok(!ev.some((e) => e.type === 'produce' || e.type === 'discardRequired'));
  throwsRule(() => act(st, { type: 'endTurn', p: 0 }), /天文台/);
  const ev2 = act(st, { type: 'reroll', p: 0, yes: true });
  assert.equal(pl.res.wool, 1);
  assert.ok(ev2[0].type === 'roll' && ev2[0].again);
  assert.ok(st.used.observatory);
  assert.equal(st.rolls.reduce((a, b) => a + b, 0) - fresh().rolls.reduce((a, b) => a + b, 0), 1, 'one roll counted');
  // declined: the first roll stands
  const s2 = fresh(['observatory']);
  built(s2, 0, 'observatory', corner(s2));
  give(s2, 0, { ...none(), wool: 1 });
  s2.rolled = false;
  const first = act(s2, { type: 'roll', p: 0 })[0].sum;
  const ev3 = act(s2, { type: 'reroll', p: 0, yes: false });
  assert.equal(s2.players[0].res.wool >= 1, true);
  assert.ok(first === 7 ? s2.pending : ev3.some((e) => e.type === 'produce'));
});

test('watchtower: the robber beside its settlement costs the mover a card to its owner; with no cards, not there', () => {
  const st = fresh(['watchtower']);
  const v = corner(st);
  built(st, 1, 'watchtower', v);
  const h = GEO.vertices[v].hexes.find((x) => st.board.robber !== x);
  st.pending = { type: 'robber', reason: 'seven' };
  assert.match(robberWhy(st, 0, h), /瞭望塔/);
  give(st, 0, { ...none(), ore: 1 });
  assert.equal(robberWhy(st, 0, h), null);
  const ev = act(st, { type: 'robber', p: 0, hex: h });
  const i = ev.findIndex((e) => e.type === 'toll');
  const tl = ev[i];
  assert.ok(tl && tl.p === 1 && tl.from === 0 && tl.res === 'ore');
  // (then the theft, from the watchtower's owner as from anyone beside the robber)
  const j = ev.findIndex((e) => e.type === 'steal');
  assert.ok(j > i, 'the toll before the theft');
  assert.equal(st.players[0].res.ore + st.players[1].res.ore, 1);
});

test("temple: the robber beside its owner's settlements robs nobody of theirs", () => {
  const st = fresh(['temple']);
  const v = corner(st);
  built(st, 1, 'temple', v);
  give(st, 1, all(2));
  const h = GEO.vertices[v].hexes[0];
  assert.deepEqual(robberVictims(st, h, 0), []);
});

test("builders' yard and apprentice workshop: a wonder's stage, a special building one card short, the card chosen", () => {
  const st = fresh(['builders', 'workshop', 'market', 'gardens']);
  const pl = st.players[0];
  const v = corner(st);
  built(st, 0, 'workshop', v, true);
  // the market (wood, 2 wool, 2 grain) without one wool
  give(st, 0, { ...none(), wood: 1, wool: 1, grain: 2 });
  const ev = act(st, { type: 'special', p: 0, k: 'market', vertex: v, skip: 'wool' });
  assert.equal(ev[0].skip, 'wool');
  assert.equal(hand(st, 0), 0);
  // a wonder's stage without the brick chosen
  const desert = st.board.hexes.findIndex((x) => x.terrain === 'desert');
  st.board.robber = GEO.hexes.find((x) => land(st, x.id)).id;
  place(st, 0, GEO.hexes[desert].vertices[0]);
  pl.built.builders = GEO.hexes[desert].vertices[0];
  give(st, 0, { ...none(), wood: 2, brick: 1, grain: 1 });
  const ev2 = act(st, { type: 'wonder', p: 0, hex: desert, skip: 'brick' });
  assert.equal(ev2[0].skip, 'brick');
  assert.equal(hand(st, 0), 0);
});

test('garrison: two cards of any kind keep a wonder from the robber', () => {
  const st = fresh(['garrison', 'gardens']);
  const desert = st.board.hexes.findIndex((x) => x.terrain === 'desert');
  const v = GEO.hexes[desert].vertices[0];
  built(st, 1, 'garrison', v);
  st.wonders.push({ h: desert, k: 'gardens', p: 1, s: 2, t: 1, done: false });
  give(st, 1, { ...none(), wood: 1, ore: 2 });
  give(st, 0, { ...none(), wool: 1 });
  st.board.robber = GEO.hexes.find((x) => land(st, x.id) && x.id !== desert).id;
  st.pending = { type: 'robber', reason: 'seven' };
  act(st, { type: 'robber', p: 0, hex: desert });
  assert.equal(st.pending.type, 'defend');
  throwsRule(() => act(st, { type: 'defend', p: 1, yes: true, pay: { ore: 3 } }), /2 張/);
  const ev = act(st, { type: 'defend', p: 1, yes: true, pay: { wood: 1, ore: 1 } });
  assert.ok(ev.some((e) => e.type === 'defend' && e.paid));
  assert.equal(st.wonders.length, 1);
});

test('guild hall: a point for every two special buildings, itself among them; the monument: two', () => {
  const st = fresh(['guildHall', 'monument', 'market', 'granary', 'temple']);
  const v = corner(st);
  const u = corner(st, { avoid: [v] });
  place(st, 0, v, 'c');
  place(st, 0, u, 'c');
  const pl = st.players[0];
  pl.built.guildHall = v;
  assert.equal(developScore(st, 0).buildings, 0);
  pl.built.market = v;
  assert.equal(developScore(st, 0).buildings, 1 + 1);
  pl.built.granary = u;
  assert.equal(developScore(st, 0).buildings, 2 + 1);
  pl.built.monument = u;
  assert.equal(developScore(st, 0).buildings, 2 + 2 + 2);
  assert.equal(totalVP(st, 0) >= 5, true);
});

test('the deck: when it runs out the road building, year of plenty and monopoly cards played go back in', () => {
  const st = fresh();
  const pl = st.players[0];
  st.devDeck = [];
  pl.dev = [{ type: 'monopoly', turn: 1 }];
  act(st, { type: 'playDev', p: 0, card: 'monopoly', res: 'ore' });
  assert.deepEqual(st.devDiscard, ['monopoly']);
  give(st, 0, { ...none(), wool: 1, grain: 1, ore: 1 });
  const ev = act(st, { type: 'buyDev', p: 0 });
  assert.ok(ev.some((e) => e.type === 'devReshuffle'));
  assert.equal(pl.dev[0].type, 'monopoly');
  assert.equal(st.devDiscard.length, 0);
  // knights are not shuffled back
  pl.dev.push({ type: 'knight', turn: 1 });
  st.devPlayed = false;
  act(st, { type: 'playDev', p: 0, card: 'knight' });
  assert.equal(st.devDiscard.length, 0);
});

console.log(`develop2: ${passed} passed`);
