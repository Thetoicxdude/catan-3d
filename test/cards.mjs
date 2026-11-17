// The building cards (src/meta/collection.js): what a new player owns, missions, draws and shards, the
// shop, coins from finished games, copies put together, blueprints kept to the cards owned.
//   node test/cards.mjs
import assert from 'node:assert/strict';
import { BUILDING_IDS, PRESETS, BASIC, isWonder, validBlueprint } from '../src/engine/develop.js';
import {
  STARTER, FIRST_BLUEPRINT, MISSION_CARDS, POOL, MISSIONS, DRAW_COST, DRAW10_COST, COINS, newCollection, fitCollection, mergeCollections, owns, ownedBlueprint,
  claim, claimable, missionState, missionFor, observe, gameOver, draw, buy, pick, priceOf, dupShards, chanceOf, seen, slotNew, RARITIES, rarityOf, ALL_CARDS,
} from '../src/meta/collection.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL', name);
    throw e;
  }
}
// a fixed sequence of numbers in [0, 1)
const seq = (...xs) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};
// a seeded random number generator (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// a development-mode view as game.js sees it (only what the missions read)
const devView = ({ plots = {}, wonders = [], built = {}, bp = ['granary', 'market'] } = {}) => ({
  rules: { develop: true },
  plots,
  wonders,
  players: [{ bp, built }, { bp: PRESETS.port, built: {} }],
});

test('the cards: four basic ones and three buildings to start with (a full blueprint), three from missions, twelve to draw', () => {
  assert.deepEqual(STARTER, ['granary', 'market', 'aqueduct']);
  assert.deepEqual(FIRST_BLUEPRINT, [...BASIC, ...STARTER]);
  assert.equal(FIRST_BLUEPRINT.length, 7);
  assert.ok(validBlueprint(FIRST_BLUEPRINT));
  assert.deepEqual(MISSION_CARDS, ['shipyard', 'camp', 'academy']);
  assert.equal(POOL.length, 12);
  assert.equal(POOL.filter(isWonder).length, 5);
  assert.deepEqual([...STARTER, ...MISSION_CARDS, ...POOL].sort(), BUILDING_IDS.slice().sort());
  // rarity: how a card is had (the frame's colour)
  const by = (r) => ALL_CARDS.filter((k) => rarityOf(k) === r);
  assert.deepEqual(RARITIES, ['basic', 'common', 'rare', 'epic', 'legendary']);
  assert.deepEqual(by('basic'), BASIC);
  assert.deepEqual(by('common').sort(), STARTER.slice().sort());
  assert.deepEqual(by('rare').sort(), MISSION_CARDS.slice().sort());
  assert.deepEqual(by('epic').sort(), POOL.filter((k) => !isWonder(k)).sort());
  assert.deepEqual(by('legendary').sort(), POOL.filter(isWonder).sort());
  assert.equal(ALL_CARDS.length, BASIC.length + BUILDING_IDS.length);
  assert.deepEqual(ALL_CARDS.map(rarityOf), RARITIES.flatMap((r) => by(r).map(() => r)));
  for (const k of MISSION_CARDS) assert.ok(missionFor(k), 'a mission gives ' + k);
  assert.ok(Math.abs(POOL.reduce((n, k) => n + chanceOf(k), 0) - 1) < 1e-9);
  assert.ok(chanceOf('gardens') < chanceOf('guild'), 'wonders are rarer');
});

test('a new player: the starter buildings and every basic card, no coins, the welcome present waiting', () => {
  const c = newCollection();
  assert.deepEqual(c.own, ['aqueduct', 'granary', 'market'], 'in the cards\' order');
  assert.deepEqual(fitCollection(null).own, c.own);
  assert.ok(BASIC.every((k) => owns(c, k)));
  assert.equal(c.coins, 0);
  assert.equal(claimable(c), 1);
  assert.deepEqual(claim(c, 'welcome'), { coins: 200 });
  assert.equal(c.coins, 200);
  assert.equal(claim(c, 'welcome'), null, 'once');
  assert.equal(claim(c, 'plot'), null, 'not done yet');
  assert.equal(claimable(c), 0);
});

test('draws: coins first, a card of the pool, a repeat becomes shards', () => {
  const c = newCollection();
  assert.equal(draw(c, 1, Math.random).error, '金幣不夠');
  c.coins = DRAW_COST * 2;
  const a = draw(c, 1, seq(0));
  assert.equal(a.cards.length, 1);
  assert.equal(a.cards[0].k, POOL[0]);
  assert.ok(a.cards[0].fresh && owns(c, POOL[0]) && c.fresh.includes(POOL[0]));
  assert.equal(c.coins, DRAW_COST);
  const b = draw(c, 1, seq(0));
  assert.equal(b.cards[0].fresh, false);
  assert.equal(b.cards[0].shards, dupShards(POOL[0]));
  assert.equal(c.shards, dupShards(POOL[0]));
  assert.equal(c.coins, 0);
  // ten at once cost less than ten single draws; within the ten a card can repeat too
  c.coins = DRAW10_COST;
  const ten = draw(c, 10, seq(0.999, 0.999));
  assert.equal(ten.cards.length, 10);
  assert.equal(ten.cards.filter((x) => x.fresh).length, 1);
  assert.equal(c.coins, 0);
  assert.ok(DRAW10_COST < 10 * DRAW_COST);
  assert.equal(draw(c, 3, Math.random).error, '不能這樣抽');
  // the chances: about each card's weight over many draws
  const r = rng(7);
  const n = 85000;
  const seenCount = {};
  for (let i = 0; i < n; i++) {
    const k = pick(r);
    seenCount[k] = (seenCount[k] || 0) + 1;
  }
  for (const k of POOL) assert.ok(Math.abs(seenCount[k] / n - chanceOf(k)) < 0.006, k);
});

test('the shop: a card of the pool for shards, not one owned, not more than the shards', () => {
  const c = newCollection();
  assert.equal(buy(c, 'guild').error, '碎片不夠');
  c.shards = priceOf('guild') + 5;
  assert.deepEqual(buy(c, 'guild'), { card: 'guild' });
  assert.equal(c.shards, 5);
  assert.equal(buy(c, 'guild').error, '已經有這張卡了');
  assert.equal(buy(c, 'aqueduct').error, '商店沒有這張卡', 'mission cards come from missions');
  c.shards = 1000;
  assert.ok(priceOf('library') > priceOf('wall'));
  buy(c, 'library');
  assert.equal(c.shards, 1000 - priceOf('library'));
});

test('missions in a game: developing, the second level, a wonder begun and finished, a defence, buildings in one game', () => {
  const c = newCollection();
  assert.equal(observe(c, { rules: {}, players: [{}] }, 0), null, 'not the development mode');
  assert.equal(observe(c, devView(), 0), null, 'nothing done yet');
  assert.deepEqual(observe(c, devView({ plots: { 5: { p: 0, r: ['wood'] } } }), 0), ['plot']);
  assert.equal(observe(c, devView({ plots: { 5: { p: 0, r: ['wood'] } } }), 0), null, 'done already');
  assert.equal(observe(c, devView({ plots: { 5: { p: 1, r: ['wood', 'ore'] } } }), 0), null, "another player's");
  assert.deepEqual(observe(c, devView({ plots: { 5: { p: 0, r: ['wood', 'ore'] } } }), 0), ['level2']);
  assert.deepEqual(observe(c, devView({ wonders: [{ h: 3, k: 'gardens', p: 0, s: 1, done: false }] }), 0), ['wonder']);
  assert.deepEqual(observe(c, devView(), 0, [{ type: 'wonderDone', p: 0, hex: 3, k: 'gardens' }]), ['wonderdone']);
  assert.deepEqual(observe(c, devView(), 0, [{ type: 'defend', p: 0, by: 1, hex: 3, k: 'gardens' }]), ['defend']);
  assert.deepEqual(observe(c, devView({ built: { granary: 4, market: 9 } }), 0), ['build2']);
  assert.equal(missionState(c, 'build3').n, 2);
  observe(c, devView({ built: { granary: 4 } }), 0);
  assert.equal(missionState(c, 'build3').n, 2, 'the most in one game');
  // the rewards: a card each for the granary series' missions, coins for the others
  assert.deepEqual(claim(c, 'plot'), { card: 'shipyard' });
  assert.deepEqual(claim(c, 'build2'), { coins: 100 });
  assert.ok(owns(c, 'shipyard'));
  assert.deepEqual(claim(c, 'level2'), { coins: 80 });
});

test('a finished game: coins for it, a win, an online room, the first of the day; counted once', () => {
  const c = newCollection();
  const r = { gid: 's:1:2', mode: 'single', won: true, vp: 18, place: 1, n: 4, turns: 90 };
  const out = gameOver(c, r, { ...devView({ bp: [...PRESETS.port] }), largestArmy: 0 }, 0, '2026-11-15');
  assert.deepEqual(out.coins, [['game', COINS.game], ['win', COINS.win], ['daily', COINS.daily]]);
  assert.equal(out.total, COINS.game + COINS.win + COINS.daily);
  assert.equal(c.coins, out.total);
  assert.deepEqual(out.done.sort(), ['army', 'devgame', 'devwin'].sort());
  assert.equal(c.games, 1);
  assert.equal(c.wins, 1);
  assert.equal(gameOver(c, r, devView(), 0, '2026-11-15'), null, 'the same game again');
  const lost = gameOver(c, { ...r, gid: 'o:ABCD:5', mode: 'online', won: false }, { rules: {}, players: [{}] }, 0, '2026-11-15');
  assert.deepEqual(lost.coins, [['game', COINS.game], ['online', COINS.online]], 'no second daily coins');
  assert.deepEqual(lost.done, ['online']);
  const next = gameOver(c, { ...r, gid: 's:9:9', won: false }, { rules: {}, players: [{}] }, 0, '2026-11-16');
  assert.ok(next.coins.some(([k]) => k === 'daily'), 'a new day');
  assert.equal(gameOver(c, null, devView(), 0, '2026-11-16'), null, 'not counted: several players at one device');
  for (let i = 0; i < 7; i++) gameOver(c, { ...r, gid: 'g' + i }, null, 0, '2026-11-16');
  assert.equal(missionState(c, 'games10').n, 10);
  assert.ok(missionState(c, 'wins5').done);
  assert.equal(missionState(c, 'wins5').n, 5, 'kept at the goal');
});

test('a stored copy put right: unknown cards, the starter cards, counts', () => {
  const c = fitCollection({ own: ['guild', 'x', 'guild', 'library', 'road'], coins: -5, shards: 12.7, prog: { plot: 9, games10: 4, nope: 3 }, got: ['plot', 'zzz'], games: 3, wins: 8, gids: ['a', 5], fresh: ['guild', 'wall'], day: 'today' });
  assert.deepEqual(c.own, ['aqueduct', 'granary', 'market', 'guild', 'library']);
  assert.equal(c.coins, 0);
  assert.equal(c.shards, 12);
  assert.equal(c.prog.plot, 1);
  assert.equal(c.prog.games10, 4);
  assert.equal(c.prog.nope, undefined);
  assert.deepEqual(c.got, ['plot']);
  assert.equal(c.wins, 3, 'not more wins than games');
  assert.deepEqual(c.gids, ['a']);
  assert.deepEqual(c.fresh, ['guild']);
  assert.equal(c.day, '');
  assert.deepEqual(fitCollection(null), newCollection());
  assert.deepEqual(fitCollection('junk'), newCollection());
});

test('two copies put together: every card and mission, the larger counts', () => {
  const a = newCollection();
  a.own.push('guild');
  a.coins = 300;
  a.prog.plot = 1;
  a.got = ['welcome'];
  a.rev = 4;
  const b = newCollection();
  b.own.push('library');
  b.shards = 40;
  b.prog.games10 = 3;
  b.rev = 9;
  const m = mergeCollections(a, b);
  assert.deepEqual(m.own, ['aqueduct', 'granary', 'market', 'guild', 'library']);
  assert.equal(m.coins, 300);
  assert.equal(m.shards, 40);
  assert.equal(m.prog.plot, 1);
  assert.equal(m.prog.games10, 3);
  assert.deepEqual(m.got, ['welcome']);
  assert.equal(m.rev, 10, 'newer than both');
});

test('blueprints kept to the cards owned (the basic cards are everyone\'s); a new card slots into one with room', () => {
  const c = newCollection();
  c.own.push('gardens', 'library', 'wall');
  assert.deepEqual(ownedBlueprint(c, ['granary', 'guild', 'gardens', 'library', 'market', 'granary']), ['granary', 'gardens', 'market']);
  assert.deepEqual(ownedBlueprint(c, ['road', 'city', 'guild', 'wall']), ['road', 'city', 'wall']);
  assert.deepEqual(ownedBlueprint(c, [...FIRST_BLUEPRINT, 'wall']), FIRST_BLUEPRINT, 'seven at most');
  assert.deepEqual(ownedBlueprint(c, null), []);
  const bp = ['granary'];
  assert.ok(slotNew(bp, 'gardens'));
  assert.ok(!slotNew(bp, 'library'), 'one wonder');
  assert.ok(!slotNew(bp, 'granary'), 'there already');
  const full = PRESETS.port.slice();
  assert.ok(!slotNew(full, 'wall'), 'full');
  assert.ok(seen(c, ['gardens']) === false, 'nothing new to look at');
  c.fresh = ['wall'];
  assert.ok(seen(c, ['wall']));
  assert.deepEqual(c.fresh, []);
});

test('pace: the whole pack in about thirty draws (shards buy the last ones)', () => {
  const r = rng(11);
  const runs = [];
  for (let n = 0; n < 2000; n++) {
    const c = newCollection();
    let draws = 0;
    while (POOL.some((k) => !owns(c, k))) {
      const missing = POOL.filter((k) => !owns(c, k)).sort((x, y) => priceOf(x) - priceOf(y));
      if (c.shards >= priceOf(missing[0])) {
        buy(c, missing[0]);
        continue;
      }
      c.coins = DRAW_COST;
      draw(c, 1, r);
      draws++;
    }
    runs.push(draws);
  }
  runs.sort((x, y) => x - y);
  const median = runs[runs.length >> 1];
  console.log(`  the whole pack: ${median} draws (median), ${runs[Math.floor(runs.length * 0.9)]} for nine players in ten`);
  assert.ok(median >= 25 && median <= 45, 'median ' + median);
  assert.ok(MISSIONS.every((m) => m.goal >= 1 && (m.reward.card || m.reward.coins > 0)));
});

console.log(`cards: ${passed} passed`);
