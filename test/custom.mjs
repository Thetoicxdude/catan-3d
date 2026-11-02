// Maps drawn in the editor: the draft as stored, the map definition made from it, the editor's checks,
// and games on such maps (saved with the game, so a reload never depends on the editor's drafts).
import assert from 'node:assert/strict';
import { normalizeDraft, draftId, draftToDef, checkDraft, analyzeDraft, LIMITS } from '../src/engine/custom.js';
import { registerMap, mapDef, isBuiltIn, BASE4, BASE6 } from '../src/engine/maps.js';
import { GEO, useMap } from '../src/engine/geometry.js';
import { createGame, ensureMap, applyAction, actorsNow, makeView } from '../src/engine/engine.js';
import { aiAct } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';
import { DRAFTS } from './drafts.mjs';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.log('FAIL', name, '\n ', e.stack || e.message);
    process.exitCode = 1;
  }
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: '#fff', kind: 'ai', ai: { level: 'normal' } }));
// rows of land on the editor's grid ([first column, last column] per row; odd rows half a hex east)
const shape = (rows, k = 'l') => rows.flatMap(([c0, c1], r) => Array.from({ length: c1 - c0 + 1 }, (_, i) => [c0 + i, r, k]));
const STANDARD = shape([[1, 3], [0, 3], [0, 4], [0, 3], [1, 3]]);
const LARGE = shape([[2, 4], [1, 4], [1, 5], [0, 5], [1, 5], [1, 4], [2, 4]]);

test('a draft as stored: checked fields, cells on the grid, one per position', () => {
  const d = normalizeDraft({ name: '  <b>島</b>  ', kit: 7, vp: 99, start: 'x', bonus: 5, cells: [[0, 0, 'l'], [0, 0, 's'], [-1, 0, 'l'], [LIMITS.cols, 0, 'l'], [2, 1, 'q'], [1.5, 1, 'l'], [3, 2, 'g'], 'x'] });
  assert.equal(d.name, 'b島/b');
  assert.equal(d.kit, 4);
  assert.equal(d.vp, LIMITS.vp[1]);
  assert.equal(d.start, 'any');
  assert.equal(d.bonus, 2);
  assert.equal(d.desert, true);
  assert.deepEqual(d.cells, [[0, 0, 's'], [3, 2, 'g']]);
  assert.equal(normalizeDraft(null).name, '未命名的島嶼');
  assert.equal(normalizeDraft({ name: 'x'.repeat(40) }).name.length, LIMITS.name);
});

test('the id follows the content', () => {
  const a = { name: '甲', cells: STANDARD };
  assert.equal(draftId(a), draftId(JSON.parse(JSON.stringify(a))));
  assert.match(draftId(a), /^my-[0-9a-z]{12}$/);
  assert.notEqual(draftId(a), draftId({ ...a, name: '乙' }));
  assert.notEqual(draftId(a), draftId({ ...a, cells: STANDARD.slice(1) }));
  // the order the cells were drawn in does not matter
  assert.equal(draftId(a), draftId({ ...a, cells: STANDARD.slice().reverse() }));
});

test('the standard island drawn by hand gets the standard pieces', () => {
  const def = draftToDef({ name: '標準', cells: STANDARD });
  assert.equal(def.tiles.length, 19);
  assert.deepEqual(def.pool, BASE4.pool);
  assert.deepEqual(def.numbers, BASE4.numbers);
  assert.deepEqual(def.harbors.types.slice().sort(), BASE4.harbors.types.slice().sort());
  assert.deepEqual(def.players, [3, 4]);
  assert.equal(def.rules, undefined, 'no ships on one island');
  assert.equal(def.robber, undefined, 'the robber starts in the desert');
  assert.ok(def.custom);
  assert.ok(!isBuiltIn(def.id));
});

test('the 5–6 player island drawn by hand gets the 5–6 player pieces', () => {
  const def = draftToDef({ name: '大', kit: 6, cells: LARGE });
  assert.equal(def.tiles.length, 30);
  assert.deepEqual(def.pool, BASE6.pool);
  assert.deepEqual(def.numbers, BASE6.numbers);
  assert.deepEqual(def.harbors.types.slice().sort(), BASE6.harbors.types.slice().sort());
  assert.deepEqual(def.players, [5, 6]);
  assert.equal(def.bank, 24);
  assert.deepEqual(def.dev, BASE6.dev);
  assert.deepEqual(def.rules, { turns: 'paired' });
});

test('ships with more than one island or a gold field; the opening on the largest island', () => {
  const twin = draftToDef(DRAFTS.twin);
  assert.deepEqual(twin.rules, { seafarers: true, turns: 'paired' });
  assert.equal(twin.isleBonus, 2);
  assert.equal(twin.tiles.filter((t) => t.t === 'gold').length, 1);
  const arch = analyzeDraft(DRAFTS.archipelago);
  const def = draftToDef(DRAFTS.archipelago);
  assert.deepEqual(def.setup, { group: 'main' });
  assert.equal(def.tiles.filter((t) => t.g === 'main').length, Math.max(...arch.sizes));
  // one island and no gold: no ships unless asked for
  assert.equal(draftToDef({ cells: STANDARD, start: 'main' }).setup, undefined);
  assert.ok(draftToDef({ cells: STANDARD, ships: true }).rules.seafarers);
  // no desert: the robber starts off the board
  const nd = draftToDef({ cells: STANDARD, desert: false });
  assert.deepEqual(nd.robber, { off: true });
  assert.equal(nd.numbers.length, 19);
  assert.equal(nd.pool.desert, undefined);
});

test('what the editor stops and what it warns about', () => {
  assert.deepEqual(checkDraft({ cells: [] }).errors, ['先在格子上畫出陸地']);
  const big = [];
  for (let r = 0; r < LIMITS.rows; r++) for (let c = 0; c < LIMITS.cols; c++) big.push([c, r, r % 3 ? 'l' : 's']);
  const cb = checkDraft({ cells: big });
  assert.ok(cb.errors.some((e) => e.includes(`最多 ${LIMITS.tiles} 格`)));
  assert.equal(cb.def, null);
  const tiny = checkDraft({ cells: shape([[0, 1]]) });
  assert.ok(tiny.errors.some((e) => e.startsWith('開局位置不夠')), tiny.errors.join());
  const ok = checkDraft({ cells: STANDARD });
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.def && ok.stats.room >= 8);
  assert.ok(checkDraft(DRAFTS.twin).notes.length === 1);
  for (const d of Object.values(DRAFTS)) assert.deepEqual(checkDraft(d).errors, [], d.name);
});

test('a game on a drawn map keeps the map: it plays on after the page forgets the draft', () => {
  const def = registerMap(draftToDef(DRAFTS.ring));
  const st = createGame({ seed: 3, players: players(4), map: def.id });
  assert.equal(st.map, def.id);
  assert.equal(st.mapDef, def);
  // as after a reload: another map in play, the draft unknown to the registry — the saved state has it
  const saved = JSON.parse(JSON.stringify(st));
  useMap(BASE4);
  ensureMap(saved);
  assert.equal(GEO.id, def.id);
  assert.equal(GEO.hexes.length, def.tiles.length);
  // the same draft lays out the same board
  assert.deepEqual(createGame({ seed: 3, players: players(4), map: def.id }).board, st.board);
  assert.equal(mapDef(def.id), def);
});

test('computer players finish games on every drawn map', () => {
  for (const [k, d] of Object.entries(DRAFTS)) {
    const def = registerMap(draftToDef(d));
    const n = def.players[1];
    const st = createGame({ seed: 11, players: players(n), map: def.id });
    const rnd = makeRng(7);
    const mem = st.players.map(() => ({}));
    let steps = 0;
    while (st.phase !== 'over' && steps++ < 8000) {
      let acted = false;
      for (const p of actorsNow(st)) {
        const a = aiAct(makeView(st, p), p, mem[p], rnd);
        if (!a) continue;
        applyAction(st, a);
        acted = true;
        break;
      }
      assert.ok(acted, `${k}: nobody can move`);
    }
    assert.equal(st.phase, 'over', `${k}: no winner after ${steps} moves`);
  }
});

console.log(`custom maps ok: ${passed} tests passed`);
