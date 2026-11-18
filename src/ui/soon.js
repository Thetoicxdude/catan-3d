// "Coming soon": something closed (meta/features.js) was touched. It shakes, and a slip with the words
// shows by it for a moment; the slip is read out too (role status). Closed things carry the class
// .soon (greyed: motion.css).
import { shake } from './motion.js';
import { t } from '../i18n/index.js';

let slip = null;
let timer = 0;
export function comingSoon(target) {
  if (target) shake(target);
  if (slip) slip.remove();
  clearTimeout(timer);
  slip = document.createElement('div');
  slip.className = 'soon-slip';
  slip.setAttribute('role', 'status');
  slip.textContent = t('即將推出');
  document.body.appendChild(slip);
  // (above the thing touched, or under it near the top of the screen; kept inside the screen)
  const r = target ? target.getBoundingClientRect() : { left: innerWidth / 2, width: 0, top: innerHeight / 2, bottom: innerHeight / 2 };
  const w = slip.offsetWidth;
  const h = slip.offsetHeight;
  const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const above = r.top - h - 10 > 8;
  slip.style.left = `${Math.round(x)}px`;
  slip.style.top = `${Math.round(above ? r.top - h - 10 : r.bottom + 10)}px`;
  const mine = slip;
  timer = setTimeout(() => {
    mine.remove();
    if (slip === mine) slip = null;
  }, 1700);
}
// the words, for a title or a label
export const soonText = () => t('即將推出');

// A whole part of a page closed (the Profile page's collection and blueprint): greyed under a "Coming
// soon" tag, its content out of reach (inert: no focus, no clicks), and a click anywhere on it says
// so. Called again after each repaint of the part (the tag goes with its old content).
export function soonSection(sec) {
  sec.classList.add('soon');
  sec.setAttribute('aria-disabled', 'true');
  for (const n of sec.children) if (!n.matches('.pg-h, .soon-tag')) n.inert = true;
  if (!sec.querySelector(':scope > .soon-tag')) {
    const tag = document.createElement('span');
    tag.className = 'soon-tag';
    tag.textContent = soonText();
    sec.appendChild(tag);
  }
  if (sec.dataset.soon) return;
  sec.dataset.soon = '1';
  sec.addEventListener('click', () => comingSoon(sec.querySelector(':scope > .soon-tag') || sec));
}
