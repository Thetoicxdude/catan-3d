// Maps players publish from the map workshop (the self-hosted site only; see server/maps.js). A
// published map is known by a six-letter code. Its author may change it: each version is a revision
// (0, 1, 2…) and has its own map id, `u-<code>` for the first and `u-<code>.<rev>` after, so a game,
// a room or a saved campaign keeps the version it began on; opening a code (a link, the list, a code
// typed in) gives the newest. Every page makes the same map definition from a version's draft
// (custom.js).
import { accountsAvailable } from './account.js';
import { draftToDef, normalizeDraft } from '../engine/custom.js';
import { registerMap, knownMap, mapDef } from '../engine/maps.js';
import { N_ } from '../i18n/fill.js';

export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const mapsAvailable = accountsAvailable;
export const publishedId = (code, rev) => (rev ? `u-${code}.${rev}` : `u-${code}`);
const ID_RE = /^u-([A-HJ-NP-Z2-9]{6})(?:\.([1-9]\d{0,5}))?$/;
// a published map's code and revision from its map id (null: not a published map)
export function parsePublished(id) {
  const m = typeof id === 'string' ? ID_RE.exec(id) : null;
  return m ? { code: m[1], rev: m[2] ? Number(m[2]) : 0 } : null;
}
export const publishedCode = (id) => {
  const p = parsePublished(id);
  return p ? p.code : null;
};
// a code as a player may type it (small letters, spaces, a dash)
export const cleanCode = (s) =>
  String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

// (cache: 'no-cache' asks past the browser's own copy, for what may have changed)
async function api(path, body, cache = 'default') {
  const res = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = new Error((data && data.message) || (res.status === 404 ? N_('找不到這張地圖') : res.status === 401 ? N_('請先登入') : N_('伺服器忙碌中，請稍後再試')));
    e.status = res.status;
    e.code = data && data.error;
    throw e;
  }
  return data || {};
}

// the map definition of a published map's version, with who made it
export function publishedDef(m) {
  const rev = Number.isInteger(m.rev) && m.rev > 0 ? m.rev : 0;
  const def = draftToDef(m.draft, publishedId(m.code, rev));
  def.code = m.code;
  def.rev = rev;
  def.author = String(m.author || '').slice(0, 40);
  def.draft = normalizeDraft(m.draft);
  return def;
}
const known = (def) => (knownMap(def.id) ? mapDef(def.id) : registerMap(def));

// a published map fetched and registered (resolves to its definition): one version (`rev`), which
// never changes, fetched once a page; without `rev` the newest, asked once a page (and again after
// this page changed or deleted the map)
const fetching = new Map(); // map id → its definition, coming
const newest = new Map(); // code → the newest version's definition, coming
function once(table, k, make) {
  if (!table.has(k)) {
    const p = make().catch((e) => {
      table.delete(k);
      throw e;
    });
    table.set(k, p);
  }
  return table.get(k);
}
export function loadPublished(code, rev) {
  if (rev === undefined || rev === null) return once(newest, code, () => api('maps/' + code, undefined, 'no-cache').then((d) => known(publishedDef(d.map))));
  const id = publishedId(code, rev);
  if (knownMap(id)) return Promise.resolve(mapDef(id));
  return once(fetching, id, () => api(`maps/${code}?rev=${rev}`).then((d) => known(publishedDef(d.map))));
}
// a newer version of the published map `id` (null: none, not a published map, or not reachable)
export async function newerVersion(id) {
  const p = parsePublished(id);
  if (!p || !mapsAvailable()) return null;
  try {
    const def = await loadPublished(p.code);
    return def.rev > p.rev ? def : null;
  } catch {
    return null;
  }
}

export const publishMap = (draft) => api('maps', { draft });
// the author's new version of a map (the same code; the answer's rev is the version's number)
export const updateMap = (code, draft) =>
  api('maps/' + code, { draft }).then((r) => {
    newest.delete(code);
    return r;
  });
export const deleteMap = (code) =>
  api(`maps/${code}/delete`, {}).then((r) => {
    newest.delete(code);
    return r;
  });
export const listMaps = (sort = 'new', page = 0) => api(`maps?sort=${sort}&page=${page}`);
// the player's maps ({maps, max}; each with rev, cid, listed)
export const myPublished = () => api('maps?mine=1', undefined, 'no-cache');
export const rateMap = (code, stars) => api(`maps/${code}/rate`, { stars });
// on the public list or off it (the code opens it either way)
export const setListed = (code, listed) => api(`maps/${code}/hide`, { hidden: !listed });
// a campaign started on a published map (counted for the list; never in the way of the game)
export function countPlay(id) {
  const code = publishedCode(id);
  if (!code || !mapsAvailable()) return;
  api(`maps/${code}/play`, {}).catch(() => {});
}

// the link that opens a published map
export function mapLink(code) {
  return `${location.origin}${location.pathname}#map=${code}`;
}
