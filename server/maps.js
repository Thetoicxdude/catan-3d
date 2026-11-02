// Maps players publish from the map workshop (the self-hosted site only).
//
//   GET  /api/maps?sort=new|top|played&page=N   the public list (24 a page, no drafts)
//   GET  /api/maps?mine=1                        the signed-in player's maps
//   GET  /api/maps/<code>                        one map, with its draft (cached at the edge)
//   POST /api/maps            {draft}            publish (signed in) → {code}; the same draft again
//                                                gives the same code
//   POST /api/maps/<code>/rate  {stars: 1–5}     rate a map (signed in, not your own; once, changeable)
//   POST /api/maps/<code>/hide                   take your map off the list (its code keeps working,
//                                                so games and links already made on it go on)
//   POST /api/maps/<code>/play                   a campaign started on the map
//
// A map is stored as its draft (src/engine/custom.js): the server checks it with the same code the
// editor uses, and every page makes the same map definition from it. The rows live in the accounts
// Durable Object, next to the players who published them.
import { normalizeDraft, checkDraft, draftId } from '../src/engine/custom.js';

export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const MAX_DRAFT = 8192; // bytes of JSON
const PAGE = 24;

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

// control characters and invisible formatting marks
const BAD_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_DRAFT * 2) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// edge cache for what anyone may read: one map (it never changes but for its counts) and the list
// (where the Cache API does nothing, or fails, every request simply goes to the rows)
async function cached(request, ttl, make) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = new Request(request.url, { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return hit;
    } catch {
      /* no cache here */
    }
  }
  const res = await make();
  if (res.status !== 200) return res;
  const copy = new Response(res.body, res);
  copy.headers.set('cache-control', `public, max-age=${ttl}`);
  if (cache) {
    try {
      await cache.put(key, copy.clone());
    } catch {
      /* no cache here */
    }
  }
  return copy;
}

export async function handleMaps(request, url, store, hash, now = Date.now()) {
  const parts = url.pathname.split('/').filter(Boolean); // api, maps, <code>, <verb>
  const code = parts[2] || null;
  const verb = parts[3] || null;
  if (code && !CODE_RE.test(code)) return json({ error: 'not_found' }, 404);

  if (request.method === 'GET' && !code) {
    if (url.searchParams.get('mine')) {
      if (!hash) return json({ error: 'signed_out' }, 401);
      return json(await store.mineMaps(hash, now));
    }
    const sort = ['new', 'top', 'played'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'new';
    const page = Math.min(50, Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0));
    return cached(request, 30, async () => json({ maps: await store.listMaps(sort, page * PAGE, PAGE), page, size: PAGE }));
  }
  if (request.method === 'GET' && code && !verb) {
    return cached(request, 300, async () => {
      const m = await store.getMap(code);
      return m ? json({ map: m }) : json({ error: 'not_found' }, 404);
    });
  }
  if (request.method === 'POST' && !code) {
    if (!hash) return json({ error: 'signed_out' }, 401);
    const body = await readJson(request);
    if (!body || !body.draft || JSON.stringify(body.draft).length > MAX_DRAFT) return json({ error: 'bad_map', message: '地圖資料不正確' }, 400);
    const draft = normalizeDraft(body.draft);
    draft.name = draft.name.replace(BAD_CHARS, '').trim() || '未命名的島嶼';
    const check = checkDraft(draft);
    if (check.errors.length) return json({ error: 'bad_map', message: check.errors[0] }, 400);
    const out = await store.publishMap(hash, { draft: JSON.stringify(check.draft), cid: draftId(check.draft), name: check.draft.name, kit: check.draft.kit, tiles: check.stats.tiles }, now);
    return json(out, out.error === 'signed_out' ? 401 : out.error ? 429 : 200);
  }
  if (request.method === 'POST' && code && verb === 'rate') {
    if (!hash) return json({ error: 'signed_out' }, 401);
    const body = await readJson(request);
    const stars = body && Number.isInteger(body.stars) && body.stars >= 1 && body.stars <= 5 ? body.stars : 0;
    if (!stars) return json({ error: 'bad_rating' }, 400);
    const out = await store.rateMap(hash, code, stars, now);
    return json(out, out.error === 'signed_out' ? 401 : out.error === 'not_found' ? 404 : out.error ? 403 : 200);
  }
  if (request.method === 'POST' && code && verb === 'hide') {
    if (!hash) return json({ error: 'signed_out' }, 401);
    const out = await store.hideMap(hash, code);
    return json(out, out.error === 'signed_out' ? 401 : out.error ? 403 : 200);
  }
  if (request.method === 'POST' && code && verb === 'play') {
    await store.playMap(code);
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}

// ── the rows (methods of the accounts Durable Object, see accounts.js) ──
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return [...a].map((x) => ALPHABET[x % 32]).join('');
}
const pub = (r) => ({
  code: r.code,
  name: r.name,
  author: r.author,
  kit: r.kit,
  tiles: r.tiles,
  at: r.at,
  plays: r.plays,
  rating: r.rcount ? Math.round((r.rsum / r.rcount) * 10) / 10 : 0,
  votes: r.rcount,
});

export const MapRows = {
  mapsInit() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS maps (
      code TEXT PRIMARY KEY, sub TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL, kit INTEGER NOT NULL, tiles INTEGER NOT NULL,
      cid TEXT NOT NULL, draft TEXT NOT NULL, at INTEGER NOT NULL, plays INTEGER NOT NULL DEFAULT 0,
      rsum INTEGER NOT NULL DEFAULT 0, rcount INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS maps_list ON maps (hidden, at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS maps_sub ON maps (sub, cid)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS ratings (code TEXT NOT NULL, sub TEXT NOT NULL, stars INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code, sub))');
  },

  publishMap(hash, m, now) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    // the same draft again: the code it already has
    const same = this.one('SELECT code FROM maps WHERE sub = ? AND cid = ?', s.sub, m.cid);
    if (same) {
      this.run('UPDATE maps SET hidden = 0 WHERE code = ?', same.code);
      return { code: same.code, again: true };
    }
    const today = this.one('SELECT COUNT(*) AS c FROM maps WHERE sub = ? AND at > ?', s.sub, now - 86400000);
    if (today && today.c >= 20) return { error: 'limit', message: '今天發布的地圖太多了，明天再來' };
    const all = this.one('SELECT COUNT(*) AS c FROM maps WHERE sub = ? AND hidden = 0', s.sub);
    if (all && all.c >= 60) return { error: 'limit', message: '公開的地圖最多 60 張：先從列表移除一些' };
    const u = this.one('SELECT name FROM users WHERE sub = ?', s.sub);
    for (let i = 0; i < 8; i++) {
      const code = newCode();
      if (this.one('SELECT code FROM maps WHERE code = ?', code)) continue;
      this.run('INSERT INTO maps (code, sub, author, name, kit, tiles, cid, draft, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', code, s.sub, (u && u.name) || '玩家', m.name, m.kit, m.tiles, m.cid, m.draft, now);
      return { code };
    }
    return { error: 'busy', message: '請再試一次' };
  },

  getMap(code) {
    const r = this.one('SELECT * FROM maps WHERE code = ?', code);
    if (!r) return null;
    let draft = null;
    try {
      draft = JSON.parse(r.draft);
    } catch {
      return null;
    }
    return { ...pub(r), listed: !r.hidden, draft };
  },

  listMaps(sort, offset, limit) {
    // best rated: an average pulled towards 3 stars until a map has a few votes
    const order = sort === 'top' ? '(rsum + 6.0) / (rcount + 2) DESC, plays DESC, at DESC' : sort === 'played' ? 'plays DESC, at DESC' : 'at DESC';
    return this.sql.exec(`SELECT code, name, author, kit, tiles, at, plays, rsum, rcount FROM maps WHERE hidden = 0 ORDER BY ${order} LIMIT ? OFFSET ?`, limit, offset).toArray().map(pub);
  },

  mineMaps(hash, now) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    return { maps: this.sql.exec('SELECT code, name, author, kit, tiles, at, plays, rsum, rcount FROM maps WHERE sub = ? AND hidden = 0 ORDER BY at DESC LIMIT 60', s.sub).toArray().map(pub) };
  },

  rateMap(hash, code, stars, now) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    const m = this.one('SELECT sub FROM maps WHERE code = ?', code);
    if (!m) return { error: 'not_found' };
    if (m.sub === s.sub) return { error: 'own_map', message: '不能幫自己的地圖評分' };
    const old = this.one('SELECT stars FROM ratings WHERE code = ? AND sub = ?', code, s.sub);
    if (old) {
      if (old.stars !== stars) {
        this.run('UPDATE ratings SET stars = ?, at = ? WHERE code = ? AND sub = ?', stars, now, code, s.sub);
        this.run('UPDATE maps SET rsum = rsum + ? WHERE code = ?', stars - old.stars, code);
      }
    } else {
      this.run('INSERT INTO ratings (code, sub, stars, at) VALUES (?, ?, ?, ?)', code, s.sub, stars, now);
      this.run('UPDATE maps SET rsum = rsum + ?, rcount = rcount + 1 WHERE code = ?', stars, code);
    }
    const r = this.one('SELECT rsum, rcount FROM maps WHERE code = ?', code);
    return { ok: true, mine: stars, rating: Math.round((r.rsum / r.rcount) * 10) / 10, votes: r.rcount };
  },

  hideMap(hash, code) {
    const s = this.one('SELECT sub FROM sessions WHERE hash = ?', hash);
    if (!s) return { error: 'signed_out' };
    const m = this.one('SELECT sub FROM maps WHERE code = ?', code);
    if (!m || m.sub !== s.sub) return { error: 'not_yours' };
    this.run('UPDATE maps SET hidden = 1 WHERE code = ?', code);
    return { ok: true };
  },

  playMap(code) {
    this.run('UPDATE maps SET plays = plays + 1 WHERE code = ?', code);
    return true;
  },
};
