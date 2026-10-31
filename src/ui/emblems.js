// Gold emblems for the home screen: struck like coins on the game's bronze and enamel, large enough
// to be the first thing a player reads on a button (the name sits underneath, smaller).
let uid = 0;

// a gold fill and a dark engraving line, shared by every part of one emblem
function emblem(body, size) {
  const id = `em${++uid}`;
  return `<svg class="emblem" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff4c8"/><stop offset="0.38" stop-color="#f1c965"/><stop offset="0.72" stop-color="#b47b29"/><stop offset="1" stop-color="#7a4c16"/>
      </linearGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#d6dde3"/><stop offset="1" stop-color="#7d8892"/>
      </linearGradient>
    </defs>
    <g fill="url(#${id}g)" stroke="#2a1808" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${body(id)}</g>
  </svg>`;
}

// a sword pointing up; crossed pairs turn about the crossing point (50, 50)
const sword = (id, rot) => `<g transform="rotate(${rot} 50 50)">
  <path d="M45 14 L50 3 L55 14 V64 H45 Z" fill="url(#${id}s)"/>
  <path d="M50 9 V60" fill="none" stroke="#7d8892" stroke-width="1.6"/>
  <rect x="33" y="63" width="34" height="8" rx="3"/>
  <rect x="46" y="71" width="8" height="15" rx="2.5"/>
  <circle cx="50" cy="91" r="6"/>
</g>`;

const hex = (cx, cy, r) => {
  const p = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    p.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${p.join(' L')} Z`;
};

const BODIES = {
  // a campaign of your own: crossed swords over an island hex
  single: (id) => `${sword(id, -42)}${sword(id, 42)}
    <path d="${hex(50, 47, 15)}"/>
    <path d="${hex(50, 47, 9.5)}" fill="#2a1808" stroke="none"/>
    <path d="${hex(50, 47, 6)}" fill="#e9b553" stroke="none"/>`,
  // a room of your own: a keep with its banner raised, and a "new" seal
  create: () => `<path d="M50 27 V5" fill="none"/>
    <path d="M50 6 L70 10.5 L50 15.5 Z" fill="#c8372d"/>
    <path d="M27 44 V27 H37 V33 H45 V27 H55 V33 H63 V27 H73 V44 Z"/>
    <path d="M31 44 H69 V90 H31 Z"/>
    <path d="M42.5 90 V79 A7.5 7.5 0 0 1 57.5 79 V90 Z" fill="#2a1808"/>
    <rect x="47.5" y="54" width="5" height="12" rx="2" fill="#2a1808" stroke="none"/>
    <circle cx="76" cy="76" r="13"/>
    <path d="M76 69 V83 M69 76 H83" fill="none" stroke-width="3.6"/>`,
  // a friend's room: through the gate
  join: () => `<path d="M24 90 V46 A26 26 0 0 1 76 46 V90 Z"/>
    <path d="M35 90 V49 A15 15 0 0 1 65 49 V90 Z" fill="#2a1808"/>
    <path d="M42 90 V52 M50 90 V45 M58 90 V52" fill="none" stroke="#8a5a1e" stroke-width="2.4"/>
    <path d="M6 72 H40" fill="none" stroke-width="9"/>
    <path d="M36 59 L52 72 L36 85 Z"/>
    <path d="M8 72 H38" fill="none" stroke="#f1c965" stroke-width="3.6"/>`,
  // the last campaign: an hourglass
  resume: () => `<rect x="24" y="8" width="52" height="9" rx="3.5"/>
    <rect x="24" y="83" width="52" height="9" rx="3.5"/>
    <path d="M33 17 C33 36 46 42 46 50 C46 58 33 64 33 83 H67 C67 64 54 58 54 50 C54 42 67 36 67 17 Z" fill="#1d2b36" fill-opacity="0.85"/>
    <path d="M38 23 H62 C61 33 54 39 50 44 C46 39 39 33 38 23 Z" stroke="none"/>
    <path d="M37 81 C40 71 60 71 63 81 Z" stroke="none"/>
    <path d="M50 46 V72" fill="none" stroke="#f1c965" stroke-width="2"/>
    <path d="M27 17 V83 M73 17 V83" fill="none" stroke-width="4"/>`,
  // the rules: an open book
  rules: () => `<path d="M50 30 C40 22 24 21 12 25 V80 C24 76 40 77 50 85 C60 77 76 76 88 80 V25 C76 21 60 22 50 30 Z"/>
    <path d="M50 30 V85" fill="none"/>
    <path d="M20 37 C28 35 36 35 43 38 M20 47 C28 45 36 45 43 48 M20 57 C28 55 36 55 43 58 M57 38 C64 35 72 35 80 37 M57 48 C64 45 72 45 80 47 M57 58 C64 55 72 55 80 57" fill="none" stroke="#5c3a12" stroke-width="2.2"/>`,
  // settings: a cog
  settings: () => {
    const teeth = 9;
    const pts = [];
    for (let i = 0; i < teeth * 4; i++) {
      const a = (Math.PI * 2 * i) / (teeth * 4) - Math.PI / 2;
      const r = i % 4 === 1 || i % 4 === 2 ? 44 : 35;
      pts.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`);
    }
    return `<path d="M${pts.join(' L')} Z"/><circle cx="50" cy="50" r="14" fill="#2a1808"/><circle cx="50" cy="50" r="23" fill="none" stroke="#fff3c4" stroke-opacity="0.45" stroke-width="2"/>`;
  },
};

export function emblemSvg(name, size = 64) {
  return emblem(BODIES[name], size);
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
