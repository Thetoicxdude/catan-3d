// Gold emblems for the home screen and the menus: struck like coins on the game's bronze and enamel,
// large enough to be the first thing a player reads on a button (the name sits underneath, smaller).
// The figures are Game Icons (game-icons.net, CC BY 3.0, see gameicons.js) cast in gold with a dark
// engraved edge.
import { GAME_ICONS } from './gameicons.js';

let uid = 0;

const FIGURES = {
  single: 'crossed-swords', // a campaign of your own
  create: 'tower-flag', // raise your banner: a room of your own
  join: 'open-gate', // through a friend's gate
  resume: 'scroll-unfurled', // the campaign you left off
  rules: 'rule-book',
  settings: 'cog',
  account: 'visored-helm',
  official: 'laurels-trophy',
  chat: 'talk',
};

export function emblemSvg(name, size = 64) {
  const d = GAME_ICONS[FIGURES[name] || name];
  if (!d) return '';
  const id = `em${++uid}`;
  return `<svg class="emblem" viewBox="-8 -8 528 528" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4c8"/><stop offset="0.38" stop-color="#f1c965"/><stop offset="0.72" stop-color="#b47b29"/><stop offset="1" stop-color="#7a4c16"/>
    </linearGradient></defs>
    <path d="${d}" fill="url(#${id}g)" stroke="#2a1808" stroke-width="14" stroke-linejoin="round" paint-order="stroke"/>
  </svg>`;
}

// a seat in the official room: a heater shield, gold when taken, in the player's colour for their own
export function seatShield(state, color = null) {
  const fill = state === 'me' && color ? color : state === 'taken' ? '#e2b456' : 'rgba(10, 16, 22, 0.55)';
  const stroke = state === 'open' ? 'rgba(234, 208, 142, 0.55)' : '#2a1808';
  return `<svg class="seat-shield ${state}" viewBox="0 0 40 46" width="28" height="32" aria-hidden="true">
    <path d="M4 4 H36 V20 C36 32 28 39 20 43 C12 39 4 32 4 20 Z" fill="${fill}" stroke="${stroke}" stroke-width="2.6" stroke-linejoin="round"/>
    ${state === 'open' ? '' : '<path d="M9 9 H31 V20 C31 29 25 34 20 37" fill="none" stroke="#fff3c4" stroke-opacity="0.5" stroke-width="1.6"/>'}
  </svg>`;
}
