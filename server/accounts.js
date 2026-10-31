// Player accounts: "Sign in with Google" and each player's record of finished campaigns.
//
//   POST /api/login   {credential}   a Google ID token from the page → sets the session cookie
//   GET  /api/me                      the signed-in player and their record (or {user: null})
//   POST /api/result  {gid, mode, won, vp, place, n, turns}   a finished campaign (once per game)
//   POST /api/logout                  ends the session
//   POST /api/forget                  deletes the player's account and record
//
// Only the Google account's id (`sub`), its display name and its picture are kept: no email address.
// Results are reported by each player's own page, so the record is a personal one (nothing here is
// ranked against other players).
//
// Everything lives in one SQLite Durable Object ("accounts"): a few rows per sign-in and per finished
// campaign, well inside the free plan.
import { DurableObject } from 'cloudflare:workers';
import { GOOGLE_CLIENT_ID } from './config.js';
import { verifyIdToken, googleKeys, TokenError } from './google.js';

const COOKIE = 'cs';
const SESSION_DAYS = 30;
const DAY = 86400000;
const MODES = ['single', 'hotseat', 'online', 'official'];

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

function readCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sessionCookie(token, secure, maxAge) {
  return `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// requests that change something must come from a page of this site (or the developer's own machine)
function sameSite(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return o.host === url.host || o.hostname === '127.0.0.1' || o.hostname === 'localhost';
  } catch {
    return false;
  }
}

// signing keys: Google's, or (local test runs only) a test set given in TEST_JWKS
function keySource(env) {
  if (env.TEST_JWKS) {
    const keys = JSON.parse(env.TEST_JWKS).keys || [];
    return async () => keys;
  }
  return googleKeys;
}

// control characters and invisible formatting marks
const BAD_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

function cleanText(s, max) {
  return String(s || '')
    .replace(BAD_CHARS, '')
    .trim()
    .slice(0, max);
}

export function cleanResult(r) {
  if (!r || typeof r !== 'object') return null;
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const gid = typeof r.gid === 'string' && /^[A-Za-z0-9:_.-]{4,80}$/.test(r.gid) ? r.gid : null;
  const mode = MODES.includes(r.mode) ? r.mode : null;
  const vp = int(r.vp, 0, 30);
  const place = int(r.place, 1, 4);
  const n = int(r.n, 2, 4);
  const turns = int(r.turns, 0, 2000);
  if (!gid || !mode || vp == null || place == null || n == null || turns == null || typeof r.won !== 'boolean') return null;
  if (r.won && place !== 1) return null;
  return { gid, mode, won: r.won ? 1 : 0, vp, place, n, turns };
}

export async function handleApi(request, env, url) {
  const path = url.pathname;
  const secure = url.protocol === 'https:';
  if (request.method !== 'GET' && !sameSite(request, url)) return json({ error: 'forbidden' }, 403);
  const store = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'));
  const token = readCookie(request, COOKIE);
  const hash = token && /^[0-9a-f]{64}$/.test(token) ? await sha256hex(token) : null;
  try {
    if (path === '/api/login' && request.method === 'POST') {
      let body = null;
      try {
        body = await request.json();
      } catch {
        /* not JSON */
      }
      let claims;
      try {
        claims = await verifyIdToken(body && body.credential, GOOGLE_CLIENT_ID, keySource(env));
      } catch (e) {
        if (e instanceof TokenError) return json({ error: 'invalid_token', message: e.message }, 401);
        throw e;
      }
      const fresh = randomToken();
      const user = await store.login({ sub: claims.sub, name: cleanText(claims.name || claims.given_name, 40), pic: typeof claims.picture === 'string' && /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//.test(claims.picture) ? claims.picture.slice(0, 400) : '' }, await sha256hex(fresh), Date.now() + SESSION_DAYS * DAY);
      return json({ user }, 200, { 'set-cookie': sessionCookie(fresh, secure, SESSION_DAYS * 86400) });
    }
    if (path === '/api/me' && request.method === 'GET') {
      const user = hash ? await store.me(hash, Date.now()) : null;
      return json({ user }, 200, user || !token ? {} : { 'set-cookie': sessionCookie('', secure, 0) });
    }
    if (path === '/api/result' && request.method === 'POST') {
      if (!hash) return json({ error: 'signed_out' }, 401);
      let body = null;
      try {
        body = await request.json();
      } catch {
        /* not JSON */
      }
      const r = cleanResult(body);
      if (!r) return json({ error: 'bad_result' }, 400);
      const out = await store.result(hash, r, Date.now());
      return json(out, out.error ? 401 : 200);
    }
    if (path === '/api/logout' && request.method === 'POST') {
      if (hash) await store.logout(hash);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', secure, 0) });
    }
    if (path === '/api/forget' && request.method === 'POST') {
      if (!hash) return json({ error: 'signed_out' }, 401);
      await store.forget(hash);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', secure, 0) });
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    console.error('account api', e);
    return json({ error: 'server' }, 500);
  }
}

export class Accounts extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      sub TEXT PRIMARY KEY, name TEXT NOT NULL, pic TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL,
      games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, vp INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0,
      online INTEGER NOT NULL DEFAULT 0, online_wins INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, sub TEXT NOT NULL, exp INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS sessions_sub ON sessions (sub)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS results (
      sub TEXT NOT NULL, gid TEXT NOT NULL, at INTEGER NOT NULL, mode TEXT NOT NULL, won INTEGER NOT NULL, vp INTEGER NOT NULL,
      place INTEGER NOT NULL, n INTEGER NOT NULL, turns INTEGER NOT NULL, PRIMARY KEY (sub, gid))`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS results_recent ON results (sub, at)');
  }

  one(query, ...args) {
    const rows = this.sql.exec(query, ...args).toArray();
    return rows.length ? rows[0] : null;
  }

  // a statement run to the end (its cursor read out), so the count of written rows is final
  run(query, ...args) {
    const c = this.sql.exec(query, ...args);
    c.toArray();
    return c;
  }

  session(hash, now) {
    const s = this.one('SELECT sub, exp FROM sessions WHERE hash = ?', hash);
    if (!s) return null;
    if (s.exp < now) {
      this.run('DELETE FROM sessions WHERE hash = ?', hash);
      return null;
    }
    return s;
  }

  profile(sub) {
    const u = this.one('SELECT * FROM users WHERE sub = ?', sub);
    if (!u) return null;
    const recent = this.sql.exec('SELECT at, mode, won, vp, place, n, turns FROM results WHERE sub = ? ORDER BY at DESC LIMIT 8', sub).toArray();
    return {
      name: u.name,
      pic: u.pic,
      since: u.created,
      games: u.games,
      wins: u.wins,
      vp: u.vp,
      best: u.best,
      online: u.online,
      onlineWins: u.online_wins,
      recent: recent.map((r) => ({ at: r.at, mode: r.mode, won: !!r.won, vp: r.vp, place: r.place, n: r.n, turns: r.turns })),
    };
  }

  login(u, hash, exp) {
    const now = Date.now();
    this.run(
      'INSERT INTO users (sub, name, pic, created, seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sub) DO UPDATE SET name = excluded.name, pic = excluded.pic, seen = excluded.seen',
      u.sub,
      u.name || '玩家',
      u.pic || '',
      now,
      now,
    );
    this.run('INSERT INTO sessions (hash, sub, exp) VALUES (?, ?, ?)', hash, u.sub, exp);
    // a few devices at most: drop the oldest sessions of this account
    this.run('DELETE FROM sessions WHERE sub = ? AND hash NOT IN (SELECT hash FROM sessions WHERE sub = ? ORDER BY exp DESC LIMIT 8)', u.sub, u.sub);
    return this.profile(u.sub);
  }

  me(hash, now) {
    const s = this.session(hash, now);
    if (!s) return null;
    // a session in use stays alive (written at most once every two weeks)
    if (s.exp - now < (SESSION_DAYS / 2) * DAY) this.run('UPDATE sessions SET exp = ? WHERE hash = ?', now + SESSION_DAYS * DAY, hash);
    return this.profile(s.sub);
  }

  result(hash, r, now) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    const today = this.one('SELECT COUNT(*) AS c FROM results WHERE sub = ? AND at > ?', s.sub, now - DAY);
    if (today && today.c >= 200) return { ok: false, why: 'limit' };
    const ins = this.run('INSERT OR IGNORE INTO results (sub, gid, at, mode, won, vp, place, n, turns) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', s.sub, r.gid, now, r.mode, r.won, r.vp, r.place, r.n, r.turns);
    if (ins.rowsWritten > 0) {
      const online = r.mode === 'online' || r.mode === 'official' ? 1 : 0;
      this.run(
        'UPDATE users SET games = games + 1, wins = wins + ?, vp = vp + ?, best = MAX(best, ?), online = online + ?, online_wins = online_wins + ?, seen = ? WHERE sub = ?',
        r.won,
        r.vp,
        r.vp,
        online,
        online && r.won ? 1 : 0,
        now,
        s.sub,
      );
    }
    return { ok: true, recorded: ins.rowsWritten > 0, user: this.profile(s.sub) };
  }

  logout(hash) {
    this.run('DELETE FROM sessions WHERE hash = ?', hash);
    return true;
  }

  forget(hash) {
    const s = this.one('SELECT sub FROM sessions WHERE hash = ?', hash);
    if (!s) return false;
    this.run('DELETE FROM results WHERE sub = ?', s.sub);
    this.run('DELETE FROM sessions WHERE sub = ?', s.sub);
    this.run('DELETE FROM users WHERE sub = ?', s.sub);
    return true;
  }
}
