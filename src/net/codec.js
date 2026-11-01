// Compact wire format for online play. The host publishes the public part of the game state
// (plus recent public events) in its room presence; each remote seat's hand travels encrypted.
// All keys are identifiers and every string stays well under 1 KiB (room presence limits).
import { GEO, useMap } from '../engine/geometry.js';
import { RES } from '../engine/engine.js';
import { generateBoard, provinceName } from '../engine/board.js';
import { seedState } from '../engine/rng.js';
import { DEFAULT_MAP, mapDef } from '../engine/maps.js';

const TER = { forest: 'f', hills: 'h', pasture: 'p', fields: 'g', mountains: 'm', desert: 'd', sea: 's', gold: 'o', fog: 'x' };
const TER_R = Object.fromEntries(Object.entries(TER).map(([k, v]) => [v, k]));
const HB = { any: 'a', wood: 'w', brick: 'b', wool: 'l', grain: 'g', ore: 'o' };
const HB_R = Object.fromEntries(Object.entries(HB).map(([k, v]) => [v, k]));
const DEV = { knight: 'k', victoryPoint: 'v', roadBuilding: 'r', yearOfPlenty: 'y', monopoly: 'm' };
const DEV_R = Object.fromEntries(Object.entries(DEV).map(([k, v]) => [v, k]));
const KIND = { human: 'h', ai: 'a', remote: 'r' };
const KIND_R = { h: 'human', a: 'ai', r: 'remote' };
const LVL = { easy: 'e', normal: 'n', hard: 'x' };
const LVL_R = { e: 'easy', n: 'normal', x: 'hard' };

const resStr = (m) => RES.map((r) => (m && m[r]) || 0).join('.');
const resObj = (s) => {
  const a = String(s).split('.').map(Number);
  const o = {};
  RES.forEach((r, i) => {
    if (a[i]) o[r] = a[i];
  });
  return o;
};
const resFull = (s) => {
  const a = String(s).split('.').map(Number);
  const o = {};
  RES.forEach((r, i) => (o[r] = a[i] || 0));
  return o;
};

// {seat: count} ↔ "seat.count,seat.count"
const amountsStr = (m) => Object.entries(m).map(([q, n]) => `${q}.${n}`).join(',');
const amountsObj = (s) => {
  const o = {};
  if (s) for (const x of String(s).split(',')) {
    const [q, n] = x.split('.').map(Number);
    o[q] = n;
  }
  return o;
};

// ── static board + seats (sent with every snapshot; small) ──
// The standard island travels in full. Other maps send only the map, the seed and the number method:
// every page lays the same board out itself (the generator is deterministic), and hk — a checksum of
// the host's board — catches a page running another version of the game. ru: the turn rule (5–6
// players: 'p' paired turns, 's' special building phase).
export function encodeBoard(st) {
  let b;
  if (st.map && st.map !== DEFAULT_MAP) b = { mp: st.map, m: st.board.method === 'spiral' ? 's' : 'b', ts: st.mapSeed >>> 0, hk: boardHash(st.board) };
  else {
    b = {
      h: st.board.hexes.map((h) => TER[h.terrain] + String(h.number).padStart(2, '0')).join(''),
      n: st.board.hexes.map((h) => h.name).join('|'),
      hb: st.board.harbors.map((h) => h.edge + HB[h.type]).join(','),
      m: st.board.method === 'spiral' ? 's' : 'b',
      ts: st.mapSeed >>> 0,
    };
  }
  if (st.rules && st.rules.turns) b.ru = st.rules.turns === 'sbp' ? 's' : 'p';
  return b;
}

// a short checksum of a board's layout (FNV-1a over terrain, numbers, names and harbors); the fog
// islands' hidden hexes count as unexplored whatever has been found there since
export function boardHash(board) {
  const tiles = GEO.def.tiles;
  const text = board.hexes.map((h, i) => (tiles[i] && tiles[i].t === 'fog' ? 'fog0' : `${h.terrain}${h.number}${h.name}`)).join('|') + '#' + board.harbors.map((h) => h.edge + h.type).join(',');
  let x = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    x ^= text.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x.toString(36);
}

export class BoardMismatch extends Error {
  constructor() {
    super('主持人的遊戲版本和你的不同，請重新整理頁面後再加入');
    this.name = 'BoardMismatch';
  }
}

const laidOut = new Map();
function layOut(b) {
  const key = `${b.mp}:${b.ts}:${b.m}`;
  let hit = laidOut.get(key);
  if (!hit) {
    const board = generateBoard({ rng: seedState(b.ts >>> 0) }, { numbers: b.m === 's' ? 'spiral' : 'balanced' });
    hit = { board, hash: boardHash(board) };
    if (laidOut.size > 6) laidOut.clear();
    laidOut.set(key, hit);
  }
  if (b.hk && hit.hash !== b.hk) throw new BoardMismatch();
  return hit.board;
}

// (puts the board's map in play)
export function decodeBoard(b, robber) {
  useMap(b.mp || DEFAULT_MAP);
  if (!b.h) {
    const board = layOut(b);
    return { hexes: board.hexes, harbors: board.harbors, vertexHarbor: board.vertexHarbor, robber, method: board.method };
  }
  const names = b.n.split('|');
  const hexes = [];
  for (let i = 0; i < GEO.hexes.length; i++) {
    const t = b.h.slice(i * 3, i * 3 + 3);
    hexes.push({ terrain: TER_R[t[0]], number: Number(t.slice(1)), name: names[i] || '' });
  }
  const harbors = b.hb.split(',').map((x) => ({ edge: parseInt(x, 10), type: HB_R[x.replace(/^\d+/, '')] }));
  const vertexHarbor = new Array(GEO.vertices.length).fill(null);
  for (const hb of harbors) for (const v of GEO.edges[hb.edge].v) vertexHarbor[v] = hb.type;
  return { hexes, harbors, vertexHarbor, robber, method: b.m === 's' ? 'spiral' : 'balanced' };
}
export function encodeSeats(st) {
  return st.players.map((p) => [p.name, p.color, KIND[p.kind] || 'a', p.ai ? LVL[p.ai.level] || 'n' : '']);
}
export function decodeSeats(a) {
  return a.map(([name, color, k, l]) => ({ name, color, kind: KIND_R[k] || 'ai', ai: k === 'a' ? { level: LVL_R[l] || 'normal' } : null }));
}

// ── events ──
export function encodeEvent(e) {
  switch (e.type) {
    case 'roll':
      return ['R', e.p, e.dice[0], e.dice[1]];
    case 'produce':
      return ['P', e.sum, e.blocked, e.paid.map((c) => `${c.hex}.${c.vertex}.${c.p}.${RES.indexOf(c.res)}.${c.amt}`).join(','), e.shortages.map((s) => `${RES.indexOf(s.res)}.${s.partial ? 1 : 0}.${s.p ?? -1}.${s.got ?? 0}`).join(','), ...(e.gold ? [amountsStr(e.gold)] : [])];
    case 'build':
      return ['B', e.p, e.what === 'ship' ? 'h' : e.what[0], e.vertex ?? e.edge, (e.setup ? 1 : 0) + (e.free ? 2 : 0)];
    case 'moveShip':
      return ['V', e.p, e.from, e.to];
    case 'pirate':
      return ['J', e.p, e.from, e.to, e.reason === 'knight' ? 'k' : 's'];
    case 'gold':
      return ['U', e.p, resStr(e.res), e.count];
    case 'isleBonus':
      return ['I', e.p, e.vertex, e.vp];
    case 'discover':
      return ['f', e.p, e.hex, TER[e.terrain], e.number, e.res ? RES.indexOf(e.res) : -1];
    case 'startingResources':
      return ['S', e.p, e.vertex, resStr(e.gains)];
    case 'buyDev':
      return ['D', e.p, e.left];
    case 'playDev':
      if (e.card === 'knight') return ['K', e.p, e.knights];
      if (e.card === 'roadBuilding') return ['W', e.p];
      if (e.card === 'yearOfPlenty') return ['Y', e.p, e.res.map((r) => RES.indexOf(r)).join('.')];
      return ['M', e.p, RES.indexOf(e.res), e.total, Object.entries(e.taken || {}).map(([q, n]) => `${q}.${n}`).join(',')];
    case 'robber':
      return ['X', e.p, e.from, e.to, e.reason === 'knight' ? 'k' : 's'];
    case 'steal':
      return ['T', e.p, e.from];
    case 'discardRequired':
      return ['Q', Object.entries(e.amounts).map(([q, n]) => `${q}.${n}`).join(',')];
    case 'discard':
      return ['d', e.p, e.count];
    case 'bankTrade':
      return ['b', e.p, RES.indexOf(e.give), RES.indexOf(e.get), e.ratio];
    case 'offer':
      return ['O', e.p, resStr(e.give), resStr(e.get)];
    case 'respond':
      return ['A', e.p, e.accept ? 1 : 0, e.from, e.lack ? 1 : 0];
    case 'trade':
      return ['t', e.from, e.to, resStr(e.give), resStr(e.get)];
    case 'offerCancelled':
      return ['C', e.p];
    case 'longestRoad':
      return ['L', e.from, e.to, e.length];
    case 'largestArmy':
      return ['G', e.from, e.to, e.size];
    case 'turnStart':
      return e.sub ? ['N', e.p, e.turn, e.sub === 'sbp' ? 's' : 'p', e.lead] : ['N', e.p, e.turn];
    case 'phase':
      return ['H'];
    case 'roadBuildingDone':
      return ['w', e.p];
    case 'gameOver':
      return ['Z', e.winner, e.vp];
    default:
      return null;
  }
}

export function decodeEvent(a) {
  const k = a[0];
  switch (k) {
    case 'R':
      return { type: 'roll', p: a[1], dice: [a[2], a[3]], sum: a[2] + a[3] };
    case 'P': {
      const paid = a[3]
        ? a[3].split(',').map((x) => {
            const [hex, vertex, p, r, amt] = x.split('.').map(Number);
            return { hex, vertex, p, res: RES[r], amt };
          })
        : [];
      const shortages = a[4]
        ? a[4].split(',').map((x) => {
            const [r, partial, p, got] = x.split('.').map(Number);
            return { res: RES[r], partial: !!partial, p, got };
          })
        : [];
      const e = { type: 'produce', sum: a[1], blocked: a[2], paid, shortages };
      if (a[5]) e.gold = amountsObj(a[5]);
      return e;
    }
    case 'B': {
      const what = { r: 'road', s: 'settlement', c: 'city', h: 'ship' }[a[2]];
      const e = { type: 'build', what, p: a[1], setup: !!(a[4] & 1), free: !!(a[4] & 2) };
      if (what === 'road' || what === 'ship') e.edge = a[3];
      else e.vertex = a[3];
      return e;
    }
    case 'V':
      return { type: 'moveShip', p: a[1], from: a[2], to: a[3] };
    case 'J':
      return { type: 'pirate', p: a[1], from: a[2], to: a[3], reason: a[4] === 'k' ? 'knight' : 'seven' };
    case 'U':
      return { type: 'gold', p: a[1], res: resObj(a[2]), count: a[3] };
    case 'f':
      return { type: 'discover', p: a[1], hex: a[2], terrain: TER_R[a[3]], number: a[4], ...(a[5] >= 0 ? { res: RES[a[5]] } : {}) };
    case 'I':
      return { type: 'isleBonus', p: a[1], vertex: a[2], vp: a[3] };
    case 'S':
      return { type: 'startingResources', p: a[1], vertex: a[2], gains: resFull(a[3]) };
    case 'D':
      return { type: 'buyDev', p: a[1], left: a[2], card: null };
    case 'K':
      return { type: 'playDev', p: a[1], card: 'knight', knights: a[2] };
    case 'W':
      return { type: 'playDev', p: a[1], card: 'roadBuilding' };
    case 'Y':
      return { type: 'playDev', p: a[1], card: 'yearOfPlenty', res: String(a[2]).split('.').map((i) => RES[+i]) };
    case 'M': {
      const taken = {};
      if (a[4]) for (const x of a[4].split(',')) {
        const [q, n] = x.split('.').map(Number);
        taken[q] = n;
      }
      return { type: 'playDev', p: a[1], card: 'monopoly', res: RES[a[2]], total: a[3], taken };
    }
    case 'X':
      return { type: 'robber', p: a[1], from: a[2], to: a[3], reason: a[4] === 'k' ? 'knight' : 'seven' };
    case 'T':
      return { type: 'steal', p: a[1], from: a[2], res: null };
    case 'Q': {
      const amounts = {};
      if (a[1]) for (const x of a[1].split(',')) {
        const [q, n] = x.split('.').map(Number);
        amounts[q] = n;
      }
      return { type: 'discardRequired', amounts };
    }
    case 'd':
      return { type: 'discard', p: a[1], count: a[2], cards: null };
    case 'b':
      return { type: 'bankTrade', p: a[1], give: RES[a[2]], get: RES[a[3]], ratio: a[4] };
    case 'O':
      return { type: 'offer', p: a[1], give: resObj(a[2]), get: resObj(a[3]) };
    case 'A':
      return { type: 'respond', p: a[1], accept: !!a[2], from: a[3], lack: !!a[4] };
    case 't':
      return { type: 'trade', from: a[1], to: a[2], give: resObj(a[3]), get: resObj(a[4]) };
    case 'C':
      return { type: 'offerCancelled', p: a[1] };
    case 'L':
      return { type: 'longestRoad', from: a[1], to: a[2], length: a[3] };
    case 'G':
      return { type: 'largestArmy', from: a[1], to: a[2], size: a[3] };
    case 'N':
      return a[3] ? { type: 'turnStart', p: a[1], turn: a[2], sub: a[3] === 's' ? 'sbp' : 'pair', lead: a[4] } : { type: 'turnStart', p: a[1], turn: a[2] };
    case 'H':
      return { type: 'phase', phase: 'play' };
    case 'w':
      return { type: 'roadBuildingDone', p: a[1] };
    case 'Z':
      return { type: 'gameOver', winner: a[1], vp: a[2] };
    default:
      return null;
  }
}

// private details only the involved seats may learn
export function privateDetails(events, seat) {
  const out = [];
  events.forEach((e, i) => {
    if (e.type === 'buyDev' && e.p === seat) out.push([i, 'D', DEV[e.card]]);
    if (e.type === 'steal' && (e.p === seat || e.from === seat) && e.res) out.push([i, 'T', RES.indexOf(e.res)]);
    if (e.type === 'discard' && e.p === seat) out.push([i, 'd', resStr(e.cards)]);
  });
  return out;
}

// ── dynamic public state ──
export function encodePublic(st) {
  const pd = st.pending;
  let pend = 0;
  if (pd) {
    if (pd.type === 'discard') pend = ['d', Object.entries(pd.amounts).map(([q, n]) => `${q}.${n}`).join(',')];
    else if (pd.type === 'robber') pend = ['r', pd.reason === 'knight' ? 'k' : 's'];
    else if (pd.type === 'steal') pend = ['s', pd.hex, pd.victims.join('.')];
    else if (pd.type === 'roadBuilding') pend = pd.gold ? ['b', pd.left, pd.gold] : ['b', pd.left];
    else if (pd.type === 'gold') pend = ['g', amountsStr(pd.amounts)];
  }
  const t = st.trade;
  const trade = t ? [t.id, t.from, resStr(t.give), resStr(t.get), Object.entries(t.resp).map(([q, r]) => `${q}${r === 'yes' ? 'y' : r === 'no' ? 'n' : r === 'lack' ? 'l' : 'w'}`).join('.')] : 0;
  const pub = {
    s: st.seq,
    ph: st.phase === 'setup' ? 'S' : st.phase === 'over' ? 'O' : 'P',
    tv: st.targetVP,
    v: st.vertices.map((b) => (b ? String.fromCharCode((b.t === 'c' ? 65 : 97) + b.p) : '.')).join(''),
    e: st.edges.map((p) => (p < 0 ? '.' : String(p))).join(''),
    rb: st.board.robber,
    su: [st.setup.order.join(''), st.setup.i, st.setup.step === 'road' ? 'r' : 's', st.setup.last],
    cu: st.current,
    tu: st.turn,
    ro: st.rolled ? 1 : 0,
    di: st.dice ? st.dice[0] * 10 + st.dice[1] : 0,
    dp: st.devPlayed ? 1 : 0,
    pd: pend,
    tr: trade,
    lr: st.longestRoad,
    la: st.largestArmy,
    rl: st.roadLen.join('.'),
    w: st.winner,
    rs: st.rolls.join('.'),
    bk: resStr(st.bank),
    dc: st.devDeck.length,
    pl: st.players.map((p) => {
      const row = [RES.reduce((s, r) => s + p.res[r], 0), p.dev.length, p.knights, `${p.played.knight}.${p.played.roadBuilding}.${p.played.yearOfPlenty}.${p.played.monopoly}`, `${p.pieces.roads}.${p.pieces.settlements}.${p.pieces.cities}${p.pieces.ships != null ? '.' + p.pieces.ships : ''}`, st.phase === 'over' ? p.dev.filter((c) => c.type === 'victoryPoint').length : -1];
      // (Seafarers) bonus points, the islands they came from, the home islands
      if (st.ships) row.push(p.chits || 0, (p.isles || []).join('.'), (p.home || []).join('.'));
      return row;
    }),
  };
  // (the fog islands) the hexes found so far: hex, terrain, number
  if (st.fog) pub.fg = GEO.def.tiles.map((t, i) => (t.t === 'fog' && st.board.hexes[i].terrain !== 'fog' ? `${i}${TER[st.board.hexes[i].terrain]}${st.board.hexes[i].number}` : '')).filter(Boolean).join(',');
  // Seafarers: the ships ('.' none, else the owner), the pirate, the ships built this turn, a ship moved
  if (st.ships) {
    pub.sh = st.ships.map((p) => (p < 0 ? '.' : String(p))).join('');
    pub.pi = st.board.pirate;
    pub.nw = st.newShips.join('.');
    pub.sm = st.shipMoved ? 1 : 0;
  }
  // 5–6 players: the part of the turn after the main player's
  if (st.sub) pub.sb = [st.sub.k === 'sbp' ? 's' : 'p', st.sub.lead, st.sub.rest.join('')];
  return pub;
}

export function encodePrivate(st, seat) {
  const p = st.players[seat];
  return { r: resStr(p.res), d: p.dev.map((c) => DEV[c.type] + c.turn).join(',') };
}

// Build a redacted view (same shape as makeView) for `seat` from public + private parts.
export function decodeView(board, seats, pub, priv, seat) {
  const n = seats.length;
  const vertices = [...pub.v].map((ch) => {
    if (ch === '.') return null;
    const c = ch.charCodeAt(0);
    return c >= 97 ? { p: c - 97, t: 's' } : { p: c - 65, t: 'c' };
  });
  const edges = [...pub.e].map((ch) => (ch === '.' ? -1 : Number(ch)));
  let pending = null;
  if (pub.pd) {
    const [k, a, b] = pub.pd;
    if (k === 'd') {
      const amounts = {};
      if (a) for (const x of a.split(',')) {
        const [q, m] = x.split('.').map(Number);
        amounts[q] = m;
      }
      pending = { type: 'discard', amounts };
    } else if (k === 'r') pending = { type: 'robber', reason: a === 'k' ? 'knight' : 'seven' };
    else if (k === 's') pending = { type: 'steal', hex: a, victims: String(b).split('.').map(Number) };
    else if (k === 'b') pending = b ? { type: 'roadBuilding', left: a, gold: b } : { type: 'roadBuilding', left: a };
    else if (k === 'g') pending = { type: 'gold', amounts: amountsObj(a) };
  }
  let trade = null;
  if (pub.tr) {
    const [id, from, g, gt, resp] = pub.tr;
    const r = {};
    for (const x of String(resp).split('.')) {
      if (!x) continue;
      const q = parseInt(x, 10);
      const c = x.slice(-1);
      r[q] = c === 'y' ? 'yes' : c === 'n' ? 'no' : c === 'l' ? 'lack' : null;
    }
    trade = { id, from, give: resObj(g), get: resObj(gt), resp: r };
  }
  const players = seats.map((s, i) => {
    const [cnt, devCount, knights, played, pieces, vpShown, chits, isles, home] = pub.pl[i];
    const pp = String(played).split('.').map(Number);
    const pc = String(pieces).split('.').map(Number);
    const mine = i === seat && priv;
    const res = mine ? resFull(priv.r) : null;
    let dev = mine ? (priv.d ? priv.d.split(',').map((x) => ({ type: DEV_R[x[0]], turn: Number(x.slice(1)) })) : []) : null;
    if (!mine && vpShown >= 0) dev = Array.from({ length: vpShown }, () => ({ type: 'victoryPoint', turn: 0 }));
    return {
      id: i,
      name: s.name,
      color: s.color,
      kind: s.kind,
      ai: s.ai,
      res,
      resCount: cnt,
      dev,
      devCount,
      knights,
      played: { knight: pp[0], roadBuilding: pp[1], yearOfPlenty: pp[2], monopoly: pp[3] },
      pieces: pc.length > 3 ? { roads: pc[0], settlements: pc[1], cities: pc[2], ships: pc[3] } : { roads: pc[0], settlements: pc[1], cities: pc[2] },
      ...(pub.sh != null ? { chits: chits || 0, isles: isles ? String(isles).split('.').map(Number) : [], home: home ? String(home).split('.').map(Number) : [] } : {}),
    };
  });
  const dice = pub.di ? [Math.floor(pub.di / 10), pub.di % 10] : null;
  const decoded = decodeBoard(board, pub.rb);
  const view = {
    v: 1,
    viewer: seat,
    seed: null,
    mapSeed: board.ts,
    rng: null,
    targetVP: pub.tv,
    board: decoded,
    players,
    vertices,
    edges,
    bank: resFull(pub.bk),
    devDeck: null,
    devDeckCount: pub.dc,
    phase: pub.ph === 'S' ? 'setup' : pub.ph === 'O' ? 'over' : 'play',
    setup: pub.su ? { order: [...pub.su[0]].map(Number), i: pub.su[1], step: pub.su[2] === 'r' ? 'road' : 'settlement', last: pub.su[3] } : { order: [], i: 0, step: 'settlement', last: -1 },
    current: pub.cu,
    turn: pub.tu,
    rolled: !!pub.ro,
    dice,
    devPlayed: !!pub.dp,
    pending,
    trade,
    longestRoad: pub.lr,
    largestArmy: pub.la,
    roadLen: String(pub.rl).split('.').map(Number).slice(0, n),
    winner: pub.w,
    seq: pub.s,
    rolls: String(pub.rs).split('.').map(Number),
    map: board.mp || DEFAULT_MAP,
  };
  // the rules: the map's, with the room's turn rule
  const rules = { ...(mapDef(board.mp || DEFAULT_MAP).rules || {}) };
  if (board.ru) rules.turns = board.ru === 's' ? 'sbp' : 'paired';
  if (Object.keys(rules).length) {
    view.rules = rules;
    if (rules.turns) view.sub = pub.sb ? { k: pub.sb[0] === 's' ? 'sbp' : 'pair', lead: pub.sb[1], rest: [...String(pub.sb[2] || '')].map(Number) } : null;
  }
  if (pub.sh != null) {
    view.ships = [...pub.sh].map((ch) => (ch === '.' ? -1 : Number(ch)));
    view.newShips = pub.nw ? String(pub.nw).split('.').map(Number) : [];
    view.shipMoved = !!pub.sm;
    view.board = { ...view.board, pirate: pub.pi };
  }
  // (the fog islands) the hexes found so far, on this page's own copy of the board
  if (pub.fg != null) {
    view.board = { ...view.board, hexes: discovered(view.board.hexes, String(pub.fg)) };
  }
  return view;
}

// the board's hexes with the fog's finds laid on them (the same array for the same finds, so the map
// and the sea analysis are not rebuilt on every update)
const found = new Map();
function discovered(hexes, fg) {
  if (!fg) return hexes;
  let byBoard = found.get(hexes);
  if (!byBoard) {
    if (found.size > 4) found.clear();
    byBoard = new Map();
    found.set(hexes, byBoard);
  }
  let out = byBoard.get(fg);
  if (!out) {
    out = hexes.slice();
    for (const x of fg.split(',')) {
      const m = /^(\d+)([a-z])(\d+)$/.exec(x);
      if (!m) continue;
      const i = Number(m[1]);
      const terrain = TER_R[m[2]];
      out[i] = { terrain, number: Number(m[3]), name: provinceName(terrain, i) };
    }
    byBoard.set(fg, out);
  }
  return out;
}

// ── the whole game, for the player who takes over as host ──
// The public part is already in the host's presence; this adds every hand, the development deck's
// order and the dice generator. It travels sealed for that one player only.
export function encodeFull(st) {
  return {
    p: st.players.map((p, i) => encodePrivate(st, i)),
    d: st.devDeck.map((t) => DEV[t]).join(''),
    g: Array.isArray(st.rng) ? st.rng.slice() : null,
    sd: st.seed >>> 0,
    // (the fog islands) what the fog still hides, and its numbers
    ...(st.fog ? { fo: [st.fog.pool.map((t) => TER[t]).join(''), st.fog.numbers.join('.')] } : {}),
  };
}

export function decodeFull(board, seats, pub, full) {
  const v = decodeView(board, seats, pub, null, -1);
  const players = v.players.map((p, i) => {
    const pr = (full.p && full.p[i]) || { r: '', d: '' };
    return {
      id: i,
      name: p.name,
      color: p.color,
      kind: p.kind,
      ai: p.ai,
      res: resFull(pr.r),
      dev: pr.d ? pr.d.split(',').map((x) => ({ type: DEV_R[x[0]], turn: Number(x.slice(1)) })) : [],
      played: p.played,
      knights: p.knights,
      pieces: p.pieces,
      ...(p.chits != null ? { chits: p.chits, isles: p.isles, home: p.home } : {}),
    };
  });
  const st = { ...v, players, devDeck: [...String(full.d || '')].map((c) => DEV_R[c]), rng: Array.isArray(full.g) ? full.g.slice() : null, seed: full.sd >>> 0 };
  if (full.fo) st.fog = { pool: [...String(full.fo[0])].map((c) => TER_R[c]), numbers: full.fo[1] ? String(full.fo[1]).split('.').map(Number) : [] };
  delete st.viewer;
  delete st.devDeckCount;
  return st;
}

export function applyPrivateDetails(events, details) {
  for (const [i, k, v] of details || []) {
    const e = events[i];
    if (!e) continue;
    if (k === 'D' && e.type === 'buyDev') e.card = DEV_R[v];
    if (k === 'T' && e.type === 'steal') e.res = RES[v];
    if (k === 'd' && e.type === 'discard') e.cards = resObj(v);
  }
  return events;
}

// A player's move as it arrives at the host, kept to the fields the rules read and to well-formed
// values (seat: the sender's seat, whatever the move claims; types: the moves there are).
const RES_SET = ['wood', 'brick', 'wool', 'grain', 'ore'];
function resMap(x) {
  const m = {};
  for (const r of RES_SET) if (Number.isInteger(x[r]) && x[r] > 0 && x[r] < 20) m[r] = x[r];
  return m;
}
export function sanitizeAction(a, seat, types) {
  if (!a || typeof a !== 'object' || !types.includes(a.type)) return null;
  const out = { type: a.type, p: seat };
  for (const k of ['vertex', 'edge', 'hex', 'target', 'with', 'from']) if (Number.isInteger(a[k])) out[k] = a[k];
  // to: where a ship sails (a path), or whom an offer goes to (seats)
  if (Number.isInteger(a.to)) out.to = a.to;
  else if (Array.isArray(a.to)) out.to = a.to.filter((q) => Number.isInteger(q) && q >= 0 && q < 8).slice(0, 8);
  if (typeof a.card === 'string') out.card = a.card;
  if (typeof a.accept === 'boolean') out.accept = a.accept;
  if (a.reason === 'lack') out.reason = 'lack';
  // res: a resource (monopoly), two (year of plenty), or counts (a gold field's pick)
  if (typeof a.res === 'string') out.res = a.res;
  else if (Array.isArray(a.res)) out.res = a.res.filter((x) => typeof x === 'string').slice(0, 2);
  else if (a.res && typeof a.res === 'object') out.res = resMap(a.res);
  for (const k of ['give', 'get', 'cards']) if (a[k] && typeof a[k] === 'object') out[k] = resMap(a[k]);
  if (a.type === 'bankTrade') {
    if (typeof a.give === 'string') out.give = a.give;
    if (typeof a.get === 'string') out.get = a.get;
  }
  return out;
}

export function utf8Size(obj) {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}
