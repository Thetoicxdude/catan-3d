// Protocol test for the room server (server/worker.js) against `wrangler dev`:
//   npx wrangler dev --port 8787   then   node test/rooms.mjs [http://127.0.0.1:8787]
import http from 'node:http';
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/^http/, 'ws');
const ROOM = 'test-' + Math.random().toString(36).slice(2, 8);
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(peer, room = ROOM, opts) {
  const ws = new WebSocket(`${BASE}/rooms/${room}?peer=${peer}`, opts);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = e.data === 'pong' ? { t: 'pong' } : JSON.parse(e.data);
    inbox.push(m);
    for (const w of [...waiters]) if (w.test(m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
  };
  const closed = new Promise((r) => (ws.onclose = (e) => r(e.code)));
  const opened = new Promise((r, j) => {
    ws.onopen = () => r();
    ws.onerror = (e) => j(e);
  });
  opened.catch(() => {}); // a refused socket is checked through `closed`
  return {
    ws,
    inbox,
    closed,
    opened,
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    next(test, ms = 3000) {
      const hit = inbox.find(test);
      if (hit) {
        inbox.splice(inbox.indexOf(hit), 1);
        return Promise.resolve(hit);
      }
      return new Promise((resolve, reject) => {
        const w = { test, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error('timeout waiting'));
          }
        }, ms);
      }).then((m) => {
        inbox.splice(inbox.indexOf(m), 1);
        return m;
      });
    },
  };
}

const A = client('peeraaaa01');
await A.opened;
A.send({ t: 'hello', id: 0, p: { app: 'catan3d', x: 1 } });
const snapA = await A.next((m) => m.t === 'snap');
ok(snapA.me === 'peeraaaa01' && snapA.peers.length === 0, 'first peer gets an empty snapshot');

const B = client('peerbbbb01');
await B.opened;
B.send({ t: 'hello', id: 0, p: { y: 2 } });
const snapB = await B.next((m) => m.t === 'snap');
ok(snapB.peers.length === 1 && snapB.peers[0].peer === 'peeraaaa01' && snapB.peers[0].presence.x === 1, 'second peer sees the first with its presence');
const joinB = await A.next((m) => m.t === 'join');
ok(joinB.p.peer === 'peerbbbb01' && joinB.p.presence.y === 2, 'first peer is told about the join');

A.send({ t: 'pres', id: 7, p: { x: 2, gone: null } });
ok((await A.next((m) => m.t === 'ack')).id === 7, 'presence patch acknowledged');
const upd = await B.next((m) => m.t === 'upd');
ok(upd.p.peer === 'peeraaaa01' && upd.p.presence.x === 2 && upd.p.presence.app === 'catan3d', 'patch merged and broadcast');

A.send({ t: 'pres', id: 8, p: { big: 'x'.repeat(4100) } });
const err = await A.next((m) => m.t === 'err');
ok(err.id === 8 && err.code === 'invalid_argument', 'presence over 4 KiB rejected');
A.send({ t: 'pres', id: 9, p: { del: null } });
await A.next((m) => m.t === 'ack' && m.id === 9);
const upd2 = await B.next((m) => m.t === 'upd');
ok(!('big' in upd2.p.presence), 'rejected patch was not applied');

A.send('ping');
ok((await A.next((m) => m.t === 'pong')).t === 'pong', 'ping answered');

// the same tab reconnecting while its old socket still looks open: an update, not leave + join
const B2 = client('peerbbbb01');
await B2.opened;
B2.send({ t: 'hello', id: 0, p: { y: 3 } });
const snapB2 = await B2.next((m) => m.t === 'snap');
ok(snapB2.peers.length === 1, 'reconnected tab gets the room');
const code = await B.closed;
ok(code === 4001, `old socket closed as replaced (${code})`);
const upd3 = await A.next((m) => m.t === 'upd' || m.t === 'left' || m.t === 'join');
ok(upd3.t === 'upd' && upd3.p.presence.y === 3, `others see an update (${upd3.t})`);
await sleep(300);
ok(!A.inbox.some((m) => m.t === 'left'), 'no leave reported for the replaced socket');

// a third peer, then a clean leave
const C = client('peercccc01');
await C.opened;
C.send({ t: 'hello', id: 0, p: {} });
const snapC = await C.next((m) => m.t === 'snap');
ok(snapC.peers.length === 2, 'third peer sees both');
await A.next((m) => m.t === 'join');
B2.ws.close(1000, 'leave');
const left = await A.next((m) => m.t === 'left');
ok(left.peer === 'peerbbbb01', 'leave broadcast');
const leftC = await C.next((m) => m.t === 'left');
ok(leftC.peer === 'peerbbbb01', 'leave broadcast to everyone');

// rooms are separate
const D = client('peerdddd01', ROOM + '-other');
await D.opened;
D.send({ t: 'hello', id: 0, p: {} });
ok((await D.next((m) => m.t === 'snap')).peers.length === 0, 'another room is separate');

// bad requests: the handshake is refused
const refused = async (c) => {
  try {
    await Promise.race([c.opened, sleep(3000).then(() => Promise.reject(new Error('no answer')))]);
    c.ws.close();
    return false;
  } catch {
    return true;
  }
};
ok(await refused(client('NOT-OK')), 'bad peer id refused');
const status = await new Promise((resolve) => {
  const u = new URL(BASE.replace(/^ws/, 'http') + `/rooms/${ROOM}?peer=peereeee01`);
  const req = http.request({
    host: u.hostname,
    port: u.port,
    path: u.pathname + u.search,
    headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: 'https://evil.example' },
  });
  req.on('response', (r) => resolve(r.statusCode));
  req.on('upgrade', (r, sock) => {
    sock.destroy();
    resolve(101);
  });
  req.on('error', () => resolve(0));
  req.end();
});
ok(status === 403, `foreign origin refused (${status})`);

for (const c of [A, C, D]) c.ws.close(1000);
await sleep(200);
console.log(failed ? `${failed} FAILED` : 'rooms ok');
process.exit(failed ? 1 : 0);
