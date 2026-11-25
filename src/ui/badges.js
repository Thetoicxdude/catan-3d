// Badges: an enamel pin in a nation's colour, its shape telling what it is, a white pictogram on it
// (Game Icons, see gameicons.js). 2026-11-25, the user: from far away nobody could tell whose
// building stands where, or which were their own; icons like a game's, in the owner's colour, the
// shape saying what the building is. The same badges name the buildings on the map from afar
// (render/badges.js) and in the build menu (hud.js), so a shape learnt in one place reads in the
// other; the missions (cards-ui.js) and the winner's crest (dialogs.js gameOver) are badges too.
// The shapes:
//   settlement  a round pin        city   a hexagon       ship   a triangle
//   road, card  a rounded square   a special building (the development mode)   a diamond
//   a wonder    a rosette (its rim always gold)
// Your own pieces have a gold rim and a glow; the others an ivory rim. Each badge is drawn on a
// 64 × 64 grid and sized by CSS. The gradients, the shapes' clips and the pictograms are defined once
// in the page (a hidden <svg>), the badges refer to them.
import { GAME_ICONS } from './gameicons.js';

const pts = (arr) => 'M' + arr.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L') + 'Z';
const ring = (n, R, rot = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return [32 + R * Math.cos(a), 32 + R * Math.sin(a)];
  });
const star = (n, R, r) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = ((-90 + (180 / n) * i) * Math.PI) / 180;
    const k = i % 2 ? r : R;
    return [32 + k * Math.cos(a), 32 + k * Math.sin(a)];
  });
const rounded = (x, y, w, h, r) => `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;

// each shape: its outline, and where its pictogram sits (x, y, size)
export const SHAPES = {
  circle: { d: 'M32,6A26,26 0 1 1 31.99,6Z', g: [15, 14, 34] },
  hex: { d: pts(ring(6, 28)), g: [15, 14.5, 34] },
  tri: { d: pts([[32, 4], [60, 54], [4, 54]]), g: [18.5, 25, 27] },
  diamond: { d: pts(ring(4, 29)), g: [16.5, 16.5, 31] },
  rosette: { d: pts(star(8, 30, 24.5)), g: [15, 15, 34] },
  square: { d: rounded(7, 7, 50, 50, 11), g: [15, 15, 34] },
};

// what each thing is drawn as: [shape, pictogram]
export const BADGE = {
  settlement: ['circle', 'house'],
  city: ['hex', 'castle'],
  ship: ['tri', 'sailboat'],
  road: ['square', 'stone-path'],
  dev: ['square', 'card-random'],
  pirate: ['circle', 'pirate-flag'],
};

let defs = null;
const glyphs = new Set();
// the shared definitions (once per page; nothing where there is no page, as in the tests)
function ensureDefs() {
  if (defs || typeof document === 'undefined') return defs;
  const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  holder.setAttribute('width', '0');
  holder.setAttribute('height', '0');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  holder.innerHTML = `<defs>
    <linearGradient id="bdg-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.42"/></linearGradient>
    <linearGradient id="bdg-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="bdg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4c4"/><stop offset="0.45" stop-color="#f0c055"/><stop offset="1" stop-color="#9a6416"/></linearGradient>
    <linearGradient id="bdg-ivory" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9ccb0"/></linearGradient>
    <linearGradient id="bdg-gilt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c8"/><stop offset="0.5" stop-color="#e8bd62"/><stop offset="1" stop-color="#a9762a"/></linearGradient>
    <linearGradient id="bdg-die" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="0.6" stop-color="#f1e6cc"/><stop offset="1" stop-color="#d6c49e"/></linearGradient>
    ${Object.entries(SHAPES)
      .map(([k, s]) => `<clipPath id="bdg-c-${k}"><path d="${s.d}"/></clipPath>`)
      .join('')}
  </defs>`;
  document.body.appendChild(holder);
  defs = holder.firstElementChild;
  return defs;
}
// (the shared gradients, for CSS to fill with: the action bar's gilt pictograms, the dice)
export const ensureBadgeDefs = () => ensureDefs();
function glyphId(name) {
  const d = ensureDefs();
  if (d && !glyphs.has(name) && GAME_ICONS[name]) {
    glyphs.add(name);
    d.insertAdjacentHTML('beforeend', `<symbol id="bdg-g-${name}" viewBox="0 0 512 512"><path d="${GAME_ICONS[name]}"/></symbol>`);
  }
  return 'bdg-g-' + name;
}

// One badge as SVG: `shape` (SHAPES), `glyph` (a Game Icons name), `color` (the owner's). Options:
// mine (gold rim), gold (gold rim whoever owns it: a wonder), pips [done, of] (a wonder's stages, as
// dots under it), dim (a grey badge: something that cannot be had).
export function badgeSvg(shape, glyph, color, { mine = false, gold = false, pips = null, dim = false } = {}) {
  const s = SHAPES[shape] || SHAPES.circle;
  const [gx, gy, gs] = s.g;
  const id = glyphId(glyph);
  const fill = dim ? '#8d877c' : color;
  const rim = mine || gold ? 'url(#bdg-gold)' : 'url(#bdg-ivory)';
  let dots = '';
  if (pips) {
    const [done, of] = pips;
    for (let i = 0; i < of; i++) {
      const x = 32 + (i - (of - 1) / 2) * 11;
      dots += `<circle cx="${x}" cy="61" r="4.2" fill="${i < done ? '#f6d27a' : '#2a1d12'}" stroke="#1a120b" stroke-width="2"/>`;
    }
  }
  return (
    `<svg class="bdg-svg" viewBox="0 0 64 64" aria-hidden="true">` +
    `<path d="${s.d}" fill="none" stroke="#1a120b" stroke-width="7.5" stroke-linejoin="round"/>` +
    `<path d="${s.d}" fill="${fill}"/>` +
    `<path d="${s.d}" fill="url(#bdg-shade)"/>` +
    `<ellipse cx="32" cy="10" rx="30" ry="17" fill="url(#bdg-shine)" clip-path="url(#bdg-c-${shape})"/>` +
    `<path d="${s.d}" fill="none" stroke="${rim}" stroke-width="${mine || gold ? 3.6 : 2.6}" stroke-linejoin="round"/>` +
    `<use href="#${id}" x="${gx}" y="${gy + 1.6}" width="${gs}" height="${gs}" fill="rgba(0,0,0,.45)"/>` +
    `<use href="#${id}" x="${gx}" y="${gy}" width="${gs}" height="${gs}" fill="#fffaf0"/>` +
    dots +
    `</svg>`
  );
}

// a badge to put in a page: a <span class="bdg"> sized by CSS (1em by default)
export function badge(kind, color, opts = {}) {
  const [shape, glyph] = BADGE[kind] || [opts.shape || 'circle', opts.glyph || 'house'];
  return `<span class="bdg bdg-${shape}${opts.mine ? ' mine' : ''}${opts.cls ? ' ' + opts.cls : ''}">${badgeSvg(opts.shape || shape, opts.glyph || glyph, color, opts)}</span>`;
}
