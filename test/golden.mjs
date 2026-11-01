// The standard map must not change when the board machinery does: for a fixed set of seeds this
// records the generated boards, the geometry and a stretch of computer play, and compares later runs
// with that record.
//   node test/golden.mjs           compare with test/golden.json
//   node test/golden.mjs --write   (re)record it — only when a change of the standard game is intended
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGame, applyAction, actorsNow, makeView } from '../src/engine/engine.js';
import { GEO } from '../src/engine/geometry.js';
import { aiAct } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';

const FILE = new URL('./golden.json', import.meta.url);
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

function record() {
  const out = { geometry: null, games: [] };
  const geo = (g) => ({
    hexes: g.hexes.map((h) => [h.q, h.r, h.vertices, h.edges, h.neighbors]),
    vertices: g.vertices.map((v) => [v.kx, v.kz, v.hexes, v.edges, v.neighbors, v.coastal]),
    edges: g.edges.map((e) => [e.v, e.hexes, e.coastal]),
    coast: g.coastalEdges,
    sea: g.sea.map((s) => [s.q, s.r]),
  });
  for (let i = 0; i < 24; i++) {
    const seed = 1000 + i * 7919;
    const numbers = i % 2 ? 'spiral' : 'balanced';
    const players = [0, 1, 2, 3].slice(0, 3 + (i % 2)).map((k) => ({ name: 'p' + k, color: '#000', kind: 'ai', ai: { level: ['easy', 'normal', 'hard'][k % 3] } }));
    const st = createGame({ seed, players, targetVP: 10, board: { numbers } });
    if (!out.geometry) out.geometry = hash(geo(GEO));
    const board = hash(st.board);
    const mem = players.map(() => ({}));
    const rnd = makeRng(seed ^ 0x5bd1e995);
    const trail = [];
    for (let step = 0; step < 400 && st.phase !== 'over'; step++) {
      const p = actorsNow(st)[0];
      const a = aiAct(makeView(st, p), p, mem[p], rnd);
      try {
        applyAction(st, a || { type: 'endTurn', p });
      } catch {
        applyAction(st, { type: 'endTurn', p });
      }
      if (step % 50 === 49) trail.push(hash([st.vertices, st.edges, st.players.map((x) => x.res), st.seq]));
    }
    out.games.push({ seed, numbers, n: players.length, board, trail, end: hash([st.phase, st.winner, st.turn, st.seq]) });
  }
  return out;
}

const now = record();
if (process.argv.includes('--write') || !existsSync(FILE)) {
  writeFileSync(FILE, JSON.stringify(now, null, 1));
  console.log('golden recorded:', now.games.length, 'games');
} else {
  const want = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.equal(now.geometry, want.geometry, 'standard geometry changed');
  now.games.forEach((g, i) => {
    assert.equal(g.board, want.games[i].board, `board of seed ${g.seed} changed`);
    assert.deepEqual(g.trail, want.games[i].trail, `play of seed ${g.seed} changed`);
    assert.equal(g.end, want.games[i].end, `end of seed ${g.seed} changed`);
  });
  console.log('golden ok:', now.games.length, 'games identical to the record');
}
