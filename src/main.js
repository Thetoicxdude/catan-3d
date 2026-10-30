// Boot: title screen over a live island preview → campaign. Handles saves and settings.
import { createGame } from './engine/engine.js';
import { randomSeed } from './engine/rng.js';
import { MapView } from './render/scene.js';
import { Game, loadSave, clearSave } from './game/game.js';
import { showMenu, defaultSettings, playersFromSettings } from './ui/menu.js';
import { Dialogs } from './ui/dialogs.js';
import { HostSession, ClientSession, MatchSession, showOnlineEntry, rememberedRoom, forgetRoom } from './net/online.js';
import { icon } from './ui/icons.js';
import { setSfx } from './ui/sfx.js';

const SETTINGS_KEY = 'catan3d-settings-v1';
const app = document.getElementById('app');
app.innerHTML = '<div id="map"></div><div class="vignette"></div>';
const mapEl = app.querySelector('#map');

function loadSettings() {
  const d = defaultSettings();
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s && typeof s === 'object') return { ...d, ...s, seats: Array.isArray(s.seats) && s.seats.length === 3 ? s.seats : d.seats };
  } catch {
    /* storage unavailable */
  }
  return d;
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

let settings = loadSettings();
setSfx(settings.sound !== false);
let map = null;
let mapKey = '';
let game = null;
let menu = null;
let previewSeed = randomSeed();
let drift = null;
let session = null;
let onlineScreen = null;

// dispatches outside a running campaign (menus, lobbies)
function toast(title, text, ic = 'vp') {
  if (game) {
    game.hud.toast(title, text, ic);
    return;
  }
  let box = app.querySelector(':scope > .toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.style.top = 'calc(16px + env(safe-area-inset-top, 0px))';
    box.style.zIndex = 90;
    app.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<div class="ti">${icon(ic, 20)}</div><h4></h4><p></p>`;
  t.querySelector('h4').textContent = title;
  t.querySelector('p').textContent = text;
  box.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 450);
  }, 3800);
}

function loading(on, text = '測繪島嶼地形') {
  let el = app.querySelector('.loading');
  if (on) {
    if (!el) {
      el = document.createElement('div');
      el.className = 'loading';
      el.innerHTML = `<div>${text}</div><div class="bar"><i></i></div>`;
      app.appendChild(el);
    }
  } else if (el) el.remove();
}

function buildMap(state, players, quality) {
  const key = `${state.mapSeed != null ? state.mapSeed : state.seed}:${state.board.method}:${state.board.hexes.map((h) => h.terrain[0] + h.number).join('')}:${quality}`;
  if (map && mapKey === key) {
    map.setPlayers(state, players);
    return map;
  }
  if (map) map.dispose();
  map = new MapView(mapEl);
  map.build(state, players, quality);
  map.start();
  mapKey = key;
  return map;
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

async function showPreview(reroll) {
  if (reroll) previewSeed = randomSeed();
  loading(true);
  await nextFrame();
  if (game) {
    loading(false);
    return; // a campaign started meanwhile: never replace its map with a preview
  }
  const players = playersFromSettings(settings);
  const st = createGame({ seed: previewSeed, players, board: { numbers: settings.numbers } });
  try {
    buildMap(st, players, settings.quality);
  } catch (e) {
    loading(false);
    showFatal(e);
    return;
  }
  loading(false);
  map.setMapMode('terrain');
  map.camera.goal.set(0, 0, 6);
  map.camera.goalH = 100;
  let t = 0;
  // title screen: a slow orbit around the island at a low, cinematic angle
  drift = (dt) => {
    t += dt;
    map.camera.goal.set(Math.sin(t * 0.05) * 12, 0, 6 + Math.cos(t * 0.04) * 8);
    map.camera.goalH = 100 + Math.sin(t * 0.07) * 12;
    map.camera.goalYaw = t * 0.045;
    map.camera.goalPitch = 56;
  };
  map.onFrame = (dt) => drift && drift(dt);
}

function openMenu() {
  if (menu) menu.close();
  if (map) map.holdAssets(false);
  const save = loadSave();
  menu = showMenu(app, {
    settings,
    hasSave: !!save,
    onChange: (s) => {
      settings = s;
      saveSettings(s);
    },
    onReroll: (newSeed) => showPreview(newSeed),
    onRules: () => {
      const layer = document.createElement('div');
      layer.className = 'modal-layer';
      layer.style.zIndex = 80;
      app.appendChild(layer);
      const d = new Dialogs(layer);
      const h = d.rules();
      h.onClose = () => layer.remove();
    },
    onContinue: () => {
      const save = loadSave();
      if (save && save.net) hostRoom(save);
      else startGame(save);
    },
    onStart: () => startGame(null),
    onOnline: () => openOnline(),
  });
}

function openOnline() {
  if (menu) {
    menu.close();
    menu = null;
  }
  if (map) map.holdAssets(true);
  onlineScreen = showOnlineEntry(app, {
    settings,
    onHost: () => hostRoom(null),
    onJoin: (code) => joinRoom(code),
    onMatch: () => matchRoom(),
    onBack: () => openMenu(),
  });
}

async function hostRoom(save) {
  if (menu) {
    menu.close();
    menu = null;
  }
  session = new HostSession({
    app,
    settings,
    toast,
    onStart: (players, net) => startOnlineHost(players, net),
    onLeave: () => {
      session = null;
      openMenu();
    },
  });
  try {
    await session.open(save ? save.net : null);
  } catch (e) {
    toast('無法建立房間', e.message || String(e), 'cross');
    session = null;
    if (save) startGame(save);
    else openMenu();
    return;
  }
  if (save) {
    // reopen the same room and resume; returning players reclaim their seats automatically
    drift = null;
    loading(true, '重新開放房間');
    await nextFrame();
    const players = save.state.players.map((p) => ({ name: p.name, color: p.color, kind: p.kind, ai: p.ai }));
    buildMap(save.state, players, settings.quality);
    map.onFrame = null;
    map.holdAssets(false);
    game = new Game({ app, map, settings, players, saved: save, net: session.netApi(), onExit: () => exitOnline() });
    hookGame();
    loading(false);
    game.start();
    session.resume(game);
  }
}

async function startOnlineHost(players, net) {
  drift = null;
  loading(true, '佈置戰場');
  await nextFrame();
  const preview = createGame({ seed: previewSeed, players, targetVP: settings.target, board: { numbers: settings.numbers } });
  buildMap(preview, players, settings.quality);
  map.onFrame = null;
  map.holdAssets(false);
  game = new Game({ app, map, settings, players, seed: previewSeed, net, onExit: () => exitOnline() });
  hookGame();
  loading(false);
  game.start();
  return game;
}

async function startClientGame(view, players, net) {
  drift = null;
  loading(true, '進入戰場');
  await nextFrame();
  buildMap(view, players, settings.quality);
  map.onFrame = null;
  map.holdAssets(false);
  game = new Game({ app, map, settings, players, net, onExit: () => exitOnline() });
  hookGame();
  loading(false);
  game.start();
  return game;
}

// test hook (mock rooms, or tests that switch hooks on)
if (window.__mockRoom || window.__testHooks) window.__sess = () => session;

// official rooms: automatic matchmaking (full room or countdown starts the campaign)
async function matchRoom() {
  session = new MatchSession({
    app,
    settings,
    toast,
    seconds: window.__mmSeconds || 60,
    onHostStart: (players, net) => startOnlineHost(players, net),
    onClientGame: (view, players, net) => startClientGame(view, players, net),
    onLeave: () => {
      session = null;
      openMenu();
    },
  });
  try {
    await session.open();
  } catch (e) {
    toast('無法配對', e.message || String(e), 'cross');
    session = null;
    openMenu();
  }
}

async function joinRoom(code) {
  session = new ClientSession({
    app,
    settings,
    code,
    toast,
    onGame: (view, players, net) => startClientGame(view, players, net),
    onLeave: () => {
      session = null;
      openMenu();
    },
  });
  try {
    await session.open();
  } catch (e) {
    toast('無法加入房間', e.message || String(e), 'cross');
    session = null;
    openMenu();
  }
}

async function exitOnline() {
  if (game) {
    game.save();
    game.destroy();
    game = null;
  }
  if (session) {
    await session.leave();
    session = null;
  }
  previewSeed = randomSeed();
  openMenu();
  showPreview(false);
}

function hookGame() {
  game.onSettings = (s) => {
    settings = { ...settings, ...s };
    saveSettings(settings);
  };
  window.__game = game;
}

async function startGame(saved) {
  drift = null;
  if (menu) {
    menu.close();
    menu = null;
  }
  loading(true, saved ? '載入戰役' : '佈置戰場');
  await nextFrame();
  let players;
  let state;
  if (saved) {
    state = saved.state;
    players = state.players.map((p) => ({ name: p.name, color: p.color, kind: p.kind, ai: p.ai }));
    settings = { ...settings, ...(saved.settings || {}), quality: settings.quality };
  } else {
    players = playersFromSettings(settings);
    state = createGame({ seed: previewSeed, players, targetVP: settings.target, board: { numbers: settings.numbers } });
  }
  try {
    buildMap(state, players, settings.quality);
  } catch (e) {
    loading(false);
    showFatal(e);
    return;
  }
  map.onFrame = null;
  game = new Game({
    app,
    map,
    settings,
    players,
    seed: previewSeed,
    saved,
    onExit: () => exitToMenu(),
  });
  hookGame();
  loading(false);
  game.start();
}

function exitToMenu() {
  if (game) {
    game.save();
    game.destroy();
    game = null;
  }
  previewSeed = randomSeed();
  openMenu();
  showPreview(false);
}

function showFatal(e) {
  console.error(e);
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div style="letter-spacing:0.1em;max-width:32em;text-align:center;line-height:1.7">無法啟動 3D 地圖。<br><span style="font-family:var(--font-body);font-size:13px;color:var(--ink-faint)">這個裝置或瀏覽器可能不支援 WebGL 2，或已停用硬體加速。請改用最新版 Chrome、Edge、Safari 或 Firefox。<br>（${String(e && e.message ? e.message : e)}）</span></div>`;
  app.appendChild(el);
}

// hot reload: keep the running campaign across a republish
const hot = window.claude && window.claude.hot;
if (hot && hot.snapshot) {
  try {
    hot.snapshot(() => ({ save: game ? game.serialize() : null, settings }));
  } catch {
    /* viewer without hot updates */
  }
}

// an invite link (#room=code) opens the site straight into that room
function inviteCode() {
  const m = /(?:^#|[#&])room=([a-z0-9]{3,12})\b/i.exec(location.hash || '');
  if (!m) return null;
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* sandboxed */
  }
  return m[1].toLowerCase();
}

function boot(data) {
  if (data && data.settings) settings = { ...settings, ...data.settings };
  const invited = inviteCode();
  if (invited) {
    forgetRoom();
    showPreview(false).then(() => joinRoom(invited));
    return;
  }
  // this tab was in an online room before a reload or a new version: rejoin it
  const room = rememberedRoom();
  if (room) {
    if (room.role === 'client') {
      showPreview(false).then(() => joinRoom(room.code));
      return;
    }
    const save = loadSave();
    if (room.role === 'host' && save && save.net && save.net.code === room.code) {
      hostRoom(save);
      return;
    }
    forgetRoom();
  }
  if (data && data.save && data.save.state && data.save.state.seed != null && data.save.state.phase !== 'over') {
    startGame(data.save);
    return;
  }
  openMenu();
  showPreview(false);
}

if (hot && hot.ready) hot.ready(boot);
else boot(hot && hot.data ? hot.data : {});

export { clearSave };
