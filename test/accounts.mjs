// Sign-in and player records.
//   node test/accounts.mjs              checks the Google ID token checks and the result validation
//   node test/accounts.mjs --keys DIR   makes a test signing key in DIR (keys.json = private key,
//                                       dev.vars = the line to put in .dev.vars for `wrangler dev`)
//   node test/accounts.mjs --token DIR SUB [NAME]   a token signed with that key (browser tests)
//   API=http://127.0.0.1:8787 KEYS=DIR node test/accounts.mjs
//                                       also signs in against a local server started with that .dev.vars
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { verifyIdToken, TokenError } from '../server/google.js';
import { GOOGLE_CLIENT_ID } from '../server/config.js';

const subtle = globalThis.crypto.subtle;
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function makeKey(kid) {
  const kp = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pub = await subtle.exportKey('jwk', kp.publicKey);
  const priv = await subtle.exportKey('jwk', kp.privateKey);
  return { kid, pub: { kty: pub.kty, n: pub.n, e: pub.e, alg: 'RS256', use: 'sig', kid }, priv };
}

async function sign(key, claims, header = {}) {
  const priv = await subtle.importKey('jwk', key.priv, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }));
  const p = b64url(JSON.stringify(claims));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64url(sig)}`;
}

const now = Math.floor(Date.now() / 1000);
const good = (over = {}) => ({ iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT_ID, sub: '109876543210987654321', name: '測試玩家', picture: 'https://lh3.googleusercontent.com/a/test', email: 'should-not-be-kept@example.com', iat: now - 10, exp: now + 3600, ...over });

const args = process.argv.slice(2);
// a signed test token for the browser tests: --token DIR SUB [NAME]
if (args[0] === '--token') {
  const key = JSON.parse(readFileSync(`${args[1]}/keys.json`, 'utf8'));
  console.log(await sign(key, good({ sub: args[2], name: args[3] || '測試玩家' })));
  process.exit(0);
}
if (args[0] === '--keys') {
  const dir = args[1];
  mkdirSync(dir, { recursive: true });
  const key = await makeKey('test-' + Date.now().toString(36));
  writeFileSync(`${dir}/keys.json`, JSON.stringify(key));
  writeFileSync(`${dir}/dev.vars`, `TEST_JWKS=${JSON.stringify({ keys: [key.pub] })}\n`);
  console.log('test key written to', dir);
  process.exit(0);
}

// ── the token checks ──
{
  const key = await makeKey('k1');
  const other = await makeKey('k2');
  let fetched = 0;
  const keys = async () => {
    fetched++;
    return [key.pub];
  };
  const claims = await verifyIdToken(await sign(key, good()), GOOGLE_CLIENT_ID, keys);
  assert.equal(claims.sub, '109876543210987654321');
  const bad = async (token, why) => {
    await assert.rejects(() => verifyIdToken(token, GOOGLE_CLIENT_ID, keys), (e) => e instanceof TokenError, why);
  };
  await bad(await sign(key, good({ aud: 'someone-else.apps.googleusercontent.com' })), 'another site');
  await bad(await sign(key, good({ iss: 'https://evil.example' })), 'another issuer');
  await bad(await sign(key, good({ exp: now - 3600 })), 'expired');
  await bad(await sign(key, good({ iat: now + 3600 })), 'from the future');
  await bad(await sign(key, good({ sub: '' })), 'no subject');
  await bad(await sign(other, good(), { kid: 'k1' }), 'signed by another key');
  await bad(await sign(key, good(), { alg: 'none' }), 'unsigned');
  await bad('a.b', 'malformed');
  await bad(12, 'not a string');
  const t = await sign(key, good());
  const [h, , s] = t.split('.');
  await bad(`${h}.${b64url(JSON.stringify(good({ sub: '1' })))}.${s}`, 'changed claims');
  // an unknown key id makes it look again (Google rotates keys), once
  const before = fetched;
  await bad(await sign(other, good(), { kid: 'nope' }), 'unknown key');
  assert.equal(fetched - before, 2);
  console.log('token checks ok');
}

// ── the result checks ──
{
  // the server module needs the Workers runtime (cloudflare:workers); the validation is plain JS
  const src = readFileSync(new URL('../server/accounts.js', import.meta.url), 'utf8');
  const start = src.indexOf('export function cleanResult');
  const end = src.indexOf('\n}\n', start) + 3;
  const MODES = ['single', 'hotseat', 'online', 'official'];
  const cleanResult = new Function('MODES', src.slice(start, end).replace('export function', 'return function'))(MODES);
  const ok = { gid: 's:12345:678', mode: 'single', won: true, vp: 10, place: 1, n: 4, turns: 40 };
  assert.deepEqual(cleanResult(ok), { ...ok, won: 1 });
  assert.equal(cleanResult({ ...ok, place: 2 }), null, 'a win is first place');
  assert.equal(cleanResult({ ...ok, vp: 99 }), null);
  assert.equal(cleanResult({ ...ok, mode: 'ranked' }), null);
  assert.equal(cleanResult({ ...ok, gid: 'x' }), null);
  assert.equal(cleanResult({ ...ok, gid: '<script>' }), null);
  assert.equal(cleanResult({ ...ok, won: 'yes' }), null);
  assert.deepEqual(cleanResult({ ...ok, won: false, place: 6, n: 6 }), { ...ok, won: 0, place: 6, n: 6 }, 'six-player games count');
  assert.equal(cleanResult({ ...ok, won: false, place: 5, n: 4 }), null, 'no place below the last');
  assert.equal(cleanResult({ ...ok, n: 7 }), null);
  console.log('result checks ok');
}

// ── against a local server ──
if (process.env.API && process.env.KEYS) {
  const api = process.env.API.replace(/\/$/, '');
  const key = JSON.parse(readFileSync(`${process.env.KEYS}/keys.json`, 'utf8'));
  let cookie = '';
  const call = async (path, body, method = body ? 'POST' : 'GET') => {
    const res = await fetch(api + path, { method, headers: { origin: api, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = /cs=([^;]*)/.exec(set)[1] ? 'cs=' + /cs=([^;]*)/.exec(set)[1] : '';
    return { status: res.status, body: await res.json(), set };
  };
  const sub = 'test' + Date.now();
  assert.equal((await call('/api/me')).body.user, null);
  const forged = await call('/api/login', { credential: await sign(await makeKey(key.kid), good({ sub })) });
  assert.equal(forged.status, 401, 'a token not signed by the known key is refused');
  const login = await call('/api/login', { credential: await sign(key, good({ sub })) });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.match(login.set, /HttpOnly/);
  assert.equal(login.body.user.name, '測試玩家');
  assert.equal(JSON.stringify(login.body).includes('example.com'), false, 'no email kept');
  assert.equal((await call('/api/me')).body.user.games, 0);
  const r1 = await call('/api/result', { gid: 'online:abcde:123', mode: 'online', won: true, vp: 10, place: 1, n: 4, turns: 52 });
  assert.equal(r1.body.recorded, true);
  const again = await call('/api/result', { gid: 'online:abcde:123', mode: 'online', won: true, vp: 10, place: 1, n: 4, turns: 52 });
  assert.equal(again.body.recorded, false, 'the same game counts once');
  await call('/api/result', { gid: 's:99:1', mode: 'single', won: false, vp: 7, place: 3, n: 4, turns: 61 });
  const me = (await call('/api/me')).body.user;
  assert.deepEqual([me.games, me.wins, me.vp, me.best, me.online, me.onlineWins, me.recent.length], [2, 1, 17, 10, 1, 1, 2]);
  // a request from another site is refused
  const cross = await fetch(api + '/api/result', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', cookie }, body: JSON.stringify({ gid: 's:1:2', mode: 'single', won: true, vp: 10, place: 1, n: 2, turns: 3 }) });
  assert.equal(cross.status, 403);
  const saved = cookie;
  await call('/api/logout', {});
  cookie = saved; // the old session no longer works
  assert.equal((await call('/api/me')).body.user, null);
  await call('/api/login', { credential: await sign(key, good({ sub })) });
  assert.equal((await call('/api/me')).body.user.games, 2, 'the record is kept across sign-ins');
  await call('/api/forget', {});
  await call('/api/login', { credential: await sign(key, good({ sub })) });
  assert.equal((await call('/api/me')).body.user.games, 0, 'forgotten');
  await call('/api/forget', {});
  console.log('server sign-in flow ok');

  // ── maps players publish ──
  const { DRAFTS } = await import('./drafts.mjs');
  const { draftToDef } = await import('../src/engine/custom.js');
  const as = async (who) => {
    let ck = '';
    const c = async (path, body, method = body ? 'POST' : 'GET') => {
      const res = await fetch(api + path, { method, headers: { origin: api, 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) ck = 'cs=' + /cs=([^;]*)/.exec(set)[1];
      return { status: res.status, body: await res.json() };
    };
    const li = await c('/api/login', { credential: await sign(key, good({ sub: who, name: who.slice(0, 6) })) });
    assert.equal(li.status, 200);
    return c;
  };
  const author = await as('map-author-' + Date.now());
  const fan = await as('map-fan-' + Date.now());
  const pubd = await author('/api/maps', { draft: DRAFTS.twin });
  assert.equal(pubd.status, 200, JSON.stringify(pubd.body));
  const code = pubd.body.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.deepEqual((await author('/api/maps', { draft: JSON.parse(JSON.stringify(DRAFTS.twin)) })).body, { code, again: true }, 'the same draft keeps its code');
  const bad = await author('/api/maps', { draft: { cells: [] } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.message, '先在格子上畫出陸地');
  assert.equal((await fan('/api/maps', { draft: { ...DRAFTS.ring, cells: new Array(5000).fill([0, 0, 'l']) } })).status, 400, 'too big to read');
  const anon = await fetch(api + '/api/maps', { method: 'POST', headers: { origin: api, 'content-type': 'application/json' }, body: JSON.stringify({ draft: DRAFTS.ring }) });
  assert.equal(anon.status, 401, 'publishing needs a player');
  // anyone reads it, and makes the same map from it
  const got = await (await fetch(api + '/api/maps/' + code)).json();
  assert.equal(got.map.name, DRAFTS.twin.name);
  assert.equal(got.map.kit, 6);
  assert.deepEqual(draftToDef(got.map.draft, 'u-' + code), draftToDef(DRAFTS.twin, 'u-' + code));
  assert.equal((await fetch(api + '/api/maps/ABCDEF')).status, 404);
  assert.equal((await fetch(api + '/api/maps/abc')).status, 404);
  const list = await (await fetch(api + '/api/maps?sort=new&t=' + Date.now())).json();
  assert.ok(list.maps.some((m) => m.code === code && !m.draft), 'listed, without its draft');
  // ratings: not your own; once each, and changeable
  assert.equal((await author(`/api/maps/${code}/rate`, { stars: 5 })).status, 403);
  assert.equal((await fan(`/api/maps/${code}/rate`, { stars: 9 })).status, 400);
  assert.deepEqual((await fan(`/api/maps/${code}/rate`, { stars: 4 })).body, { ok: true, mine: 4, rating: 4, votes: 1 });
  assert.deepEqual((await fan(`/api/maps/${code}/rate`, { stars: 2 })).body, { ok: true, mine: 2, rating: 2, votes: 1 });
  await fan(`/api/maps/${code}/play`, {});
  const mine = (await author('/api/maps?mine=1')).body.maps;
  assert.deepEqual(mine.map((m) => [m.code, m.plays, m.rating, m.votes]), [[code, 1, 2, 1]]);
  // only the author takes it off the list; the code still opens it
  assert.equal((await fan(`/api/maps/${code}/hide`, {})).status, 403);
  assert.equal((await author(`/api/maps/${code}/hide`, {})).status, 200);
  const after = await (await fetch(api + '/api/maps?sort=new&t=' + Date.now() + 1)).json();
  assert.ok(!after.maps.some((m) => m.code === code), 'off the list');
  assert.equal((await author('/api/maps?mine=1')).body.maps.length, 0);
  assert.equal((await fetch(api + '/api/maps/' + code + '?t=' + Date.now())).status, 200, 'the code keeps working');
  // a player who leaves takes their name and ratings along
  await fan('/api/forget', {});
  await author('/api/forget', {});
  const gone = await (await fetch(api + '/api/maps/' + code + '?t=' + Date.now() + 2)).json();
  assert.deepEqual([gone.map.author, gone.map.votes], ['已刪除的帳號', 0]);
  console.log('server map flow ok');
}
