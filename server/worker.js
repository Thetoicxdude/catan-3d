// Cloudflare Worker for the self-hosted game: serves the static site and runs the online rooms.
//
// The game's online play was built on the claude.ai `room` capability, which is presence-only: every
// peer in a room owns a small presence object (at most 4 KiB) and everyone is told who joined, left
// or changed theirs. The whole game protocol rides on that (the host publishes the public state in its
// presence, players post their moves in theirs, hands are sealed end to end), so this server only has
// to provide the same presence rooms and never needs to know the rules.
//
//   GET /rooms/<name>?peer=<id>   WebSocket into room <name> ("lobby" is the shared lobby)
//
// Client → server: {t:'hello', id, p}   first message: my full presence
//                  {t:'pres', id, p}    a patch (null deletes a key)
//                  "ping"               answered with "pong" without waking the room
// Server → client: {t:'snap', id, me, peers}   reply to hello: everyone else in the room
//                  {t:'join'|'upd', p}         a peer arrived / changed its presence
//                  {t:'left', peer}            a peer left
//                  {t:'ack', id} / {t:'err', id, code, message}
import { DurableObject } from 'cloudflare:workers';

const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const PEER_RE = /^[a-z0-9]{8,40}$/;
const MAX_PRESENCE = 4096; // bytes of JSON, same limit as the claude.ai room
const MAX_MESSAGE = 8192;
const MAX_PEERS_LOBBY = 300;
const MAX_PEERS_ROOM = 40;
const RATE_WINDOW = 10000;
const RATE_MAX = 600; // messages per socket per window (pings don't count: they never reach the room)
// A tab that stopped pinging is gone. Background tabs may only get to ping about once a minute
// (browser timer throttling), so the limit is generous: this sweep only clears half-open sockets.
const STALE_MS = 150000;
const SWEEP_MS = 30000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/rooms/')) {
      let name = '';
      try {
        name = decodeURIComponent(url.pathname.slice('/rooms/'.length));
      } catch {
        /* malformed escape */
      }
      if (!ROOM_RE.test(name)) return new Response('bad room name', { status: 400 });
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('websocket only', { status: 426 });
      // only pages served from this site (or a page on the developer's own machine) may use its rooms,
      // which keeps the free quota ours
      const origin = request.headers.get('Origin');
      if (origin) {
        let o = null;
        try {
          o = new URL(origin);
        } catch {
          /* "null" or garbage */
        }
        const loopback = o && (o.hostname === '127.0.0.1' || o.hostname === 'localhost' || o.hostname === '[::1]');
        if (!o || (o.host !== url.host && !loopback)) return new Response('forbidden', { status: 403 });
      }
      return env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(request);
    }
    if (url.pathname === '/healthz') return new Response('ok', { headers: { 'cache-control': 'no-store' } });
    return env.ASSETS.fetch(request);
  },
};

export class PresenceRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // peer -> { presence, updatedAt }; rebuilt from storage after the room wakes from hibernation
    this.peers = null;
    this.rate = new WeakMap();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  info(ws) {
    try {
      return ws.deserializeAttachment() || {};
    } catch {
      return {};
    }
  }

  mark(ws, patch) {
    try {
      ws.serializeAttachment({ ...this.info(ws), ...patch });
    } catch {
      /* socket already closed */
    }
  }

  live() {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = this.info(ws);
      return a.peer && !a.replaced && !a.gone;
    });
  }

  async load() {
    if (this.peers) return this.peers;
    const live = new Set();
    for (const ws of this.live()) {
      const a = this.info(ws);
      if (a.ready) live.add(a.peer);
    }
    const peers = new Map();
    const dead = [];
    let stored = new Map();
    try {
      stored = await this.ctx.storage.list({ prefix: 'p:' });
    } catch (e) {
      console.warn('room storage unavailable', e);
    }
    for (const [k, v] of stored) {
      const p = k.slice(2);
      if (live.has(p)) peers.set(p, v);
      else dead.push(k);
    }
    for (const p of live) if (!peers.has(p)) peers.set(p, { presence: {}, updatedAt: Date.now() });
    this.peers = peers;
    for (let i = 0; i < dead.length; i += 128) await this.store(() => this.ctx.storage.delete(dead.slice(i, i + 128)));
    return peers;
  }

  // storage only backs the presence up for when the room hibernates; if the daily write quota runs out
  // the room keeps working from memory
  async store(op) {
    try {
      await op();
    } catch (e) {
      console.warn('room storage write failed', e);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const peer = url.searchParams.get('peer') || '';
    if (!PEER_RE.test(peer)) return new Response('bad peer id', { status: 400 });
    let name = '';
    try {
      name = decodeURIComponent(url.pathname.slice('/rooms/'.length));
    } catch {
      /* checked by the worker */
    }
    await this.load();
    const old = this.ctx.getWebSockets(peer).filter((ws) => {
      const a = this.info(ws);
      return !a.replaced && !a.gone;
    });
    const cap = name === 'lobby' ? MAX_PEERS_LOBBY : MAX_PEERS_ROOM;
    if (!old.length && this.live().length >= cap) return new Response('room full', { status: 503 });
    // the same tab reconnecting (its old socket may not have noticed the drop yet) takes over its slot,
    // so the others see an update instead of a leave and a join
    const back = old.some((ws) => this.info(ws).ready);
    for (const ws of old) {
      this.mark(ws, { replaced: true });
      try {
        ws.close(4001, 'replaced');
      } catch {
        /* already closed */
      }
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [peer]);
    server.serializeAttachment({ peer, at: Date.now(), ready: false, back });
    await this.armSweep();
    return new Response(null, { status: 101, webSocket: client });
  }

  allow(ws) {
    const now = Date.now();
    let r = this.rate.get(ws);
    if (!r || now - r.t > RATE_WINDOW) {
      r = { t: now, n: 0 };
      this.rate.set(ws, r);
    }
    r.n++;
    return r.n <= RATE_MAX;
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }

  broadcast(msg, exceptPeer) {
    const s = JSON.stringify(msg);
    for (const ws of this.live()) {
      const a = this.info(ws);
      if (!a.ready || a.peer === exceptPeer) continue;
      try {
        ws.send(s);
      } catch {
        /* closing */
      }
    }
  }

  list(exceptPeer) {
    const out = [];
    const seen = new Set();
    for (const ws of this.live()) {
      const a = this.info(ws);
      if (!a.ready || a.peer === exceptPeer || seen.has(a.peer)) continue;
      seen.add(a.peer);
      const r = this.peers.get(a.peer);
      if (r) out.push({ peer: a.peer, presence: r.presence, updatedAt: r.updatedAt });
    }
    return out;
  }

  async webSocketMessage(ws, data) {
    const a = this.info(ws);
    if (!a.peer || a.replaced || a.gone) return;
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) {
      console.log('[room] message too big', a.peer, typeof data === 'string' ? data.length : 'binary');
      ws.close(1009, 'message too big');
      await this.gone(ws);
      return;
    }
    if (!this.allow(ws)) {
      console.log('[room] rate limited', a.peer);
      ws.close(4008, 'rate limited');
      await this.gone(ws);
      return;
    }
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (!m || (m.t !== 'hello' && m.t !== 'pres')) return;
    if (m.t === 'pres' && !a.ready) return; // the hello always comes first
    const p = m.p;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      this.send(ws, { t: 'err', id: m.id, code: 'invalid_argument', message: 'presence must be an object' });
      return;
    }
    const peers = await this.load();
    const prev = peers.get(a.peer);
    let next;
    if (m.t === 'hello') next = { ...p };
    else {
      next = { ...(prev ? prev.presence : {}) };
      for (const [k, v] of Object.entries(p)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
    }
    const size = new TextEncoder().encode(JSON.stringify(next)).length;
    if (size > MAX_PRESENCE) {
      this.send(ws, { t: 'err', id: m.id, code: 'invalid_argument', message: `presence over 4 KiB: ${size}` });
      if (m.t === 'hello') {
        ws.close(4009, 'presence too big');
        await this.gone(ws);
      }
      return;
    }
    const rec = { presence: next, updatedAt: Date.now() };
    peers.set(a.peer, rec);
    await this.store(() => this.ctx.storage.put('p:' + a.peer, rec));
    if (m.t === 'hello') {
      this.mark(ws, { ready: true });
      this.send(ws, { t: 'snap', id: m.id, me: a.peer, peers: this.list(a.peer) });
      this.broadcast({ t: a.back ? 'upd' : 'join', p: { peer: a.peer, ...rec } }, a.peer);
    } else {
      this.send(ws, { t: 'ack', id: m.id });
      this.broadcast({ t: 'upd', p: { peer: a.peer, ...rec } }, a.peer);
    }
  }

  async webSocketClose(ws, code) {
    await this.gone(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  async gone(ws) {
    const a = this.info(ws);
    if (!a.peer || a.replaced || a.gone) return;
    this.mark(ws, { gone: true });
    // a newer socket of the same tab keeps the peer in the room
    const still = this.ctx.getWebSockets(a.peer).some((o) => {
      if (o === ws) return false;
      const b = this.info(o);
      return !b.replaced && !b.gone;
    });
    if (still) return;
    const peers = await this.load();
    peers.delete(a.peer);
    await this.store(() => this.ctx.storage.delete('p:' + a.peer));
    if (a.ready) this.broadcast({ t: 'left', peer: a.peer }, a.peer);
  }

  async armSweep() {
    try {
      if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    } catch (e) {
      console.warn('room alarm unavailable', e);
    }
  }

  async alarm() {
    const now = Date.now();
    for (const ws of this.live()) {
      const a = this.info(ws);
      const pong = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      const last = Math.max(a.at || 0, pong ? pong.getTime() : 0);
      if (now - last > STALE_MS) {
        try {
          ws.close(4002, 'stale');
        } catch {
          /* already closed */
        }
        await this.gone(ws);
      }
    }
    if (this.live().length) await this.armSweep();
  }
}
