// FIT_NORM for src/ai/ai.js: how the computer's blueprint choice is set against each ready-made
// blueprint's own spread. Rerun it after changing a blueprint fit (blueprintFits) or the presets, and
// paste the printed table into ai.js.
//   node tools/fitnorm.mjs
// It takes the fits of 4,000 seats on the 4- and 3-player development islands, measures each one's mean
// and deviation, then moves the means until the hard computer (noise 0.35) brings every blueprint about
// as often (1 in 10), and prints how often each is brought on hard and on normal.
import { createGame } from '../src/engine/engine.js';
import { blueprintFits } from '../src/ai/ai.js';
import { developMap } from '../src/engine/maps.js';
import { PRESET_IDS } from '../src/engine/develop.js';

const rows = [];
for (const N of [4, 3]) {
  for (let g = 0; g < (N === 4 ? 600 : 534); g++) {
    const players = Array.from({ length: N }, (_, i) => ({ name: 'P' + i, kind: 'ai', ai: { level: 'hard' } }));
    const st = createGame({ seed: 90001 + g * 31 + N, players, map: developMap(N).id });
    for (let p = 0; p < N; p++) rows.push(blueprintFits(st, p));
  }
}
const norm = {};
for (const k of PRESET_IDS) {
  const xs = rows.map((r) => r[k]);
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  norm[k] = [m, +sd.toFixed(2)];
}
// (each blueprint's share of the seats with the means moved by `off`, in deviations)
const off = Object.fromEntries(PRESET_IDS.map((k) => [k, 0]));
const shares = (noise, seed) => {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = Object.fromEntries(PRESET_IDS.map((k) => [k, 0]));
  for (const r of rows) {
    let best = -Infinity;
    let pick = null;
    for (const k of PRESET_IDS) {
      const z = (r[k] - norm[k][0]) / norm[k][1] + off[k] + rnd() * noise;
      if (z > best) {
        best = z;
        pick = k;
      }
    }
    n[pick]++;
  }
  return Object.fromEntries(PRESET_IDS.map((k) => [k, n[k] / rows.length]));
};
for (let it = 0; it < 400; it++) {
  const f = shares(0.35, 11 + it);
  for (const k of PRESET_IDS) off[k] -= 1.5 * (f[k] - 1 / PRESET_IDS.length);
}
console.log(`${rows.length} seats\nconst FIT_NORM = {`);
for (const k of PRESET_IDS) console.log(`  ${k}: [${(norm[k][0] - off[k] * norm[k][1]).toFixed(2)}, ${norm[k][1]}],`);
console.log('};');
for (const [name, noise] of [['hard', 0.35], ['normal', 1]]) {
  const f = shares(noise, 999);
  console.log(name, PRESET_IDS.map((k) => `${k} ${(f[k] * 100).toFixed(1)}%`).join(', '));
}
