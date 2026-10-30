// Round-trip test: encoded online snapshots decode into the same view the engine would give that seat.
import assert from 'node:assert/strict';
import { createGame, applyAction, makeView, actorsNow, redactEvent } from '../src/engine/engine.js';
import { aiAct } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';
import * as C from '../src/net/codec.js';

const KEYS = ['phase', 'current', 'turn', 'rolled', 'dice', 'devPlayed', 'pending', 'trade', 'longestRoad', 'largestArmy', 'roadLen', 'winner', 'seq', 'rolls', 'bank', 'devDeckCount', 'targetVP', 'vertices', 'edges'];
let checked = 0;
let maxSize = 0;
for (let g = 0; g < 40; g++) {
  const players = Array.from({ length: g % 3 ? 4 : 3 }, (_, i) => ({ name: ['曙光王國', '蒼藍聯邦', '琥珀公國', '白楊共和國'][i], color: '#c8372d', kind: 'ai', ai: { level: 'normal' } }));
  const st = createGame({ seed: 900 + g, players, entropy: [1, 2, 3, g + 4] });
  const rnd = makeRng(g);
  const mem = players.map(() => ({}));
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 4000) {
    const actors = actorsNow(st);
    let ev = null;
    for (const p of actors) {
      const a = aiAct(makeView(st, p), p, mem[p], rnd);
      if (!a) continue;
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
    const size = C.utf8Size({ bd: board, ps: C.encodeSeats(st), pub });
    maxSize = Math.max(maxSize, size);
  }
}
console.log(`codec ok: ${checked} views compared, largest public snapshot ${maxSize} bytes`);
