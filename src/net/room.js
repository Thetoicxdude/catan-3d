// Room transport. In claude.ai the page uses the platform `room` capability (presence only:
// every admitted viewer may set presence, so any viewer can host or join). On the self-hosted site
// (the page sets window.__rooms) the same presence rooms come from our own server over WebSockets
// (server/worker.js). For local testing a BroadcastChannel stand-in with the same surface can be
// switched on with window.__mockRoom.

let roomPromise = null;

export function getRoom() {
  if (roomPromise) return roomPromise;
  roomPromise = (async () => {
    if (typeof window === 'undefined') return null;
    if (window.__mockRoom) return mockRoom();
    const c = window.claude;
    if (c && typeof c.use === 'function') {
      try {
        const room = await c.use('room');
        if (room) return room;
      } catch {
        /* no room capability here */
      }
    }
    if (window.__rooms) return wsRoom(window.__rooms);
    return null;
  })();
  return roomPromise;
}

// true when online play runs on our own room server (invite links work, anyone with the link can join)
export function selfHosted() {
  return typeof window !== 'undefined' && !!window.__rooms && !window.__mockRoom && !(window.claude && typeof window.claude.use === 'function');
}

// Wraps a room (lobby or named) with conveniences: my peer label and a single peers listener.
export function wrap(r) {
  const listeners = new Set();
  let unsub = null;
  const api = {
    raw: r,
    me() {
      const p = r.peers().find((x) => x.sameTab);
      return p ? p.peer : null;
    },
    peers: () => r.peers(),
    presence: (patch) => r.presence(patch),
    connected: () => (r.connected ? r.connected() : true),
    onPeers(fn) {
      listeners.add(fn);
      if (!unsub) {
        unsub = r.onPeers(
          (ch) => {
            for (const f of listeners) {
              try {
                f(ch);
              } catch (e) {
                console.error(e);
              }
            }
          },
          (err) => {
            for (const f of listeners) f({ error: err, peers: [], joined: [], left: [], updated: [] });
          },
        );
      }
      return () => listeners.delete(fn);
    },
    onConnection(fn) {
      return r.onConnection ? r.onConnection(fn) : (fn(true), () => {});
    },
    leave() {
      if (unsub) unsub();
      unsub = null;
      listeners.clear();
      return r.leave ? r.leave() : Promise.resolve();
    },
  };
  return api;
}

// ───────── WebSocket rooms (self-hosted site) ─────────
function randomPeer() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((x) => (x % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
}

function wsChannel(base, name, peer) {
  let mine = {};
  let myUpdated = Date.now();
  const others = new Map();
  const handlers = new Set();
  const connHandlers = new Set();
  const readyWaiters = new Set();
  let snapshot = null;
  let ws = null;
  let ready = false;
  let left = false;
  let retry = 0;
  let retryTimer = null;
  let pingTimer = null;
  let lastPong = 0;
  let nextId = 1;
  const waiting = new Map();
  const meObj = () => Object.freeze({ peer, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...mine }), updatedAt: myUpdated });
  const peerObj = (p) =>
    Object.freeze({ peer: p.peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(p.presence || {}), updatedAt: p.updatedAt || Date.now() });
  const build = () => {
    snapshot = Object.freeze([meObj(), ...others.values()]);
    return snapshot;
  };
  build();
  let pend = { joined: [], left: [], updated: [] };
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const peers = build();
    const ch = { peers, joined: pend.joined, left: pend.left, updated: pend.updated };
    pend = { joined: [], left: [], updated: [] };
    for (const h of handlers) {
      try {
        h(ch);
      } catch (e) {
        console.error(e);
      }
    }
  };
  const queue = (kind, obj) => {
    pend[kind].push(obj);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 16);
    }
  };
  const setReady = (ok) => {
    if (ok === ready) return;
    ready = ok;
    if (ok) {
      for (const f of readyWaiters) f();
      readyWaiters.clear();
    }
    for (const f of connHandlers) {
      try {
        f(ok);
      } catch (e) {
        console.error(e);
      }
    }
  };
  // presence calls that were waiting for the server: their change rides along with the next hello
  const settleAll = () => {
    for (const [, w] of waiting) {
      clearTimeout(w.timer);
      w.resolve();
    }
    waiting.clear();
  };
  const send = (msg) => {
    try {
      ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  };
  const stopPing = () => {
    clearInterval(pingTimer);
    pingTimer = null;
  };
  const drop = (sock) => {
    if (ws !== sock) return;
    ws = null;
    stopPing();
    try {
      sock.close();
    } catch {
      /* already closed */
    }
    setReady(false);
    settleAll();
    reconnectLater();
  };
  const reconnectLater = () => {
    if (left) return;
    clearTimeout(retryTimer);
    const delay = Math.min(8000, 400 * 2 ** retry) * (0.75 + Math.random() * 0.5);
    retry = Math.min(retry + 1, 6);
    retryTimer = setTimeout(connect, delay);
  };
  const connect = () => {
    if (left || ws) return;
    let sock;
    try {
      sock = new WebSocket(`${base}${encodeURIComponent(name)}?peer=${peer}`);
    } catch {
      reconnectLater();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      lastPong = Date.now();
      send({ t: 'hello', id: 0, p: mine });
      stopPing();
      // a socket that stops answering pings is dropped and reopened
      pingTimer = setInterval(() => {
        if (ws !== sock) return;
        if (Date.now() - lastPong > 45000) {
          drop(sock);
          return;
        }
        send('ping');
      }, 15000);
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      lastPong = Date.now();
      if (e.data === 'pong') return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'snap') {
        retry = 0;
        // the room as it is now; after a reconnect, report the difference to what we knew before
        const fresh = new Map((m.peers || []).map((p) => [p.peer, peerObj(p)]));
        for (const [k, o] of others) {
          if (!fresh.has(k)) {
            others.delete(k);
            queue('left', o);
          }
        }
        for (const [k, o] of fresh) {
          const had = others.get(k);
          others.set(k, o);
          if (!had) queue('joined', o);
          else if (had.updatedAt !== o.updatedAt) queue('updated', o);
        }
        setReady(true);
      } else if (m.t === 'join' || m.t === 'upd') {
        const o = peerObj(m.p);
        const had = others.has(o.peer);
        others.set(o.peer, o);
        queue(had ? 'updated' : 'joined', o);
      } else if (m.t === 'left') {
        const o = others.get(m.peer);
        if (o) {
          others.delete(m.peer);
          queue('left', o);
        }
      } else if (m.t === 'ack' || m.t === 'err') {
        const w = waiting.get(m.id);
        if (!w) return;
        waiting.delete(m.id);
        clearTimeout(w.timer);
        if (m.t === 'ack') w.resolve();
        else w.reject({ code: m.code, message: m.message });
      }
    };
    sock.onclose = () => drop(sock);
    sock.onerror = () => {
      /* onclose follows */
    };
  };
  const onPageHide = () => {
    if (ws) {
      try {
        ws.close(1000, 'bye');
      } catch {
        /* already closed */
      }
    }
  };
  const onPageShow = (e) => {
    // back from the back/forward cache: the socket was closed on the way out
    if (e.persisted && !left && !ws) connect();
  };
  const onOnline = () => {
    if (!left && !ws) {
      clearTimeout(retryTimer);
      retry = 0;
      connect();
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
  }
  connect();
  return {
    name,
    presence(patch) {
      const next = { ...mine };
      for (const [k, v] of Object.entries(patch || {})) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      const size = new TextEncoder().encode(JSON.stringify(next)).length;
      if (size > 4096) return Promise.reject({ code: 'invalid_argument', message: 'presence over 4 KiB: ' + size });
      mine = next;
      myUpdated = Date.now();
      queue('updated', build()[0]);
      if (!ws || ws.readyState !== 1) return Promise.resolve(); // sent with the hello when the socket is back
      const id = nextId++;
      if (!send({ t: 'pres', id, p: patch })) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve();
        }, 8000);
        waiting.set(id, { resolve, reject, timer });
      });
    },
    peers: () => snapshot,
    onPeers(fn) {
      handlers.add(fn);
      setTimeout(() => handlers.has(fn) && fn({ peers: snapshot, joined: snapshot.slice(), left: [], updated: [] }), 0);
      return () => handlers.delete(fn);
    },
    connected: () => ready,
    onConnection(fn) {
      connHandlers.add(fn);
      setTimeout(() => connHandlers.has(fn) && fn(ready), 0);
      return () => connHandlers.delete(fn);
    },
    // resolves true once the room's member list has arrived, false after `ms` of waiting. Time the page
    // spends stalled (a long shader compile on a slow device) doesn't count: the socket's events are
    // queued behind the stall just like the timer.
    whenReady(ms = 6000) {
      if (ready) return Promise.resolve(true);
      return new Promise((resolve) => {
        let left = ms;
        let last = performance.now();
        let t = null;
        const finish = (ok) => {
          clearTimeout(t);
          readyWaiters.delete(onReady);
          resolve(ok);
        };
        const onReady = () => finish(true);
        const step = () => {
          const now = performance.now();
          left -= Math.min(now - last, 1000);
          last = now;
          if (ready) finish(true);
          else if (left <= 0) finish(false);
          else t = setTimeout(step, 250);
        };
        readyWaiters.add(onReady);
        t = setTimeout(step, 250);
      });
    },
    leave() {
      left = true;
      clearTimeout(retryTimer);
      stopPing();
      settleAll();
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('online', onOnline);
      }
      const sock = ws;
      ws = null;
      if (sock) {
        try {
          sock.close(1000, 'leave');
        } catch {
          /* already closed */
        }
      }
      handlers.clear();
      connHandlers.clear();
      return Promise.resolve();
    },
  };
}

function wsRoom(path) {
  const u = new URL(path, location.href);
  if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol === 'http:') u.protocol = 'ws:';
  const base = u.href.endsWith('/') ? u.href : u.href + '/';
  const peer = randomPeer();
  const lobby = wsChannel(base, 'lobby', peer);
  const rooms = new Map();
  return {
    ...lobby,
    async join(name) {
      if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) throw { code: 'invalid_argument' };
      let r = rooms.get(name);
      if (!r) {
        r = wsChannel(base, name, peer);
        rooms.set(name, r);
        const leave = r.leave;
        r.leave = () => {
          rooms.delete(name);
          return leave();
        };
      }
      await r.whenReady(6000);
      return r;
    },
  };
}

// ───────── BroadcastChannel stand-in (tests only) ─────────
function mockChannel(name, peer) {
  const bc = new BroadcastChannel('mockroom:' + name);
  const others = new Map();
  let mine = {};
  let myUpdated = Date.now();
  const handlers = new Set();
  let snapshot = null;
  let left = false;
  const build = () => {
    const me = { peer, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...mine }), updatedAt: myUpdated };
    snapshot = Object.freeze([me, ...[...others.values()].map((o) => o.obj)]);
    return snapshot;
  };
  build();
  let pend = { joined: [], left: [], updated: [] };
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const peers = build();
    const ch = { peers, joined: pend.joined, left: pend.left, updated: pend.updated };
    pend = { joined: [], left: [], updated: [] };
    for (const h of handlers) h(ch);
  };
  const queue = (kind, obj) => {
    pend[kind].push(obj);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 16);
    }
  };
  const send = () => !left && bc.postMessage({ t: 'pres', peer, p: mine });
  bc.onmessage = (e) => {
    const m = e.data;
    if (left) return;
    if (m.t === 'pres') {
      const had = others.get(m.peer);
      const obj = Object.freeze({ peer: m.peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(m.p), updatedAt: Date.now() });
      others.set(m.peer, { obj, last: Date.now() });
      queue(had ? 'updated' : 'joined', obj);
      if (!had) send();
    } else if (m.t === 'bye') {
      const had = others.get(m.peer);
      if (had) {
        others.delete(m.peer);
        queue('left', had.obj);
      }
    }
  };
  const iv = setInterval(() => {
    send();
    const now = Date.now();
    for (const [k, o] of others) {
      if (now - o.last > 12000) {
        others.delete(k);
        queue('left', o.obj);
      }
    }
  }, 1000);
  send();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => !left && bc.postMessage({ t: 'bye', peer }));
  const api = {
    name,
    presence(patch) {
      // like the real rooms: a patch that would make the presence too big is refused and changes nothing
      const next = { ...mine };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      const size = new TextEncoder().encode(JSON.stringify(next)).length;
      if (size > 4096) return Promise.reject({ code: 'invalid_argument', message: 'presence over 4 KiB: ' + size });
      mine = next;
      myUpdated = Date.now();
      send();
      queue('updated', build()[0]);
      return Promise.resolve();
    },
    peers: () => snapshot,
    onPeers(fn) {
      handlers.add(fn);
      setTimeout(() => fn({ peers: snapshot, joined: snapshot.slice(), left: [], updated: [] }), 0);
      return () => handlers.delete(fn);
    },
    connected: () => true,
    onConnection(fn) {
      setTimeout(() => fn(true), 0);
      return () => {};
    },
    leave() {
      left = true;
      bc.postMessage({ t: 'bye', peer });
      clearInterval(iv);
      bc.close();
      handlers.clear();
      return Promise.resolve();
    },
  };
  return api;
}

function mockRoom() {
  const peer = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  const lobby = mockChannel('lobby', peer);
  const rooms = new Map();
  return {
    ...lobby,
    async join(name) {
      if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) throw { code: 'invalid_argument' };
      if (!rooms.has(name)) rooms.set(name, mockChannel(name, peer));
      const r = rooms.get(name);
      const leave = r.leave;
      r.leave = () => {
        rooms.delete(name);
        return leave();
      };
      return r;
    },
  };
}
