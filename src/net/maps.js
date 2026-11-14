// Maps players publish from the map workshop (the self-hosted site only; see server/maps.js). A
// published map is known by a six-letter code; its map id is `u-<code>`, and every page makes the
// same map definition from its draft (custom.js).
import { accountsAvailable } from './account.js';
import { draftToDef, normalizeDraft } from '../engine/custom.js';
import { registerMap, knownMap, mapDef } from '../engine/maps.js';
import { N_ } from '../i18n/fill.js';

export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const mapsAvailable = accountsAvailable;
export const publishedCode = (id) => (typeof id === 'string' && id.startsWith('u-') && CODE_RE.test(id.slice(2)) ? id.slice(2) : null);
// a code as a player may type it (small letters, spaces, a dash)
export const cleanCode = (s) =>
  String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

async function api(path, body) {
  const res = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
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

// the map definition of a published map, with who made it
export function publishedDef(m) {
  const def = draftToDef(m.draft, 'u-' + m.code);
  def.code = m.code;
  def.author = String(m.author || '').slice(0, 40);
  def.draft = normalizeDraft(m.draft);
  return def;
}

const fetching = new Map();
// a published map, fetched once per page and registered (resolves to its definition)
export function loadPublished(code) {
  const id = 'u-' + code;
  if (knownMap(id)) return Promise.resolve(mapDef(id));
  if (!fetching.has(code)) {
    const p = api('maps/' + code)
      .then((d) => registerMap(publishedDef(d.map)))
      .catch((e) => {
        fetching.delete(code);
        throw e;
      });
    fetching.set(code, p);
  }
  return fetching.get(code);
}

export const publishMap = (draft) => api('maps', { draft });
export const listMaps = (sort = 'new', page = 0) => api(`maps?sort=${sort}&page=${page}`);
export const myPublished = () => api('maps?mine=1');
export const rateMap = (code, stars) => api(`maps/${code}/rate`, { stars });
export const hideMap = (code) => api(`maps/${code}/hide`, {});
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
