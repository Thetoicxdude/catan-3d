// What is open to players. The development mode — its own island, blueprints, special buildings and
// wonders, and everything that goes with it: the building cards, the Cards, Shop and Missions pages,
// coins and missions — is closed at launch (2026-11-18): it shows greyed, and says "Coming soon" when
// touched. It is open on a device whose page was opened once with #dev-open at the end of its address
// (#dev-close shuts it again), and in the tests (window.__developOpen).
import { KEY_PREFIX } from './keys.js';

const FLAG = KEY_PREFIX + 'dev-open';
export function developOpen() {
  if (typeof window !== 'undefined' && window.__developOpen) return true;
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}
// the address's switch, read once as the page starts (main.js)
export function readDevSwitch() {
  if (typeof location === 'undefined') return;
  const h = location.hash;
  if (h !== '#dev-open' && h !== '#dev-close') return;
  try {
    if (h === '#dev-open') localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    // (storage blocked: the switch does nothing)
  }
  history.replaceState(null, '', location.pathname + location.search);
}
// the side bar's pages that belong to it (pages.js NAV)
export const DEVELOP_PAGES = ['cards', 'shop', 'missions'];
export const pageOpen = (k) => !DEVELOP_PAGES.includes(k) || developOpen();
