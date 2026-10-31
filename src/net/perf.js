// How well this device can host an online game. The host's page runs the rules and the computer
// players for everyone, so the room is handed to the player whose device does that fastest.
// The score is how many moves of a computer game this page plays in a short burst, adjusted for the
// number of processor cores and for phones and tablets (which pause pages in the background).
import { createGame, applyAction, makeView, actorsNow } from '../engine/engine.js';
import { aiAct } from '../ai/ai.js';
import { makeRng } from '../engine/rng.js';

let cached = null;

function benchGame() {
  const players = [0, 1, 2, 3].map((i) => ({ name: 'p' + i, color: '#000000', kind: 'ai', ai: { level: 'normal' } }));
  return { st: createGame({ seed: 20261031, players, targetVP: 10 }), mem: players.map(() => ({})) };
}

export function isTouchDevice() {
  try {
    return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || /Mobi|Android|iPad|iPhone/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}

export function perfScore(budgetMs = 120) {
  if (typeof window !== 'undefined' && typeof window.__perf === 'number') return window.__perf; // test hook
  if (cached != null) return cached;
  const rnd = makeRng(7);
  let g = benchGame();
  let ops = 0;
  const t0 = performance.now();
  let t = t0;
  while (t - t0 < budgetMs) {
    for (let k = 0; k < 8; k++) {
      if (g.st.phase === 'over') g = benchGame();
      const p = actorsNow(g.st)[0];
      let a = null;
      try {
        a = aiAct(makeView(g.st, p), p, g.mem[p], rnd);
        if (a) applyAction(g.st, a);
        else applyAction(g.st, { type: 'endTurn', p });
      } catch {
        try {
          applyAction(g.st, { type: 'endTurn', p });
        } catch {
          g = benchGame(); // stuck: start over
        }
      }
      ops++;
    }
    t = performance.now();
  }
  const rate = (ops * 1000) / Math.max(1, t - t0);
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const cores = Math.min(16, nav.hardwareConcurrency || 2);
  const memGB = nav.deviceMemory;
  let s = rate * (1 + 0.04 * cores);
  if (isTouchDevice()) s *= 0.6;
  if (memGB && memGB < 4) s *= 0.8;
  cached = Math.max(1, Math.round(s));
  return cached;
}
