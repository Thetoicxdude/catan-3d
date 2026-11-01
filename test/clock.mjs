// The turn clock's fallback moves: for whoever the game is waiting on, the move made when their time
// runs out must be legal, must keep the game going, and must never build or trade for them.
import assert from 'node:assert/strict';
import { createGame, applyAction, actorsNow, makeView } from '../src/engine/engine.js';
import { aiAct } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';
import { timeoutAction, turnKey, turnLimit } from '../src/game/clock.js';

const ALLOWED = new Set(['settlement', 'road', 'ship', 'discard', 'gold', 'robber', 'steal', 'cancelOffer', 'respond', 'roll', 'endTurn', 'endRoadBuilding']);
let checked = 0;
let games = 0;
const kinds = {};
// 40 standard games, 5–6 player games on the large island (paired turns, then the special building
// phase), then Seafarers games
for (let g = 0; g < 66; g++) {
  const big = g >= 40 && g < 52;
  const sea = g >= 52;
  const n = big ? 5 + (g % 2) : 4;
  const players = Array.from({ length: n }, (_, i) => ({ name: 'p' + i, color: '#000', kind: 'ai', ai: { level: 'normal' } }));
  const st = createGame({ seed: 1000 + g, players, targetVP: 10, map: big ? 'base-6' : sea ? (g >= 60 ? 'sea-2' : 'sea-1') : undefined, rules: big && g >= 46 ? { turns: 'sbp' } : undefined });
  const mem = players.map(() => ({}));
  const rnd = makeRng(77 + g);
  let steps = 0;
  while (st.phase !== 'over' && steps < 3000) {
    steps++;
    assert.ok(turnKey(st), 'a running game has a clock');
    assert.equal(turnLimit(st), st.phase === 'setup' ? 120000 : !st.sub ? 180000 : st.sub.k === 'pair' ? 90000 : 45000);
    for (const p of actorsNow(st)) {
      const a = timeoutAction(st, p, {}, rnd);
      if (!a) continue;
      assert.ok(ALLOWED.has(a.type), `time-out move ${a.type}`);
      if (a.type === 'settlement' || a.type === 'road' || a.type === 'ship') assert.ok(st.phase === 'setup' || (st.pending && st.pending.type === 'roadBuilding'), `${a.type} only in the opening`);
      if (a.type === 'respond') assert.equal(a.accept, false, 'a time-out never accepts a trade');
      const copy = JSON.parse(JSON.stringify(st));
      applyAction(copy, a); // throws if illegal
      kinds[a.type] = (kinds[a.type] || 0) + 1;
      checked++;
    }
    // the game goes on as the computer would play it
    const p = actorsNow(st)[0];
    let a = aiAct(makeView(st, p), p, mem[p], rnd);
    try {
      applyAction(st, a || { type: 'endTurn', p });
    } catch {
      applyAction(st, timeoutAction(st, p, {}, rnd));
    }
  }
  if (st.phase === 'over') games++;
}
// a game of nothing but time-outs still reaches its end of the opening and keeps turning
{
  const players = [0, 1, 2].map((i) => ({ name: 'p' + i, color: '#000', kind: 'remote' }));
  const st = createGame({ seed: 4242, players, targetVP: 10 });
  const rnd = makeRng(9);
  for (let i = 0; i < 400 && st.turn < 30; i++) {
    const p = actorsNow(st)[0];
    applyAction(st, timeoutAction(st, p, {}, rnd));
  }
  assert.equal(st.phase, 'play');
  assert.ok(st.turn >= 30, 'turns keep passing on time-outs alone');
}
console.log(`clock ok: ${checked} time-out moves checked in ${games} games`, kinds);
