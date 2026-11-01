// Round-trip test: encoded online snapshots decode into the same view the engine would give that seat.
import assert from 'node:assert/strict';
import { createGame, applyAction, makeView, actorsNow, redactEvent, ACTION_TYPES } from '../src/engine/engine.js';
import { aiAct } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';
import * as C from '../src/net/codec.js';

const KEYS = ['phase', 'current', 'turn', 'rolled', 'dice', 'devPlayed', 'pending', 'trade', 'longestRoad', 'largestArmy', 'roadLen', 'winner', 'seq', 'rolls', 'bank', 'devDeckCount', 'targetVP', 'vertices', 'edges'];
let checked = 0;
let maxSize = 0;
let fullMax = 0;
let seatsChecked = 0;
let bigMax = 0;
const NAMES = ['曙光王國', '蒼藍聯邦', '琥珀公國', '白楊共和國', '紫晶公國', '翡翠王朝'];
let seaMax = 0;
// 40 standard games, 5–6 player games on the large island (paired turns, then the special building
// phase), then Seafarers games (scenario 1, 2, 3 and 9)
for (let g = 0; g < 88; g++) {
  const big = g >= 40 && g < 52;
  const sea = g >= 52;
  const players = Array.from({ length: big ? 5 + (g % 2) : g % 3 ? 4 : 3 }, (_, i) => ({ name: NAMES[i], color: '#c8372d', kind: 'ai', ai: { level: 'normal' } }));
  const st = createGame({ seed: 900 + g, players, entropy: [1, 2, 3, g + 4], map: big ? 'base-6' : sea ? (g >= 80 ? 'sea-9' : g >= 72 ? 'sea-3' : g >= 64 ? 'sea-2' : 'sea-1') : undefined, rules: big && g >= 46 ? { turns: 'sbp' } : undefined });
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
    if (big) bigMax = Math.max(bigMax, size);
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
console.log(`codec ok: ${checked} views compared, largest public snapshot ${maxSize} bytes (5–6 players on the large island: ${bigMax}; Seafarers: ${seaMax}), largest takeover snapshot ${fullMax} bytes`);
