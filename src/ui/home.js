// Home screen. The official room leads: one public room that fills up and starts by itself, so
// players gather in it instead of each opening a room of their own and waiting there alone.
// Below it: single player, a room of your own, joining a room by code, the rules and the settings.
import { GEO, HEX_SIZE } from '../engine/geometry.js';
import { generateBoard } from '../engine/board.js';
import { seedState } from '../engine/rng.js';
import { PALETTE } from './menu.js';
import { flagURL } from './flags.js';
import { icon } from './icons.js';
import { esc } from './text.js';

const APP = 'catan3d';
const SQRT3 = Math.sqrt(3);
// the paper map's terrain colours
const TERRAIN = { forest: '#3f6e3c', hills: '#c46a40', pasture: '#8fc457', fields: '#efc24a', mountains: '#8a8e9c', desert: '#e3cf96' };
const SVG = {
  play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8.5 5.8v12.4L18.6 12z" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  join: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  resume: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5.5 12a6.5 6.5 0 1 0 2-4.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5.5 4.5v3.6h3.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  people: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.6 14.4c1.6.7 2.6 2.3 2.9 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h13M13 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

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

// The next island as a painted strategy map: provinces in their terrain colours, number tokens and
// harbours out at sea. As the card's backdrop (desktop) the island sits between the text and the
// countdown; as a strip above the text (phones) it is centred.
export function drawBoardArt(canvas, board, backdrop = true) {
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
  const cx = W * (backdrop ? 0.635 : 0.5);
  const cz = H * 0.5;
  const sea = g.createRadialGradient(cx, cz, 0, cx, cz, Math.max(W, H) * 0.7);
  sea.addColorStop(0, '#2f6f8c');
  sea.addColorStop(0.5, '#1d4b63');
  sea.addColorStop(1, '#0c2230');
  g.fillStyle = sea;
  g.fillRect(0, 0, W, H);
  if (!board) return;
  const span = { x: HEX_SIZE * SQRT3 * 5 + 8, z: HEX_SIZE * 8 + 8 };
  const s = Math.min((W * (backdrop ? 0.36 : 0.8)) / span.x, (H * 0.84) / span.z);
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
  // swell lines around the coast, then a sand rim
  g.lineWidth = Math.max(1, s * 0.3);
  for (const [k, a] of [
    [1.75, 0.07],
    [1.45, 0.12],
  ]) {
    g.strokeStyle = `rgba(200, 232, 245, ${a})`;
    for (const h of GEO.hexes) {
      hexPath(h.x, h.z, HEX_SIZE * k);
      g.stroke();
    }
  }
  g.fillStyle = '#d8c28c';
  for (const h of GEO.hexes) {
    hexPath(h.x, h.z, HEX_SIZE * 1.16);
    g.fill();
  }
  for (const h of GEO.hexes) {
    const T = board.hexes[h.id];
    hexPath(h.x, h.z, HEX_SIZE * 0.99);
    g.fillStyle = TERRAIN[T.terrain] || '#c9b98f';
    g.fill();
    const [hx, hy] = P(h.x, h.z);
    const lg = g.createLinearGradient(hx - s * 8, hy - s * 8, hx + s * 8, hy + s * 8);
    lg.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
    lg.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
    g.fillStyle = lg;
    g.fill();
    g.strokeStyle = 'rgba(58, 40, 22, 0.6)';
    g.lineWidth = Math.max(1, s * 0.42);
    g.stroke();
  }
  for (const hb of board.harbors || []) {
    const e = GEO.edges[hb.edge];
    if (!e || !e.outward) continue;
    const [ex, ey] = P(e.x + e.outward.x * 1.5, e.z + e.outward.z * 1.5);
    const [hx, hy] = P(e.x + e.outward.x * 7.5, e.z + e.outward.z * 7.5);
    g.strokeStyle = 'rgba(217, 189, 120, 0.85)';
    g.lineWidth = Math.max(1, s * 0.35);
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(hx, hy);
    g.stroke();
    g.beginPath();
    g.arc(hx, hy, s * 1.9, 0, Math.PI * 2);
    g.fillStyle = '#121a20';
    g.fill();
    g.stroke();
  }
  for (const h of GEO.hexes) {
    const T = board.hexes[h.id];
    if (!T.number) continue;
    const [hx, hy] = P(h.x, h.z);
    const rr = s * 3.2;
    g.beginPath();
    g.arc(hx, hy, rr, 0, Math.PI * 2);
    g.fillStyle = '#f4ead0';
    g.fill();
    g.lineWidth = Math.max(1, s * 0.32);
    g.strokeStyle = 'rgba(70, 52, 30, 0.9)';
    g.stroke();
    g.fillStyle = T.number === 6 || T.number === 8 ? '#b3261e' : '#2b2118';
    g.font = `700 ${Math.round(rr * 1.2)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
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

// opts: settings, hasSave, seed (the island this player would open an official room on), seconds
// (the official countdown), version, getLobby() → lobby wrapper | null (unreachable) | undefined
// (no live lobby on this page), and the handlers onChange, onSingle, onCreate, onJoin, onMatch,
// onContinue, onRules, onSettings
export function showHome(app, opts) {
  const { settings, hasSave, onChange, version } = opts;
  const total = Math.max(1, opts.seconds || 60) * 1000;
  const scr = el('div', 'menu-screen home');
  scr.innerHTML = `
    <header class="home-top">
      <h1 class="home-logo">卡坦島<span>3D 戰略版</span></h1>
      <div class="home-live" role="status" hidden><i class="dot"></i><span class="lv"></span></div>
    </header>
    <main class="home-main">
      <div class="home-id panel">
        <img class="flag" alt="">
        <label class="id-name"><small>你的國家</small><input id="menu-name" type="text" maxlength="8" autocomplete="off" spellcheck="false"></label>
        <div class="swatches" role="group" aria-label="國家顏色"></div>
      </div>
      <section class="home-official" data-k="match" role="button" tabindex="0" aria-label="加入下一場官方對戰">
        <canvas class="ho-map" aria-hidden="true"></canvas>
        <div class="ho-info">
          <div class="ho-eyebrow"><i class="ho-dot"></i>官方房間</div>
          <h2 class="ho-title">加入下一場</h2>
          <div class="ho-tags"><span>4 人對戰</span><span>10 分勝利</span><span>標準規則</span></div>
          <div class="ho-count">${SVG.people}<b class="ho-n">0/4</b><span class="ho-who">位玩家</span></div>
          <div class="ho-bar"><i></i></div>
          <p class="ho-note"></p>
          <span class="ho-cta">立即加入${SVG.arrow}</span>
        </div>
        <div class="ho-ring" aria-hidden="true">
          <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="track"/><circle cx="50" cy="50" r="44" class="arc"/></svg>
          <div><b class="ho-sec">—</b><span class="ho-sub"></span></div>
        </div>
      </section>
      <div class="home-grid">
        <button class="hg-btn primary" type="button" data-k="single"><span class="hg-ico">${SVG.play}</span><span>單人遊戲</span></button>
        <button class="hg-btn" type="button" data-k="create"><span class="hg-ico">${SVG.plus}</span><span>建立房間</span></button>
        <button class="hg-btn" type="button" data-k="join"><span class="hg-ico">${SVG.join}</span><span>加入房間</span></button>
        <button class="hg-btn" type="button" data-k="continue"${hasSave ? '' : ' hidden'}><span class="hg-ico">${SVG.resume}</span><span>繼續上一局</span></button>
      </div>
      <div class="home-grid2">
        <button class="hg-btn2" type="button" data-k="rules">${icon('rules', 18)}<span>規則說明</span></button>
        <button class="hg-btn2" type="button" data-k="settings">${icon('gear', 18)}<span>設定</span></button>
      </div>
      <p class="home-credits">寫實素材來自 <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a>、Blend Swap 的 Daniel74 與 <a href="https://quaternius.com" target="_blank" rel="noopener">Quaternius</a>（皆為 CC0）${version ? `<span class="ver">${esc(version)}</span>` : ''}</p>
    </main>`;
  app.appendChild(scr);

  // ── who you are: flag, name, colour ──
  const flag = scr.querySelector('.home-id .flag');
  const name = scr.querySelector('#menu-name');
  const sw = scr.querySelector('.home-id .swatches');
  const paintId = () => {
    flag.src = flagURL(settings.color, 0);
    sw.innerHTML = '';
    for (const p of PALETTE) {
      const b = el('button', 'swatch' + (settings.color === p.hex ? ' on' : ''));
      b.type = 'button';
      b.style.background = p.hex;
      b.title = p.name;
      b.setAttribute('aria-label', p.name + '色');
      b.setAttribute('aria-pressed', String(settings.color === p.hex));
      b.addEventListener('click', () => {
        settings.color = p.hex;
        onChange(settings);
        paintId();
      });
      sw.appendChild(b);
    }
  };
  name.value = settings.name;
  name.addEventListener('input', () => {
    settings.name = name.value;
    onChange(settings);
  });
  paintId();

  // ── actions ──
  const handlers = { single: opts.onSingle, create: opts.onCreate, join: opts.onJoin, continue: opts.onContinue, rules: opts.onRules, settings: opts.onSettings, match: opts.onMatch };
  const act = (k) => handlers[k] && handlers[k]();
  scr.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => act(b.dataset.k)));
  const card = scr.querySelector('.home-official');
  card.addEventListener('click', () => act('match'));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      act('match');
    }
  });

  // ── the island of the next official game ──
  let closed = false;
  const canvas = scr.querySelector('.ho-map');
  let artSeed = opts.seed;
  const paintArt = () => drawBoardArt(canvas, artSeed == null ? null : officialBoard(artSeed), getComputedStyle(canvas).position === 'absolute');
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paintArt()) : null;
  if (ro) ro.observe(canvas);
  paintArt();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => !closed && paintArt());

  // ── the official room, live ──
  const pill = scr.querySelector('.home-live');
  const pillText = pill.querySelector('.lv');
  const nEl = scr.querySelector('.ho-n');
  const whoEl = scr.querySelector('.ho-who');
  const bar = scr.querySelector('.ho-bar i');
  const note = scr.querySelector('.ho-note');
  const sec = scr.querySelector('.ho-sec');
  const sub = scr.querySelector('.ho-sub');
  const arc = scr.querySelector('.ho-ring .arc');
  const CIRC = 2 * Math.PI * 44;
  arc.style.strokeDasharray = CIRC.toFixed(2);
  let link = 'static'; // static (no live lobby on this page) | connecting | online | offline
  let room = null; // the official room a player pressing "join" lands in: { code, n, f, rem, at }
  let searching = 0;
  const unsubs = [];

  const tick = () => {
    if (room && room.rem != null) {
      const left = Math.max(0, room.rem - (Date.now() - room.at));
      sec.textContent = `${Math.ceil(left / 1000)}s`;
      sub.textContent = '後開戰';
      arc.style.strokeDashoffset = (CIRC * (1 - Math.min(1, left / total))).toFixed(2);
    } else {
      sec.textContent = link === 'static' ? `${Math.round(total / 1000)}s` : '—';
      sub.textContent = room ? '等待中' : { static: '倒數開戰', online: '等待開房', offline: '離線', connecting: '連線中' }[link];
      arc.style.strokeDashoffset = link === 'static' ? '0' : CIRC.toFixed(2);
    }
  };
  const paint = () => {
    card.classList.toggle('live', !!room);
    const counted = link === 'online';
    nEl.parentElement.hidden = !counted;
    bar.parentElement.hidden = !counted;
    const who = searching ? `位玩家 · ${searching} 人正在配對` : '位玩家';
    if (room) {
      const have = Math.min(room.n, Math.max(1, room.n - room.f));
      nEl.textContent = `${have}/${room.n}`;
      whoEl.textContent = who;
      bar.style.width = `${Math.round((have / room.n) * 100)}%`;
      note.textContent = room.f > 0 ? `滿 ${room.n} 人立即開戰；倒數結束時，空位由電腦補上。` : '人已到齊，即將開戰。';
    } else {
      nEl.textContent = '0/4';
      whoEl.textContent = who;
      bar.style.width = '0%';
      note.textContent = {
        static: '系統會把你放進開放中的官方房間：滿 4 人立即開戰，60 秒後空位由電腦補上。',
        connecting: '正在連線線上大廳…',
        offline: '暫時連不上線上大廳。可以稍後再試，或先玩單人遊戲。',
        online: '目前沒有開放中的官方房間。按下加入就會開一間：60 秒內湊滿 4 人立即開戰，空位由電腦補上。',
      }[link];
    }
    tick();
  };
  const setPill = (peers) => {
    pill.hidden = link === 'static';
    pill.classList.toggle('on', link === 'online');
    pill.classList.toggle('off', link === 'offline');
    if (link === 'online') {
      const playing = peers.filter((p) => p.presence && p.presence.app === APP && p.presence.host && p.presence.host.st === 'play').length;
      pillText.innerHTML = `線上 <b>${peers.length}</b> 人${playing ? ` · <b>${playing}</b> 局進行中` : ''}`;
    } else pillText.textContent = link === 'offline' ? '離線' : '連線中…';
  };
  const update = (peers) => {
    const mine = peers.filter((p) => p.presence && p.presence.app === APP);
    // open official rooms in the order matchmaking fills them (oldest first)
    const officials = mine
      .filter((p) => p.presence.host && p.presence.host.off === 1 && p.presence.host.st === 'lobby' && typeof p.presence.host.code === 'string')
      .sort((a, b) => (Number(a.presence.host.ts) || 0) - (Number(b.presence.host.ts) || 0) || (a.presence.host.code < b.presence.host.code ? -1 : a.presence.host.code > b.presence.host.code ? 1 : 0));
    const top = officials.find((p) => (Number(p.presence.host.f) || 0) > 0);
    searching = mine.filter((p) => p.presence.mm && !p.presence.mm.in).length;
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
    setPill(peers);
    paint();
  };

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
    if (!lobby) {
      link = lobby === undefined ? 'static' : 'offline';
      setPill([]);
      paint();
      return;
    }
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
  })();

  return {
    el: scr,
    close() {
      closed = true;
      clearInterval(timer);
      for (const u of unsubs) if (u) u();
      if (ro) ro.disconnect();
      scr.remove();
    },
  };
}
