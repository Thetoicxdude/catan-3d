// Maps players publish from the map workshop (the self-hosted site only).
//
//   GET  /api/maps?sort=new|top|played&page=N   the public list (24 a page, no drafts)
//   GET  /api/maps?mine=1                        the signed-in player's maps (listed or not) and how
//                                                many an account may have
//   GET  /api/maps/<code>                        one map at its newest version, with its draft
//   GET  /api/maps/<code>?rev=N                  one version of it (never changes: cached for a day)
//   POST /api/maps            {draft}            publish (signed in) → {code, rev, cid}; the same draft
//                                                again gives the same code
//   POST /api/maps/<code>     {draft}            the author's new version of the map: the same code,
//                                                the next revision → {code, rev, cid}
//   POST /api/maps/<code>/hide  {hidden}         take your map off the list, or back onto it (its code
//                                                keeps working either way)
//   POST /api/maps/<code>/delete                 delete your map: its code no longer opens it
//   POST /api/maps/<code>/rate  {stars: 1–5}     rate a map (signed in, not your own; once, changeable)
//   POST /api/maps/<code>/play                   a campaign started on the map
//
// A map is stored as its draft (src/engine/custom.js): the server checks it with the same code the
// editor uses, and every page makes the same map definition from it. An account has at most MAX_MAPS
// maps (2026-11-20, the user: maps are edited, not published again). A map edited gets a new revision
// under the same code; a game, a room or a saved campaign names the revision it began on (map id
// `u-CODE.N`, revision 0 `u-CODE`), so the versions replaced, and a deleted map's last one, are kept
// for KEEP_DAYS for the rooms still playing them. The rows live in the accounts Durable Object, next to
// the players who published them.
import { normalizeDraft, checkDraft, draftId } from '../src/engine/custom.js';

export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const MAX_DRAFT = 8192; // bytes of JSON
const PAGE = 24;
export const MAX_MAPS = 5; // maps an account may have
const DAY_ACTIONS = 20; // publications, new versions and deletions an account may make a day
const DAY = 86400000;
const KEEP_DAYS = 30; // how long a version replaced (or a deleted map) still opens by its revision

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

// a status for what the rows answered
const STATUS = { signed_out: 401, not_found: 404, not_yours: 403, own_map: 403, full: 403, limit: 429, busy: 503 };
const answer = (out) => json(out, out.error ? STATUS[out.error] || 400 : 200);

// a map sent to publish, checked as the editor checks it, as it is stored (or why it cannot be one)
export function draftRow(raw) {
  if (!raw || typeof raw !== 'object' || JSON.stringify(raw).length > MAX_DRAFT) return { error: 'bad_map', message: '地圖資料不正確' };
  const draft = normalizeDraft(raw);
  draft.name = draft.name.replace(BAD_CHARS, '').trim() || '未命名的島嶼';
  const check = checkDraft(draft);
  if (check.errors.length) return { error: 'bad_map', message: check.errors[0] };
  return { draft: JSON.stringify(check.draft), cid: draftId(check.draft), name: check.draft.name, kit: check.draft.kit, tiles: check.stats.land };
}
async function readDraft(request) {
  const body = await readJson(request);
  return draftRow(body && body.draft);
}

// (a map changed or deleted: this place's cached copy of its newest version goes; elsewhere it lasts
// its minute)
async function uncache(url, code) {
  try {
    if (typeof caches !== 'undefined' && caches.default) await caches.default.delete(new Request(`${url.origin}/api/maps/${code}`, { method: 'GET' }));
  } catch {
    /* no cache here */
  }
}

export async function handleMaps(request, url, store, hash, now = Date.now()) {
  const parts = url.pathname.split('/').filter(Boolean); // api, maps, <code>, <verb>
  const code = parts[2] || null;
  const verb = parts[3] || null;
  if (code && !CODE_RE.test(code)) return json({ error: 'not_found' }, 404);

  if (request.method === 'GET' && !code) {
    if (url.searchParams.get('mine')) {
      if (!hash) return json({ error: 'signed_out' }, 401);
      return answer(await store.mineMaps(hash, now));
    }
    const sort = ['new', 'top', 'played'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'new';
    const page = Math.min(50, Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0));
    return cached(request, 30, async () => json({ maps: await store.listMaps(sort, page * PAGE, PAGE), page, size: PAGE }));
  }
  if (request.method === 'GET' && code && !verb) {
    const rv = url.searchParams.get('rev');
    if (rv !== null) {
      // one version: it never changes
      if (!/^\d{1,6}$/.test(rv)) return json({ error: 'not_found' }, 404);
      return cached(request, 86400, async () => {
        const m = await store.getMap(code, Number(rv));
        return m ? json({ map: m }) : json({ error: 'not_found' }, 404);
      });
    }
    // the newest version (its author may change it: a minute at the edge)
    return cached(request, 60, async () => {
      const m = await store.getMap(code);
      return m ? json({ map: m }) : json({ error: 'not_found' }, 404);
    });
  }
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
  if (!hash && verb !== 'play') return json({ error: 'signed_out' }, 401);
  if (!code) {
    const m = await readDraft(request);
    if (m.error) return json(m, 400);
    return answer(await store.publishMap(hash, m, now));
  }
  if (!verb) {
    const m = await readDraft(request);
    if (m.error) return json(m, 400);
    const out = await store.updateMap(hash, code, m, now);
    if (!out.error && !out.again) await uncache(url, code);
    return answer(out);
  }
  if (verb === 'rate') {
    const body = await readJson(request);
    const stars = body && Number.isInteger(body.stars) && body.stars >= 1 && body.stars <= 5 ? body.stars : 0;
    if (!stars) return json({ error: 'bad_rating' }, 400);
    return answer(await store.rateMap(hash, code, stars, now));
  }
  if (verb === 'hide') {
    // ({hidden: false} puts it back on the list; an older page sends nothing and means off it)
    const body = await readJson(request);
    return answer(await store.hideMap(hash, code, !(body && body.hidden === false), now));
  }
  if (verb === 'delete') {
    const out = await store.deleteMap(hash, code, now);
    if (!out.error) await uncache(url, code);
    return answer(out);
  }
  if (verb === 'play') {
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
const draftOf = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const MapRows = {
  mapsInit() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS maps (
      code TEXT PRIMARY KEY, sub TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL, kit INTEGER NOT NULL, tiles INTEGER NOT NULL,
      cid TEXT NOT NULL, draft TEXT NOT NULL, at INTEGER NOT NULL, plays INTEGER NOT NULL DEFAULT 0,
      rsum INTEGER NOT NULL DEFAULT 0, rcount INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)`);
    // (2026-11-20: maps are edited; `rev` is the newest version's number, the first one 0)
    let hasRev = false;
    try {
      hasRev = this.sql.exec('PRAGMA table_info(maps)').toArray().some((c) => c.name === 'rev');
    } catch {
      try {
        this.sql.exec('SELECT rev FROM maps LIMIT 0').toArray();
        hasRev = true;
      } catch {
        hasRev = false;
      }
    }
    if (!hasRev) {
      try {
        this.sql.exec('ALTER TABLE maps ADD COLUMN rev INTEGER NOT NULL DEFAULT 0');
      } catch (e) {
        console.error('maps: adding rev', e);
      }
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS maps_list ON maps (hidden, at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS maps_sub ON maps (sub, cid)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS ratings (code TEXT NOT NULL, sub TEXT NOT NULL, stars INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code, sub))');
    // the versions replaced, and the last of a map deleted (at: when), for the rooms still playing them
    this.sql.exec('CREATE TABLE IF NOT EXISTS map_revs (code TEXT NOT NULL, rev INTEGER NOT NULL, sub TEXT NOT NULL, author TEXT NOT NULL, draft TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code, rev))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS map_revs_sub ON map_revs (sub, at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS map_revs_at ON map_revs (at)');
  },

  // what an account did with its maps in the last day: maps published, versions replaced, maps deleted
  mapActions(sub, now) {
    const r = this.one('SELECT (SELECT COUNT(*) FROM maps WHERE sub = ? AND at > ?) + (SELECT COUNT(*) FROM map_revs WHERE sub = ? AND at > ?) AS c', sub, now - DAY, sub, now - DAY);
    return r ? r.c : 0;
  },

  // a version put aside (replaced, or its map deleted), and those older than KEEP_DAYS dropped
  keepRev(code, r, sub, now) {
    this.run('INSERT OR REPLACE INTO map_revs (code, rev, sub, author, draft, at) VALUES (?, ?, ?, ?, ?, ?)', code, r.rev, sub, r.author, r.draft, now);
    this.run('DELETE FROM map_revs WHERE at < ?', now - KEEP_DAYS * DAY);
  },

  publishMap(hash, m, now) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    // the same draft again: the code it already has
    const same = this.one('SELECT code, rev FROM maps WHERE sub = ? AND cid = ?', s.sub, m.cid);
    if (same) {
      this.run('UPDATE maps SET hidden = 0 WHERE code = ?', same.code);
      return { code: same.code, rev: same.rev, cid: m.cid, again: true };
    }
    const all = this.one('SELECT COUNT(*) AS c FROM maps WHERE sub = ?', s.sub);
    if (all && all.c >= MAX_MAPS) return { error: 'full', max: MAX_MAPS, message: '每個帳號最多 5 張地圖：在「我的地圖」刪掉一張，或編輯已發布的地圖' };
    if (this.mapActions(s.sub, now) >= DAY_ACTIONS) return { error: 'limit', message: '今天發布與更新的次數太多了，明天再來' };
    const u = this.one('SELECT name FROM users WHERE sub = ?', s.sub);
    for (let i = 0; i < 8; i++) {
      const code = newCode();
      // (nor a code whose versions are still kept: a room may be playing them)
      if (this.one('SELECT code FROM maps WHERE code = ?', code) || this.one('SELECT code FROM map_revs WHERE code = ? LIMIT 1', code)) continue;
      this.run('INSERT INTO maps (code, sub, author, name, kit, tiles, cid, draft, at, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)', code, s.sub, (u && u.name) || '玩家', m.name, m.kit, m.tiles, m.cid, m.draft, now);
      return { code, rev: 0, cid: m.cid };
    }
    return { error: 'busy', message: '請再試一次' };
  },

  // the author's new version: the same code, the next revision (the ratings and plays stay)
  updateMap(hash, code, m, now) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    const r = this.one('SELECT sub, author, draft, cid, rev FROM maps WHERE code = ?', code);
    if (!r) return { error: 'not_found', message: '找不到這張地圖' };
    if (r.sub !== s.sub) return { error: 'not_yours', message: '只有作者可以修改這張地圖' };
    if (r.cid === m.cid) return { code, rev: r.rev, cid: r.cid, again: true };
    if (this.mapActions(s.sub, now) >= DAY_ACTIONS) return { error: 'limit', message: '今天發布與更新的次數太多了，明天再來' };
    this.keepRev(code, r, s.sub, now);
    const u = this.one('SELECT name FROM users WHERE sub = ?', s.sub);
    this.run('UPDATE maps SET author = ?, name = ?, kit = ?, tiles = ?, cid = ?, draft = ?, rev = ? WHERE code = ?', (u && u.name) || r.author, m.name, m.kit, m.tiles, m.cid, m.draft, r.rev + 1, code);
    return { code, rev: r.rev + 1, cid: m.cid };
  },

  // a map at its newest version, or (rev) at one version: the newest, one replaced, or the last of a
  // map since deleted (while kept)
  getMap(code, rev = null) {
    const r = this.one('SELECT * FROM maps WHERE code = ?', code);
    if (r && (rev === null || rev === r.rev)) {
      const draft = draftOf(r.draft);
      return draft ? { ...pub(r), rev: r.rev, cid: r.cid, listed: !r.hidden, draft } : null;
    }
    if (rev === null) return null;
    const o = this.one('SELECT author, draft FROM map_revs WHERE code = ? AND rev = ?', code, rev);
    const draft = o && draftOf(o.draft);
    if (!draft) return null;
    return { code, rev, name: String(draft.name || ''), author: r ? r.author : o.author, kit: draft.kit === 6 ? 6 : 4, draft, old: true };
  },

  listMaps(sort, offset, limit) {
    // best rated: an average pulled towards 3 stars until a map has a few votes
    const order = sort === 'top' ? '(rsum + 6.0) / (rcount + 2) DESC, plays DESC, at DESC' : sort === 'played' ? 'plays DESC, at DESC' : 'at DESC';
    return this.sql.exec(`SELECT code, name, author, kit, tiles, at, plays, rsum, rcount FROM maps WHERE hidden = 0 ORDER BY ${order} LIMIT ? OFFSET ?`, limit, offset).toArray().map(pub);
  },

  // the player's maps, on the list or not, and how many an account may have
  mineMaps(hash, now) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    const rows = this.sql.exec('SELECT code, name, author, kit, tiles, at, plays, rsum, rcount, rev, cid, hidden FROM maps WHERE sub = ? ORDER BY at DESC LIMIT 60', s.sub).toArray();
    return { maps: rows.map((r) => ({ ...pub(r), rev: r.rev, cid: r.cid, listed: !r.hidden })), max: MAX_MAPS };
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

  hideMap(hash, code, hidden = true, now = Date.now()) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    const m = this.one('SELECT sub FROM maps WHERE code = ?', code);
    if (!m || m.sub !== s.sub) return { error: 'not_yours' };
    this.run('UPDATE maps SET hidden = ? WHERE code = ?', hidden ? 1 : 0, code);
    return { ok: true, listed: !hidden };
  },

  // the author deletes a map: off the list, its code no longer opens it, a place free for another;
  // its versions stay KEEP_DAYS for the rooms still playing them
  deleteMap(hash, code, now) {
    const s = this.session(hash, now);
    if (!s) return { error: 'signed_out' };
    const r = this.one('SELECT sub, author, draft, rev FROM maps WHERE code = ?', code);
    if (!r || r.sub !== s.sub) return { error: 'not_yours' };
    this.keepRev(code, r, s.sub, now);
    this.run('DELETE FROM maps WHERE code = ?', code);
    this.run('DELETE FROM ratings WHERE code = ?', code);
    return { ok: true };
  },

  playMap(code) {
    this.run('UPDATE maps SET plays = plays + 1 WHERE code = ?', code);
    return true;
  },
};
