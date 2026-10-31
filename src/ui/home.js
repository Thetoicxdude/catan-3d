// Home screen, dressed like the game: a bronze-framed board for the official room (the next island
// takes most of it; beside it only the room's terms, its seats and the countdown) and the ways to
// play as a hand of cards in the same frames as the resource cards. Pressing the official board
// joins matchmaking right here; pressing it again leaves.
import { GEO, HEX_SIZE } from '../engine/geometry.js';
import { generateBoard } from '../engine/board.js';
import { seedState } from '../engine/rng.js';
import { PALETTE } from './menu.js';
import { flagURL } from './flags.js';
import { esc } from './text.js';
import { emblemSvg, seatShield } from './emblems.js';

const APP = 'catan3d';
const SQRT3 = Math.sqrt(3);
// the paper map's terrain colours
const TERRAIN = { forest: '#3d6b39', hills: '#c0683f', pasture: '#8cc055', fields: '#eabf48', mountains: '#878b99', desert: '#dfca91' };

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// the island an official game on this map seed is played on (official rooms use the balanced numbers)
const boards = new Map();
export function officialBoard(seed) {
  const k = seed >>> 0;
  if (!boards.has(k)) {
    if (boards.size > 8) boards.clear();
    boards.set(k, generateBoard({ rng: seedState(k) }, { numbers: 'balanced' }));
  }
  return boards.get(k);
}

// ── the painted island ──
// small marks that tell the provinces apart at a glance: trees, sheep, wheat rows, clay pits, peaks, dunes
function glyph(g, terrain, x, y, u) {
  g.save();
  g.translate(x, y);
  if (terrain === 'forest') {
    g.fillStyle = '#21452a';
    for (const [dx, dy, k] of [
      [-0.55, 0.2, 0.85],
      [0.5, 0.25, 0.8],
      [0, -0.15, 1],
    ]) {
      g.beginPath();
      g.moveTo(dx * u, dy * u - 1.15 * u * k);
      g.lineTo(dx * u + 0.6 * u * k, dy * u + 0.55 * u * k);
      g.lineTo(dx * u - 0.6 * u * k, dy * u + 0.55 * u * k);
      g.closePath();
      g.fill();
    }
  } else if (terrain === 'pasture') {
    g.fillStyle = '#f7f3e6';
    g.beginPath();
    g.ellipse(0, 0, 0.62 * u, 0.42 * u, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3b3328';
    g.beginPath();
    g.arc(0.62 * u, -0.12 * u, 0.22 * u, 0, Math.PI * 2);
    g.fill();
  } else if (terrain === 'fields') {
    g.strokeStyle = 'rgba(150, 102, 22, 0.75)';
    g.lineWidth = Math.max(1, u * 0.16);
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(-0.7 * u, k * 0.42 * u + 0.25 * u);
      g.lineTo(0.7 * u, k * 0.42 * u - 0.25 * u);
      g.stroke();
    }
  } else if (terrain === 'hills') {
    g.fillStyle = 'rgba(122, 52, 24, 0.7)';
    g.beginPath();
    g.ellipse(0, 0.1 * u, 0.7 * u, 0.36 * u, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = 'rgba(255, 214, 170, 0.35)';
    g.fillRect(-0.4 * u, 0.12 * u, 0.8 * u, 0.12 * u);
  } else if (terrain === 'mountains') {
    for (const [dx, k] of [
      [-0.35, 0.85],
      [0.3, 1.05],
    ]) {
      g.fillStyle = '#5d606c';
      g.beginPath();
      g.moveTo(dx * u, -0.95 * u * k);
      g.lineTo(dx * u + 0.7 * u * k, 0.5 * u);
      g.lineTo(dx * u - 0.7 * u * k, 0.5 * u);
      g.closePath();
      g.fill();
      g.fillStyle = '#f4f2ec';
      g.beginPath();
      g.moveTo(dx * u, -0.95 * u * k);
      g.lineTo(dx * u + 0.24 * u * k, -0.52 * u * k);
      g.lineTo(dx * u - 0.24 * u * k, -0.52 * u * k);
      g.closePath();
      g.fill();
    }
  } else if (terrain === 'desert') {
    g.strokeStyle = 'rgba(150, 112, 48, 0.6)';
    g.lineWidth = Math.max(1, u * 0.14);
    g.beginPath();
    g.moveTo(-0.7 * u, 0.2 * u);
    g.quadraticCurveTo(-0.2 * u, -0.35 * u, 0.2 * u, 0.15 * u);
    g.quadraticCurveTo(0.45 * u, -0.15 * u, 0.75 * u, 0.1 * u);
    g.stroke();
  }
  g.restore();
}

export function drawBoardArt(canvas, board) {
  const r = canvas.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(r.width * dpr);
  const H = Math.round(r.height * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const g = canvas.getContext('2d');
  const cx = W * 0.5;
  const cz = H * 0.5;
  // the sea, darker toward the frame, with a compass rose out in it
  const sea = g.createRadialGradient(cx, cz, 0, cx, cz, Math.max(W, H) * 0.72);
  sea.addColorStop(0, '#2d6c88');
  sea.addColorStop(0.55, '#1b4a62');
  sea.addColorStop(1, '#0b1f2c');
  g.fillStyle = sea;
  g.fillRect(0, 0, W, H);
  const rose = (x, y, rr) => {
    g.save();
    g.translate(x, y);
    g.strokeStyle = 'rgba(234, 208, 142, 0.32)';
    g.fillStyle = 'rgba(234, 208, 142, 0.22)';
    g.lineWidth = Math.max(1, rr * 0.03);
    g.beginPath();
    g.arc(0, 0, rr * 0.62, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 8; k++) {
      const a = (Math.PI / 4) * k;
      const len = k % 2 ? rr * 0.55 : rr;
      g.beginPath();
      g.moveTo(Math.cos(a) * len, Math.sin(a) * len);
      g.lineTo(Math.cos(a + 0.28) * rr * 0.16, Math.sin(a + 0.28) * rr * 0.16);
      g.lineTo(Math.cos(a - 0.28) * rr * 0.16, Math.sin(a - 0.28) * rr * 0.16);
      g.closePath();
      g.fill();
    }
    g.restore();
  };
  if (!board) return;
  const span = { x: HEX_SIZE * SQRT3 * 5 + 14, z: HEX_SIZE * 8 + 10 };
  const s = Math.min((W * 0.94) / span.x, (H * 0.97) / span.z);
  // old-chart dressing in the open sea: a compass rose, swell marks and a few sails
  const isle = (x, y) => Math.hypot((x - cx) / (span.x * 0.5 * s + H * 0.05), (y - cz) / (span.z * 0.5 * s + H * 0.05)) < 1;
  if (W / H > 1.25) rose(Math.min(W * 0.1, cx - span.x * 0.5 * s - H * 0.12), H * 0.2, H * 0.12);
  const marks = [[0.06, 0.62], [0.13, 0.86], [0.2, 0.45], [0.27, 0.74], [0.08, 0.38], [0.74, 0.16], [0.82, 0.4], [0.9, 0.7], [0.78, 0.86], [0.94, 0.26], [0.86, 0.56], [0.3, 0.12]];
  g.strokeStyle = 'rgba(214, 236, 245, 0.28)';
  g.lineWidth = Math.max(1, H * 0.006);
  for (const [mx, my] of marks) {
    const x = mx * W;
    const y = my * H;
    if (isle(x, y)) continue;
    const w = H * 0.035;
    g.beginPath();
    g.moveTo(x - w, y);
    g.quadraticCurveTo(x - w / 2, y - w * 0.55, x, y);
    g.quadraticCurveTo(x + w / 2, y - w * 0.55, x + w, y);
    g.stroke();
  }
  const sail = (x, y, k, flip) => {
    if (isle(x, y)) return;
    g.save();
    g.translate(x, y);
    g.scale(flip ? -k : k, k);
    g.fillStyle = '#4a2f1a';
    g.beginPath();
    g.moveTo(-1.1, 0);
    g.lineTo(1.1, 0);
    g.lineTo(0.75, 0.42);
    g.lineTo(-0.8, 0.42);
    g.closePath();
    g.fill();
    g.strokeStyle = '#2a1808';
    g.lineWidth = 0.08;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -1.6);
    g.stroke();
    g.fillStyle = '#f2e6c8';
    g.beginPath();
    g.moveTo(0.08, -1.5);
    g.quadraticCurveTo(0.95, -0.85, 0.08, -0.15);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(-0.08, -1.25);
    g.quadraticCurveTo(-0.7, -0.75, -0.08, -0.25);
    g.closePath();
    g.fill();
    g.fillStyle = '#b3261e';
    g.fillRect(0, -1.75, 0.45, 0.2);
    g.restore();
  };
  sail(W * 0.17, H * 0.62, H * 0.045, false);
  sail(W * 0.85, H * 0.3, H * 0.04, true);
  const P = (x, z) => [cx + x * s, cz + z * s];
  const hexPath = (x, z, rad) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const [px, py] = P(x + rad * Math.cos(a), z + rad * Math.sin(a));
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  };
  // swell around the coast, then the beach
  g.lineWidth = Math.max(1, s * 0.3);
  for (const [k, a] of [
    [1.75, 0.08],
    [1.45, 0.14],
  ]) {
    g.strokeStyle = `rgba(200, 232, 245, ${a})`;
    for (const h of GEO.hexes) {
      hexPath(h.x, h.z, HEX_SIZE * k);
      g.stroke();
    }
  }
  g.fillStyle = '#d9c38d';
  for (const h of GEO.hexes) {
    hexPath(h.x, h.z, HEX_SIZE * 1.16);
    g.fill();
  }
  const R = HEX_SIZE * s;
  for (const h of GEO.hexes) {
    const T = board.hexes[h.id];
    hexPath(h.x, h.z, HEX_SIZE * 0.99);
    g.fillStyle = TERRAIN[T.terrain] || '#c9b98f';
    g.fill();
    g.save();
    g.clip();
    const [hx, hy] = P(h.x, h.z);
    const u = R * 0.2;
    // a ring of marks around the number token (the desert keeps its centre)
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k + Math.PI / 6;
      glyph(g, T.terrain, hx + Math.cos(a) * R * 0.6, hy + Math.sin(a) * R * 0.6, u);
    }
    if (!T.number) glyph(g, T.terrain, hx, hy, u * 1.3);
    const lg = g.createLinearGradient(hx - R, hy - R, hx + R, hy + R);
    lg.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    lg.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
    g.fillStyle = lg;
    g.fillRect(hx - R, hy - R, R * 2, R * 2);
    g.restore();
    hexPath(h.x, h.z, HEX_SIZE * 0.99);
    g.strokeStyle = 'rgba(58, 40, 22, 0.65)';
    g.lineWidth = Math.max(1, s * 0.45);
    g.stroke();
  }
  // harbours: a jetty and a ring out at sea
  for (const hb of board.harbors || []) {
    const e = GEO.edges[hb.edge];
    if (!e || !e.outward) continue;
    const [ex, ey] = P(e.x + e.outward.x * 1.4, e.z + e.outward.z * 1.4);
    const [hx, hy] = P(e.x + e.outward.x * 6.8, e.z + e.outward.z * 6.8);
    g.strokeStyle = 'rgba(122, 86, 52, 0.95)';
    g.lineWidth = Math.max(1.5, s * 0.75);
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(hx, hy);
    g.stroke();
    g.beginPath();
    g.arc(hx, hy, s * 1.9, 0, Math.PI * 2);
    g.fillStyle = hb.type === 'any' ? '#f1e4bf' : TERRAIN[{ wood: 'forest', brick: 'hills', wool: 'pasture', grain: 'fields', ore: 'mountains' }[hb.type]];
    g.fill();
    g.lineWidth = Math.max(1, s * 0.4);
    g.strokeStyle = '#2a1808';
    g.stroke();
  }
  // number tokens
  for (const h of GEO.hexes) {
    const T = board.hexes[h.id];
    if (!T.number) continue;
    const [hx, hy] = P(h.x, h.z);
    const rr = s * 3.1;
    g.beginPath();
    g.arc(hx, hy + s * 0.25, rr, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.fill();
    g.beginPath();
    g.arc(hx, hy, rr, 0, Math.PI * 2);
    g.fillStyle = '#f4ead0';
    g.fill();
    g.lineWidth = Math.max(1, s * 0.32);
    g.strokeStyle = 'rgba(70, 52, 30, 0.9)';
    g.stroke();
    g.fillStyle = T.number === 6 || T.number === 8 ? '#b3261e' : '#2b2118';
    g.font = `700 ${Math.round(rr * 1.18)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(T.number), hx, hy + rr * 0.07);
  }
}

// When this tab first heard each official room's countdown: the host only re-lists its room when
// something changes, so the time left is counted from when its listing arrived. Kept across visits
// to the home screen (the lobby connection outlives it).
const remSeen = new Map();
function countdownFrom(peer, h) {
  const k = `${h.code}:${h.rem}`;
  if (!remSeen.has(k)) {
    if (remSeen.size > 40) remSeen.clear();
    // a listing that arrived before this screen opened: the server's time of the update, when it is
    // plausible on this device's clock
    const now = Date.now();
    const u = Number(peer.updatedAt) || 0;
    remSeen.set(k, u > now - 65000 && u < now + 2000 ? Math.min(now, u) : now);
  }
  return remSeen.get(k);
}

// the hexes of the crest: a small island
function crest() {
  const cols = ['#e9c04f', '#3f6e3c', '#c46a40', '#8fc457', '#8a8e9c', '#3f6e3c', '#efc24a'];
  const pts = [[0, 0]];
  for (let k = 0; k < 6; k++) pts.push([Math.cos((Math.PI / 3) * k + Math.PI / 6) * 17.3, Math.sin((Math.PI / 3) * k + Math.PI / 6) * 17.3]);
  const hex = (x, y, r) => {
    const p = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 90);
      p.push(`${(50 + x + r * Math.cos(a)).toFixed(1)},${(50 + y + r * Math.sin(a)).toFixed(1)}`);
    }
    return p.join(' ');
  };
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><linearGradient id="crestg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2c0"/><stop offset="0.45" stop-color="#e2b456"/><stop offset="1" stop-color="#7a4c16"/></linearGradient></defs>
    <polygon points="${hex(0, 0, 47)}" fill="url(#crestg)" stroke="#2a1808" stroke-width="3"/>
    <polygon points="${hex(0, 0, 40)}" fill="#13222d" stroke="#2a1808" stroke-width="2"/>
    ${pts.map(([x, y], i) => `<polygon points="${hex(x, y, 9.6)}" fill="${cols[i]}" stroke="#2a1808" stroke-width="1.6"/>`).join('')}
  </svg>`;
}

// opts: settings, hasSave, seed (the island this player would open an official room on), seconds
// (the official countdown), version, getLobby() → lobby wrapper | null (unreachable) | undefined
// (no live lobby on this page), and the handlers onChange, onSingle, onCreate, onJoin, onMatch,
// onContinue, onRules, onSettings. setMatch(state) shows this player's own matchmaking.
export function showHome(app, opts) {
  const { settings, hasSave, onChange, version } = opts;
  const total = Math.max(1, opts.seconds || 60) * 1000;
  const scr = el('div', 'menu-screen home');
  const card = (k, metal, name, em = k) =>
    `<button class="hm-card m-${metal}" type="button" data-k="${k}"${k === 'continue' && !hasSave ? ' hidden' : ''}><span class="hm-em">${emblemSvg(em, 96)}</span><span class="hm-lbl">${name}</span></button>`;
  scr.innerHTML = `
    <header class="hm-top">
      <div class="hm-brand">
        <div class="hm-logo"><span class="hm-crest">${crest()}</span><h1><span class="hm-title">卡坦島</span><span class="hm-sub">3D 戰略版</span></h1></div>
        <div class="hm-live" role="status" hidden><i></i><span></span></div>
      </div>
      <div class="hm-nation">
        <span class="hm-flag"><img alt=""></span>
        <label class="hm-name"><span class="sr-only">你的國家名稱</span><input id="menu-name" type="text" maxlength="8" autocomplete="off" spellcheck="false"></label>
        <div class="hm-gems" role="group" aria-label="國家顏色"></div>
      </div>
    </header>
    <main class="hm-main">
      <section class="ho-board" data-k="match" role="button" tabindex="0" aria-label="官方房間：點擊加入配對，再點一次退出">
        <div class="ho-plaque"><span class="pl-main">官方房間</span><span class="pl-alt">加入配對</span></div>
        <div class="ho-inner">
          <div class="ho-mapwrap"><canvas class="ho-map" aria-hidden="true"></canvas></div>
          <div class="ho-side">
            <div class="ho-tags"><span>4 人對戰</span><span>10 分勝利</span><span>標準規則</span></div>
            <div class="ho-seats"><span class="ho-shields"></span><b class="ho-n">0/4</b></div>
            <div class="ho-timer">
              <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" class="rim"/><circle cx="50" cy="50" r="38" class="track"/><circle cx="50" cy="50" r="38" class="arc"/></svg>
              <div><b class="ho-sec">60</b><span>秒</span></div>
            </div>
            <p class="ho-hint" hidden></p>
          </div>
        </div>
      </section>
      <nav class="hm-hand" aria-label="遊戲方式">
        ${card('single', 'gold', '單人遊戲')}${card('create', 'bronze', '建立房間')}${card('join', 'verdigris', '加入房間')}${card('continue', 'silver', '繼續上一局', 'resume')}
      </nav>
    </main>
    <div class="hm-medals">
      <button class="hm-medal" type="button" data-k="rules" title="規則說明" aria-label="規則說明">${emblemSvg('rules', 40)}<span>規則</span></button>
      <button class="hm-medal" type="button" data-k="settings" title="設定" aria-label="設定">${emblemSvg('settings', 40)}<span>設定</span></button>
    </div>
    <p class="hm-credits">寫實素材來自 <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a>、Blend Swap 的 Daniel74 與 <a href="https://quaternius.com" target="_blank" rel="noopener">Quaternius</a>（皆為 CC0）${version ? `<span class="ver">${esc(version)}</span>` : ''}</p>`;
  app.appendChild(scr);
  // without the art pack (the claude.ai page) the frames fall back to plain bronze and parchment
  const probe = new Image();
  probe.onerror = () => scr.classList.add('no-art');
  probe.src = 'assets/ui/menu_gold.webp';

  // the hand of cards fans out around its middle
  const cards = [...scr.querySelectorAll('.hm-card:not([hidden])')];
  cards.forEach((c, i) => {
    const off = i - (cards.length - 1) / 2;
    c.style.setProperty('--rot', `${(off * 4.5).toFixed(1)}deg`);
    c.style.setProperty('--lift', `${(Math.abs(off) ** 1.6 * 7).toFixed(1)}px`);
  });

  // ── who you are: flag, name, colour ──
  const flag = scr.querySelector('.hm-flag img');
  const name = scr.querySelector('#menu-name');
  const gems = scr.querySelector('.hm-gems');
  const paintId = () => {
    flag.src = flagURL(settings.color, 0);
    gems.innerHTML = '';
    for (const p of PALETTE) {
      const b = el('button', 'gem' + (settings.color === p.hex ? ' on' : ''));
      b.type = 'button';
      b.style.setProperty('--c', p.hex);
      b.title = p.name;
      b.setAttribute('aria-label', p.name + '色');
      b.setAttribute('aria-pressed', String(settings.color === p.hex));
      b.addEventListener('click', () => {
        settings.color = p.hex;
        onChange(settings);
        paintId();
        paint();
      });
      gems.appendChild(b);
    }
  };
  name.value = settings.name;
  name.addEventListener('input', () => {
    settings.name = name.value;
    onChange(settings);
  });

  // ── actions ──
  const handlers = { single: opts.onSingle, create: opts.onCreate, join: opts.onJoin, continue: opts.onContinue, rules: opts.onRules, settings: opts.onSettings, match: opts.onMatch };
  const act = (k) => handlers[k] && handlers[k]();
  scr.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => act(b.dataset.k)));
  const boardEl = scr.querySelector('.ho-board');
  boardEl.addEventListener('click', () => act('match'));
  boardEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      act('match');
    }
  });

  // ── the island of the next official game ──
  let closed = false;
  const canvas = scr.querySelector('.ho-map');
  let artSeed = opts.seed;
  const paintArt = () => drawBoardArt(canvas, artSeed == null ? null : officialBoard(artSeed));
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paintArt()) : null;
  if (ro) ro.observe(canvas);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => !closed && paintArt());

  // ── the official room, live ──
  const live = scr.querySelector('.hm-live');
  const liveText = live.querySelector('span');
  const plMain = scr.querySelector('.pl-main');
  const plAlt = scr.querySelector('.pl-alt');
  const shields = scr.querySelector('.ho-shields');
  const nEl = scr.querySelector('.ho-n');
  const secEl = scr.querySelector('.ho-sec');
  const timerEl = scr.querySelector('.ho-timer');
  const hint = scr.querySelector('.ho-hint');
  const arc = scr.querySelector('.ho-timer .arc');
  const CIRC = 2 * Math.PI * 38;
  arc.style.strokeDasharray = CIRC.toFixed(2);
  let link = 'static'; // static (no live lobby on this page) | connecting | online | offline
  let room = null; // the official room a player pressing the board lands in: { code, n, f, rem, at }
  let match = null; // this player's own matchmaking, from the session
  const unsubs = [];

  // seconds left on the countdown that applies to this player
  const timeLeft = () => {
    if (match && match.rem != null) return Math.max(0, match.rem - (Date.now() - match.at));
    if (room && room.rem != null) return Math.max(0, room.rem - (Date.now() - room.at));
    return null;
  };
  const tick = () => {
    const left = timeLeft();
    timerEl.classList.toggle('idle', left == null);
    const txt = left == null ? String(Math.round(total / 1000)) : String(Math.ceil(left / 1000));
    secEl.textContent = txt;
    secEl.classList.toggle('long', txt.length > 2);
    arc.style.strokeDashoffset = (left == null ? CIRC : CIRC * (1 - Math.min(1, left / total))).toFixed(2);
  };
  const paint = () => {
    const joined = !!match;
    boardEl.classList.toggle('joined', joined);
    boardEl.classList.toggle('live', !!room || joined);
    boardEl.dataset.match = joined ? match.phase || 'searching' : '';
    plMain.textContent = joined ? '配對中' : '官方房間';
    plAlt.textContent = joined ? '退出配對' : '加入配對';
    // seats: from my own room when I am in one, otherwise from the lobby's listing
    let n = 4;
    let have = 0;
    const listed = room ? Math.min(room.n, Math.max(1, room.n - room.f)) : 0;
    if (joined && match.seats) {
      n = match.seats.length;
      have = match.seats.filter((s) => s.kind !== 'open').length;
      // a newcomer's own view can lag behind the room's listing for a moment
      if (room && room.code === match.code) have = Math.max(have, listed);
    } else if (room) {
      n = room.n;
      have = listed;
    }
    if (joined) have = Math.max(have, 1);
    let html = '';
    for (let i = 0; i < n; i++) html += seatShield(i >= have ? 'open' : joined && i === (match.seat >= 0 ? match.seat : 0) ? 'me' : 'taken', settings.color);
    shields.innerHTML = html;
    nEl.textContent = `${have}/${n}`;
    const hints = { offline: '暫時連不上線上大廳' };
    const h = joined ? (match.phase === 'searching' && !match.seats ? '正在尋找房間…　再點一次退出' : '再點一次退出') : hints[link] || '';
    hint.textContent = h;
    hint.hidden = !h;
    tick();
  };
  const setLive = (peers) => {
    live.hidden = link === 'static';
    live.classList.toggle('on', link === 'online');
    live.classList.toggle('off', link === 'offline');
    if (link === 'online') {
      const playing = peers.filter((p) => p.presence && p.presence.app === APP && p.presence.host && p.presence.host.st === 'play').length;
      liveText.innerHTML = `線上 <b>${peers.length}</b> 人${playing ? ` · <b>${playing}</b> 局進行中` : ''}`;
    } else liveText.textContent = link === 'offline' ? '離線' : '連線中…';
  };
  const update = (peers) => {
    const mine = peers.filter((p) => p.presence && p.presence.app === APP);
    // open official rooms in the order matchmaking fills them (oldest first)
    const officials = mine
      .filter((p) => p.presence.host && p.presence.host.off === 1 && p.presence.host.st === 'lobby' && typeof p.presence.host.code === 'string')
      .sort((a, b) => (Number(a.presence.host.ts) || 0) - (Number(b.presence.host.ts) || 0) || (a.presence.host.code < b.presence.host.code ? -1 : a.presence.host.code > b.presence.host.code ? 1 : 0));
    // my own room when I am in one, else the one a player pressing the board lands in
    const top = (match && match.code && officials.find((p) => p.presence.host.code === match.code)) || officials.find((p) => (Number(p.presence.host.f) || 0) > 0);
    let seed = opts.seed;
    if (top) {
      const h = top.presence.host;
      const rem = typeof h.rem === 'number' ? h.rem : null;
      room = { code: h.code, n: Number(h.n) || 4, f: Number(h.f) || 0, rem, at: rem == null ? Date.now() : countdownFrom(top, h) };
      if (Number.isFinite(h.ms)) seed = h.ms >>> 0;
    } else room = null;
    if (seed !== artSeed) {
      artSeed = seed;
      paintArt();
    }
    setLive(peers);
    paint();
  };

  let lobbyNow = null;
  const attach = (lobby) => {
    if (!lobby || lobbyNow || closed) return; // one view of the lobby is enough
    lobbyNow = lobby;
    link = lobby.connected() ? 'online' : 'connecting';
    let wasOnline = link === 'online';
    unsubs.push(lobby.onPeers((ch) => !closed && update(ch.peers || lobby.peers())));
    unsubs.push(
      lobby.onConnection((ok) => {
        if (closed) return;
        if (ok) wasOnline = true;
        link = ok ? 'online' : wasOnline ? 'connecting' : link;
        update(lobby.peers());
      }),
    );
    // the room server keeps retrying in the background; say so if the first attempt takes long
    const slow = setTimeout(() => {
      if (!closed && link === 'connecting' && !lobby.connected()) {
        link = 'offline';
        update(lobby.peers());
      }
    }, 8000);
    unsubs.push(() => clearTimeout(slow));
    update(lobby.peers());
  };

  paintId();
  paintArt();
  paint();
  const timer = setInterval(tick, 250);
  (async () => {
    let lobby;
    try {
      lobby = opts.getLobby ? await opts.getLobby() : undefined;
    } catch {
      lobby = null;
    }
    if (closed) return;
    if (lobby) attach(lobby);
    else if (!lobbyNow) {
      link = lobby === undefined ? 'static' : 'offline';
      setLive([]);
      paint();
    }
  })();

  return {
    el: scr,
    // this player's matchmaking (null when not matching): { phase, code, seats, seat, rem }
    setMatch(st) {
      if (closed) return;
      match = st ? { ...st, at: Date.now() } : null;
      if (lobbyNow) update(lobbyNow.peers());
      else paint();
    },
    // a lobby that became available after the screen opened (claude.ai: once matchmaking connects)
    attachLobby(lobby) {
      attach(lobby);
    },
    close() {
      closed = true;
      clearInterval(timer);
      for (const u of unsubs) if (u) u();
      if (ro) ro.disconnect();
      scr.remove();
    },
  };
}
