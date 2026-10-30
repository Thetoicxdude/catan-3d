// Measures how often the computer opponents accept the kinds of offers a person typically makes.
// Mid-game states come from all-AI games; seat 0 plays the "person" who proposes:
//   fair    1 of my most plentiful card for 1 card I am missing for my next build
//   generous 2 of my most plentiful for 1 card I need
//   lopsided 1 card for 2 of what I need (should mostly be refused)
// usage: node test/tradeai.mjs [games]
import { createGame, applyAction, makeView, actorsNow, RES, COSTS, missingFor, publicVP } from '../src/engine/engine.js';
import { aiAct } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';

const GAMES = Number(process.argv[2] || 40);
const stats = { fair: [0, 0, 0, 0, 0], generous: [0, 0, 0, 0, 0], lopsided: [0, 0, 0, 0, 0] }; // [offers, ≥1 accept, accept votes, holder votes, holders]
const level = process.argv[3] || 'normal';

for (let g = 0; g < GAMES; g++) {
  const players = [0, 1, 2, 3].map((i) => ({ name: 'P' + i, color: '#fff', kind: 'ai', ai: { level } }));
  const st = createGame({ seed: 1000 + g, players });
  const rnd = makeRng(1000 + g);
  const mem = players.map(() => ({}));
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 4000) {
    // at the start of seat 0's main phase, try the offers on a copy of the state
    if (st.phase === 'play' && st.current === 0 && st.rolled && !st.pending && !st.trade && st.turn > 8 && st.turn % 4 === 1) {
      const me = st.players[0];
      const plentiful = RES.slice().sort((a, b) => me.res[b] - me.res[a])[0];
      const goals = [COSTS.settlement, COSTS.city, COSTS.dev, COSTS.road];
      let want = null;
      for (const c of goals) {
        const m = Object.keys(missingFor(me.res, c).missing).filter((r) => r !== plentiful);
        if (m.length) {
          want = m[0];
          break;
        }
      }
      if (want && publicVP(st, 0) < st.targetVP - 2) {
        const kinds = [];
        if (me.res[plentiful] >= 1) kinds.push(['fair', { [plentiful]: 1 }, { [want]: 1 }]);
        if (me.res[plentiful] >= 2) kinds.push(['generous', { [plentiful]: 2 }, { [want]: 1 }]);
        if (me.res[plentiful] >= 1) kinds.push(['lopsided', { [plentiful]: 1 }, { [want]: 2 }]);
        for (const [kind, give, get] of kinds) {
          const s2 = structuredClone(st);
          applyAction(s2, { type: 'offer', p: 0, give, get });
          let yes = 0;
          let able = 0;
          for (const q of [1, 2, 3]) {
            const a = aiAct(makeView(s2, q), q, structuredClone(mem[q]), rnd);
            if (!a || a.type !== 'respond') continue;
            able++;
            if (a.accept) yes++;
            const holds = Object.entries(get).every(([r, n]) => s2.players[q].res[r] >= n);
            if (holds) {
              stats[kind][4]++;
              if (a.accept) stats[kind][3]++;
            }
          }
          if (!able) continue;
          stats[kind][0]++;
          if (yes) stats[kind][1]++;
          stats[kind][2] += yes;
        }
      }
    }
    const actors = actorsNow(st);
    let acted = false;
    for (const p of actors) {
      const a = aiAct(makeView(st, p), p, mem[p], rnd);
      if (!a) continue;
      applyAction(st, a);
      acted = true;
      break;
    }
    if (!acted) break;
  }
}
for (const [k, [n, any, votes, hv, h]] of Object.entries(stats)) {
  console.log(`${k.padEnd(9)} offers ${String(n).padStart(4)}  someone accepts ${((any / Math.max(1, n)) * 100).toFixed(0).padStart(3)}%  avg yes ${(votes / Math.max(1, n)).toFixed(2)} of 3  · holders accept ${((hv / Math.max(1, h)) * 100).toFixed(0)}% (${h} holders)`);
}
