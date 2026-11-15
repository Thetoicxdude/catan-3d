// The building cards on this device (localStorage), and the signed-in account's copy on the self-hosted
// site (server/accounts.js, /api/cards), so the same cards are there on every device.
//
// Every change goes through commit(): the counter `rev` goes up, the copy is written here and, for a
// signed-in player, sent to the account a moment later. Signing in lines the two copies up:
//   · the account has none yet          → this device's copy becomes the account's
//   · this copy was never with an account (played signed out) → the two are put together
//   · this copy is the same account's   → the newer one (larger rev) wins
//   · this copy is another account's    → the account's own replaces it
// `owner` (a short id the server gives the account) says whose copy this is.
import { newCollection, fitCollection, mergeCollections } from './collection.js';
import { accountsAvailable, currentUser, onUser, fetchCards, sendCards } from '../net/account.js';

const KEY = 'catan3d-cards-v1';
let cur = null;
let owner = '';
const subs = new Set();
let pushTimer = null;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    owner = data && typeof data.owner === 'string' ? data.owner.slice(0, 40) : '';
    return fitCollection(data);
  } catch {
    return newCollection();
  }
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(owner ? { ...cur, owner } : cur));
  } catch {
    /* private window, storage full: this page still has it */
  }
}

function notify() {
  for (const f of subs) {
    try {
      f(cur);
    } catch (e) {
      console.error(e);
    }
  }
}

// the collection (read once per page)
export function cards() {
  if (!cur) {
    cur = read();
    hookAccount();
  }
  return cur;
}

// fn(collection) after every change; → a function that stops it
export function onCards(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// a change made to cards() is kept: here, and on the account
export function commit() {
  const c = cards();
  c.rev += 1;
  c.at = Date.now();
  write();
  notify();
  schedulePush();
}

// another copy takes this one's place (the account's)
function adopt(data, who) {
  cur = fitCollection(data);
  owner = who || owner;
  write();
  notify();
}

function schedulePush() {
  if (!owner || !accountsAvailable() || !currentUser()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1200);
}

async function push() {
  clearTimeout(pushTimer);
  pushTimer = null;
  try {
    const d = await sendCards(cur);
    // (another device got there first with more: its copy is the account's now)
    if (d && d.stale && d.cards) adopt(d.cards, d.owner);
  } catch (e) {
    console.warn('cards', e);
  }
}

let hooked = false;
function hookAccount() {
  if (hooked || !accountsAvailable()) return;
  hooked = true;
  onUser((u) => {
    if (u) link().catch((e) => console.warn('cards', e));
  });
  if (currentUser()) link().catch((e) => console.warn('cards', e));
}

let linking = null;
function link() {
  if (!linking)
    linking = (async () => {
      const d = await fetchCards();
      if (!d || !d.owner) return;
      const c = cards();
      if (!d.cards) {
        // a new account: this device's copy, unless it is another account's
        if (owner && owner !== d.owner) cur = newCollection();
        owner = d.owner;
        commit();
        await push();
      } else if (owner === d.owner) {
        if (d.cards.rev > c.rev) adopt(d.cards, d.owner);
        else if (c.rev > d.cards.rev) await push();
      } else if (!owner) {
        adopt(mergeCollections(c, d.cards), d.owner);
        await push();
      } else adopt(d.cards, d.owner);
    })().finally(() => (linking = null));
  return linking;
}
