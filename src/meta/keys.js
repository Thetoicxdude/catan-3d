// Where the page keeps its things in the browser (settings, the campaign save, the collection, map
// drafts, the room to rejoin…): every key starts with KEY_PREFIX. The game was renamed on 2026-11-18
// (Hexverse); what players kept under the earlier prefix is moved to the new one once, here, before
// anything reads it — so this module is the first that main.js imports. (The earlier prefix is kept
// below only for this move.)
export const KEY_PREFIX = 'hexverse-';
const EARLIER = 'catan3d-';

function moveKeys(store) {
  try {
    // (the names first: adding and removing keys while counting through them reorders them)
    const names = [];
    for (let i = 0; i < store.length; i++) names.push(store.key(i));
    for (const k of names) {
      if (!k || !k.startsWith(EARLIER)) continue;
      const to = KEY_PREFIX + k.slice(EARLIER.length);
      if (store.getItem(to) == null) store.setItem(to, store.getItem(k));
      store.removeItem(k);
    }
  } catch (e) {
    // (storage blocked: nothing kept, nothing to move)
  }
}
if (typeof localStorage !== 'undefined') moveKeys(localStorage);
if (typeof sessionStorage !== 'undefined') moveKeys(sessionStorage);
