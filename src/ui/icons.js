// Resource cards (photographic art, styled in cards.css) and inline SVG icons (original drawings)
// for actions and map modes.
import { gameIcon } from './gameicons.js';

export const RES_NAMES = { wood: '木材', brick: '磚塊', wool: '羊毛', grain: '小麥', ore: '礦石' };
// the names printed on the cards themselves (the game's original English card names)
export const RES_EN = { wood: 'Lumber', brick: 'Brick', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
export const DEV_EN = { knight: 'Knight', roadBuilding: 'Road Building', yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly', victoryPoint: 'Victory Point' };
export const TERRAIN_NAMES = { forest: '森林', hills: '丘陵', pasture: '牧場', fields: '農田', mountains: '山脈', desert: '沙漠' };

// A miniature of the resource card (its art ringed in the card's frame colour), sized by height.
export function resIcon(res, size = 20) {
  const w = Math.round(size * 0.74);
  return `<span class="ico rc-mini rc-${res}" style="width:${w}px;height:${size}px" aria-hidden="true"></span>`;
}

// A card face: the frame with its art, the English name on the parchment strip, and an optional
// count token in the top corner (clear of the name). Its size comes from CSS (--w) unless w is
// given; `lg` picks the large image for cards shown big.
function face(kind, en, label, { w = null, count = null, cls = '', name = true, lg = false } = {}) {
  const nm = name ? `<span class="nm">${en}</span>` : '';
  const cnt = count != null ? `<b class="cnt num">${count}</b>` : '';
  const st = ` style="--n:${Math.max(4, en.length)}${w ? `;--w:${w}px` : ''}"`;
  return `<span class="rcard ${kind}${lg ? ' lg' : ''}${cls ? ' ' + cls : ''}"${st} role="img" aria-label="${label}" title="${label}">${nm}${cnt}</span>`;
}

export function resCard(res, opts = {}) {
  return face(`rc-${res}`, RES_EN[res] || res, RES_NAMES[res] || res, opts);
}

export function devCard(type, label, opts = {}) {
  return face(`dcard dc-${type}`, DEV_EN[type] || 'Development', label, opts);
}

const A = {
  road: `<path d="M3 19L10 5h4l7 14z" fill="currentColor" opacity="0.25"/><path d="M12 6v3M12 11v3M12 16v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3 19L10 5M21 19L14 5" stroke="currentColor" stroke-width="1.6"/>`,
  settlement: `<path d="M4 20V11l5-4 5 4v9z" fill="currentColor" opacity="0.9"/><path d="M14 20v-6l3.5-3 3.5 3v6z" fill="currentColor" opacity="0.6"/><rect x="7.5" y="15" width="3" height="5" fill="#1d1b18" opacity="0.6"/>`,
  city: `<path d="M8 21V7l3-3 3 3v14z" fill="currentColor"/><path d="M2 21v-8l3-2.5L8 13v8zM14 21v-7l3.5-3 3.5 3v7z" fill="currentColor" opacity="0.65"/><rect x="10" y="9" width="2" height="2.5" fill="#1d1b18" opacity="0.6"/>`,
  dev: `<rect x="5" y="3" width="14" height="18" rx="2" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.5"/><path d="M12 7l1.4 3 3.2.4-2.4 2.2.7 3.2L12 14.3l-2.9 1.5.7-3.2-2.4-2.2 3.2-.4z" fill="currentColor"/>`,
  knight: `<path d="M7 20h10l-1-3H8z" fill="currentColor"/><path d="M8.5 17c0-3 1-5 3-7-1-1-2.5-1.2-3.5-.5l-.5-2.5 3-2 4 .5 2.5 3-1.5 2.5L14 10c1 2 1.5 4.5 1.5 7z" fill="currentColor"/>`,
  vp: `<path d="M12 3l2.6 5.6 6.1.7-4.5 4.1 1.2 6L12 16.4 6.6 19.4l1.2-6-4.5-4.1 6.1-.7z" fill="currentColor"/>`,
  trade: `<path d="M4 8h13l-3-3M20 16H7l3 3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  dice: `<rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.6" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.6" fill="currentColor"/>`,
  end: `<path d="M5 12h12M13 7l5 5-5 5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  cards: `<rect x="3" y="6" width="11" height="15" rx="1.6" fill="currentColor" opacity="0.35" transform="rotate(-10 8 13)"/><rect x="9" y="4" width="11" height="15" rx="1.6" fill="currentColor" opacity="0.85" transform="rotate(8 14 11)"/>`,
  terrain: `<path d="M2 19l6-9 4 5 3-4 7 8z" fill="currentColor"/><circle cx="17" cy="6" r="2.2" fill="currentColor" opacity="0.6"/>`,
  political: `<path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 3v16M15 5v16" stroke="currentColor" stroke-width="1.4"/><path d="M3 5l6-2v16l-6 2z" fill="currentColor" opacity="0.5"/>`,
  production: `<path d="M4 20V13M9 20V8M14 20v-5M19 20V5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
  resources: `<circle cx="8" cy="8" r="3.5" fill="currentColor"/><circle cx="16" cy="8" r="3.5" fill="currentColor" opacity="0.6"/><circle cx="8" cy="16" r="3.5" fill="currentColor" opacity="0.6"/><circle cx="16" cy="16" r="3.5" fill="currentColor" opacity="0.35"/>`,
  rules: `<path d="M5 4h10l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 11h8M8 14h8M8 17h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  gear: `<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  robber: `<path d="M12 3c-3 0-5 2.4-5 5.5 0 1.8.8 3.3 2 4.3L7 21h10l-2-8.2c1.2-1 2-2.5 2-4.3C17 5.4 15 3 12 3z" fill="currentColor"/><rect x="8.5" y="7.5" width="7" height="2.2" rx="1" fill="#e9dcc2"/>`,
  road2: `<path d="M5 18L18 5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`,
  rotl: `<path d="M5.5 12a6.5 6.5 0 1 0 2-4.7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M4 4.5v4.6h4.6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  rotr: `<path d="M18.5 12a6.5 6.5 0 1 1-2-4.7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M20 4.5v4.6h-4.6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  compass: `<path d="M12 2.5l3.6 9.5H8.4z" fill="#d9563f"/><path d="M12 21.5l-3.6-9.5h7.2z" fill="currentColor" opacity="0.75"/><circle cx="12" cy="12" r="1.5" fill="#1d1b18"/>`,
  tiltUp: `<path d="M4 18h16M7 18l3-9h4l3 9" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M12 3v4M10 5l2-2 2 2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  tiltDown: `<path d="M3 15h18M5 15l2-7h10l2 7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M12 21v-3M10 19.5l2 1.5 2-1.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  cross: `<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  wait: `<circle cx="6" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18" cy="12" r="1.8" fill="currentColor"/>`,
  log: `<path d="M5 6h14M5 10h14M5 14h10M5 18h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  hourglass: `<path d="M7 3.5h10M7 20.5h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.2 3.5c0 4.2 3.2 6 3.8 8.5-.6 2.5-3.8 4.3-3.8 8.5M15.8 3.5c0 4.2-3.2 6-3.8 8.5.6 2.5 3.8 4.3 3.8 8.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><path d="M9.6 19c.8-1.7 1.7-2.7 2.4-3.4.7.7 1.6 1.7 2.4 3.4z" fill="currentColor"/>`,
  chat: `<path d="M4 6.6C4 5.2 5.2 4 6.6 4h10.8C18.8 4 20 5.2 20 6.6v6.8c0 1.4-1.2 2.6-2.6 2.6H11l-4.6 3.8V16h0C5.1 16 4 14.8 4 13.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8.6" cy="10" r="1.1" fill="currentColor"/><circle cx="12" cy="10" r="1.1" fill="currentColor"/><circle cx="15.4" cy="10" r="1.1" fill="currentColor"/>`,
  people: `<circle cx="9" cy="8" r="3" fill="currentColor"/><path d="M3 19c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5z" fill="currentColor"/><circle cx="16.5" cy="9" r="2.4" fill="currentColor" opacity="0.6"/><path d="M15 13.6c3 .1 5.2 2 5.6 5.4h-4" fill="currentColor" opacity="0.6"/>`,
};

// the game's own objects are drawn from Game Icons (see gameicons.js); the interface marks (ticks,
// crosses, the map modes, the menu) stay simple line drawings
const FIGURE = {
  dice: 'rolling-dices',
  road: 'stone-path',
  settlement: 'house',
  city: 'castle',
  dev: 'card-random',
  devbuy: 'card-draw',
  trade: 'trade',
  cards: 'card-pick',
  end: 'player-next',
  knight: 'mounted-knight',
  vp: 'laurel-crown',
  robber: 'hooded-figure',
  people: 'meeple-group',
  rules: 'rule-book',
  gear: 'cog',
  hourglass: 'hourglass',
  chat: 'talk',
  harbor: 'anchor',
  leave: 'exit-door',
  // Seafarers
  ship: 'sailboat',
  moveShip: 'ship-wheel',
  pirate: 'pirate-flag',
  gold: 'gold-nuggets',
  isle: 'island',
};

export function icon(name, size = 20) {
  if (FIGURE[name]) return gameIcon(FIGURE[name], size, 'ico gi');
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${A[name] || ''}</svg>`;
}

export function dieFace(n, size = 34) {
  const P = {
    1: [[12, 12]],
    2: [[7, 7], [17, 17]],
    3: [[7, 7], [12, 12], [17, 17]],
    4: [[7, 7], [17, 7], [7, 17], [17, 17]],
    5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]],
    6: [[7, 6.5], [17, 6.5], [7, 12], [17, 12], [7, 17.5], [17, 17.5]],
  }[n] || [];
  const dots = P.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1"/>`).join('');
  return `<svg class="die" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="4.5"/><g>${dots}</g></svg>`;
}
