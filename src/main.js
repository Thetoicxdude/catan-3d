// Boot: title screen over a live island preview → campaign. Handles saves and settings.
import { createGame } from './engine/engine.js';
import { randomSeed } from './engine/rng.js';
import { MapView } from './render/scene.js';
import { Game, loadSave, clearSave } from './game/game.js';
import { showMenu, defaultSettings, playersFromSettings, PALETTE, buildInfo } from './ui/menu.js';
import { showHome } from './ui/home.js';
import { Dialogs } from './ui/dialogs.js';
import { HostSession, ClientSession, MatchSession, showOnlineEntry, rememberedRoom, forgetRoom } from './net/online.js';
import { getRoom, wrap, selfHosted } from './net/room.js';
import { icon } from './ui/icons.js';
import { esc } from './ui/text.js';
import { reportResult } from './net/account.js';
import { setSfx } from './ui/sfx.js';

const SETTINGS_KEY = 'catan3d-settings-v1';
const app = document.getElementById('app');
// without the art pack (the claude.ai page) the bronze frames fall back to plain lines
{
  const probe = new Image();
  probe.onerror = () => document.documentElement.classList.add('no-art');
  probe.src = 'assets/ui/frame_bronze.webp';
}
app.innerHTML = '<div id="map"></div><div class="vignette"></div>';
const mapEl = app.querySelector('#map');

function loadSettings() {
  const d = defaultSettings();
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    // quality follows the device unless the player has picked one in the settings
    if (s && typeof s === 'object') {
      const seats = Array.isArray(s.seats) && s.seats.length === 3 ? s.seats.map((x) => (x && x.name === '白楊共和國' ? { ...x, name: '碧海共和國' } : x)) : d.seats;
      const color = PALETTE.some((p) => p.hex === s.color) ? s.color : d.color;
      return { ...d, ...s, color, quality: s.qualityPicked ? s.quality || d.quality : d.quality, seats };
    }
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
  map = new MapView(mapEl, quality);
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

// dialogs over the menus (rules, settings)
let menuDlg = null;
function menuDialogs() {
  if (!menuDlg) {
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    layer.style.zIndex = 80;
    app.appendChild(layer);
    menuDlg = new Dialogs(layer);
  }
  return menuDlg;
}

function closeMenus() {
  if (menu) {
    menu.close();
    menu = null;
  }
  if (onlineScreen) {
    onlineScreen.close();
    onlineScreen = null;
  }
  if (menuDlg) menuDlg.close(true);
}

// The home screen watches the lobby live (players online, the official room filling up) wherever
// that needs no permission: on our own room server and with the test rooms. In claude.ai the lobby
// opens only when the player asks for online play.
let lobbyView = null;
async function homeLobby() {
  if (!selfHosted() && !window.__mockRoom) return undefined;
  const room = await getRoom();
  if (!room) return null;
  if (!lobbyView) lobbyView = wrap(room);
  return lobbyView;
}

function onSettingsChange(s) {
  settings = s;
  saveSettings(s);
}

function openMenu() {
  closeMenus();
  if (map) map.holdAssets(false);
  menu = showHome(app, {
    settings,
    hasSave: !!loadSave(),
    seed: previewSeed,
    seconds: window.__mmSeconds || 60,
    version: buildInfo(),
    getLobby: homeLobby,
    dialogs: menuDialogs,
    onChange: onSettingsChange,
    // any other way to play leaves the official matchmaking first
    onSingle: () => stopMatch().then(openSetup),
    onCreate: () =>
      stopMatch().then(() => {
        closeMenus();
        if (map) map.holdAssets(true);
        hostRoom(null);
      }),
    onJoin: () => stopMatch().then(openJoin),
    onMatch: () => toggleMatch(),
    onContinue: () =>
      stopMatch().then(() => {
        const save = loadSave();
        if (save && save.net) hostRoom(save);
        else startGame(save);
      }),
    onRules: () => menuDialogs().rules(),
    onSettings: () =>
      menuDialogs().settings({ ...settings }, (s, key) => {
        // in place: the home screen keeps editing this same object (name, colour)
        Object.assign(settings, s);
        saveSettings(settings);
        setSfx(settings.sound !== false);
        // the preview island is redrawn in the new quality straight away (same quality: kept as is)
        if (key === 'quality' && !game) showPreview(false);
      }),
  });
}

// single player: opponents, numbers, victory points and the island, over the live preview
function openSetup() {
  closeMenus();
  menu = showMenu(app, {
    settings,
    hasSave: false,
    onChange: onSettingsChange,
    onReroll: (newSeed) => showPreview(newSeed),
    onRules: () => menuDialogs().rules(),
    onStart: () => startGame(null),
    onBack: () => openMenu(),
  });
}

// join a friend's room: a room code, or one of the open rooms
function openJoin() {
  closeMenus();
  if (map) map.holdAssets(true);
  onlineScreen = showOnlineEntry(app, {
    settings,
    joinOnly: true,
    onJoin: (code) => {
      onlineScreen = null;
      joinRoom(code);
    },
    onBack: () => {
      onlineScreen = null;
      openMenu();
    },
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
    onDemoted: (d) => becomeClient(d),
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

async function startOnlineHost(players, net, official = false) {
  drift = null;
  loading(true, '佈置戰場');
  await nextFrame();
  // official rooms play the standard game (10 points, balanced numbers) on the island they listed
  const gs = official ? { ...settings, target: 10, numbers: 'balanced' } : settings;
  const preview = createGame({ seed: previewSeed, players, targetVP: gs.target, board: { numbers: gs.numbers } });
  buildMap(preview, players, settings.quality);
  map.onFrame = null;
  map.holdAssets(false);
  game = new Game({ app, map, settings: gs, players, seed: previewSeed, net, onExit: () => exitOnline() });
  hookGame();
  loading(false);
  game.start();
  return game;
}

// switched: this page hosted the campaign until now and plays on as a player (adopt: its old HUD)
async function startClientGame(view, players, net, { adopt = null, switched = false } = {}) {
  drift = null;
  if (!switched) {
    loading(true, '進入戰場');
    await nextFrame();
  }
  buildMap(view, players, settings.quality);
  map.onFrame = null;
  map.holdAssets(false);
  game = new Game({ app, map, settings, players, net, onExit: () => exitOnline() });
  if (adopt) game.hud.adopt(adopt);
  hookGame();
  loading(false);
  game.start({ switched });
  return game;
}

// The campaign moves to this page: the page best able to run it hosts, and when the host's page goes
// away the next one takes over from the last state it was sent. The map and the battle log stay.
function becomeHost(t, from) {
  if (from && from.retire) from.retire();
  if (matching && matching === from) matching = null;
  const old = game;
  const oldHud = old ? old.hud : null;
  const gs = { ...settings, target: t.target };
  const hs = new HostSession({
    app,
    settings: gs,
    toast,
    official: t.official,
    chat: t.chat,
    onLeave: () => {
      session = null;
      openMenu();
    },
    onDemoted: (d) => becomeClient(d),
  });
  session = hs;
  hs.takeover(t);
  if (old) {
    old.destroy();
    if (game === old) game = null;
  }
  closeMenus();
  drift = null;
  const players = t.state.players.map((p) => ({ name: p.name, color: p.color, kind: p.kind, ai: p.ai }));
  buildMap(t.state, players, settings.quality);
  map.onFrame = null;
  map.holdAssets(false);
  game = new Game({ app, map, settings: gs, players, saved: { state: t.state }, net: hs.netApi(), onExit: () => exitOnline() });
  game.hud.adopt(oldHud);
  hookGame();
  game.start({ switched: !!old, clockLeft: t.dl == null ? null : Math.max(t.dl, 15000) });
  hs.resume(game);
  game.hud.log(t.planned ? '你的電腦接手主持這場戰役：規則判定與電腦玩家改在你的頁面上運行' : `${esc(t.oldHostName || '主持人')} 斷線了，你的電腦接手主持這場戰役`, { hl: true });
  toast('你現在是主持人', '這場戰役改在你的頁面上運行，請保持這個分頁開著。', 'people');
}

// Another page runs the campaign now: this page plays on as a player. The game stays on screen,
// frozen, until the new host's first update arrives.
function becomeClient(d, from) {
  if (from && from.retire) from.retire();
  if (matching && matching === from) matching = null;
  const old = game;
  if (old) old.freeze(true, '主持人交接中…');
  clearSave();
  const cs = new ClientSession({
    app,
    settings,
    code: d.code,
    toast,
    quiet: true,
    attach: d,
    chat: d.chat,
    onGame: (view, players, net) => {
      const oldHud = old ? old.hud : null;
      if (old) {
        old.destroy();
        if (game === old) game = null;
      }
      return startClientGame(view, players, net, { adopt: oldHud, switched: !!old });
    },
    onLeave: () => {
      session = null;
      openMenu();
    },
    onTakeover: (t) => becomeHost(t),
  });
  session = cs;
  cs.open().catch((e) => {
    console.warn(e);
    toast('連線中斷', '無法繼續這場戰役。', 'cross');
    exitOnline();
  });
}

// test hook (mock rooms, or tests that switch hooks on)
if (window.__mockRoom || window.__testHooks) window.__sess = () => session;

// official rooms: automatic matchmaking (full room or countdown starts the campaign)
// The official room is joined from the home screen and the player stays there while it fills up:
// the board shows the seats and the countdown, pressing it again leaves. When the room starts, the
// campaign opens.
let matching = null;
async function toggleMatch() {
  if (matching) {
    await stopMatch();
    return;
  }
  const m = new MatchSession({
    app,
    settings,
    toast,
    seconds: window.__mmSeconds || 60,
    mapSeed: previewSeed,
    onState: (st) => matching === m && menu && menu.setMatch && menu.setMatch(st),
    onHostStart: (players, net) => {
      matching = null;
      closeMenus();
      return startOnlineHost(players, net, true);
    },
    onClientGame: (view, players, net) => {
      matching = null;
      closeMenus();
      return startClientGame(view, players, net);
    },
    onTakeover: (t, from) => becomeHost(t, from),
    onDemoted: (d, from) => becomeClient(d, from),
  });
  matching = m;
  session = m;
  // keep the page light while it waits for other players (slow devices could drop out otherwise)
  if (map) map.holdAssets(true);
  if (menu && menu.setMatch) menu.setMatch({ phase: 'searching' });
  try {
    await m.open();
    if (matching === m && menu && menu.attachLobby) menu.attachLobby(m.lobby);
  } catch (e) {
    toast('無法配對', e.message || String(e), 'cross');
    if (matching === m) {
      matching = null;
      if (session === m) session = null;
      if (menu && menu.setMatch) menu.setMatch(null);
      if (map) map.holdAssets(false);
    }
  }
}

async function stopMatch() {
  const m = matching;
  if (!m) return;
  matching = null;
  if (session === m) session = null;
  if (menu && menu.setMatch) menu.setMatch(null);
  if (map) map.holdAssets(false);
  await m.leave();
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
    onTakeover: (t) => becomeHost(t),
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
  // a host first hands the campaign to another player: that finishes in the background
  const s = session;
  session = null;
  if (s) s.leave().catch((e) => console.warn(e));
  previewSeed = randomSeed();
  openMenu();
  showPreview(false);
}

function hookGame() {
  const g = game;
  // a finished campaign goes into the signed-in player's record
  g.onGameOver = (r) => {
    if (!r) return;
    reportResult(r).then((d) => {
      if (d && d.recorded && d.user && !g.destroyed) g.hud.toast('已記入戰績', `${d.user.name}：${d.user.games} 場 · ${d.user.wins} 勝`, 'vp', 4200);
    });
  };
  game.onSettings = (s) => {
    // in-game settings never carry a game's own rules back to the menus (an official game plays to 10)
    const { target, numbers, opponents, seats, ...rest } = s;
    settings = { ...settings, ...rest };
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
