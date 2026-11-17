// The building cards a player owns for the development mode, and how more are earned (no screen here:
// the side pages are ui/cards-ui.js, the saving and the account copy meta/store.js).
//
// A blueprint is 7 cards (2026-11-15): the basic cards (road, settlement, city, development card),
// which every player owns, and the special buildings. A new player owns three buildings besides, the
// granary, the market and the aqueduct, so the first blueprint is full: the four basic cards and those
// three. Missions give the rest of the granary series (the first ready-made blueprint the player chose
// these from: shipyard, frontier camp, academy). The other 12 (seven buildings and the five world
// wonders) are drawn: a draw can repeat a card, and a repeat becomes shards, which buy a chosen card in
// the shop. Coins pay for draws: a finished game, a win, an online game, the first game of each day,
// missions. Nothing here is bought with money.
//
// The collection is plain data, kept as one JSON object:
//   v        the format (1)
//   own      the buildings owned, in BUILDING_IDS order (the basic cards are not listed: everyone's)
//   coins, shards
//   prog     each mission's progress (missing: 0)
//   got      the missions whose reward was taken
//   games, wins   finished games counted (single player against the computer, and online)
//   day      the day the first-game-of-the-day coins were last paid ('YYYY-MM-DD', the player's own)
//   gids     the last games counted (so a game is counted once, whatever reloads)
//   fresh    cards gained and not yet looked at (the Cards page's "new" marks)
//   rev, at  a counter of changes and the time of the last one (which copy is newer: store.js)
import { BUILDINGS, BUILDING_IDS, BASIC, BLUEPRINT_SIZE, isWonder, isBasic } from '../engine/develop.js';
import { N_ } from '../i18n/fill.js';

// the three buildings every player starts with (beside the four basic cards)
export const STARTER = ['granary', 'market', 'aqueduct'];
// the first blueprint of a new player: full
export const FIRST_BLUEPRINT = [...BASIC, ...STARTER];
// what the missions give: the rest of the granary series
export const MISSION_CARDS = ['shipyard', 'camp', 'academy'];
// what the draws give
export const POOL = BUILDING_IDS.filter((k) => !STARTER.includes(k) && !MISSION_CARDS.includes(k));

// How hard a card is to have (2026-11-17: the colour of the card's frame): basic (everyone's), common
// (a new player's three), rare (the missions'), epic (the buildings drawn), legendary (the wonders)
export const RARITIES = ['basic', 'common', 'rare', 'epic', 'legendary'];
export function rarityOf(k) {
  if (isBasic(k)) return 'basic';
  if (STARTER.includes(k)) return 'common';
  if (MISSION_CARDS.includes(k)) return 'rare';
  return isWonder(k) ? 'legendary' : 'epic';
}
// every card (the basic ones first), rarest last; within a rarity in BUILDING_IDS order
export const ALL_CARDS = RARITIES.flatMap((r) => [...BASIC, ...BUILDING_IDS].filter((k) => rarityOf(k) === r));

// a draw: each building of the pool 10 parts in 85, each wonder 3
export const WEIGHT = { building: 10, wonder: 3 };
export const DRAW_COST = 100;
export const DRAW10_COST = 900;
// a card drawn again: shards
export const DUP_SHARDS = { building: 20, wonder: 60 };
// the shop: a chosen card of the pool for shards
export const PRICE = { building: 100, wonder: 300 };
// coins for a finished game (counted games: see gameOver)
export const COINS = { game: 30, win: 40, online: 20, daily: 50 };

const kindOf = (k) => (isWonder(k) ? 'wonder' : 'building');
export const drawWeight = (k) => WEIGHT[kindOf(k)];
export const dupShards = (k) => DUP_SHARDS[kindOf(k)];
export const priceOf = (k) => PRICE[kindOf(k)];
// a card's chance on one draw (0–1)
export function chanceOf(k) {
  const total = POOL.reduce((n, x) => n + drawWeight(x), 0);
  return POOL.includes(k) ? drawWeight(k) / total : 0;
}

// The missions, in the order they are listed. what: how progress is counted
//   once   done the first time it happens
//   most   the most in one game (goal: how many)
//   count  added up over games (goal: how many)
// reward: { card } or { coins }. The first one is a welcome present, done from the start.
export const MISSIONS = [
  { id: 'welcome', text: N_('歡迎來到卡坦島'), what: 'once', goal: 1, reward: { coins: 200 } },
  { id: 'plot', text: N_('在發展模式開發 1 塊地'), what: 'once', goal: 1, reward: { card: 'shipyard' } },
  { id: 'devgame', text: N_('打完 1 局發展模式'), what: 'once', goal: 1, reward: { card: 'camp' } },
  { id: 'devwin', text: N_('贏 1 局發展模式'), what: 'once', goal: 1, reward: { card: 'academy' } },
  { id: 'build2', text: N_('在一局發展模式裡蓋好 2 座特殊建築'), what: 'most', goal: 2, reward: { coins: 100 } },
  { id: 'level2', text: N_('把一塊開發地升到二級'), what: 'once', goal: 1, reward: { coins: 80 } },
  { id: 'wonder', text: N_('開工一座世界奇觀'), what: 'once', goal: 1, reward: { coins: 100 } },
  { id: 'wonderdone', text: N_('完成一座世界奇觀'), what: 'once', goal: 1, reward: { coins: 200 } },
  { id: 'defend', text: N_('用騎士保住一座世界奇觀'), what: 'once', goal: 1, reward: { coins: 150 } },
  { id: 'build3', text: N_('在一局發展模式裡蓋好 3 座特殊建築'), what: 'most', goal: 3, reward: { coins: 200 } },
  { id: 'army', text: N_('打完一局時持有最大騎士團'), what: 'once', goal: 1, reward: { coins: 150 } },
  { id: 'online', text: N_('打完 1 局線上房間'), what: 'once', goal: 1, reward: { coins: 100 } },
  { id: 'games10', text: N_('打完 10 局（任何模式）'), what: 'count', goal: 10, reward: { coins: 300 } },
  { id: 'wins5', text: N_('贏 5 局（任何模式）'), what: 'count', goal: 5, reward: { coins: 300 } },
];
const MISSION = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
export const missionOf = (id) => MISSION[id] || null;
// the mission that gives a card (null: none, the card is drawn or a starter)
export const missionFor = (k) => MISSIONS.find((m) => m.reward.card === k) || null;

const GIDS = 40;
const sortCards = (a) => BUILDING_IDS.filter((k) => a.includes(k));

export function newCollection() {
  return { v: 1, own: sortCards(STARTER), coins: 0, shards: 0, prog: { welcome: 1 }, got: [], games: 0, wins: 0, day: '', gids: [], fresh: [], rev: 0, at: 0 };
}

// A collection as read back (a stored copy, the account's copy): whatever is malformed is put right,
// the starter cards are always owned.
export function fitCollection(c) {
  const out = newCollection();
  if (!c || typeof c !== 'object') return out;
  const int = (v, max = 1e9) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  const cards = (a) => (Array.isArray(a) ? sortCards(a.filter((k) => typeof k === 'string' && BUILDINGS[k])) : []);
  out.own = sortCards([...STARTER, ...cards(c.own)]);
  out.coins = int(c.coins);
  out.shards = int(c.shards);
  if (c.prog && typeof c.prog === 'object') for (const m of MISSIONS) out.prog[m.id] = Math.min(m.goal, int(c.prog[m.id]));
  out.prog.welcome = 1;
  out.got = Array.isArray(c.got) ? MISSIONS.map((m) => m.id).filter((id) => c.got.includes(id)) : [];
  out.games = int(c.games);
  out.wins = Math.min(out.games, int(c.wins));
  out.day = typeof c.day === 'string' && /^\d{4}-\d\d-\d\d$/.test(c.day) ? c.day : '';
  out.gids = Array.isArray(c.gids) ? c.gids.filter((g) => typeof g === 'string' && g.length <= 80).slice(-GIDS) : [];
  out.fresh = cards(c.fresh).filter((k) => out.own.includes(k));
  out.rev = int(c.rev);
  out.at = int(c.at, 1e14);
  return out;
}

// (the basic cards: everyone's)
export const owns = (c, k) => isBasic(k) || c.own.includes(k);

// Two copies of one player's collection put together (a device that played signed out joins the
// account): every card and mission either has, the larger of each count.
export function mergeCollections(a, b) {
  const x = fitCollection(a);
  const y = fitCollection(b);
  const most = (k) => Math.max(x[k], y[k]);
  return fitCollection({
    own: [...x.own, ...y.own],
    coins: most('coins'),
    shards: most('shards'),
    prog: Object.fromEntries(MISSIONS.map((m) => [m.id, Math.max(x.prog[m.id] || 0, y.prog[m.id] || 0)])),
    got: [...x.got, ...y.got],
    games: most('games'),
    wins: most('wins'),
    day: x.day > y.day ? x.day : y.day,
    gids: [...new Set([...x.gids, ...y.gids])],
    fresh: [...x.fresh, ...y.fresh],
    rev: most('rev') + 1,
    at: most('at'),
  });
}

// a blueprint kept to what this collection owns (the basic cards are everyone's) and to a valid one:
// 7 at most, one wonder
export function ownedBlueprint(c, bp) {
  const out = [];
  for (const k of Array.isArray(bp) ? bp : []) {
    if (!(isBasic(k) || owns(c, k)) || out.includes(k) || (isWonder(k) && out.some(isWonder))) continue;
    if (out.length < BLUEPRINT_SIZE) out.push(k);
  }
  return out;
}

function gain(c, k) {
  if (owns(c, k)) return false;
  c.own = sortCards([...c.own, k]);
  if (!c.fresh.includes(k)) c.fresh.push(k);
  return true;
}

// ── missions ──

export function missionState(c, id) {
  const m = MISSION[id];
  const n = Math.min(m.goal, c.prog[id] || 0);
  return { n, goal: m.goal, done: n >= m.goal, got: c.got.includes(id) };
}
// how many rewards wait to be taken
export const claimable = (c) => MISSIONS.filter((m) => missionState(c, m.id).done && !c.got.includes(m.id)).length;

// progress on mission id: 'once' and 'most' to value v, 'count' by v
function advance(c, id, v, done) {
  const m = MISSION[id];
  const before = c.prog[id] || 0;
  const after = Math.min(m.goal, m.what === 'count' ? before + v : Math.max(before, v));
  if (after === before) return false;
  c.prog[id] = after;
  if (before < m.goal && after >= m.goal) done.push(id);
  return true;
}

// Taking a mission's reward. → { coins } or { card } (a card already owned comes as its shards), or
// null when there is nothing to take.
export function claim(c, id) {
  const m = MISSION[id];
  if (!m || !missionState(c, id).done || c.got.includes(id)) return null;
  c.got.push(id);
  c.got = MISSIONS.map((x) => x.id).filter((x) => c.got.includes(x));
  if (m.reward.coins) {
    c.coins += m.reward.coins;
    return { coins: m.reward.coins };
  }
  const k = m.reward.card;
  if (gain(c, k)) return { card: k };
  c.shards += dupShards(k);
  return { card: k, shards: dupShards(k) };
}

// ── during a game ──

// What a game in play shows of this player (view: the state as the player sees it, me: their seat,
// events: what just happened): the missions that can be done before the game ends. → the missions
// this completed (their ids), or null when nothing changed.
export function observe(c, view, me, events = []) {
  if (!view || !view.rules || !view.rules.develop || !view.players || !view.players[me]) return null;
  const done = [];
  let changed = false;
  const mine = Object.values(view.plots || {}).filter((pl) => pl && pl.p === me);
  if (mine.length) changed = advance(c, 'plot', 1, done) || changed;
  if (mine.some((pl) => pl.r && pl.r.length >= 2)) changed = advance(c, 'level2', 1, done) || changed;
  const wonders = (view.wonders || []).filter((w) => w.p === me);
  if (wonders.length || events.some((e) => e.type === 'wonder' && e.p === me)) changed = advance(c, 'wonder', 1, done) || changed;
  if (wonders.some((w) => w.done) || events.some((e) => e.type === 'wonderDone' && e.p === me)) changed = advance(c, 'wonderdone', 1, done) || changed;
  if (events.some((e) => e.type === 'defend' && e.p === me)) changed = advance(c, 'defend', 1, done) || changed;
  const built = Object.keys(view.players[me].built || {}).length;
  if (built) {
    changed = advance(c, 'build2', built, done) || changed;
    changed = advance(c, 'build3', built, done) || changed;
  }
  return changed ? done : null;
}

// ── a finished game ──

// The coins and missions of a finished game. r: the game's result (game.js result(): gid, mode, won,
// …; null for games that are not counted: several players at one device), view/me as in observe,
// today: 'YYYY-MM-DD'. → { coins: [[what, n]…], total, done: [mission ids] }, or null when the game
// was counted before (a reload, a room joined again).
export function gameOver(c, r, view, me, today) {
  if (!r || !r.gid || c.gids.includes(r.gid)) return null;
  c.gids = [...c.gids, r.gid].slice(-GIDS);
  const online = r.mode === 'online' || r.mode === 'official';
  const coins = [['game', COINS.game]];
  if (r.won) coins.push(['win', COINS.win]);
  if (online) coins.push(['online', COINS.online]);
  if (today && c.day !== today) {
    coins.push(['daily', COINS.daily]);
    c.day = today;
  }
  const total = coins.reduce((n, [, x]) => n + x, 0);
  c.coins += total;
  c.games += 1;
  if (r.won) c.wins += 1;
  const done = observe(c, view, me) || [];
  const dev = !!(view && view.rules && view.rules.develop);
  if (dev) advance(c, 'devgame', 1, done);
  if (dev && r.won) advance(c, 'devwin', 1, done);
  if (view && view.players && view.largestArmy === me) advance(c, 'army', 1, done);
  if (online) advance(c, 'online', 1, done);
  advance(c, 'games10', 1, done);
  if (r.won) advance(c, 'wins5', 1, done);
  return { coins, total, done };
}

// ── draws and the shop ──

// One card of the pool (rnd: a number in [0, 1)).
export function pick(rnd) {
  const total = POOL.reduce((n, k) => n + drawWeight(k), 0);
  let x = rnd() * total;
  for (const k of POOL) {
    x -= drawWeight(k);
    if (x < 0) return k;
  }
  return POOL[POOL.length - 1];
}

// Drawing n cards (1 or 10). → { cards: [{ k, fresh, shards }] } or { error } (a key: not enough coins).
export function draw(c, n, rnd) {
  const cost = n === 10 ? DRAW10_COST : DRAW_COST * n;
  if (!(n === 1 || n === 10)) return { error: N_('不能這樣抽') };
  if (c.coins < cost) return { error: N_('金幣不夠') };
  c.coins -= cost;
  const cards = [];
  for (let i = 0; i < n; i++) {
    const k = pick(rnd);
    if (gain(c, k)) cards.push({ k, fresh: true, shards: 0 });
    else {
      c.shards += dupShards(k);
      cards.push({ k, fresh: false, shards: dupShards(k) });
    }
  }
  return { cards, cost };
}

// Trading shards for a card of the pool. → { card } or { error } (a key).
export function buy(c, k) {
  if (!POOL.includes(k)) return { error: N_('商店沒有這張卡') };
  if (owns(c, k)) return { error: N_('已經有這張卡了') };
  if (c.shards < priceOf(k)) return { error: N_('碎片不夠') };
  c.shards -= priceOf(k);
  gain(c, k);
  return { card: k };
}

// a card looked at (its "new" mark goes)
export function seen(c, cards) {
  const before = c.fresh.length;
  c.fresh = c.fresh.filter((k) => !cards.includes(k));
  return c.fresh.length !== before;
}

// A blueprint with room takes a new card at once (the one in use, so a new card is played with
// without a visit to the Cards page): not when it is full, nor a second wonder. → whether it changed.
export function slotNew(bp, k) {
  if (!Array.isArray(bp) || bp.includes(k) || bp.length >= BLUEPRINT_SIZE) return false;
  if (isWonder(k) && bp.some(isWonder)) return false;
  bp.push(k);
  return true;
}
