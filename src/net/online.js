// Online play over the claude.ai room capability. One player hosts: the host's page runs the
// rules engine and the computer players, publishes the public game state in its room presence
// and seals each remote player's hand with that player's key. Players send their moves as a
// short outbox in their own presence; the host validates every move with the rules engine.
import { getRoom, wrap, selfHosted } from './room.js';
import { loadKeyPair, sharedKey, seal, open, cryptoAvailable } from './crypto.js';
import * as C from './codec.js';
import { ACTION_TYPES } from '../engine/engine.js';
import { randomState } from '../engine/rng.js';
import { flagURL } from '../ui/flags.js';
import { esc } from '../ui/text.js';
import { icon } from '../ui/icons.js';
import { PALETTE, AI_NAMES } from '../ui/menu.js';

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

export class HostSession {
  constructor({ app, settings, onStart, onLeave, toast, official = false, quiet = false, onLobby = null, seconds = 60 }) {
    this.app = app;
    this.settings = settings;
    this.onStart = onStart;
    this.onLeave = onLeave;
    this.toast = toast || (() => {});
    this.official = official; // an official matchmaking room: 4 seats, starts when full or when the timer runs out
    this.quiet = quiet; // the matchmaking screen draws the lobby instead of the host's own screen
    this.onLobby = onLobby;
    this.seconds = seconds;
    this.history = [];
    this.err = null;
    this.phase = 'lobby';
    this.game = null;
    this.state = null;
    this.publishing = null;
    this.dirty = false;
    this.ui = null;
  }

  async open(restore = null) {
    const sup = await onlineSupport();
    if (!sup.ok) throw new Error(supportError(sup.why));
    this.room = sup.room;
    this.lobby = wrap(this.room);
    this.code = restore ? restore.code : makeCode();
    this.ch = wrap(await this.room.join(PREFIX + this.code));
    this.keys = await loadKeyPair();
    if (restore) this.phase = 'play';
    if (restore) {
      this.seats = restore.seats.map((s) => ({ ...s, peer: null, away: s.kind === 'remote', awaySince: s.kind === 'remote' ? Date.now() : 0 }));
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
    this.unsub = this.ch.onPeers((ch) => this.onPeers(ch));
    this.connUnsub = this.ch.onConnection((ok) => this.ui && this.ui.conn && this.ui.conn(ok));
    this.awayTimer = setInterval(() => this.checkAway(), 2000);
    if (!restore && !this.quiet) this.showLobby();
    this.publish();
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

  usedColors(except = -1) {
    return this.seats.filter((s, i) => i !== except && s.color && s.kind !== 'open').map((s) => s.color);
  }
  freeColor(want, i) {
    const used = this.usedColors(i);
    if (want && !used.includes(want) && PALETTE.some((p) => p.hex === want)) return want;
    return PALETTE.map((p) => p.hex).find((h) => !used.includes(h)) || '#888888';
  }

  onPeers(ch) {
    if (ch.error) {
      this.toast('連線中斷', '房間連線已結束，請重新建立房間。', 'cross');
      return;
    }
    // the room echoing this page's own presence back changes nothing here (and answering it with
    // another publish would loop)
    if (Array.isArray(ch.updated) && !(ch.joined && ch.joined.length) && !(ch.left && ch.left.length) && ch.updated.length && ch.updated.every((p) => p.sameTab)) return;
    const peers = ch.peers.filter((p) => !p.sameTab && p.presence && p.presence.app === APP && p.presence.role === 'player');
    const now = Date.now();
    let changed = false;
    const present = new Set(peers.map((p) => p.peer));
    // seated players who left
    this.seats.forEach((s) => {
      if (s.kind === 'remote' && s.peer && !present.has(s.peer)) {
        if (this.phase === 'lobby') {
          Object.assign(s, { kind: 'open', peer: null, name: '', color: null, key: null });
        } else if (!s.away) {
          s.away = true;
          s.awaySince = now;
          s.peer = null;
          this.toast('玩家離線', `${s.name} 離開了房間，${AWAY_MS / 1000} 秒後由電腦代管。`, 'people');
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
          const same = pr.sid && pr.sid === this.seats[i].sid; // same page as before: keep its move counter
          Object.assign(this.seats[i], { peer: p.peer, away: false, awaySince: 0, managed: false, lastN: same ? this.seats[i].lastN || 0 : 0, sid: pr.sid || null });
          if (this.game) this.game.setSeatAway(i, false);
          this.toast('玩家回來了', `${this.seats[i].name} 重新連線`, 'people');
          changed = true;
        }
      }
      if (i < 0 && this.phase === 'lobby' && typeof pr.k === 'string' && pr.k.length < 200) {
        const open = this.seats.findIndex((s) => s.kind === 'open');
        if (open >= 0) {
          const name = cleanName(pr.name, '玩家 ' + (open + 1));
          Object.assign(this.seats[open], { kind: 'remote', peer: p.peer, name, color: this.freeColor(pr.color, open), key: pr.k, lastN: 0, away: false, sid: pr.sid || null });
          changed = true;
        }
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
      if (i >= 0 && this.phase === 'play' && this.game) this.takeIntents(i, p);
    }
    this.waiting = peers.filter((p) => !this.seats.some((s) => s.peer === p.peer)).map((p) => cleanName(p.presence.name, '玩家'));
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
    if (this.phase !== 'play' || !this.game) return;
    const now = Date.now();
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
      onChange: (st, events) => this.broadcast(st, events),
      entropy: randomState(),
      serialize: () => ({ code: this.code, seats: this.seats.map((s) => ({ kind: s.kind, name: s.name, color: s.color, key: s.key || null, level: s.level, lastN: s.lastN || 0, sid: s.sid || null })) }),
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
    this.dirty = true;
    if (this.publishing) return;
    this.publishing = (async () => {
      while (this.dirty) {
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

  async publishNow() {
    this.seats[0].peer = this.me();
    const lob = this.lob();
    const open = this.seats.filter((s) => s.kind === 'open').length;
    const rem = this.remaining();
    // the room listing in the lobby only changes with seats and phase: send it only when it does
    const listing = { code: this.code, nm: this.seats[0].name, n: this.seats.length, f: open, st: this.phase, off: this.official ? 1 : 0, ts: this.createdAt };
    const lk = JSON.stringify(listing);
    if (lk !== this.listingKey || (rem != null && Date.now() - (this.listingAt || 0) > 5000)) {
      this.listingKey = lk;
      this.listingAt = Date.now();
      this.lobby.presence({ app: APP, v: V, host: { ...listing, rem } }).catch(() => {});
    }
    if (this.phase === 'lobby' || !this.state) {
      await this.ch.presence({ app: APP, v: V, role: 'host', code: this.code, k: this.keys.pubB64, st: this.phase, lob, tv: this.settings.target || 10, off: this.official ? 1 : 0, rem });
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
    const ack = this.seats.filter((s) => s.kind === 'remote' && s.peer).map((s) => [s.peer, s.lastN || 0]);
    const base = { app: APP, v: V, role: 'host', code: this.code, k: this.keys.pubB64, st: 'play', lob, bd: C.encodeBoard(st), ps: C.encodeSeats(st), pub: C.encodePublic(st), px, ack, err: this.err };
    let ev = this.history.map((h) => [h.s, h.ev]);
    let pres = { ...base, ev };
    while (C.utf8Size(pres) > 3900 && ev.length > 1) {
      ev = ev.slice(1);
      pres = { ...base, ev };
    }
    if (C.utf8Size(pres) > 3900) pres = { ...base, ev: [] };
    if (typeof window !== 'undefined') window.__presSize = Math.max(window.__presSize || 0, C.utf8Size(pres));
    await this.ch.presence(pres);
  }

  async leave() {
    clearInterval(this.awayTimer);
    clearInterval(this.autoTimer);
    this.phase = 'closed';
    forgetRoom();
    try {
      await this.lobby.presence({ host: null });
    } catch {
      /* already gone */
    }
    if (this.unsub) this.unsub();
    try {
      await this.ch.leave();
    } catch {
      /* already gone */
    }
    if (this.ui) this.ui.close();
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
      body.innerHTML = `<div class="code-box"><span class="lbl">房間代碼</span><b class="num">${this.code.toUpperCase()}</b></div><div class="row-label">席位</div><div class="seat-list"></div><div class="waiting"></div>`;
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
  constructor({ app, settings, code, onGame, onLeave, toast, quiet = false, onLobby = null, onHostLost = null, noSpectate = false }) {
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
    this.n = 0;
    this.out = [];
    this.lastSeq = -1;
    this.game = null;
    this.queue = Promise.resolve();
    this.hostSeen = false;
    this.lastErr = null;
    // this tab sat in this room before (reload, new version): expect to get the seat back
    const prev = rememberedRoom();
    this.returning = !!(prev && prev.role === 'client' && prev.code === this.code);
    this.claimLeft = null;
    this.claimTimer = null;
  }

  async open() {
    const sup = await onlineSupport();
    if (!sup.ok) throw new Error(supportError(sup.why));
    this.room = sup.room;
    this.ch = wrap(await this.room.join(PREFIX + this.code));
    this.keys = await loadKeyPair();
    this.sid = makeCode() + makeCode();
    await this.ch.presence({ app: APP, v: V, role: 'player', name: cleanName(this.settings.name, '玩家'), color: this.settings.color, k: this.keys.pubB64, sid: this.sid, out: [] });
    rememberRoom(this.code, 'client');
    this.unsub = this.ch.onPeers((ch) => this.onPeers(ch));
    if (!this.quiet) this.showWaiting();
    this.hostTimer = setTimeout(() => {
      if (this.hostSeen) return;
      if (this.ui) this.ui.status('找不到這個房間的主持人。請確認代碼，或請主持人重新開房。');
      if (this.onHostLost) this.onHostLost();
    }, 8000);
  }

  me() {
    return this.ch.me();
  }

  onPeers(ch) {
    if (ch.error) {
      this.toast('連線中斷', '房間連線已結束。', 'cross');
      return;
    }
    const host = ch.peers.find((p) => !p.sameTab && p.presence && p.presence.app === APP && p.presence.role === 'host' && p.presence.code === this.code);
    if (!host) {
      if (this.hostSeen && this.game) this.game.setNetStatus('主持人離線，等待重新連線…');
      if (this.hostSeen && !this.game && this.onHostLost && !this.lostTimer) {
        // the room closed before the campaign started
        this.lostTimer = setTimeout(() => {
          this.lostTimer = null;
          const back = this.ch.peers().some((p) => !p.sameTab && p.presence && p.presence.role === 'host' && p.presence.code === this.code);
          if (!back && !this.game) this.onHostLost();
        }, 3000);
      }
      return;
    }
    if (!this.hostSeen) clearTimeout(this.hostTimer);
    this.hostSeen = true;
    if (host.presence === this.lastPres) return;
    this.lastPres = host.presence;
    const me = this.me();
    this.queue = this.queue.then(() => this.handleHost(host.presence, me)).catch((e) => console.error(e));
  }

  async handleHost(pr, me) {
    // before the game exists, act only on the newest presence from the host (a newer one is queued)
    if (!this.game && this.lastPres && pr !== this.lastPres) return;
    const lob = Array.isArray(pr.lob) ? pr.lob : [];
    const seats = lob.map(([k, name, color, peer, level, away]) => ({ kind: { h: 'host', r: 'remote', a: 'ai', o: 'open' }[k] || 'open', name, color, peer, level, away: !!away }));
    const seat = seats.findIndex((s) => s.peer === me);
    this.seat = seat;
    if (pr.st !== 'play' || !pr.pub) {
      if (this.ui) this.ui.render(seats, seat);
      if (this.onLobby) this.onLobby(seats, seat, typeof pr.rem === 'number' ? pr.rem : null, Date.now());
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
    const view = C.decodeView(pr.bd, seatInfo, pr.pub, priv, seat);
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
    if (!this.game) {
      if (this.ui) this.ui.close();
      this.ui = null;
      this.game = await this.onGame(view, players, this.netApi(seat, view));
    } else {
      this.game.setNetStatus(null);
      this.game.applyRemote(view, evs, players);
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
      seat,
      view,
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

  async leave() {
    clearTimeout(this.hostTimer);
    clearTimeout(this.lostTimer);
    clearTimeout(this.claimTimer);
    this.closed = true;
    forgetRoom();
    if (this.unsub) this.unsub();
    try {
      await this.ch.leave();
    } catch {
      /* already gone */
    }
    if (this.ui) this.ui.close();
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
    this.ui = {
      render: (seats, seat) => {
        // before the host has seen us arrive there may still be open seats: we are about to get one
        const open = seats.some((s) => s.kind === 'open');
        statusEl.textContent = seat >= 0 ? `你坐在第 ${seat + 1} 席，等待主持人開始戰役…` : open ? '正在取得席位…' : '席位已滿，目前在旁觀望。';
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
  constructor({ app, settings, toast, onHostStart, onClientGame, onLeave, seconds = 60 }) {
    this.app = app;
    this.settings = settings;
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
    if (!sup.ok) throw new Error(supportError(sup.why));
    this.room = sup.room;
    this.lobby = wrap(this.room);
    this.name = cleanName(this.settings.name, '玩家');
    this.qt = Date.now();
    this.showUI();
    await this.lobby.presence({ app: APP, v: V, mm: { t: this.qt, nm: this.name } });
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
        if (this.lobbyView && this.lobbyView.seat < 0 && Date.now() - this.joinedAt > 4000 && !this.client.game) {
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
      settings: { ...this.settings, target: 10 },
      toast: this.toast,
      official: true,
      quiet: true,
      seconds: this.seconds,
      onLobby: () => this.render(),
      onStart: async (players, net) => {
        this.state = 'playing';
        this.closeUI();
        return this.onHostStart(players, net, this);
      },
    });
    await this.host.open();
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
    await this.client.open();
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
    if (this.host) await this.host.leave();
    if (this.client) await this.client.leave();
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
    if (!this.ui) return;
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
        status = this.lobbyView.seat >= 0 ? '已加入官方房間' : '這個房間已滿，正在找下一個房間…';
      } else status = '正在加入官方房間…';
    }
    const searching = this.peers().filter((p) => p.presence.mm && !p.presence.mm.in).length;
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

export function showOnlineEntry(app, { settings, onHost, onJoin, onMatch, onBack }) {
  const scr = el('div', 'menu-screen online-screen');
  scr.innerHTML = `<div class="title-block"><div class="eyebrow">Online Campaign</div><h1>線上對戰<span>與朋友爭奪卡坦島</span></h1><p>一位玩家建立房間當主持人，其他人輸入房間代碼加入。每個人只看得到自己的手牌，空位由電腦補上。</p></div>
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
    if (onMatch) {
      const quick = el('div', 'online-card quick');
      quick.innerHTML = `<div class="row-label">官方房間</div><p class="lead">自動配對到開放中的官方房間。滿 4 人立即開戰，或 60 秒後由電腦補滿空位。</p><p class="lead mm-online"></p>`;
      quick.appendChild(btn(`${icon('people', 16)} 快速配對`, 'primary', () => {
        cleanup();
        onMatch();
      }));
      body.appendChild(quick);
    }
    const host = el('div', 'online-card');
    host.innerHTML = `<div class="row-label">建立房間</div><p class="lead">以「${esc(settings.name)}」的身分開房，使用目前的對手數量與勝利分數設定。</p>`;
    host.appendChild(btn(`${icon('people', 16)} 建立房間`, 'primary', () => {
      cleanup();
      onHost();
    }));
    body.appendChild(host);
    const join = el('div', 'online-card');
    join.innerHTML = `<div class="row-label">加入房間</div><div class="join-row"><input type="text" id="join-code" maxlength="12" placeholder="輸入房間代碼" autocomplete="off" spellcheck="false" aria-label="房間代碼"></div>`;
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
        row.innerHTML = `<b class="num" style="letter-spacing:.12em">${esc(String(h.code).toUpperCase())}</b><span>${esc(cleanName(h.nm, '主持人'))} 的房間</span><span class="st">${playing ? '戰役進行中' : `空位 ${Number(h.f) || 0}/${Math.max(0, (Number(h.n) || 1) - 1)}`}</span>`;
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
