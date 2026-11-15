// The development mode's balance, measured with computer players (the design's targets in brackets):
//   node test/devsim.mjs [games] [--bp=random|presets|ai] [--level=hard] [--players=4] [--base]
// --bp=presets (default): every seat a ready-made blueprint at random → each blueprint's win rate
//   [25% ± 5% at four players]
// --bp=random: every seat the 4 basic cards and 3 buildings at random (one wonder at most) → each building's win rate with
//   and without it [no more than 5 points apart]
// --bp=ai: the computer players choose, as in a game
// Always: game length against the standard game [1.5–1.8×], wonders completed once begun [40–60%] and
// destroyed once complete [20–40%], the winner's points from buildings and wonders [25–40%].
// --base: the standard game's length with the same players (the yardstick)
import { createGame, applyAction, makeView, actorsNow, RuleError, totalVP, publicVP, hiddenVP } from '../src/engine/engine.js';
import { aiAct, chooseBlueprint } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';
import { developMap } from '../src/engine/maps.js';
import { PRESETS, PRESET_IDS, BUILDING_IDS, BASIC, isWonder, developScore } from '../src/engine/develop.js';

const args = process.argv.slice(2);
const flag = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split('=')[1];
const GAMES = Number(args.find((a) => /^\d+$/.test(a)) || 200);
const BP = flag('bp', 'presets');
const LEVEL = flag('level', 'hard');
const N = Number(flag('players', 4));
const BASE = args.includes('--base');
const SEED = Number(flag('seed', 1));
const VPADJ = Number(flag('vp', 0));

function randomBlueprint(rnd) {
  const wonders = BUILDING_IDS.filter(isWonder);
  const others = BUILDING_IDS.filter((k) => !isWonder(k));
  // the four basic cards, then three buildings
  const bp = [...BASIC];
  // a wonder in most blueprints (as the presets have)
  if (rnd() < 0.8) bp.push(wonders[Math.floor(rnd() * wonders.length)]);
  while (bp.length < 7) {
    const k = others[Math.floor(rnd() * others.length)];
    if (!bp.includes(k)) bp.push(k);
  }
  return bp;
}

const out = { stageRound: {}, parts: {}, games: 0, unfinished: 0, turns: [], illegal: 0, preset: {}, building: {}, wonders: { begun: 0, done: 0, lostDone: 0, lostBuilding: 0 }, share: [], events: {}, winnerVP: [] };
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const rnd = makeRng(SEED * 100003 + g);
  const players = Array.from({ length: N }, (_, i) => ({ name: 'P' + i, kind: 'ai', ai: { level: LEVEL } }));
  const map = BASE ? (N === 4 ? 'base-4' : 'base-4') : developMap(N).id;
  const st = createGame({ seed: 4242 + g * 17 + SEED * 7919, players, map, vpAdj: VPADJ });
  const tags = [];
  if (!BASE) {
    st.players.forEach((pl, i) => {
      let tag = null;
      if (BP === 'random') pl.bp = randomBlueprint(rnd);
      else {
        tag = BP === 'ai' ? chooseBlueprint(st, i, LEVEL, rnd) : PRESET_IDS[Math.floor(rnd() * PRESET_IDS.length)];
        pl.bp = PRESETS[tag].slice();
      }
      tags.push(tag);
    });
  }
  const mem = players.map(() => ({}));
  let steps = 0;
  while (st.phase !== 'over' && steps < 12000) {
    let acted = false;
    for (const p of actorsNow(st)) {
      const a = aiAct(makeView(st, p), p, mem[p], rnd);
      if (!a) continue;
      try {
        for (const e of applyAction(st, a)) {
          out.events[e.type] = (out.events[e.type] || 0) + 1;
          if (e.type === 'wonder' && e.stage === 1) out.wonders.begun++;
          if (e.type === 'wonder') (out.stageRound[e.stage] = out.stageRound[e.stage] || []).push(st.turn / N);
          if (e.type === 'wonderDone') (out.stageRound.done = out.stageRound.done || []).push(st.turn / N);
          if (e.type === 'wonderDone') out.wonders.done++;
          if (e.type === 'wonderLost') out.wonders[e.done ? 'lostDone' : 'lostBuilding']++;
          if (e.type === 'special') out.events['special:' + e.k] = (out.events['special:' + e.k] || 0) + 1;
        }
      } catch (err) {
        if (!(err instanceof RuleError)) throw err;
        out.illegal++;
        if (out.illegal < 8) console.log('illegal', JSON.stringify(a), err.message);
        try {
          applyAction(st, st.pending && st.pending.type === 'roadBuilding' ? { type: 'endRoadBuilding', p } : { type: 'endTurn', p });
        } catch (e2) {
          if (!(e2 instanceof RuleError)) throw e2;
        }
      }
      acted = true;
      break;
    }
    if (!acted) break;
    steps++;
  }
  if (st.phase !== 'over') {
    out.unfinished++;
    continue;
  }
  out.games++;
  out.turns.push(st.turn);
  const w = st.winner;
  out.winnerVP.push(totalVP(st, w));
  // the winner's points, by source
  const parts = { settlements: 0, cities: 0, road: st.longestRoad === w ? 2 : 0, army: st.largestArmy === w ? 2 : 0, cards: hiddenVP(st, w) };
  st.vertices.forEach((b) => {
    if (b && b.p === w) parts[b.t === 'c' ? 'cities' : 'settlements'] += b.t === 'c' ? 2 : 1;
  });
  if (!BASE) Object.assign(parts, developScore(st, w));
  for (const [k, x] of Object.entries(parts)) out.parts[k] = (out.parts[k] || 0) + x;
  if (!BASE) {
    const sc = developScore(st, w);
    const extra = sc.buildings + sc.adventurers + sc.post + sc.wonder;
    out.share.push(extra / totalVP(st, w));
    st.players.forEach((pl, i) => {
      const won = i === w ? 1 : 0;
      if (tags[i]) {
        const r = (out.preset[tags[i]] = out.preset[tags[i]] || { n: 0, w: 0 });
        r.n++;
        r.w += won;
      }
      for (const k of BUILDING_IDS) {
        const r = (out.building[k] = out.building[k] || { inN: 0, inW: 0, outN: 0, outW: 0, built: 0 });
        if (pl.bp.includes(k)) {
          r.inN++;
          r.inW += won;
        } else {
          r.outN++;
          r.outW += won;
        }
        if (pl.built[k] !== undefined) r.built++;
      }
    });
  }
}
const pct = (a, b) => (b ? +((100 * a) / b).toFixed(1) : null);
const avg = (xs) => (xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2) : null);
const report = {
  mode: BASE ? 'standard' : `development, blueprints: ${BP}`,
  players: N,
  level: LEVEL,
  finished: `${out.games}/${GAMES}`,
  illegal: out.illegal,
  avgTurns: avg(out.turns),
  avgRounds: out.turns.length ? +(avg(out.turns) / N).toFixed(1) : null,
  winnerVP: avg(out.winnerVP),
  winnerPoints: Object.fromEntries(Object.entries(out.parts).map(([k, x]) => [k, +(x / Math.max(1, out.games)).toFixed(2)])),
};
if (!BASE) {
  report.presetWinRate = Object.fromEntries(Object.entries(out.preset).map(([k, r]) => [k, `${pct(r.w, r.n)}% of ${r.n}`]));
  report.buildingDelta = Object.fromEntries(
    Object.entries(out.building)
      .map(([k, r]) => [k, { with: pct(r.inW, r.inN), without: pct(r.outW, r.outN), delta: +(pct(r.inW, r.inN) - pct(r.outW, r.outN)).toFixed(1), builtWhenHeld: isWonder(k) ? undefined : pct(r.built, r.inN) }])
      .sort((a, b) => b[1].delta - a[1].delta),
  );
  report.wonders = { ...out.wonders, completedOfBegun: pct(out.wonders.done, out.wonders.begun), destroyedOfCompleted: pct(out.wonders.lostDone, out.wonders.done) };
  report.wonderStageRound = Object.fromEntries(Object.entries(out.stageRound).map(([k, xs]) => [k, avg(xs)]));
  report.winnerShareFromBuildingsAndWonders = pct(avg(out.share), 1);
  report.perGame = Object.fromEntries(
    Object.entries(out.events)
      .filter(([k]) => /^(develop|special|wonder|wonderDone|wonderLost|defend|siege|market|guildBonus|aqueduct|devDraw|buyDev|playDev|trade|bankTrade|roll)$/.test(k) || k.startsWith('special:'))
      .map(([k, n]) => [k, +(n / Math.max(1, out.games)).toFixed(2)]),
  );
}
report.ms = Date.now() - t0;
console.log(JSON.stringify(report, null, 1));
