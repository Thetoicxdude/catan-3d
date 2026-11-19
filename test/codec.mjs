// Round-trip test: encoded online snapshots decode into the same view the engine would give that seat.
import assert from 'node:assert/strict';
import { createGame, applyAction, makeView, actorsNow, redactEvent, ACTION_TYPES } from '../src/engine/engine.js';
import { aiAct } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';
import * as C from '../src/net/codec.js';
import { registerMap } from '../src/engine/maps.js';
import { draftToDef } from '../src/engine/custom.js';
import { DRAFTS } from './drafts.mjs';

const KEYS = ['phase', 'current', 'turn', 'rolled', 'dice', 'devPlayed', 'pending', 'trade', 'longestRoad', 'largestArmy', 'roadLen', 'winner', 'seq', 'rolls', 'bank', 'devDeckCount', 'targetVP', 'vertices', 'edges'];
let checked = 0;
let maxSize = 0;
let fullMax = 0;
let seatsChecked = 0;
let bigMax = 0;
const NAMES = ['曙光王國', '蒼藍聯邦', '琥珀公國', '白楊共和國', '紫晶公國', '翡翠王朝'];
let seaMax = 0;
let sea6Max = 0;
let drawnMax = 0;
// 40 standard games, 5–6 player games on the large island (paired turns, then the special building
// phase), then Seafarers games (scenario 1, 2, 3 and 9), then Seafarers for 5–6 players (each map
// four times, the last of them with the special building phase)
const SEA6 = ['sea-1-6', 'sea-2-6', 'sea-3-6', 'sea-9-6'];
// and maps players made (published: every page makes the same map from the draft), two each
const DRAWN = ['twin', 'archipelago'].map((k) => registerMap(draftToDef(DRAFTS[k], 'u-TEST' + (k === 'twin' ? '22' : '33'))));
// and last, games with a room's house rules (numbers dealt more like the dice fall, a higher hand
// limit, the dice deck) on the standard island, the large island, Seafarers 1 and the new world
const HOUSE = [undefined, 'base-6', 'sea-1', 'sea-9'];
// and the development mode (developments, blueprints, buildings, wonders): four players on the 37-hex
// island, two or three on the 30-hex one
const PRESETS = ['port', 'order', 'farm', 'frontier', 'scholars'];
let devMax = 0;
let ruinsSeen = 0;
for (let g = 0; g < 124; g++) {
  const dev = g >= 116;
  const house = g >= 108 && !dev;
  const big = (g >= 40 && g < 52) || (house && g % 4 === 1);
  const drawn = g >= 104 && g < 108 ? DRAWN[(g - 104) >> 1] : null;
  const sea = (g >= 52 && g < 104) || !!(drawn && drawn.rules && drawn.rules.seafarers) || (house && g % 4 >= 2);
  const sea6 = g >= 88 && g < 104;
  const players = Array.from({ length: dev ? (g % 4 === 3 ? 3 - (g % 2) : 4) : drawn ? drawn.players[1] : big || sea6 ? 5 + (g % 2) : g % 3 ? 4 : 3 }, (_, i) => ({ name: NAMES[i], color: '#c8372d', kind: 'ai', ai: { level: 'normal' }, bp: dev ? Object.values(PRESETS)[(g + i) % 5] : undefined }));
  const map = dev ? (players.length === 4 ? 'dev-4' : 'dev-3') : house ? HOUSE[g % 4] : drawn ? drawn.id : sea6 ? SEA6[(g - 88) >> 2] : big ? 'base-6' : sea ? (g >= 80 ? 'sea-9' : g >= 72 ? 'sea-3' : g >= 64 ? 'sea-2' : 'sea-1') : undefined;
  const rules = house ? { discard: 8 + (g % 3), dice: 'deck' } : (big && g >= 46) || (sea6 && g % 4 === 3) ? { turns: 'sbp' } : undefined;
  const st = createGame({ seed: 900 + g, players, entropy: [1, 2, 3, g + 4], map, rules, board: house ? { mix: 'rich' } : undefined });
  if (house) assert.equal(st.board.mix, 'rich');
  const rnd = makeRng(g);
  const mem = players.map(() => ({}));
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 4000) {
    const actors = actorsNow(st);
    let ev = null;
    for (const p of actors) {
      const a = aiAct(makeView(st, p), p, mem[p], rnd);
      if (!a) continue;
      // the move as the host receives it from a player's page: nothing the rules read is lost
      const sent = JSON.parse(JSON.stringify(a));
      assert.deepEqual(C.sanitizeAction(sent, p, ACTION_TYPES), sent, `${a.type} loses something on the way to the host`);
      ev = applyAction(st, a);
      break;
    }
    if (!ev) break;
    // encode/decode events
    for (const e of ev) {
      const enc = C.encodeEvent(e);
      if (!enc) continue;
      const dec = C.decodeEvent(JSON.parse(JSON.stringify(enc)));
      assert.equal(dec.type, e.type);
      if (e.type === 'produce') assert.equal(dec.paid.length, e.paid.length);
      if (e.type === 'build') assert.equal(dec.vertex ?? dec.edge, e.vertex ?? e.edge);
      if (e.type === 'turnStart') assert.deepEqual([dec.p, dec.turn, dec.sub, dec.lead], [e.p, e.turn, e.sub, e.lead]);
    }
    if (guard % 7 !== 0 && st.phase !== 'over') continue;
    const board = C.encodeBoard(st);
    const seats = C.decodeSeats(C.encodeSeats(st));
    const pub = JSON.parse(JSON.stringify(C.encodePublic(st)));
    for (let seat = 0; seat < players.length; seat++) {
      const priv = JSON.parse(JSON.stringify(C.encodePrivate(st, seat)));
      const got = C.decodeView(board, seats, pub, priv, seat);
      const want = makeView(st, seat);
      for (const k of KEYS) assert.deepEqual(got[k], want[k], `${k} differs (game ${g}, seq ${st.seq})`);
      assert.deepEqual(got.sub, want.sub, `sub differs (game ${g}, seq ${st.seq})`);
      if (sea) {
        assert.deepEqual(got.ships, want.ships, `ships differ (game ${g}, seq ${st.seq})`);
        assert.equal(got.board.pirate, want.board.pirate);
        assert.deepEqual(got.newShips, want.newShips);
        assert.equal(got.shipMoved, want.shipMoved);
        got.players.forEach((pl, i) => {
          assert.equal(pl.chits, want.players[i].chits);
          assert.deepEqual(pl.home, want.players[i].home);
        });
      }
      assert.deepEqual(got.rules, want.rules);
      assert.equal(got.map, want.map);
      if (dev) {
        assert.deepEqual(got.plots, want.plots, `plots differ (game ${g}, seq ${st.seq})`);
        assert.deepEqual(got.wonders, want.wonders, `wonders differ (game ${g}, seq ${st.seq})`);
        assert.deepEqual(got.ruins || [], want.ruins || [], `ruins differ (game ${g}, seq ${st.seq})`);
        if ((want.ruins || []).length) ruinsSeen++;
        assert.deepEqual(got.used, want.used, `used differs (game ${g}, seq ${st.seq})`);
        got.players.forEach((pl, i) => {
          const w = want.players[i];
          assert.deepEqual([pl.bp, pl.built, pl.bought, pl.yard], [w.bp, w.built, w.bought, w.yard], `development seat ${i} differs (game ${g}, seq ${st.seq})`);
          if (i === seat) assert.deepEqual(pl.pick, w.pick);
        });
      }
      assert.deepEqual(got.board.hexes, want.board.hexes);
      assert.deepEqual(got.board.vertexHarbor, want.board.vertexHarbor);
      assert.equal(got.board.robber, want.board.robber);
      if (st.phase !== 'over') assert.deepEqual(got.setup.order, want.setup.order);
      for (let i = 0; i < players.length; i++) {
        const a = got.players[i];
        const b = want.players[i];
        assert.equal(a.resCount, b.resCount);
        assert.equal(a.devCount, b.devCount);
        assert.equal(a.knights, b.knights);
        assert.deepEqual(a.pieces, b.pieces);
        assert.deepEqual(a.played, b.played);
        if (i === seat) {
          assert.deepEqual(a.res, b.res);
          assert.deepEqual(a.dev, b.dev);
        } else if (st.phase !== 'over') {
          assert.equal(a.res, null);
          assert.equal(a.dev, null);
        }
      }
      checked++;
    }
    // the whole game, as the player taking over as host rebuilds it
    const full = JSON.parse(JSON.stringify(C.encodeFull(st)));
    const rebuilt = C.decodeFull(board, seats, pub, full);
    const norm = (x) => JSON.parse(JSON.stringify(x));
    const want = norm(st);
    const got = norm(rebuilt);
    for (const k of Object.keys(want)) assert.deepEqual(got[k], want[k], `full state: ${k} differs (game ${g}, seq ${st.seq})`);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
    // and the game goes on from it exactly as from the original
    if (st.phase !== 'over') {
      const p = actorsNow(st)[0];
      const a = aiAct(makeView(st, p), p, {}, makeRng(seatsChecked++));
      if (a) {
        const e1 = applyAction(JSON.parse(JSON.stringify(st)), a);
        const e2 = applyAction(rebuilt, a);
        assert.deepEqual(norm(e2), norm(e1));
      }
    }
    fullMax = Math.max(fullMax, C.utf8Size(full));
    const size = C.utf8Size({ bd: board, ps: C.encodeSeats(st), pub });
    if (dev) devMax = Math.max(devMax, size);
    else if (big) bigMax = Math.max(bigMax, size);
    else if (drawn) drawnMax = Math.max(drawnMax, size);
    else if (sea6) sea6Max = Math.max(sea6Max, size);
    else if (sea) seaMax = Math.max(seaMax, size);
    else maxSize = Math.max(maxSize, size);
  }
}
// a page on another version lays out another board: it must notice
{
  const players = Array.from({ length: 5 }, (_, i) => ({ name: NAMES[i], color: '#c8372d', kind: 'ai' }));
  const st = createGame({ seed: 4321, players, map: 'base-6' });
  const bd = { ...C.encodeBoard(st), hk: 'zzzz' };
  assert.throws(() => C.decodeBoard(bd, 0), (e) => e instanceof C.BoardMismatch);
}
// (the development mode) a blueprint as the lobby sends it: basic cards and buildings, seven at most
assert.deepEqual(C.bpDecode(C.bpCode(['road', 'settlement', 'city', 'dev', 'granary', 'market', 'gardens'])), ['road', 'settlement', 'city', 'dev', 'granary', 'market', 'gardens']);
assert.deepEqual(C.bpDecode(C.bpCode(['road', 'granary'])), ['road', 'granary']);
assert.deepEqual(C.bpDecode(''), []);
assert.equal(C.bpDecode(C.bpCode(['road', 'road'])), null);
assert.equal(C.bpDecode('rdstctdvgrmkaqhg'), null, 'eight cards');
assert.deepEqual(C.bpDecode(C.bpCode(['road', 'city', 'farmstead', 'warehouse', 'monument', 'guildHall', 'library'])), ['road', 'city', 'farmstead', 'warehouse', 'monument', 'guildHall', 'library']);

// (2026-11-18) the new buildings: their events, their state, the moves they bring
{
  const evs = [
    { type: 'roll', p: 1, dice: [3, 4], sum: 7, again: true },
    { type: 'build', what: 'road', p: 0, setup: false, free: false, edge: 5, paid: { brick: 1, ore: 1 }, smith: 'wood' },
    { type: 'build', what: 'city', p: 0, setup: false, free: false, vertex: 12, paid: { grain: 1, ore: 4 }, smith: 'grain' },
    { type: 'special', p: 2, k: 'market', vertex: 9, paid: { wood: 1, wool: 1, grain: 2 }, skip: 'wool' },
    { type: 'special', p: 2, k: 'shipyard', vertex: 9, res: 'ore' },
    { type: 'wonder', p: 2, k: 'gardens', hex: 4, stage: 1, paid: { wood: 2, grain: 1 }, skip: 'brick' },
    { type: 'develop', p: 0, hex: 3, res: 'ore', level: 3, cost: { wool: 1, grain: 2, ore: 2 }, smith: 'grain' },
    { type: 'defend', p: 1, by: 0, hex: 4, k: 'gardens', knights: 0, paid: { wood: 1, ore: 1 } },
    { type: 'buyDev', p: 0, card: null, left: 10, how: 'scriptorium' },
    { type: 'bonus', p: 0, res: 'wool', why: 'countingHouse' },
    { type: 'bonus', p: 3, res: 'brick', why: 'almshouse' },
    { type: 'toll', p: 1, from: 0, res: null },
    { type: 'caravan', p: 0, give: ['wood', 'brick'], get: 'ore' },
    { type: 'warehouse', p: 0, put: 3, take: 0, stored: 3 },
    { type: 'devReshuffle', left: 4 },
  ];
  for (const e of evs) assert.deepEqual(C.decodeEvent(JSON.parse(JSON.stringify(C.encodeEvent(e)))), e, e.type);
  // the toll's card: for the two of them
  const tl = [{ type: 'toll', p: 1, from: 0, res: 'ore' }];
  for (const seat of [0, 1, 2]) {
    const back = C.applyPrivateDetails([C.decodeEvent(C.encodeEvent(tl[0]))], C.privateDetails(tl, seat));
    assert.equal(back[0].res, seat === 2 ? null : 'ore');
  }
  // the moves, whole on their way to the host
  for (const a of [
    { type: 'caravan', p: 0, give: ['wood', 'brick'], get: 'ore' },
    { type: 'warehouse', p: 0, put: { ore: 2, wool: 1 } },
    { type: 'warehouse', p: 0, take: { ore: 1 } },
    { type: 'defend', p: 0, yes: true, pay: { wood: 1, ore: 1 } },
    { type: 'endTurn', p: 0, bonus: 'wool' },
    { type: 'roll', p: 0, alms: 'brick' },
    { type: 'special', p: 0, k: 'monument', vertex: 4, skip: 'wool' },
    { type: 'road', p: 0, edge: 3, sub: 'wood' },
    { type: 'reroll', p: 0, yes: false },
  ])
    assert.deepEqual(C.sanitizeAction(JSON.parse(JSON.stringify(a)), 0, ACTION_TYPES), a, a.type);
  // a game with a warehouse full, cards to go back in the deck, a reroll to decide, the smithy used
  const players = Array.from({ length: 4 }, (_, i) => ({ name: NAMES[i], color: '#c8372d', kind: 'ai', ai: { level: 'normal' }, bp: ['road', 'settlement', 'city', 'dev', 'warehouse', 'observatory', 'smithy'] }));
  const st = createGame({ seed: 77, players, map: 'dev-4' });
  let guard = 0;
  while (st.phase === 'setup' && guard++ < 200) applyAction(st, aiAct(makeView(st, actorsNow(st)[0]), actorsNow(st)[0], {}, makeRng(guard)));
  const v = st.vertices.findIndex((b) => b && b.p === 1);
  st.players[1].built.warehouse = v;
  st.players[1].store = { wood: 0, brick: 1, wool: 0, grain: 2, ore: 0 };
  st.players[0].built.observatory = st.vertices.findIndex((b) => b && b.p === 0);
  st.players[0].devGot = 4;
  st.devDiscard = ['monopoly', 'roadBuilding'];
  st.devPlays = 1;
  st.knightPlayed = true;
  st.used = { smithy: true, almshouse: true };
  st.pending = { type: 'reroll', p: 0, sum: 8 };
  st.rolled = true;
  st.dice = [4, 4];
  const board = C.encodeBoard(st);
  const seats = C.decodeSeats(C.encodeSeats(st));
  const pub = JSON.parse(JSON.stringify(C.encodePublic(st)));
  for (const seat of [0, 1, 2]) {
    const got = C.decodeView(board, seats, pub, JSON.parse(JSON.stringify(C.encodePrivate(st, seat))), seat);
    const want = makeView(st, seat);
    for (const k of [...KEYS, 'used', 'devPlays', 'knightPlayed', 'devDiscard', 'devDiscardCount']) assert.deepEqual(got[k], want[k], k);
    got.players.forEach((pl, i) => assert.deepEqual([pl.devGot, pl.store, pl.storeCount], [want.players[i].devGot, want.players[i].store, want.players[i].storeCount], `seat ${i} for ${seat}`));
  }
  const norm = (x) => JSON.parse(JSON.stringify(x));
  const rebuilt = norm(C.decodeFull(board, seats, pub, norm(C.encodeFull(st))));
  for (const k of Object.keys(norm(st))) assert.deepEqual(rebuilt[k], norm(st)[k], `full state: ${k}`);
}

console.log(`codec ok (wonders' ruins in ${ruinsSeen} views): ${checked} views compared, largest public snapshot ${maxSize} bytes (5–6 players on the large island: ${bigMax}; Seafarers: ${seaMax}; Seafarers for 5–6: ${sea6Max}; maps players made: ${drawnMax}; the development mode: ${devMax}), largest takeover snapshot ${fullMax} bytes`);
