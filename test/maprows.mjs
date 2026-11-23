// Published maps on the server (server/maps.js's rows), run against Node's own SQLite in the same way
// the accounts Durable Object runs them: publishing, the five maps an account may have, new versions
// under the same code, older versions kept for the rooms still playing them, taking a map off the list
// and back, deleting, the day's limit, and a table from before versions. Also the map ids of versions
// (src/net/maps.js) and the editor's "nothing changed" check against what the server stores.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MapRows, MAX_MAPS, draftRow } from '../server/maps.js';
import { parsePublished, publishedId, publishedDef } from '../src/net/maps.js';
import { draftId, normalizeDraft } from '../src/engine/custom.js';
import { DRAFTS } from './drafts.mjs';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.log('FAIL', name, '\n ', e.stack || e.message);
    process.exitCode = 1;
  }
}

const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 20, 8);
// a store as the Durable Object has it: sql.exec(query, ...args).toArray(), one(), run(), session()
function store(before) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (sub TEXT PRIMARY KEY, name TEXT NOT NULL)');
  db.prepare('INSERT INTO users (sub, name) VALUES (?, ?)').run('A', 'Ann');
  db.prepare('INSERT INTO users (sub, name) VALUES (?, ?)').run('B', 'Bea');
  if (before) before(db);
  const o = Object.create(MapRows);
  o.sql = {
    exec(query, ...args) {
      const rows = db.prepare(query).all(...args);
      return { toArray: () => rows };
    },
  };
  o.one = function (query, ...args) {
    const rows = this.sql.exec(query, ...args).toArray();
    return rows.length ? rows[0] : null;
  };
  o.run = function (query, ...args) {
    return this.sql.exec(query, ...args);
  };
  o.session = (hash) => ({ ann: { sub: 'A' }, bea: { sub: 'B' } })[hash] || null;
  o.mapsInit();
  return o;
}
// drafts that differ (the same island under other names)
const base = DRAFTS[Object.keys(DRAFTS)[0]];
const named = (name) => draftRow({ ...base, name });

test('the map ids of versions: u-CODE for the first, u-CODE.N after', () => {
  assert.equal(publishedId('ABCDEF', 0), 'u-ABCDEF');
  assert.equal(publishedId('ABCDEF', 3), 'u-ABCDEF.3');
  assert.deepEqual(parsePublished('u-ABCDEF'), { code: 'ABCDEF', rev: 0 });
  assert.deepEqual(parsePublished('u-ABCDEF.12'), { code: 'ABCDEF', rev: 12 });
  for (const bad of ['u-ABCDEF.0', 'u-ABCDEF.', 'u-ABCDEI', 'u-abcdef', 'my-ABCDEF', 'base-4', null]) assert.equal(parsePublished(bad), null, String(bad));
  const def = publishedDef({ code: 'ABCDEF', rev: 2, author: 'Ann', draft: base });
  assert.equal(def.id, 'u-ABCDEF.2');
  assert.equal(def.rev, 2);
  assert.equal(publishedDef({ code: 'ABCDEF', author: 'Ann', draft: base }).id, 'u-ABCDEF');
});

test('what the server stores reads back as unchanged in the editor (its content id)', () => {
  for (const d of Object.values(DRAFTS)) {
    const row = draftRow(d);
    assert.ok(!row.error, row.message);
    assert.equal(draftId(normalizeDraft(JSON.parse(row.draft))), row.cid);
  }
  assert.equal(draftRow(null).error, 'bad_map');
  assert.equal(draftRow({ ...base, name: 'x'.repeat(9000) }).error, 'bad_map');
});

test('an account publishes up to five maps; the same draft again keeps its code', () => {
  const s = store();
  const codes = [];
  for (let i = 0; i < MAX_MAPS; i++) {
    const r = s.publishMap('ann', named('Isle ' + i), T0 + i);
    assert.ok(r.code && r.rev === 0 && !r.error, JSON.stringify(r));
    codes.push(r.code);
  }
  assert.equal(new Set(codes).size, MAX_MAPS);
  const again = s.publishMap('ann', named('Isle 2'), T0 + 10);
  assert.equal(again.code, codes[2]);
  assert.ok(again.again);
  const full = s.publishMap('ann', named('Isle 9'), T0 + 11);
  assert.equal(full.error, 'full');
  assert.match(full.message, /5/);
  // another account has its own five
  assert.ok(s.publishMap('bea', named('Isle 9'), T0 + 12).code);
  const mine = s.mineMaps('ann', T0 + 13);
  assert.equal(mine.max, MAX_MAPS);
  assert.equal(mine.maps.length, MAX_MAPS);
  assert.ok(mine.maps.every((m) => m.listed && m.rev === 0 && m.cid));
  assert.equal(s.publishMap('nobody', named('x'), T0).error, 'signed_out');
});

test('a new version: the same code, the next revision; the older one still opens by its revision', () => {
  const s = store();
  const { code } = s.publishMap('ann', named('First'), T0);
  s.rateMap('bea', code, 4, T0 + 1);
  s.playMap(code);
  const r = s.updateMap('ann', code, named('Second'), T0 + 2);
  assert.deepEqual([r.code, r.rev, !!r.error], [code, 1, false]);
  const now = s.getMap(code);
  assert.equal(now.rev, 1);
  assert.equal(now.name, 'Second');
  assert.equal(now.draft.name, 'Second');
  assert.equal(now.cid, named('Second').cid);
  // the ratings and plays stay with the map
  assert.deepEqual([now.votes, now.rating, now.plays], [1, 4, 1]);
  const old = s.getMap(code, 0);
  assert.equal(old.draft.name, 'First');
  assert.equal(old.rev, 0);
  assert.ok(old.old);
  assert.equal(s.getMap(code, 1).draft.name, 'Second');
  assert.equal(s.getMap(code, 2), null);
  // nothing new: no new version
  const same = s.updateMap('ann', code, named('Second'), T0 + 3);
  assert.ok(same.again);
  assert.equal(same.rev, 1);
  assert.equal(s.updateMap('ann', code, named('Third'), T0 + 4).rev, 2);
  assert.equal(s.getMap(code, 1).draft.name, 'Second');
  // only the author; a code that is not there
  assert.equal(s.updateMap('bea', code, named('Mine now'), T0 + 5).error, 'not_yours');
  assert.equal(s.updateMap('ann', 'ZZZZZZ', named('x'), T0 + 5).error, 'not_found');
  assert.equal(s.getMap(code).name, 'Third');
  // the public list shows the newest name, once
  const list = s.listMaps('new', 0, 24);
  assert.equal(list.filter((m) => m.code === code).length, 1);
  assert.equal(list.find((m) => m.code === code).name, 'Third');
});

test('off the list and back on it: still the account\'s map, the code opens it either way', () => {
  const s = store();
  const { code } = s.publishMap('ann', named('Quiet'), T0);
  assert.equal(s.hideMap('bea', code, true, T0).error, 'not_yours');
  assert.deepEqual(s.hideMap('ann', code, true, T0), { ok: true, listed: false });
  assert.equal(s.listMaps('new', 0, 24).length, 0);
  assert.equal(s.getMap(code).listed, false);
  const mine = s.mineMaps('ann', T0);
  assert.equal(mine.maps.length, 1);
  assert.equal(mine.maps[0].listed, false);
  assert.deepEqual(s.hideMap('ann', code, false, T0), { ok: true, listed: true });
  assert.equal(s.listMaps('new', 0, 24).length, 1);
  // a map off the list still counts among the five
  for (let i = 0; i < MAX_MAPS - 1; i++) s.publishMap('ann', named('More ' + i), T0 + i);
  s.hideMap('ann', code, true, T0);
  assert.equal(s.publishMap('ann', named('One more'), T0 + 9).error, 'full');
});

test('deleting: the code no longer opens the map, its versions open for a while, a place is free', () => {
  const s = store();
  const codes = [];
  for (let i = 0; i < MAX_MAPS; i++) codes.push(s.publishMap('ann', named('D' + i), T0 + i).code);
  const code = codes[0];
  s.updateMap('ann', code, named('D0 again'), T0 + 10);
  s.rateMap('bea', code, 5, T0 + 11);
  assert.equal(s.deleteMap('bea', code, T0 + 12).error, 'not_yours');
  assert.deepEqual(s.deleteMap('ann', code, T0 + 12), { ok: true });
  assert.equal(s.getMap(code), null);
  assert.equal(s.listMaps('new', 0, 24).some((m) => m.code === code), false);
  assert.equal(s.mineMaps('ann', T0 + 12).maps.length, MAX_MAPS - 1);
  assert.equal(s.one('SELECT COUNT(*) AS c FROM ratings WHERE code = ?', code).c, 0);
  // rooms already playing it: both versions
  assert.equal(s.getMap(code, 0).draft.name, 'D0');
  assert.equal(s.getMap(code, 1).draft.name, 'D0 again');
  assert.equal(s.getMap(code, 1).author, 'Ann');
  assert.equal(s.deleteMap('ann', code, T0 + 13).error, 'not_yours');
  assert.equal(s.updateMap('ann', code, named('Back'), T0 + 13).error, 'not_found');
  // a place for another map
  assert.ok(s.publishMap('ann', named('New one'), T0 + 14).code);
  // thirty days on, the next change drops what was kept
  s.updateMap('ann', codes[1], named('D1 later'), T0 + 31 * DAY);
  assert.equal(s.getMap(code, 0), null);
  assert.equal(s.getMap(code, 1), null);
  assert.equal(s.getMap(codes[1], 0).draft.name, 'D1');
});

test('the day\'s limit: publications, new versions and deletions together', () => {
  const s = store();
  const { code } = s.publishMap('ann', named('Busy 0'), T0);
  let n = 1;
  let r = null;
  for (let i = 1; i < 40; i++) {
    r = s.updateMap('ann', code, named('Busy ' + i), T0 + i * 60000);
    if (r.error) break;
    n++;
  }
  assert.equal(r.error, 'limit');
  assert.equal(n, 20);
  assert.equal(s.publishMap('ann', named('Another'), T0 + 3600000).error, 'limit');
  assert.equal(s.deleteMap('ann', code, T0 + 3600000).ok, true); // (deleting is never refused)
  // the next day
  assert.ok(s.publishMap('ann', named('Tomorrow'), T0 + DAY + 3600000).code);
});

test('a table from before versions: the column added, its maps are revision 0', () => {
  const s = store((db) => {
    db.exec(`CREATE TABLE maps (
      code TEXT PRIMARY KEY, sub TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL, kit INTEGER NOT NULL, tiles INTEGER NOT NULL,
      cid TEXT NOT NULL, draft TEXT NOT NULL, at INTEGER NOT NULL, plays INTEGER NOT NULL DEFAULT 0,
      rsum INTEGER NOT NULL DEFAULT 0, rcount INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)`);
    const row = named('Old map');
    db.prepare('INSERT INTO maps (code, sub, author, name, kit, tiles, cid, draft, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('OLDMAP', 'A', 'Ann', row.name, row.kit, row.tiles, row.cid, row.draft, T0 - DAY);
  });
  const m = s.getMap('OLDMAP');
  assert.equal(m.rev, 0);
  assert.equal(s.getMap('OLDMAP', 0).name, 'Old map');
  assert.equal(s.updateMap('ann', 'OLDMAP', named('Old map, better'), T0).rev, 1);
  assert.equal(s.getMap('OLDMAP', 0).draft.name, 'Old map');
  // (and a second start finds the column there)
  s.mapsInit();
  assert.equal(s.getMap('OLDMAP').rev, 1);
});

console.log(`maprows: ${passed} passed`);
