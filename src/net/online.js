// Online play over the claude.ai room capability. One player hosts: the host's page runs the
// rules engine and the computer players, publishes the public game state in its room presence
// and seals each remote player's hand with that player's key. Players send their moves as a
// short outbox in their own presence; the host validates every move with the rules engine.
import { getRoom, wrap, selfHosted } from './room.js';
import { loadKeyPair, sharedKey, seal, open, cryptoAvailable } from './crypto.js';
import * as C from './codec.js';
import { ACTION_TYPES, actorsNow } from '../engine/engine.js';
import { Chat } from './chat.js';
import { perfScore, isTouchDevice } from './perf.js';
import { randomState } from '../engine/rng.js';
import { flagURL } from '../ui/flags.js';
import { esc } from '../ui/text.js';
import { icon } from '../ui/icons.js';
import { PALETTE, AI_NAMES, fitSettings, gameSetup } from '../ui/menu.js';
import { mapDef, MAP_LIST, DEFAULT_MAP } from '../engine/maps.js';

const APP = 'catan3d';
const V = 1;
const PREFIX = 'catan-';
const AWAY_MS = 30000;
const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789';

export async function onlineSupport() {
  const room = await getRoom();
  if (!room) return { ok: false, why: 'room' };
  if (!cryptoAvailable()) return { ok: false, why: 'crypto' };
  // our own room server: wait for the lobby connection (it keeps retrying in the background)
  if (room.whenReady && !(await room.whenReady(8000))) return { ok: false, why: 'server' };
  return { ok: true, room };
}

function supportError(why) {
  if (why === 'server') return '連不上連線伺服器，請稍後再試';
  if (why === 'crypto') return '瀏覽器不支援加密';
  return '這個頁面目前無法連線';
}

// link that opens the site straight into room `code`
export function inviteLink(code) {
  return `${location.origin}${location.pathname}#room=${String(code).toLowerCase()}`;
}

// The room this tab is in, so a reload (or a new published version) rejoins automatically.
const ROOM_KEY = 'catan3d-room-v1';
export function rememberRoom(code, role) {
  try {
    sessionStorage.setItem(ROOM_KEY, JSON.stringify({ code, role }));
  } catch {
    /* storage unavailable */
  }
}
export function forgetRoom() {
  try {
    sessionStorage.removeItem(ROOM_KEY);
  } catch {
    /* storage unavailable */
  }
}
export function rememberedRoom() {
  try {
    const r = JSON.parse(sessionStorage.getItem(ROOM_KEY) || 'null');
    return r && typeof r.code === 'string' ? r : null;
  } catch {
    return null;
  }
}

export function makeCode() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return [...a].map((x) => ALPH[x % ALPH.length]).join('');
}
export function normCode(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
}
const BAD_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');
const cleanName = (s, fallback) => String(s || '').replace(BAD_CHARS, '').trim().slice(0, 8) || fallback;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function btn(label, cls, fn) {
  const b = el('button', 'btn ' + (cls || ''), label);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function sanitizeAction(a, seat) {
  if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) return null;
  const out = { type: a.type, p: seat };
  for (const k of ['vertex', 'edge', 'hex', 'target', 'with']) if (Number.isInteger(a[k])) out[k] = a[k];
  if (typeof a.card === 'string') out.card = a.card;
  if (typeof a.accept === 'boolean') out.accept = a.accept;
  if (typeof a.res === 'string') out.res = a.res;
  if (Array.isArray(a.res)) out.res = a.res.filter((x) => typeof x === 'string').slice(0, 2);
  for (const k of ['give', 'get', 'cards']) {
    if (a[k] && typeof a[k] === 'object') {
      const m = {};
      for (const r of ['wood', 'brick', 'wool', 'grain', 'ore']) if (Number.isInteger(a[k][r]) && a[k][r] > 0 && a[k][r] < 20) m[r] = a[k][r];
      out[k] = m;
    }
  }
  if (a.type === 'bankTrade') {
    if (typeof a.give === 'string') out.give = a.give;
    if (typeof a.get === 'string') out.get = a.get;
  }
  return out;
}

// the room's terms in one line: island, seats, turn rule, victory points
function roomTerms(mp, ru, n, tv) {
  const def = mapDef(mp || DEFAULT_MAP);
  const parts = [`${esc(def.name)}`, `${n} 席`];
  if (ru) parts.push(ru === 's' ? '特別建造階段' : '配對回合');
  if (tv) parts.push(`${tv} 分勝利`);
  return parts.join('・');
}

function seatRows(seats, me, opts = {}) {
  return seats
    .map((s, i) => {
      const label =
        s.kind === 'host'
          ? `${esc(s.name)} <em>主持人${s.peer === me ? '·你' : ''}</em>`
          : s.kind === 'remote'
            ? `${esc(s.name)} <em>線上玩家${s.peer === me ? '·你' : ''}${s.away ? '·離線' : ''}</em>`
            : s.kind === 'ai'
              ? `${esc(s.name || '電腦')} <em>電腦·${{ easy: '簡單', normal: '普通', hard: '困難' }[s.level] || '普通'}</em>`
              : `<span style="color:var(--ink-faint)">等待玩家加入…</span>`;
      const color = s.color || '#6b6457';
      return `<div class="seat" data-i="${i}"><img class="flag sm" alt="" src="${flagURL(color, i)}"><div class="nm">${label}</div><div class="ctl">${opts.controls ? opts.controls(s, i) : ''}</div></div>`;
    })
    .join('');
}

// ───────────────────────── host ─────────────────────────
// The host is whichever page runs the campaign. It starts as the room's creator, but once the campaign
// is under way the page best able to run it takes over, and if the host's page goes away the next
// best page takes over from the last state it was sent (sealed for that page alone). Each new host
// counts up an epoch (`ep`); when two pages claim the room, the higher epoch is the host and the
// other steps down to playing its own nation.

const FAILOVER_MS = 6000; // the host's page has been gone this long: the next host takes over
const STALL_MS = 15000; // the game has waited this long on a host that does nothing: the same
const HANDOVER_MS = 10000; // a handover nobody took up is called off after this
const LEAVE_WAIT_MS = 4000; // a host leaving the campaign waits this long for the next host
const HIDE_MS = 4000; // a host page in the background this long hands the room on (phones: at once)
const PERF_MARGIN = 1.15; // the room moves to a device at least this much faster
const RETRY_MS = 30000; // after a handover nobody took up, wait this long before offering it again
const PRESENCE_BUDGET = 3900;
// presence keys of each role, cleared when a page changes role
const HOST_KEYS = ['code', 'st', 'lob', 'bd', 'ps', 'pub', 'px', 'ack', 'err', 'ev', 'tv', 'off', 'rem', 'ep', 'pn', 'bk', 'ho', 'dl', 'hn', 'hc', 'mp', 'ru'];
const PLAYER_KEYS = ['name', 'color', 'sid', 'out', 'perf', 'vis', 'bye', 'gm'];

// of two pages hosting the same room, the real host: the newer claim, then the smaller peer id
function outranks(epA, peerA, epB, peerB) {
  const a = Number(epA) || 1;
  const b = Number(epB) || 1;
  return a > b || (a === b && String(peerA) < String(peerB));
}

function pageVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

const KINDS = { h: 'host', r: 'remote', a: 'ai', o: 'open' };
function decodeLob(lob) {
  return (Array.isArray(lob) ? lob : []).map(([k, name, color, peer, level, away]) => ({ kind: KINDS[k] || 'open', name, color, peer, level, away: !!away }));
}

export class HostSession {
  constructor({ app, settings, onStart, onLeave, toast, official = false, quiet = false, onLobby = null, seconds = 60, mapSeed = null, onDemoted = null, chat = null }) {
    this.app = app;
    this.settings = settings;
    this.mapSeed = mapSeed; // official rooms list their island, so the home screen can show it
    this.onStart = onStart;
    this.onLeave = onLeave;
    this.toast = toast || (() => {});
    this.official = official; // an official matchmaking room: 4 seats, starts when full or when the timer runs out
    this.quiet = quiet; // the matchmaking screen draws the lobby instead of the host's own screen
    this.onLobby = onLobby;
    this.seconds = seconds;
    this.onDemoted = onDemoted; // another page took the campaign over: this page plays on as a player
    this.chat = chat || new Chat();
    this.history = [];
    this.err = null;
    this.phase = 'lobby';
    this.game = null;
    this.state = null;
    this.publishing = null;
    this.dirty = false;
    this.ui = null;
    this.ep = 1;
    this.pn = 0;
    this.hostSeat = 0;
    this.handing = null;
    this.demoted = false;
    this.bkTo = null;
  }

  async open(restore = null) {
    const sup = await onlineSupport();
    if (!sup.ok) throw new Error(supportError(sup.why));
    this.room = sup.room;
    this.lobby = wrap(this.room);
    this.code = restore ? restore.code : makeCode();
    this.ch = wrap(await this.room.join(PREFIX + this.code));
    this.keys = await loadKeyPair();
    this.perf = perfScore();
    if (restore) {
      this.phase = 'play';
      this.ep = Number(restore.ep) || 1;
      this.seats = restore.seats.map((s) => ({ ...s, peer: null, away: s.kind === 'remote', awaySince: s.kind === 'remote' ? Date.now() : 0 }));
      this.hostSeat = Math.max(0, this.seats.findIndex((s) => s.kind === 'host'));
    } else {
      const s = this.settings;
      this.seats = [{ kind: 'host', name: cleanName(s.name, '曙光王國'), color: s.color }];
      const n = this.official ? 3 : s.opponents;
      for (let i = 0; i < n; i++) this.seats.push({ kind: 'open', level: 'normal' });
    }
    this.createdAt = Date.now();
    if (this.official && !restore) {
      this.deadline = this.createdAt + this.seconds * 1000;
      this.autoTimer = setInterval(() => this.tickAuto(), 250);
    }
    rememberRoom(this.code, 'host');
    this.listen();
    if (!restore && !this.quiet) this.showLobby();
    this.publish();
  }

  // listen on the room channel (also after taking a running campaign over from another page)
  listen() {
    this.seats[this.hostSeat].peer = this.me();
    this.unsub = this.ch.onPeers((ch) => this.onPeers(ch));
    this.connUnsub = this.ch.onConnection((ok) => this.ui && this.ui.conn && this.ui.conn(ok));
    this.awayTimer = setInterval(() => this.checkAway(), 2000);
    this.chat.bind(this.ch, (peer, pr) => this.whoIs(peer, pr));
    this.watchPage();
  }

  // this page takes over a running campaign (from ClientSession.takeover)
  takeover(t) {
    this.room = t.room;
    this.lobby = wrap(this.room);
    this.ch = t.ch;
    this.keys = t.keys;
    this.code = t.code;
    this.ep = t.ep;
    this.seats = t.seats;
    this.hostSeat = t.hostSeat;
    this.official = !!t.official;
    this.mapSeed = t.mapSeed != null ? t.mapSeed : null;
    this.createdAt = t.createdAt || Date.now();
    this.phase = 'play';
    this.perf = perfScore();
    this.becoming = true; // the first update also clears this page's player keys
    rememberRoom(this.code, 'host');
    this.listen();
    // who is here, how fast their devices are: from the presences as they are now
    this.onPeers({ peers: this.ch.peers(), joined: [], left: [], updated: [] });
  }

  remaining() {
    return this.deadline ? Math.max(0, this.deadline - Date.now()) : null;
  }

  // official rooms start by themselves: 3 s after the last seat fills, or when the timer runs out
  tickAuto() {
    if (this.phase !== 'lobby') {
      clearInterval(this.autoTimer);
      return;
    }
    const now = Date.now();
    const full = !this.seats.some((s) => s.kind === 'open');
    if (full && !this.fullAt) {
      this.fullAt = now;
      this.deadline = Math.min(this.deadline, now + 3000);
      this.publish();
    } else if (!full && this.fullAt) this.fullAt = 0;
    if (this.onLobby) this.onLobby();
    if (now >= this.deadline) {
      clearInterval(this.autoTimer);
      this.start();
    }
  }

  me() {
    return this.ch.me();
  }

  whoIs(peer, pr) {
    const s = this.seats && this.seats.find((x) => x.peer === peer && x.kind !== 'open');
    if (s) return { name: s.name, color: s.color };
    return { name: `${cleanName(pr && pr.name, '觀戰者')}（觀戰）`, color: null };
  }

  usedColors(except = -1) {
    return this.seats.filter((s, i) => i !== except && s.color && s.kind !== 'open').map((s) => s.color);
  }
  freeColor(want, i) {
    const used = this.usedColors(i);
    if (want && !used.includes(want) && PALETTE.some((p) => p.hex === want)) return want;
    return PALETTE.map((p) => p.hex).find((h) => !used.includes(h)) || '#888888';
  }

  onPeers(ch) {
    if (this.demoted || this.phase === 'closed') return;
    if (ch.error) {
      this.toast('連線中斷', '房間連線已結束，請重新建立房間。', 'cross');
      return;
    }
    this.chat.receive(ch.peers);
    // the room echoing this page's own presence back changes nothing here (and answering it with
    // another publish would loop)
    if (Array.isArray(ch.updated) && !(ch.joined && ch.joined.length) && !(ch.left && ch.left.length) && ch.updated.length && ch.updated.every((p) => p.sameTab)) return;
    const me = this.me();
    const all = ch.peers.filter((p) => !p.sameTab && p.presence && p.presence.app === APP);
    // another page now runs this campaign (it took over from us): play on as a player
    if (this.phase === 'play') {
      const rival = all.find((p) => p.presence.role === 'host' && p.presence.code === this.code && outranks(p.presence.ep, p.peer, this.ep, me));
      if (rival) {
        this.demote();
        return;
      }
    }
    const players = all.filter((p) => p.presence.role === 'player');
    const peers = players.filter((p) => !p.presence.bye);
    const now = Date.now();
    let changed = false;
    // players who said goodbye: their seat opens (lobby) or the computer takes their nation at once
    for (const p of players) {
      if (!p.presence.bye) continue;
      const i = this.seats.findIndex((s) => s.peer === p.peer && s.kind === 'remote');
      if (i < 0) continue;
      const s = this.seats[i];
      if (this.phase === 'lobby') Object.assign(s, { kind: 'open', peer: null, name: '', color: null, key: null });
      else {
        Object.assign(s, { peer: null, away: true, awaySince: now });
        if (!s.managed) {
          s.managed = true;
          if (this.game) this.game.setSeatAway(i, true);
          this.toast('玩家離開', `${s.name} 離開了戰役，改由電腦接手。`, 'people');
        }
      }
      changed = true;
    }
    // a host page stepping down after a handover is still here: it becomes a player in a moment
    const present = new Set([...peers, ...all.filter((p) => p.presence.role === 'host')].map((p) => p.peer));
    // seated players who left
    this.seats.forEach((s) => {
      if (s.kind === 'remote' && s.peer && !present.has(s.peer)) {
        if (this.phase === 'lobby') {
          Object.assign(s, { kind: 'open', peer: null, name: '', color: null, key: null });
        } else if (!s.away) {
          s.away = true;
          s.awaySince = now;
          s.peer = null;
          if (!s.quiet) this.toast('玩家離線', `${s.name} 離開了房間，${AWAY_MS / 1000} 秒後由電腦代管。`, 'people');
        }
        changed = true;
      }
    });
    for (const p of peers) {
      const pr = p.presence;
      let i = this.seats.findIndex((s) => s.peer === p.peer);
      if (i < 0 && typeof pr.k === 'string') {
        // a returning player (same key) reclaims an empty seat
        i = this.seats.findIndex((s) => s.kind === 'remote' && !s.peer && s.key === pr.k);
        if (i >= 0) {
          const s = this.seats[i];
          const same = pr.sid && pr.sid === s.sid; // same page as before: keep its move counter
          const wasManaged = s.managed;
          Object.assign(s, { peer: p.peer, away: false, awaySince: 0, managed: false, lastN: same ? s.lastN || 0 : 0, sid: pr.sid || null });
          if (this.game && wasManaged) this.game.setSeatAway(i, false);
          if (!s.quiet) this.toast('玩家回來了', `${s.name} 重新連線`, 'people');
          s.quiet = false;
          changed = true;
        }
      }
      if (i < 0 && this.phase === 'lobby' && typeof pr.k === 'string' && pr.k.length < 200) {
        const open = this.seats.findIndex((s) => s.kind === 'open');
        if (open >= 0) {
          const name = cleanName(pr.name, '玩家 ' + (open + 1));
          Object.assign(this.seats[open], { kind: 'remote', peer: p.peer, name, color: this.freeColor(pr.color, open), key: pr.k, lastN: 0, away: false, sid: pr.sid || null });
          i = open;
          changed = true;
        }
      }
      if (i >= 0) {
        const s = this.seats[i];
        // how well this player's device could run the campaign, whether its page is in front, and
        // whether it has the campaign on screen yet
        s.perf = Number(pr.perf) || 0;
        s.vis = pr.vis === 0 ? 0 : 1;
        s.ready = pr.gm === 1;
        if (!s.key && typeof pr.k === 'string' && pr.k.length < 200) s.key = pr.k;
      }
      if (i >= 0 && this.phase === 'lobby') {
        const s = this.seats[i];
        const name = cleanName(pr.name, s.name);
        const color = this.freeColor(pr.color, i);
        if (name !== s.name || color !== s.color || pr.k !== s.key) {
          Object.assign(s, { name, color, key: pr.k });
          changed = true;
        }
      }
      if (i >= 0 && this.phase === 'play' && this.game && !this.handing) this.takeIntents(i, p);
    }
    this.waiting = peers.filter((p) => !this.seats.some((s) => s.peer === p.peer)).map((p) => cleanName(p.presence.name, '玩家'));
    // the backup goes to whoever is now best placed to take over
    if (this.phase === 'play' && this.state) {
      const next = this.successor();
      if ((next ? next.peer : null) !== this.bkTo) changed = true;
    }
    if (changed || this.phase === 'lobby') {
      if (this.ui && this.ui.render) this.ui.render();
      if (this.onLobby && this.phase === 'lobby') this.onLobby();
      this.publish();
    }
  }

  takeIntents(i, p) {
    const s = this.seats[i];
    const out = Array.isArray(p.presence.out) ? p.presence.out : [];
    let acted = false;
    for (const item of out) {
      if (!Array.isArray(item)) continue;
      const [n, a] = item;
      if (!Number.isInteger(n) || n <= (s.lastN || 0)) continue;
      s.lastN = n;
      acted = true;
      const action = sanitizeAction(a, i);
      const msg = action ? this.game.dispatchFrom(action) : '無效的動作';
      if (msg) this.err = [p.peer, n, String(msg).slice(0, 120)];
    }
    if (acted) this.publish();
  }

  checkAway() {
    if (this.phase !== 'play' || !this.game || this.handing) return;
    const now = Date.now();
    // a much faster device has joined in (or has its campaign on screen now): it hosts
    if (now >= (this.handAgainAt || 0)) this.handToBest();
    this.seats.forEach((s, i) => {
      if (s.kind === 'remote' && s.away && s.awaySince && now - s.awaySince > AWAY_MS && !s.managed) {
        s.managed = true;
        this.game.setSeatAway(i, true);
        this.publish();
      }
    });
  }

  setSeat(i, kind, level) {
    const s = this.seats[i];
    if (!s || s.kind === 'host') return;
    if (kind === 'open') Object.assign(s, { kind: 'open', peer: null, name: '', color: null, key: null, level: 'normal' });
    else if (kind === 'ai') {
      const usedNames = this.seats.map((x) => x.name);
      Object.assign(s, { kind: 'ai', peer: null, key: null, level: level || 'normal', name: s.kind === 'ai' ? s.name : AI_NAMES.find((n) => !usedNames.includes(n)), color: s.kind === 'ai' ? s.color : null });
      s.color = this.freeColor(s.color, i);
    }
    this.ui && this.ui.render && this.ui.render();
    this.publish();
  }

  // the island, the number of seats and the turn rule (a custom room, before the campaign starts):
  // seats are added as open seats, or taken away from the end (open and computer seats only)
  setLayout(mapId, count, turns) {
    if (this.phase !== 'lobby' || this.official) return;
    const def = mapDef(mapId);
    const lo = Math.max(3, def.players[0]);
    count = Math.min(def.players[1], Math.max(lo, count));
    const people = this.seats.filter((s) => s.kind === 'host' || s.kind === 'remote').length;
    if (people > count) {
      this.toast('席位不夠', `房間裡已經有 ${people} 位玩家，請先移除玩家再減少席位`, 'people');
      return;
    }
    while (this.seats.length > count) {
      let i = this.seats.length - 1;
      while (i > 0 && this.seats[i].kind !== 'open' && this.seats[i].kind !== 'ai') i--;
      this.seats.splice(i, 1);
    }
    while (this.seats.length < count) this.seats.push({ kind: 'open', level: 'normal' });
    this.hostSeat = Math.max(0, this.seats.findIndex((s) => s.kind === 'host'));
    this.settings.map = def.id;
    this.settings.opponents = count - 1;
    if (turns) this.settings.turns = turns;
    fitSettings(this.settings);
    this.ui && this.ui.render && this.ui.render();
    this.publish();
  }

  // the room's island and rules as the lobby shows them: mp (a map other than the standard island),
  // ru (the turn rule) — null when not set, which clears them from the presence
  layout() {
    const out = { mp: null, ru: null };
    if (this.official) return out;
    // a running campaign says it itself (this page may have taken it over from another)
    const g = this.state ? { map: this.state.map || DEFAULT_MAP, rules: this.state.rules } : gameSetup(this.settings);
    if (g.map !== DEFAULT_MAP) out.mp = g.map;
    if (g.rules && g.rules.turns) out.ru = g.rules.turns === 'sbp' ? 's' : 'p';
    return out;
  }

  lob() {
    return this.seats.map((s) => [s.kind[0], s.name || '', s.color || '', s.peer || '', s.level || 'normal', s.away ? 1 : 0]);
  }

  async start() {
    if (this.phase !== 'lobby') return;
    clearInterval(this.autoTimer);
    // fill open seats with computer players
    this.seats.forEach((s, i) => {
      if (s.kind === 'open') this.setSeat(i, 'ai', 'normal');
    });
    const players = this.seats.map((s) =>
      s.kind === 'host' ? { name: s.name, color: s.color, kind: 'human' } : s.kind === 'remote' ? { name: s.name, color: s.color, kind: 'remote' } : { name: s.name, color: s.color, kind: 'ai', ai: { level: s.level || 'normal' } },
    );
    this.phase = 'play';
    if (this.ui) this.ui.close();
    this.ui = null;
    this.game = await this.onStart(players, this.netApi());
    // the device best able to run the campaign hosts it (checked every 2 s, see checkAway)
  }

  handToBest() {
    if (this.phase !== 'play' || this.demoted || this.handing || !pageVisible() || !this.state || this.state.phase === 'over') return;
    const best = this.successor(true, true);
    if (best && best.perf > (this.perf || 0) * PERF_MARGIN) this.handover('perf');
  }

  resume(game) {
    this.phase = 'play';
    this.game = game;
    this.publish();
  }

  netApi() {
    return {
      role: 'host',
      code: this.code,
      official: this.official,
      chat: this.chat,
      onChange: (st, events) => this.broadcast(st, events),
      entropy: randomState(),
      serialize: () => ({ code: this.code, ep: this.ep, seats: this.seats.map((s) => ({ kind: s.kind, name: s.name, color: s.color, key: s.key || null, level: s.level, lastN: s.lastN || 0, sid: s.sid || null })) }),
      leave: () => this.leave(),
      peersOnline: () => 1 + this.seats.filter((s) => s.kind === 'remote' && s.peer).length,
    };
  }

  broadcast(st, events) {
    this.state = st;
    if (events && events.length) {
      const priv = {};
      st.players.forEach((p, i) => {
        if (p.kind === 'remote' || this.seats[i].kind === 'remote') priv[i] = C.privateDetails(events, i);
      });
      this.history.push({ s: st.seq, ev: events.map((e) => C.encodeEvent(e) || 0), priv });
      while (this.history.length > 10) this.history.shift();
    }
    this.publish();
  }

  publish() {
    if (this.phase === 'closed' || this.demoted) return;
    this.dirty = true;
    if (this.publishing) return;
    this.publishing = (async () => {
      while (this.dirty && !this.demoted && this.phase !== 'closed') {
        // a burst of moves (quick computer turns) goes out as one update, at most about 8 a second
        const wait = (this.lastPublish || 0) + 120 - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.dirty = false;
        this.lastPublish = Date.now();
        try {
          await this.publishNow();
        } catch (e) {
          console.warn('publish failed', e);
        }
      }
      this.publishing = null;
    })();
  }

  // the player who takes over if this page goes away: a seated player who is here, preferably with
  // the campaign on screen and the page in front, then the fastest device
  successor(visibleOnly = false, readyOnly = false) {
    let best = null;
    const rank = (c) => c.ready * 4 + c.vis * 2;
    this.seats.forEach((s, i) => {
      if (s.kind !== 'remote' || !s.peer || s.away || s.managed || !s.key) return;
      if (visibleOnly && s.vis === 0) return;
      if (readyOnly && !s.ready) return;
      const c = { i, peer: s.peer, key: s.key, perf: s.perf || 0, vis: s.vis === 0 ? 0 : 1, ready: s.ready ? 1 : 0 };
      if (!best || rank(c) > rank(best) || (rank(c) === rank(best) && c.perf > best.perf)) best = c;
    });
    return best;
  }

  // what the next host needs about each seat beyond the public lobby list (keys only for players
  // who are away: the others' keys are in their own presence)
  seatMeta() {
    return this.seats.map((s) => (s.kind === 'remote' ? [s.away || !s.peer ? s.key || 0 : 0, s.lastN || 0, s.sid || 0, s.managed ? 1 : 0] : 0));
  }

  async publishNow() {
    const hs = this.seats[this.hostSeat];
    hs.peer = this.me();
    const lob = this.lob();
    const open = this.seats.filter((s) => s.kind === 'open').length;
    const rem = this.remaining();
    // the room listing in the lobby only changes with seats and phase: send it only when it does
    const listing = { code: this.code, nm: hs.name, n: this.seats.length, f: open, st: this.phase, off: this.official ? 1 : 0, ts: this.createdAt };
    const lay = this.layout();
    if (lay.mp) listing.mp = lay.mp;
    if (this.mapSeed != null) listing.ms = this.mapSeed >>> 0;
    const lk = JSON.stringify(listing);
    if (lk !== this.listingKey || (rem != null && Date.now() - (this.listingAt || 0) > 5000)) {
      this.listingKey = lk;
      this.listingAt = Date.now();
      this.lobby.presence({ app: APP, v: V, host: { ...listing, rem } }).catch(() => {});
    }
    if (this.phase === 'lobby' || !this.state) {
      await this.ch.presence({ app: APP, v: V, role: 'host', code: this.code, k: this.keys.pubB64, st: this.phase, lob, tv: this.settings.target || 10, off: this.official ? 1 : 0, rem, ep: this.ep, ...lay });
      return;
    }
    const st = this.state;
    const px = {};
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (s.kind !== 'remote' || !s.key) continue;
      const key = await sharedKey(this.keys.priv, s.key);
      const x = [];
      for (const h of this.history) for (const d of h.priv[i] || []) x.push([h.s, ...d]);
      px['s' + i] = await seal(key, { ...C.encodePrivate(st, i), x });
    }
    // the whole game, sealed for the player who takes over if this page goes away
    let bk = null;
    const to = this.handing ? this.seats.find((s) => s.peer === this.handing.to) : this.successor();
    if (to && to.key && st.phase !== 'over') {
      const key = await sharedKey(this.keys.priv, to.key);
      bk = { to: to.peer, b: await seal(key, { f: C.encodeFull(st), m: this.seatMeta() }) };
    }
    this.bkTo = bk ? bk.to : null;
    const ho = this.handing ? { to: this.handing.to, at: this.handing.at, bye: this.handing.bye ? 1 : 0 } : null;
    const dl = this.game && this.game.clockLeft ? this.game.clockLeft() : null;
    const ack = this.seats.filter((s) => s.kind === 'remote' && s.peer).map((s) => [s.peer, s.lastN || 0]);
    const base = { app: APP, v: V, role: 'host', code: this.code, k: this.keys.pubB64, st: 'play', lob, bd: C.encodeBoard(st), ps: C.encodeSeats(st), pub: C.encodePublic(st), px, ack, err: this.err, ep: this.ep, pn: ++this.pn, hn: hs.name, hc: hs.color, bk, ho, dl, tv: this.settings.target || 10, off: this.official ? 1 : 0, mp: null, ru: null };
    if (this.becoming) for (const k of PLAYER_KEYS) base[k] = null;
    // the presence holds this page's chat lines too
    const budget = PRESENCE_BUDGET - (this.chat.items.length ? C.utf8Size({ chat: this.chat.items.map(([n, t]) => [n, t]) }) : 0);
    let ev = this.history.map((h) => [h.s, h.ev]);
    let pres = { ...base, ev };
    while (C.utf8Size(pres) > budget && ev.length > 1) {
      ev = ev.slice(1);
      pres = { ...base, ev };
    }
    if (C.utf8Size(pres) > budget) pres = { ...base, ev: [] };
    if (C.utf8Size(pres) > budget && pres.bk) pres = { ...pres, bk: null }; // the backup waits for a smaller update
    if (typeof window !== 'undefined') window.__presSize = Math.max(window.__presSize || 0, C.utf8Size(pres));
    await this.ch.presence(pres);
    this.becoming = false;
  }

  // Hand the campaign to another player's page: freeze it here, send that page the whole game and
  // wait until it hosts (this page then steps down). reason: 'perf' (a faster device), 'hidden'
  // (this page went to the background), 'leave' (the host is leaving the campaign).
  handover(reason) {
    if (this.phase !== 'play' || this.demoted || this.handing || !this.state || this.state.phase === 'over') return false;
    if (reason === 'hidden' && pageVisible()) return false;
    const to = this.successor(reason !== 'leave', reason !== 'leave') || (reason === 'leave' ? this.successor() : null);
    if (!to) return false;
    this.handing = { to: to.peer, at: this.ep + 1, bye: reason === 'leave', reason };
    if (this.game && !this.game.destroyed) this.game.freeze(true, '主持人交接中…');
    this.publish();
    clearTimeout(this.handTimer);
    this.handTimer = setTimeout(() => this.cancelHandover(), HANDOVER_MS);
    return true;
  }

  cancelHandover() {
    if (!this.handing || this.demoted) return;
    this.handing = null;
    this.handAgainAt = Date.now() + RETRY_MS;
    if (this.game && !this.game.destroyed) this.game.freeze(false);
    this.publish();
  }

  // the page is going away (closed, reloaded, frozen): no time to wait, point the player who already
  // holds the latest backup at it
  handoverNow() {
    if (this.phase !== 'play' || this.demoted || !this.bkTo || !this.state || this.state.phase === 'over') return;
    try {
      this.ch.presence({ ho: { to: this.bkTo, at: this.ep + 1, bye: 0 } }).catch(() => {});
    } catch {
      /* the page is closing */
    }
    // a reload comes back as a player: the other page hosts by then
    rememberRoom(this.code, 'client');
  }

  watchPage() {
    if (typeof document === 'undefined' || this.unwatchPage) return;
    const onVis = () => {
      clearTimeout(this.hideTimer);
      if (pageVisible()) return;
      this.hideTimer = setTimeout(() => this.handover('hidden'), isTouchDevice() ? 0 : HIDE_MS);
    };
    const onGone = () => this.handoverNow();
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('freeze', onGone);
    window.addEventListener('pagehide', onGone);
    this.unwatchPage = () => {
      clearTimeout(this.hideTimer);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('freeze', onGone);
      window.removeEventListener('pagehide', onGone);
      this.unwatchPage = null;
    };
  }

  stopTimers() {
    clearInterval(this.awayTimer);
    clearInterval(this.autoTimer);
    clearTimeout(this.handTimer);
    if (this.unwatchPage) this.unwatchPage();
    if (this.unsub) this.unsub();
    if (this.connUnsub) this.connUnsub();
    this.unsub = null;
    this.connUnsub = null;
  }

  // another page runs the campaign now: stop here and hand this page's room channel on
  demote() {
    if (this.demoted) return;
    this.demoted = true;
    this.phase = 'closed';
    this.stopTimers();
    this.lobby.presence({ host: null }).catch(() => {});
    this.handing = null;
    if (this.afterHandover) {
      // the host was leaving the campaign: done
      this.afterHandover();
      return;
    }
    if (this.onDemoted) this.onDemoted({ room: this.room, ch: this.ch, keys: this.keys, code: this.code, chat: this.chat });
    else this.ch.leave().catch(() => {});
  }

  async leave() {
    if (this.leaving) return this.leaving;
    // stepped down: the room channel is the player session's now
    if (this.demoted && !this.afterHandover) return undefined;
    this.leaving = (async () => {
      // the others play on: hand the campaign to one of them first
      if (this.phase === 'play' && !this.demoted && this.handover('leave')) {
        await new Promise((resolve) => {
          this.afterHandover = resolve;
          setTimeout(resolve, LEAVE_WAIT_MS);
        });
      }
      this.stopTimers();
      this.phase = 'closed';
      forgetRoom();
      try {
        await this.lobby.presence({ host: null });
      } catch {
        /* already gone */
      }
      this.chat.close();
      try {
        await this.ch.leave();
      } catch {
        /* already gone */
      }
      if (this.ui) this.ui.close();
    })();
    return this.leaving;
  }

  showLobby() {
    const scr = el('div', 'menu-screen online-screen');
    scr.innerHTML = `<div class="title-block"><div class="eyebrow">Online Room</div><h1>線上房間<span>等待其他國家加入</span></h1><p>${selfHosted() ? '把邀請連結傳給朋友，打開就會進到這個房間；也可以在「線上對戰」輸入下方的房間代碼，或從房間列表加入。' : '請朋友開啟這個頁面，選「線上對戰」後輸入下方的房間代碼，或直接從房間列表加入。'}空著的席位會由電腦補上。</p></div>
      <div class="setup-card panel"><div class="modal-head"><h3>房間 <span class="code"></span></h3></div><div class="modal-body"></div><div class="modal-foot"></div></div>`;
    scr.querySelector('.code').textContent = this.code.toUpperCase();
    const body = scr.querySelector('.modal-body');
    const foot = scr.querySelector('.modal-foot');
    const render = () => {
      const me = this.me();
      body.innerHTML = `<div class="code-box"><span class="lbl">房間代碼</span><b class="num">${this.code.toUpperCase()}</b></div><div class="room-layout"></div><div class="row-label">席位</div><div class="seat-list"></div><div class="waiting"></div>`;
      // the island and how many play (and on the large island, how the turn is shared)
      const lay = body.querySelector('.room-layout');
      const cur = mapDef(this.settings.map);
      const segRow = (label, opts, on, pick) => {
        const row = el('div', 'layout-row');
        row.appendChild(el('span', 'row-label', label));
        const seg = el('div', 'seg');
        for (const [val, text] of opts) {
          const b = el('button', val === on ? 'on' : '', text);
          b.type = 'button';
          b.addEventListener('click', () => val !== on && pick(val));
          seg.appendChild(b);
        }
        row.appendChild(seg);
        lay.appendChild(row);
      };
      segRow('地圖', MAP_LIST.map((d) => [d.id, d.name]), cur.id, (id) => this.setLayout(id, mapDef(id).players[1], this.settings.turns));
      const lo = Math.max(3, cur.players[0]);
      const counts = [];
      for (let n = lo; n <= cur.players[1]; n++) counts.push([n, `${n} 席`]);
      segRow('人數', counts, this.seats.length, (n) => this.setLayout(cur.id, n, this.settings.turns));
      if (cur.rules && cur.rules.turns)
        segRow(
          '回合規則',
          [
            ['paired', '配對回合'],
            ['sbp', '特別建造階段'],
          ],
          this.settings.turns === 'sbp' ? 'sbp' : 'paired',
          (t) => this.setLayout(cur.id, this.seats.length, t),
        );
      const box = body.querySelector('.code-box');
      const link = selfHosted();
      const copy = btn(link ? '複製邀請連結' : '複製代碼', 'ghost', () => {
        const t = link ? inviteLink(this.code) : this.code.toUpperCase();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(
            () => this.toast('已複製', link ? '邀請連結已複製，傳給朋友就能加入' : '房間代碼 ' + t, 'check'),
            () => this.toast('無法複製', link ? t : '請手動抄下房間代碼', 'cards'),
          );
        } else if (link) this.toast('邀請連結', t, 'cards');
      });
      box.appendChild(copy);
      const list = body.querySelector('.seat-list');
      list.innerHTML = seatRows(this.seats, me, {
        controls: (s, i) => {
          if (s.kind === 'host') return '';
          if (s.kind === 'remote') return `<button class="btn ghost" data-act="kick" data-i="${i}" type="button">移除</button>`;
          return `<select data-i="${i}" aria-label="席位 ${i + 1}"><option value="open"${s.kind === 'open' ? ' selected' : ''}>開放給玩家</option><option value="ai:easy"${s.kind === 'ai' && s.level === 'easy' ? ' selected' : ''}>電腦·簡單</option><option value="ai:normal"${s.kind === 'ai' && s.level === 'normal' ? ' selected' : ''}>電腦·普通</option><option value="ai:hard"${s.kind === 'ai' && s.level === 'hard' ? ' selected' : ''}>電腦·困難</option></select>`;
        },
      });
      list.querySelectorAll('select').forEach((sel) =>
        sel.addEventListener('change', () => {
          const i = Number(sel.dataset.i);
          if (sel.value === 'open') this.setSeat(i, 'open');
          else this.setSeat(i, 'ai', sel.value.split(':')[1]);
        }),
      );
      list.querySelectorAll('[data-act="kick"]').forEach((b) => b.addEventListener('click', () => this.setSeat(Number(b.dataset.i), 'open')));
      const w = body.querySelector('.waiting');
      if (this.waiting && this.waiting.length) w.innerHTML = `<p class="lead" style="margin-top:10px">已滿座，觀望中：${this.waiting.map(esc).join('、')}</p>`;
      const humans = this.seats.filter((s) => s.kind === 'remote').length;
      startBtn.textContent = humans ? `開始戰役（${humans + 1} 位玩家）` : '開始戰役（只有你和電腦）';
    };
    const leave = btn('離開房間', '', async () => {
      await this.leave();
      this.onLeave && this.onLeave();
    });
    const startBtn = btn('開始戰役', 'primary', () => this.start());
    foot.append(leave, startBtn);
    this.app.appendChild(scr);
    this.ui = { render, close: () => scr.remove() };
    render();
  }
}

// ───────────────────────── client ─────────────────────────

export class ClientSession {
  // attach: { room, ch, keys } — a page that hosted this campaign until another page took over keeps
  // its room channel and plays on as a player
  constructor({ app, settings, code, onGame, onLeave, toast, quiet = false, onLobby = null, onHostLost = null, noSpectate = false, attach = null, chat = null, onTakeover = null }) {
    this.app = app;
    this.settings = settings;
    this.code = normCode(code);
    this.onGame = onGame;
    this.onLeave = onLeave;
    this.toast = toast || (() => {});
    this.quiet = quiet;
    this.onLobby = onLobby;
    this.onHostLost = onHostLost;
    this.noSpectate = noSpectate;
    this.attach = attach;
    this.chat = chat || new Chat();
    this.onTakeover = onTakeover; // this page is to run the campaign now
    this.n = 0;
    this.out = [];
    this.lastSeq = -1;
    this.game = null;
    this.queue = Promise.resolve();
    this.hostSeen = false;
    this.lastErr = null;
    // this tab sat in this room before (reload, new version): expect to get the seat back
    const prev = rememberedRoom();
    this.returning = !!attach || !!(prev && prev.role === 'client' && prev.code === this.code);
    this.claimLeft = null;
    this.claimTimer = null;
    this.hostPeer = null;
    this.hostEp = 0;
    this.backup = null; // the latest host update that names this page as the next host
    this.goneMs = 0;
    this.stallMs = 0;
    this.seqAt = Date.now();
    this.lob = [];
  }

  async open() {
    if (this.attach) {
      this.room = this.attach.room;
      this.ch = this.attach.ch;
      this.keys = this.attach.keys;
    } else {
      const sup = await onlineSupport();
      if (!sup.ok) throw new Error(supportError(sup.why));
      this.room = sup.room;
      this.ch = wrap(await this.room.join(PREFIX + this.code));
      this.keys = await loadKeyPair();
    }
    this.sid = makeCode() + makeCode();
    this.perf = perfScore();
    const pres = { app: APP, v: V, role: 'player', name: cleanName(this.settings.name, '玩家'), color: this.settings.color, k: this.keys.pubB64, sid: this.sid, out: [], perf: this.perf, vis: pageVisible() ? 1 : 0 };
    if (this.attach) for (const k of HOST_KEYS) pres[k] = null; // this page hosted until now
    await this.ch.presence(pres);
    rememberRoom(this.code, 'client');
    this.chat.bind(this.ch, (peer, pr) => this.whoIs(peer, pr));
    this.unsub = this.ch.onPeers((ch) => this.onPeers(ch));
    this.watchPage();
    this.watchTimer = setInterval(() => this.watchHost(), 1000);
    if (!this.quiet) this.showWaiting();
    if (this.attach) this.onPeers({ peers: this.ch.peers(), joined: [], left: [], updated: [] });
    this.hostTimer = setTimeout(() => {
      if (this.hostSeen) return;
      if (this.ui) this.ui.status('找不到這個房間的主持人。請確認代碼，或請主持人重新開房。');
      if (this.onHostLost) this.onHostLost();
    }, 8000);
  }

  me() {
    return this.ch.me();
  }

  whoIs(peer, pr) {
    const s = this.lob.find((x) => x.peer === peer && x.kind !== 'open');
    if (s) return { name: s.name, color: s.color };
    return { name: `${cleanName(pr && pr.name, '觀戰者')}（觀戰）`, color: null };
  }

  // the host hands the campaign to a page in front: say when this page goes to the background
  watchPage() {
    if (typeof document === 'undefined') return;
    let sent = pageVisible() ? 1 : 0;
    let t = null;
    this.onVis = () => {
      clearTimeout(t);
      // a quick look at another tab changes nothing
      t = setTimeout(() => {
        const v = pageVisible() ? 1 : 0;
        if (v === sent || this.closed) return;
        sent = v;
        this.ch.presence({ vis: v }).catch(() => {});
      }, 2000);
    };
    document.addEventListener('visibilitychange', this.onVis);
  }

  // the host of this room: of the pages hosting it, the newest claim
  findHost(peers) {
    let host = null;
    for (const p of peers) {
      if (p.sameTab || !p.presence || p.presence.app !== APP || p.presence.role !== 'host' || p.presence.code !== this.code) continue;
      if (!host || outranks(p.presence.ep, p.peer, host.presence.ep, host.peer)) host = p;
    }
    return host;
  }

  onPeers(ch) {
    if (this.closed) return;
    if (ch.error) {
      this.toast('連線中斷', '房間連線已結束。', 'cross');
      return;
    }
    this.chat.receive(ch.peers);
    const host = this.findHost(ch.peers);
    if (!host) {
      if (this.hostSeen && this.game) this.game.setNetStatus(this.backup ? '主持人離線，準備由你接手…' : '主持人離線，等待重新連線或由其他玩家接手…');
      if (this.hostSeen && !this.game && this.onHostLost && !this.lostTimer) {
        // the room closed before the campaign started
        this.lostTimer = setTimeout(() => {
          this.lostTimer = null;
          const back = this.findHost(this.ch.peers());
          if (!back && !this.game) this.onHostLost();
        }, 3000);
      }
      return;
    }
    if (!this.hostSeen) clearTimeout(this.hostTimer);
    this.hostSeen = true;
    this.hostPeer = host.peer;
    if (host.presence === this.lastPres) return;
    this.lastPres = host.presence;
    const me = this.me();
    this.queue = this.queue.then(() => this.handleHost(host.presence, me)).catch((e) => console.error(e));
  }

  async handleHost(pr, me) {
    if (this.closed) return;
    // before the game exists, act only on the newest presence from the host (a newer one is queued)
    if (!this.game && this.lastPres && pr !== this.lastPres) return;
    const seats = decodeLob(pr.lob);
    this.lob = seats;
    const seat = seats.findIndex((s) => s.peer === me);
    this.seat = seat;
    if (pr.st !== 'play' || !pr.pub) {
      if (this.ui) this.ui.render(seats, seat, { mp: pr.mp || null, ru: pr.ru || null, tv: pr.tv });
      if (this.onLobby) this.onLobby(seats, seat, typeof pr.rem === 'number' ? pr.rem : null, Date.now());
      return;
    }
    // this page is next in line: keep the sealed game it is sent, and take over when asked (an update
    // without a backup, too big to carry one, leaves the last one in place)
    if (this.hostEp && (Number(pr.ep) || 1) !== this.hostEp) this.backup = null;
    if (pr.bk) this.backup = pr.bk.to === me && seat >= 0 ? { pr, at: Date.now() } : null;
    if (pr.ho && pr.ho.to === me && this.backup && this.onTakeover) {
      this.takeover(true);
      return;
    }
    let priv = null;
    if (seat < 0 && !this.game && this.waitForSeat(seats)) return;
    if (seat < 0 && this.noSpectate && !this.game) {
      // matchmaking players never end up watching someone else's room
      if (this.onHostLost) this.onHostLost();
      return;
    }
    if (seat >= 0) {
      const key = await sharedKey(this.keys.priv, pr.k);
      const blob = pr.px && pr.px['s' + seat];
      if (blob) {
        try {
          priv = await open(key, blob);
        } catch {
          priv = null;
        }
      }
      if (!priv) return;
    } else if (!this.game && this.ui) this.ui.status('戰役已經開始而且沒有空位，以觀戰模式進入…');
    const seatInfo = C.decodeSeats(pr.ps);
    let view;
    try {
      view = C.decodeView(pr.bd, seatInfo, pr.pub, priv, seat);
    } catch (e) {
      // this page lays the island out differently from the host's: another version of the game
      if (!(e instanceof C.BoardMismatch)) throw e;
      if (!this.mismatch) {
        this.mismatch = true;
        this.toast('版本不同', e.message, 'cross');
        if (this.ui) this.ui.status(e.message);
      }
      return;
    }
    const players = seatInfo.map((s, i) => ({ ...s, away: seats[i] && seats[i].away }));
    const evs = [];
    if (this.game) {
      for (const [s, list] of pr.ev || []) {
        if (s <= this.lastSeq) continue;
        const decoded = (list || []).map((a) => (Array.isArray(a) ? C.decodeEvent(a) : null));
        const det = ((priv && priv.x) || []).filter((x) => x[0] === s).map((x) => x.slice(1));
        C.applyPrivateDetails(decoded, det);
        for (const e of decoded) if (e) evs.push(e);
      }
    }
    if (pr.pub.s !== this.lastSeq) this.seqAt = Date.now();
    this.lastSeq = pr.pub.s;
    const ack = (pr.ack || []).find((a) => a[0] === me);
    if (ack) {
      const before = this.out.length;
      this.out = this.out.filter((o) => o[0] > ack[1]);
      if (this.out.length !== before) this.ch.presence({ out: this.out.map((o) => [o[0], o[1]]) }).catch(() => {});
    }
    if (pr.err && pr.err[0] === me && pr.err[1] !== this.lastErr) {
      this.lastErr = pr.err[1];
      this.toast('無法執行', pr.err[2], 'cross');
    }
    const ep = Number(pr.ep) || 1;
    const hostName = cleanName(pr.hn, '另一位玩家');
    if (!this.game) {
      this.hostEp = ep;
      if (this.ui) this.ui.close();
      this.ui = null;
      this.game = await this.onGame(view, players, this.netApi(seat, view));
      this.seqAt = Date.now();
      // ready to run the campaign if it comes to that
      if (seat >= 0) this.ch.presence({ gm: 1 }).catch(() => {});
      if (this.game && this.game.setRemoteClock) this.game.setRemoteClock(pr.dl, pr.pn);
      // this page hosted until now: say who runs the campaign
      if (this.attach && this.game) this.game.hud.log(`主持改由 <b>${esc(hostName)}</b> 的電腦負責`, { hl: true });
    } else {
      if (ep !== this.hostEp) {
        this.hostEp = ep;
        this.game.hud.log(`主持改由 <b>${esc(hostName)}</b> 的電腦負責`, { hl: true });
      }
      this.game.setNetStatus(null);
      if (this.game.setRemoteClock) this.game.setRemoteClock(pr.dl, pr.pn);
      this.game.applyRemote(view, evs, players);
    }
  }

  // has the host stopped answering? (only the next host checks: it is the one who can do something)
  hostStalled() {
    const g = this.game;
    const v = g && g.state;
    if (!v || v.phase === 'over') return false;
    const now = Date.now();
    const quiet = now - this.seqAt;
    // this page's own move has gone unanswered
    if (this.out.length && now - this.out[0][2] > 8000 && quiet > 8000) return true;
    // only the computer is to move (nobody else is being waited on): the host plays it within seconds
    const actors = actorsNow(v);
    const byComputer = (p) => g.players[p] && g.players[p].kind === 'ai';
    if (quiet > 8000 && actors.length && actors.every(byComputer)) return true;
    // the turn clock ran out and the host did nothing about it
    if (g.deadline && now > g.deadline + 8000 && quiet > 8000) return true;
    return false;
  }

  // every second: the next host takes over when the host's page has been gone (or silent) too long.
  // Time the page itself was frozen doesn't count.
  watchHost() {
    if (this.closed || this.taking) return;
    const now = performance.now();
    const dt = Math.min(1500, now - (this.watchAt || now));
    this.watchAt = now;
    if (!this.backup || !this.game || !this.onTakeover) {
      this.goneMs = 0;
      this.stallMs = 0;
      return;
    }
    const here = this.findHost(this.ch.peers());
    this.goneMs = here ? 0 : this.goneMs + dt;
    this.stallMs = here && this.hostStalled() ? this.stallMs + dt : 0;
    if (this.goneMs >= FAILOVER_MS || this.stallMs >= STALL_MS) this.takeover(false);
  }

  // Run the campaign from the last game the host sent this page. planned: the host asked for it.
  async takeover(planned) {
    if (this.taking || this.closed || !this.backup) return;
    this.taking = true;
    const { pr, at } = this.backup;
    try {
      const me = this.me();
      const key = await sharedKey(this.keys.priv, pr.k);
      const data = await open(key, pr.bk.b);
      const state = C.decodeFull(pr.bd, C.decodeSeats(pr.ps), pr.pub, data.f);
      const lob = decodeLob(pr.lob);
      const meta = Array.isArray(data.m) ? data.m : [];
      const hostSeat = lob.findIndex((s) => s.peer === me);
      if (hostSeat < 0) throw new Error('no seat');
      const bye = !!(planned && pr.ho && pr.ho.bye);
      const oldHost = lob.findIndex((s) => s.kind === 'host');
      const keyOf = (peer) => {
        const p = peer && this.ch.peers().find((x) => x.peer === peer);
        return p && p.presence && typeof p.presence.k === 'string' ? p.presence.k : null;
      };
      const now = Date.now();
      const seats = lob.map((s, i) => {
        const m = Array.isArray(meta[i]) ? meta[i] : null;
        if (i === hostSeat) return { kind: 'host', name: s.name, color: s.color, peer: me };
        if (i === oldHost) {
          // the page that hosted: a player now (it steps down when it sees this page hosting)
          const here = planned && !bye;
          return { kind: 'remote', name: s.name, color: s.color, key: pr.k, peer: here ? this.hostPeer : null, away: !here, awaySince: now, managed: bye, lastN: 0, sid: null, quiet: true };
        }
        if (s.kind === 'remote') {
          return { kind: 'remote', name: s.name, color: s.color, key: (m && m[0]) || keyOf(s.peer), lastN: (m && m[1]) || 0, sid: (m && m[2]) || null, managed: !!(m && m[3]), peer: s.away ? null : s.peer || null, away: s.away || !s.peer, awaySince: s.away || !s.peer ? now : 0 };
        }
        return { kind: 'ai', name: s.name, color: s.color, level: s.level || 'normal' };
      });
      state.players.forEach((p, i) => {
        const s = seats[i];
        if (s.kind === 'host') {
          p.kind = 'human';
          p.ai = null;
        } else if (s.kind === 'remote') {
          p.kind = s.managed ? 'ai' : 'remote';
          p.ai = s.managed ? { level: 'normal' } : null;
        }
      });
      const dl = typeof pr.dl === 'number' ? Math.max(0, pr.dl - (Date.now() - at)) : null;
      this.stop();
      this.onTakeover({ room: this.room, ch: this.ch, keys: this.keys, code: this.code, ep: planned && pr.ho ? Number(pr.ho.at) || (Number(pr.ep) || 1) + 1 : (Number(pr.ep) || 1) + 1, seats, hostSeat, state, official: !!pr.off, target: Number(pr.tv) || 10, dl, chat: this.chat, planned, oldHostName: oldHost >= 0 ? lob[oldHost].name : '' });
    } catch (e) {
      console.warn('takeover failed', e);
      this.backup = null;
      this.taking = false;
    }
  }

  // A player coming back (reload, new version, dropped connection) may hear from the host before the host
  // has seen it return, while its seat still waits for it. Give the host a few seconds to hand the seat
  // back instead of settling for watching the game.
  waitForSeat(seats) {
    const now = performance.now();
    if (this.claimLeft == null) {
      const reclaimable = seats.some((s) => s.kind === 'remote' && (s.away || !s.peer));
      if (!this.returning && !reclaimable) return false;
      this.claimLeft = 6000;
      this.claimAt = now;
    }
    // count only time the page was actually running (a stalled page hears the host late, not never)
    this.claimLeft -= Math.min(now - this.claimAt, 1000);
    this.claimAt = now;
    if (this.claimLeft <= 0) return false;
    if (this.ui) this.ui.status('正在取回你的席位…');
    clearTimeout(this.claimTimer);
    this.claimTimer = setTimeout(() => {
      if (this.game || this.closed || !this.lastPres) return;
      const pres = this.lastPres;
      this.queue = this.queue.then(() => this.handleHost(pres, this.me())).catch((e) => console.error(e));
    }, 600);
    return true;
  }

  netApi(seat, view) {
    return {
      role: 'client',
      code: this.code,
      official: !!(this.lastPres && this.lastPres.off),
      seat,
      view,
      chat: this.chat,
      send: (action) => this.send(action),
      busy: () => this.out.length > 0 && Date.now() - this.out[this.out.length - 1][2] < 3500,
      leave: () => this.leave(),
    };
  }

  send(action) {
    const a = JSON.parse(JSON.stringify(action));
    delete a.p;
    const sig = JSON.stringify(a);
    if (this.out.some((o) => JSON.stringify(o[1]) === sig && Date.now() - o[2] < 2500)) return false;
    this.n++;
    this.out.push([this.n, a, Date.now()]);
    while (this.out.length > 6) this.out.shift();
    this.ch.presence({ out: this.out.map((o) => [o[0], o[1]]) }).catch((e) => {
      this.toast('傳送失敗', '動作沒有送出，請再試一次。', 'cross');
      console.warn(e);
    });
    return true;
  }

  // stop acting as a player on this channel (leaving, or becoming the host)
  stop() {
    clearTimeout(this.hostTimer);
    clearTimeout(this.lostTimer);
    clearTimeout(this.claimTimer);
    clearInterval(this.watchTimer);
    if (this.onVis) document.removeEventListener('visibilitychange', this.onVis);
    this.closed = true;
    if (this.unsub) this.unsub();
    this.unsub = null;
    if (this.ui) this.ui.close();
    this.ui = null;
  }

  async leave() {
    if (this.closed && this.left) return;
    // this page took the campaign over: the room channel is the host session's now
    if (this.taking) return;
    this.left = true;
    this.stop();
    forgetRoom();
    // tell the host this is a goodbye: the computer takes the nation over at once
    try {
      await this.ch.presence({ bye: 1, out: [] });
    } catch {
      /* already gone */
    }
    this.chat.close();
    try {
      await this.ch.leave();
    } catch {
      /* already gone */
    }
  }
  showWaiting() {
    const scr = el('div', 'menu-screen online-screen');
    scr.innerHTML = `<div class="title-block"><div class="eyebrow">Online Room</div><h1>線上房間<span>${esc(this.code.toUpperCase())}</span></h1><p>已進入房間。主持人按下「開始戰役」後，地圖會自動出現。</p></div>
      <div class="setup-card panel"><div class="modal-head"><h3>房間 ${esc(this.code.toUpperCase())}</h3></div><div class="modal-body"><p class="lead status">正在尋找主持人…</p><div class="seat-list"></div></div><div class="modal-foot"></div></div>`;
    const foot = scr.querySelector('.modal-foot');
    foot.appendChild(
      btn('離開房間', '', async () => {
        await this.leave();
        this.onLeave && this.onLeave();
      }),
    );
    this.app.appendChild(scr);
    const statusEl = scr.querySelector('.status');
    const list = scr.querySelector('.seat-list');
    const termsEl = el('p', 'lead room-terms');
    list.before(termsEl);
    this.ui = {
      render: (seats, seat, lay = {}) => {
        // before the host has seen us arrive there may still be open seats: we are about to get one
        const open = seats.some((s) => s.kind === 'open');
        statusEl.textContent = seat >= 0 ? `你坐在第 ${seat + 1} 席，等待主持人開始戰役…` : open ? '正在取得席位…' : '席位已滿，目前在旁觀望。';
        termsEl.innerHTML = roomTerms(lay.mp, lay.ru, seats.length, lay.tv);
        list.innerHTML = seatRows(seats, this.me());
      },
      status: (t) => (statusEl.textContent = t),
      close: () => scr.remove(),
    };
  }
}

// ───────────────────────── official matchmaking ─────────────────────────
// Everyone who presses "quick match" shows up in the shared lobby. If an official room is open
// and has a free seat, join it (the longest-standing one wins). Otherwise the player who has been
// waiting longest opens one; the others see it appear and join. A room starts as soon as it has
// 4 players, or after the countdown with computer players in the empty seats.

export class MatchSession {
  // onState: the home screen shows the matchmaking itself (no screen of its own); it gets
  // { phase, code, seats, seat, rem } on every change
  constructor({ app, settings, toast, onHostStart, onClientGame, onLeave, onState = null, seconds = 60, mapSeed = null, onTakeover = null, onDemoted = null }) {
    this.app = app;
    this.onTakeover = onTakeover; // the campaign moves to this page / away from it (see HostSession)
    this.onDemoted = onDemoted;
    this.settings = settings;
    this.mapSeed = mapSeed;
    this.onState = onState;
    this.toast = toast || (() => {});
    this.onHostStart = onHostStart;
    this.onClientGame = onClientGame;
    this.onLeave = onLeave;
    this.seconds = seconds;
    this.state = 'idle';
    this.host = null;
    this.client = null;
    this.busy = false;
    this.closed = false;
    this.lobbyView = null; // what a joined player last heard from its official host
  }

  async open() {
    const sup = await onlineSupport();
    if (this.closed) return; // cancelled while connecting
    if (!sup.ok) throw new Error(supportError(sup.why));
    this.room = sup.room;
    this.lobby = wrap(this.room);
    this.name = cleanName(this.settings.name, '玩家');
    this.qt = Date.now();
    if (!this.onState) this.showUI();
    await this.lobby.presence({ app: APP, v: V, mm: { t: this.qt, nm: this.name } });
    if (this.closed) {
      this.lobby.presence({ mm: null }).catch(() => {});
      return;
    }
    this.state = 'searching';
    this.unsub = this.lobby.onPeers(() => this.evaluate());
    this.tick = setInterval(() => {
      this.evaluate();
      this.render();
    }, 1000);
    this.evaluate();
    this.render();
  }

  peers() {
    return this.lobby.peers().filter((p) => p.presence && p.presence.app === APP);
  }

  // open official rooms, best first: oldest, then smallest code
  officialRooms() {
    return this.peers()
      .filter((p) => p.presence.host && p.presence.host.off === 1 && p.presence.host.st === 'lobby' && typeof p.presence.host.code === 'string')
      .map((p) => ({ me: p.sameTab, code: p.presence.host.code, ts: Number(p.presence.host.ts) || 0, f: Number(p.presence.host.f) || 0, nm: p.presence.host.nm }))
      .sort((a, b) => a.ts - b.ts || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }

  better(a, b) {
    return a.ts < b.ts || (a.ts === b.ts && a.code < b.code);
  }

  async evaluate() {
    if (this.busy || this.closed || this.state === 'playing') return;
    const rooms = this.officialRooms();
    try {
      if (this.state === 'hosting') {
        if (!this.host || this.host.phase !== 'lobby') return;
        const mine = { ts: this.host.createdAt, code: this.host.code };
        const rival = rooms.find((r) => !r.me && r.f > 0 && this.better(r, mine));
        if (rival) {
          // an older official room is open: fold ours into it
          this.busy = true;
          const h = this.host;
          this.host = null;
          await h.leave();
          await this.join(rival.code);
        }
        return;
      }
      if (this.state === 'joined') {
        // the room filled up before the host gave us a seat: look again
        if (this.lobbyView && this.lobbyView.seat < 0 && Date.now() - this.joinedAt > 8000 && !this.client.game) {
          await this.backToSearch(true);
          return;
        }
        const cur = rooms.find((r) => r.code === this.client.code);
        const best = rooms.find((r) => !r.me && r.f > 0);
        if (cur && best && best.code !== cur.code && this.better(best, cur) && !this.client.game) {
          this.busy = true;
          const c = this.client;
          this.client = null;
          await c.leave();
          await this.join(best.code);
        }
        return;
      }
      if (this.state === 'searching') {
        const target = rooms.find((r) => !r.me && r.f > 0);
        if (target) {
          this.busy = true;
          await this.join(target.code);
          return;
        }
        // nobody is hosting: the player waiting longest opens the official room
        const searchers = this.peers()
          .filter((p) => p.presence.mm && !p.presence.mm.in && !(p.presence.host && p.presence.host.st === 'lobby'))
          .map((p) => ({ me: p.sameTab, peer: p.peer, t: Number(p.presence.mm.t) || 0 }))
          .sort((a, b) => a.t - b.t || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
        if (searchers.length && searchers[0].me) {
          this.busy = true;
          await this.hostRoom();
        }
      }
    } catch (e) {
      console.warn('matchmaking', e);
      this.state = 'searching';
      this.lobby.presence({ mm: { t: this.qt, nm: this.name } }).catch(() => {});
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async hostRoom() {
    this.state = 'hosting';
    await this.lobby.presence({ mm: null });
    this.host = new HostSession({
      app: this.app,
      settings: { ...this.settings, target: 10, numbers: 'balanced' },
      toast: this.toast,
      official: true,
      quiet: true,
      seconds: this.seconds,
      mapSeed: this.mapSeed,
      onDemoted: (d) => this.onDemoted && this.onDemoted(d, this),
      onLobby: () => this.render(),
      onStart: async (players, net) => {
        this.state = 'playing';
        this.closeUI();
        return this.onHostStart(players, net, this);
      },
    });
    // left while the room was opening: close it once it is open (leave() skips a room still opening)
    const h = this.host;
    this.opening = h;
    try {
      await h.open();
    } finally {
      this.opening = null;
    }
    if (this.closed) await h.leave();
  }

  async join(code) {
    this.state = 'joined';
    this.joinedAt = Date.now();
    this.lobbyView = null;
    await this.lobby.presence({ mm: { t: this.qt, nm: this.name, in: code } });
    this.client = new ClientSession({
      app: this.app,
      settings: this.settings,
      code,
      toast: this.toast,
      quiet: true,
      noSpectate: true,
      onTakeover: (t) => this.onTakeover && this.onTakeover(t, this),
      onLobby: (seats, seat, rem, at) => {
        this.lobbyView = { seats, seat, rem, at };
        this.render();
      },
      onHostLost: () => this.backToSearch(),
      onGame: async (view, players, net) => {
        this.state = 'playing';
        this.closeUI();
        return this.onClientGame(view, players, net, this);
      },
    });
    const c = this.client;
    this.opening = c;
    try {
      await c.open();
    } finally {
      this.opening = null;
    }
    if (this.closed) await c.leave();
  }

  async backToSearch(fromEvaluate = false) {
    if (this.closed || this.state !== 'joined') return;
    this.busy = true;
    const c = this.client;
    this.client = null;
    try {
      if (c) await c.leave();
    } catch {
      /* already gone */
    }
    this.state = 'searching';
    this.lobbyView = null;
    await this.lobby.presence({ mm: { t: this.qt, nm: this.name } }).catch(() => {});
    this.busy = false;
    this.render();
    if (!fromEvaluate) this.evaluate();
  }

  // the campaign changed hands: the new session carries on with the room channel, this one only lets go
  // of the matchmaking
  retire() {
    this.closed = true;
    clearInterval(this.tick);
    if (this.unsub) this.unsub();
    this.unsub = null;
    if (this.lobby) this.lobby.presence({ mm: null }).catch(() => {});
    this.host = null;
    this.client = null;
    this.closeUI();
  }

  // the running game's network side (for leaving from inside the campaign)
  async leave() {
    this.closed = true;
    clearInterval(this.tick);
    if (this.unsub) this.unsub();
    try {
      await this.lobby.presence({ mm: null });
    } catch {
      /* already gone */
    }
    if (this.host && this.host !== this.opening) await this.host.leave();
    if (this.client && this.client !== this.opening) await this.client.leave();
    this.closeUI();
  }

  showUI() {
    const scr = el('div', 'menu-screen online-screen match-screen');
    scr.innerHTML = `<div class="title-block"><div class="eyebrow">Official Match</div><h1>官方房間<span>自動配對</span></h1><p>系統會把你放進開放中的官方房間。滿 4 位玩家立即開戰；${this.seconds} 秒內沒坐滿，空位由電腦補上後開戰。</p></div>
      <div class="setup-card panel"><div class="modal-head"><h3>官方配對</h3><span class="mm-code num"></span></div><div class="modal-body"></div><div class="modal-foot"></div></div>`;
    this.ui = { el: scr, body: scr.querySelector('.modal-body'), code: scr.querySelector('.mm-code') };
    scr.querySelector('.modal-foot').appendChild(
      btn('取消配對', '', async () => {
        await this.leave();
        this.onLeave && this.onLeave();
      }),
    );
    this.app.appendChild(scr);
  }

  closeUI() {
    if (this.ui) this.ui.el.remove();
    this.ui = null;
  }

  render() {
    if (!this.ui && !this.onState) return;
    if (this.closed) return;
    let seats = null;
    let rem = null;
    let status = '正在尋找開放中的官方房間…';
    let code = '';
    if (this.state === 'hosting' && this.host && this.host.seats) {
      seats = this.host.seats.map((s) => ({ ...s, peer: s.kind === 'host' ? 'me' : s.peer }));
      rem = this.host.remaining();
      status = '已開啟新的官方房間，等待其他玩家加入';
      code = this.host.code;
    } else if (this.state === 'joined' && this.client) {
      code = this.client.code;
      if (this.lobbyView) {
        seats = this.lobbyView.seats;
        if (this.lobbyView.rem != null) rem = Math.max(0, this.lobbyView.rem - (Date.now() - this.lobbyView.at));
        // the host seats a newcomer within a moment; only after that is "no seat" a full room
        status = this.lobbyView.seat >= 0 ? '已加入官方房間' : Date.now() - this.joinedAt < 8000 ? '正在取得席位…' : '這個房間已滿，正在找下一個房間…';
      } else status = '正在加入官方房間…';
    }
    const searching = this.peers().filter((p) => p.presence.mm && !p.presence.mm.in).length;
    if (this.onState) {
      const seat = this.state === 'hosting' ? 0 : this.lobbyView ? this.lobbyView.seat : -1;
      this.onState({ phase: this.state, code: code || null, seats, seat, rem, searching });
      return;
    }
    const secs = rem == null ? null : Math.ceil(rem / 1000);
    const full = seats && !seats.some((s) => s.kind === 'open');
    this.ui.code.textContent = code ? code.toUpperCase() : '';
    const me = this.state === 'hosting' ? 'me' : this.client ? this.client.me() : null;
    this.ui.body.innerHTML = `
      <div class="mm-status">${seats ? '' : '<span class="spinner"></span>'}<span>${esc(status)}</span></div>
      <div class="mm-count"><b class="num">${secs == null ? '—' : secs}</b><span>${secs == null ? '等待房間' : full ? '人已到齊，即將開戰' : '秒後開戰'}</span></div>
      <div class="seat-list">${seats ? seatRows(seats, me) : ''}</div>
      <p class="lead mm-foot">${searching > 0 ? `大廳中有 ${searching} 位玩家正在配對。` : ''}${selfHosted() ? '所有打開這個網站、按下快速配對的玩家都會配對在一起。' : '只有能開啟這個頁面的人（你分享過的對象）會出現在配對中。'}</p>`;
  }
}

// ───────────────────────── entry screen ─────────────────────────

// joinOnly: the home screen's "join a room" (a room code, or one of the open rooms)
export function showOnlineEntry(app, { settings, onHost, onJoin, onMatch, onBack, joinOnly = false }) {
  const scr = el('div', 'menu-screen online-screen');
  scr.innerHTML = joinOnly
    ? `<div class="title-block"><div class="eyebrow">Join a Room</div><h1>加入房間<span>與朋友爭奪卡坦島</span></h1><p>輸入朋友給你的房間代碼，或從下方挑一個開放中的房間。每個人只看得到自己的手牌，空位由電腦補上。</p></div>
    <div class="setup-card panel"><div class="modal-head"><h3>加入房間</h3></div><div class="modal-body"></div><div class="modal-foot"></div></div>`
    : `<div class="title-block"><div class="eyebrow">Online Campaign</div><h1>線上對戰<span>與朋友爭奪卡坦島</span></h1><p>一位玩家建立房間當主持人，其他人輸入房間代碼加入。每個人只看得到自己的手牌，空位由電腦補上。</p></div>
    <div class="setup-card panel"><div class="modal-head"><h3>線上對戰</h3></div><div class="modal-body"></div><div class="modal-foot"></div></div>`;
  const body = scr.querySelector('.modal-body');
  const foot = scr.querySelector('.modal-foot');
  body.innerHTML = `<p class="lead status">正在連線…</p>`;
  foot.appendChild(btn('返回', '', () => {
    cleanup();
    onBack();
  }));
  app.appendChild(scr);
  let unsub = null;
  const cleanup = () => {
    if (unsub) unsub();
    scr.remove();
  };
  (async () => {
    const sup = await onlineSupport();
    if (!sup.ok) {
      const why = {
        room: '線上對戰需要在 claude.ai 裡以登入身分開啟這個頁面（公開連結或下載的檔案無法連線）。每位玩家都要能開啟這個頁面，請主持人從頁面的「分享」把它分享給朋友。',
        server: '連不上連線伺服器。請確認網路連線，稍後再試一次。',
        crypto: '這個瀏覽器不支援加密功能，無法進行線上對戰。',
      }[sup.why] || '這個頁面目前無法連線。';
      body.innerHTML = `<p class="lead">${why}</p><p class="lead">你仍然可以和電腦或同一台裝置上的朋友對戰。</p>`;
      return;
    }
    const lobby = wrap(sup.room);
    body.innerHTML = '';
    if (onMatch && !joinOnly) {
      const quick = el('div', 'online-card quick');
      quick.innerHTML = `<div class="row-label">官方房間</div><p class="lead">自動配對到開放中的官方房間。滿 4 人立即開戰，或 60 秒後由電腦補滿空位。</p><p class="lead mm-online"></p>`;
      quick.appendChild(btn(`${icon('people', 16)} 快速配對`, 'primary', () => {
        cleanup();
        onMatch();
      }));
      body.appendChild(quick);
    }
    if (!joinOnly) {
      const host = el('div', 'online-card');
      host.innerHTML = `<div class="row-label">建立房間</div><p class="lead">以「${esc(settings.name)}」的身分開房，使用目前的對手數量與勝利分數設定。</p>`;
      host.appendChild(btn(`${icon('people', 16)} 建立房間`, 'primary', () => {
        cleanup();
        onHost();
      }));
      body.appendChild(host);
    }
    const join = el('div', 'online-card');
    join.innerHTML = `<div class="row-label">${joinOnly ? '房間代碼' : '加入房間'}</div><div class="join-row"><input type="text" id="join-code" maxlength="12" placeholder="輸入房間代碼" autocomplete="off" spellcheck="false" aria-label="房間代碼"></div>`;
    const input = join.querySelector('input');
    const go = btn('加入', 'primary', () => {
      const c = normCode(input.value);
      if (c.length < 3) {
        input.focus();
        return;
      }
      cleanup();
      onJoin(c);
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
    join.querySelector('.join-row').appendChild(go);
    body.appendChild(join);
    if (joinOnly && window.innerWidth > 760) input.focus({ preventScroll: true });
    const listBox = el('div', 'online-card');
    listBox.innerHTML = `<div class="row-label">開放中的房間</div><div class="room-list"><p class="lead">目前沒有開放中的房間。</p></div>`;
    body.appendChild(listBox);
    const roomList = listBox.querySelector('.room-list');
    const render = (peers) => {
      const mmEl = body.querySelector('.mm-online');
      if (mmEl) {
        const n = peers.filter((p) => !p.sameTab && p.presence && p.presence.app === APP && p.presence.mm && !p.presence.mm.in).length;
        const offi = peers.filter((p) => !p.sameTab && p.presence && p.presence.app === APP && p.presence.host && p.presence.host.off === 1 && p.presence.host.st === 'lobby').length;
        mmEl.textContent = n || offi ? `目前 ${offi} 個官方房間開放中、${n} 位玩家正在配對。` : '';
      }
      const rooms = peers.filter((p) => !p.sameTab && p.presence && p.presence.app === APP && p.presence.host && p.presence.host.code && p.presence.host.off !== 1);
      if (!rooms.length) {
        roomList.innerHTML = '<p class="lead">目前沒有開放中的房間。</p>';
        return;
      }
      roomList.innerHTML = '';
      for (const r of rooms) {
        const h = r.presence.host;
        const row = el('div', 'resp');
        const playing = h.st === 'play';
        const isle = h.mp && MAP_LIST.some((d) => d.id === h.mp) ? `・${mapDef(h.mp).name}` : '';
        row.innerHTML = `<b class="num" style="letter-spacing:.12em">${esc(String(h.code).toUpperCase())}</b><span>${esc(cleanName(h.nm, '主持人'))} 的房間${esc(isle)}</span><span class="st">${playing ? '戰役進行中' : `空位 ${Number(h.f) || 0}/${Math.max(0, (Number(h.n) || 1) - 1)}`}</span>`;
        const b = btn(playing ? '重新加入／觀戰' : '加入', playing ? '' : 'primary', () => {
          cleanup();
          onJoin(normCode(h.code));
        });
        row.appendChild(b);
        roomList.appendChild(row);
      }
    };
    render(lobby.peers());
    unsub = lobby.onPeers((ch) => render(ch.peers || []));
  })();
  return { close: cleanup };
}
