// Runs many all-AI games and checks rule invariants after every single action.
//   node test/sim.mjs [games] [--map=base-6] [--turns=paired|sbp]
import { GEO } from '../src/engine/geometry.js';
import { mapDef } from '../src/engine/maps.js';
import {
  createGame,
  applyAction,
  makeView,
  actorsNow,
  RES,
  totalVP,
  RuleError,
  legalRoadEdges,
} from '../src/engine/engine.js';
import { aiAct } from '../src/ai/ai.js';
import { makeRng } from '../src/engine/rng.js';

const args = process.argv.slice(2);
const flag = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];
const GAMES = Number(args.find((a) => /^\d+$/.test(a)) || 300);
const MAP = flag('map') || 'base-4';
const TURNS = flag('turns');
const DEF = mapDef(MAP);
const BANK = DEF.bank || 19;
const DECK = Object.values(DEF.dev || { k: 25 }).reduce((s, x) => s + x, 0);
const [MIN_P, MAX_P] = DEF.players;
const LEVELS = ['easy', 'normal', 'hard'];

function check(st, where) {
  const fail = (m) => {
    throw new Error(`[invariant] ${m} @ ${where} seq=${st.seq}`);
  };
  for (const r of RES) {
    let t = st.bank[r];
    for (const pl of st.players) {
      if (pl.res[r] < 0) fail(`negative ${r} for ${pl.id}`);
      t += pl.res[r];
    }
    if (st.bank[r] < 0) fail(`negative bank ${r}`);
    if (t !== BANK) fail(`resource ${r} total ${t}`);
  }
  let devTotal = st.devDeck.length;
  for (const pl of st.players) {
    devTotal += pl.dev.length + pl.played.knight + pl.played.roadBuilding + pl.played.yearOfPlenty + pl.played.monopoly;
    if (pl.played.knight !== pl.knights) fail('knight count mismatch');
  }
  if (devTotal !== DECK) fail(`dev total ${devTotal}`);
  const cnt = st.players.map(() => ({ s: 0, c: 0, r: 0 }));
  st.vertices.forEach((b, v) => {
    if (!b) return;
    if (b.t === 's') cnt[b.p].s++;
    else cnt[b.p].c++;
    for (const n of GEO.vertices[v].neighbors) if (st.vertices[n]) fail(`distance rule at ${v}`);
  });
  st.edges.forEach((p) => {
    if (p >= 0) cnt[p].r++;
  });
  st.players.forEach((pl, i) => {
    if (cnt[i].s + pl.pieces.settlements !== 5) fail(`settlement pieces p${i}`);
    if (cnt[i].c + pl.pieces.cities !== 4) fail(`city pieces p${i}`);
    if (cnt[i].r + pl.pieces.roads !== 15) fail(`road pieces p${i}`);
  });
  const L = st.roadLen;
  const max = Math.max(...L);
  const nMax = L.filter((x) => x === max).length;
  if (st.longestRoad >= 0) {
    if (L[st.longestRoad] < 5 || L[st.longestRoad] !== max) fail(`longest road holder invalid ${L} h=${st.longestRoad}`);
  } else if (max >= 5 && nMax === 1) fail(`longest road unassigned ${L}`);
  if (st.largestArmy >= 0) {
    const k = st.players[st.largestArmy].knights;
    if (k < 3) fail('largest army < 3');
    for (const pl of st.players) if (pl.knights > k) fail('largest army not max');
  } else if (st.players.some((pl) => pl.knights >= 3)) fail('largest army unassigned');
  if (st.phase === 'over' && totalVP(st, st.winner) < st.targetVP) fail('winner below target');
  // 5–6 players: the second player is three seats on; nobody trades with players outside a main turn
  if (st.sub) {
    const n = st.players.length;
    if (st.sub.k === 'pair' && st.current !== (st.sub.lead + 3) % n) fail('second player is not three seats on');
    if (st.trade) fail('a player trade during a second part');
    if (st.sub.k === 'sbp' && st.phase === 'over' && st.winner === st.current) fail('won during the special building phase');
  }
}

const stats = { games: 0, turns: [], fails: 0, stalls: 0, winners: {}, levels: {}, lr: 0, la: 0, sevens: 0, actions: 0, offers: 0, trades: 0, bank: 0, devPlays: {} };
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const rnd = makeRng(1000 + g);
  const n = MAP === 'base-4' ? (g % 4 === 3 ? 3 : 4) : MIN_P + (g % (MAX_P - MIN_P + 1));
  const players = [];
  for (let i = 0; i < n; i++) players.push({ name: 'P' + i, color: '#fff', kind: 'ai', ai: { level: LEVELS[(g + i) % 3] } });
  const st = createGame({ seed: 7777 + g * 13, players, map: MAP, rules: TURNS ? { turns: TURNS } : undefined, board: { numbers: g % 2 ? 'spiral' : 'balanced' } });
  check(st, 'start');
  const mem = players.map(() => ({}));
  let steps = 0;
  while (st.phase !== 'over' && steps < 6000) {
    const actors = actorsNow(st);
    let acted = false;
    for (const p of actors) {
      const view = makeView(st, p);
      const a = aiAct(view, p, mem[p], rnd);
      if (!a) continue;
      try {
        const ev = applyAction(st, a);
        const sub = st.sub ? st.sub.k : null;
        for (const e of ev) {
          if (sub === 'sbp' && (e.type === 'bankTrade' || e.type === 'playDev')) throw new Error(`[invariant] ${e.type} in the special building phase`);
          if (e.type === 'turnStart' && e.sub) stats.subTurns = (stats.subTurns || 0) + 1;
          if ((e.type === 'build' || e.type === 'buyDev') && a.p !== undefined && st.sub) stats.subBuilds = (stats.subBuilds || 0) + 1;
          if (e.type === 'roll' && e.sum === 7) stats.sevens++;
          if (e.type === 'offer') stats.offers++;
          if (e.type === 'trade') stats.trades++;
          if (e.type === 'bankTrade') stats.bank++;
          if (e.type === 'playDev') stats.devPlays[e.card] = (stats.devPlays[e.card] || 0) + 1;
        }
      } catch (err) {
        if (!(err instanceof RuleError)) throw err;
        stats.fails++;
        if (stats.fails < 15) console.log('AI illegal action:', JSON.stringify(a), '→', err.message, 'phase', st.phase, 'pending', JSON.stringify(st.pending));
        // fallback so the game keeps going
        const fb = st.pending && st.pending.type === 'roadBuilding' ? { type: 'endRoadBuilding', p } : { type: 'endTurn', p };
        try {
          applyAction(st, fb);
        } catch (e2) {
          if (!(e2 instanceof RuleError)) throw e2;
        }
      }
      check(st, a.type);
      stats.actions++;
      acted = true;
      break;
    }
    if (!acted) {
      stats.stalls++;
      console.log('STALL: no actor acted', JSON.stringify({ phase: st.phase, pending: st.pending, trade: st.trade, current: st.current }));
      break;
    }
    steps++;
  }
  if (st.phase !== 'over') {
    console.log(`game ${g} did not finish (turn ${st.turn}) VPs`, st.players.map((pl) => totalVP(st, pl.id)));
    continue;
  }
  stats.games++;
  stats.turns.push(st.turn);
  const lvl = players[st.winner].ai.level;
  stats.levels[lvl] = (stats.levels[lvl] || 0) + 1;
  stats.winners[st.winner] = (stats.winners[st.winner] || 0) + 1;
  if (st.longestRoad >= 0) stats.lr++;
  if (st.largestArmy >= 0) stats.la++;
}
stats.turns.sort((a, b) => a - b);
const avg = stats.turns.reduce((s, x) => s + x, 0) / stats.turns.length;
console.log(
  JSON.stringify(
    {
      map: MAP + (TURNS ? ' ' + TURNS : DEF.rules && DEF.rules.turns ? ' ' + DEF.rules.turns : ''),
      finished: `${stats.games}/${GAMES}`,
      subTurns: stats.subTurns || 0,
      subBuilds: stats.subBuilds || 0,
      avgRounds: MAP === 'base-4' ? +(avg / 3.8).toFixed(1) : undefined,
      avgTurns: +avg.toFixed(1),
      medianTurns: stats.turns[Math.floor(stats.turns.length / 2)],
      maxTurns: stats.turns[stats.turns.length - 1],
      illegalAI: stats.fails,
      stalls: stats.stalls,
      winsBySeat: stats.winners,
      winsByLevel: stats.levels,
      longestRoadAwarded: stats.lr,
      largestArmyAwarded: stats.la,
      sevens: stats.sevens,
      offers: stats.offers,
      trades: stats.trades,
      bankTrades: stats.bank,
      devPlays: stats.devPlays,
      actionsPerGame: Math.round(stats.actions / Math.max(1, stats.games)),
      ms: Date.now() - t0,
    },
    null,
    1,
  ),
);
