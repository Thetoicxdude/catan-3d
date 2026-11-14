// Boot: title screen over a live island preview → campaign. Handles saves and settings.
import { createGame, ensureMap } from './engine/engine.js';
import { GEO } from './engine/geometry.js';
import { randomSeed } from './engine/rng.js';
import { MapView } from './render/scene.js';
import { Game, loadSave, clearSave } from './game/game.js';
import { showMenu, defaultSettings, playersFromSettings, PALETTE, buildInfo, fitSettings, gameSetup, officialSettings, localName } from './ui/menu.js';
import { showHome } from './ui/home.js';
import { Dialogs } from './ui/dialogs.js';
import { HostSession, ClientSession, MatchSession, showOnlineEntry, rememberedRoom, forgetRoom } from './net/online.js';
import { getRoom, wrap, selfHosted } from './net/room.js';
import { icon } from './ui/icons.js';
import { esc } from './ui/text.js';
import { reportResult } from './net/account.js';
import { setSfx } from './ui/sfx.js';
import { registerMap } from './engine/maps.js';
import { checkDraft } from './engine/custom.js';
import { showEditor, loadDrafts } from './ui/editor.js';
import { mapsAvailable, publishMap, myPublished, hideMap, loadPublished, publishedCode, publishedDef, countPlay, CODE_RE } from './net/maps.js';
import { openMapBrowser, showPublished, ratingStars } from './ui/maps-ui.js';
import { currentUser, loadUser } from './net/account.js';
import { openSignIn } from './ui/account-ui.js';
import { setLang, isZh, t, tx, terr } from './i18n/index.js';

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

function readSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null; // storage unavailable
  }
}
// the page's language, from the settings (English unless Chinese was chosen): set before anything is
// written on the page, and changed only by reloading it (onSettingsChange)
function useLanguage(s) {
  setLang(s && s.lang === 'zh' ? 'zh' : 'en');
  document.documentElement.lang = isZh() ? 'zh-Hant' : 'en';
  document.title = t('卡坦島 3D 戰略版');
}
// i18n-keep: a default name of old saves, and the one that replaced it
const RENAMED = { 白楊共和國: '碧海共和國' };
function loadSettings() {
  const raw = readSettings();
  useLanguage(raw);
  const d = defaultSettings();
  try {
    const s = raw;
    // quality follows the device unless the player has picked one in the settings
    if (s && typeof s === 'object') {
      // (the default names in the language of the page, whichever one they were saved in)
      const seats = Array.isArray(s.seats) && s.seats.length >= 3 ? s.seats.map((x) => (x && x.name ? { ...x, name: localName(RENAMED[x.name] || x.name) } : x)) : d.seats;
      const color = PALETTE.some((p) => p.hex === s.color) ? s.color : d.color;
      const merged = { ...d, ...s, color, quality: s.qualityPicked ? s.quality || d.quality : d.quality, seats };
      // the interface follows the default (the map table since round 17) unless the player has picked
      // one: 'classic' was the default before and is saved with every other setting, so it says nothing
      if (!s.uiPicked && (!s.ui || s.ui === 'classic')) merged.ui = d.ui;
      // (settings saved before the house rules: their points to win become the offset)
      if (s.vpAdj === undefined) delete merged.vpAdj;
      if (typeof merged.name === 'string') merged.name = localName(merged.name);
      return fitSettings(merged);
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

// the maps drawn in the workshop on this device (playable ones): known before the settings are read,
// so a campaign set up on one of them keeps it
function myMaps() {
  const out = [];
  for (const it of loadDrafts()) {
    const c = checkDraft(it.draft);
    if (c.def) out.push(registerMap(c.def));
  }
  return out;
}
myMaps();
// published maps opened lately (kept on this device with their drafts, so the campaign menu lists
// them and a campaign set up on one keeps it after a reload)
const SEEN_KEY = 'catan3d-maps-seen-v1';
const seenMaps = new Map();
try {
  const list = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m.code !== 'string' || !CODE_RE.test(m.code) || !m.draft) continue;
    const def = registerMap(publishedDef(m));
    seenMaps.set(def.id, def);
  }
} catch {
  /* storage unavailable */
}
function rememberMap(def) {
  seenMaps.delete(def.id);
  seenMaps.set(def.id, def);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seenMaps.values()].slice(-8).map((d) => ({ code: d.code, author: d.author, draft: d.draft }))));
  } catch {
    /* storage unavailable */
  }
}
function menuMaps() {
  const out = myMaps();
  for (const d of [...seenMaps.values()].reverse()) if (!out.some((x) => x.id === d.id)) out.push(d);
  return out;
}

let settings = loadSettings();
setSfx(settings.sound !== false);
let map = null;
applyLook(settings);
let mapKey = '';
let game = null;
let menu = null;
let previewSeed = randomSeed();
let drift = null;
// (the map view is told: a view cruising by itself is scenery, drawn at the idle rate)
function setDrift(fn) {
  drift = fn;
  if (map) map.cruise = !!fn;
}
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

function loading(on, text = t('測繪島嶼地形')) {
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
  ensureMap(state);
  const key = `${state.map || ''}:${state.mapSeed != null ? state.mapSeed : state.seed}:${state.board.method}:${state.board.hexes.map((h) => h.terrain[0] + h.number).join('')}:${quality}`;
  if (map && mapKey === key) {
    map.setPlayers(state, players);
    return map;
  }
  if (map) map.dispose();
  map = new MapView(mapEl, quality);
  map.build(state, players, quality);
  map.setOptions({ fps: settings.fps, stats: settings.perfInfo });
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
  const st = createGame({ seed: previewSeed, players, ...gameSetup(settings) });
  try {
    buildMap(st, players, settings.quality);
  } catch (e) {
    loading(false);
    showFatal(e);
    return;
  }
  loading(false);
  map.setMapMode('terrain');
  const mc = GEO.center;
  const mk = GEO.scale;
  map.camera.goal.set(mc.x, 0, mc.z + 6);
  map.camera.goalH = 100 * mk;
  let t = 0;
  // title screen: a slow orbit around the island at a low, cinematic angle
  setDrift((dt) => {
    t += dt;
    map.camera.goal.set(mc.x + Math.sin(t * 0.05) * 12 * mk, 0, mc.z + 6 + Math.cos(t * 0.04) * 8 * mk);
    map.camera.goalH = (100 + Math.sin(t * 0.07) * 12) * mk;
    map.camera.goalYaw = t * 0.045;
    map.camera.goalPitch = 56;
  });
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

function onSettingsChange(s, key) {
  settings = s;
  saveSettings(s);
  if (key === 'lang') return relaunch();
  applyLook(s);
}

// A new language: the page starts again in it (every word on it, the default names, the map's labels),
// back where it was: the campaign on this device saved and resumed, an online room joined again.
const RESUME_KEY = 'catan3d-resume';
function relaunch() {
  try {
    if (game && !game.destroyed && !session) {
      if (game.save) game.save();
      sessionStorage.setItem(RESUME_KEY, '1');
    }
  } catch {
    /* storage unavailable: the main menu instead */
  }
  location.reload();
}

// the interface's look: the map table (theme3.css), the clean one (theme2.css) or the classic bronze; and
// how the map is drawn
// (the frame rate, the performance read-out)
function applyLook(s) {
  document.documentElement.classList.toggle('ui2', !!s && s.ui === 'clean');
  document.documentElement.classList.toggle('ui3', !!s && s.ui === 'atlas');
  if (map && s) map.setOptions({ fps: s.fps, stats: s.perfInfo });
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
    onEditor: () => stopMatch().then(openEditor),
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
        if (key === 'lang') return relaunch();
        setSfx(settings.sound !== false);
        applyLook(settings);
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
    onEditor: () => openEditor(),
    onBrowse: mapsAvailable() ? () => browseMaps() : null,
    customMaps: menuMaps(),
  });
}

// the maps players published: choosing one sets the campaign up on it
function browseMaps() {
  openMapBrowser(menuDialogs(), { toast, onPick: (def) => useMapForCampaign(def) });
}
function useMapForCampaign(def) {
  rememberMap(def);
  settings.map = def.id;
  settings.opponents = def.players[1] - 1;
  fitSettings(settings);
  saveSettings(settings);
  openSetup();
  showPreview(true);
}

// publishing from the workshop: signed in first, then the map's code to share
async function publishFlow(draft) {
  await loadUser();
  if (!currentUser()) {
    openSignIn(menuDialogs(), () => publishFlow(draft));
    return;
  }
  try {
    const r = await publishMap(draft);
    const def = await loadPublished(r.code);
    rememberMap(def);
    showPublished(menuDialogs(), r.code, r.again, toast);
  } catch (e) {
    toast(t('無法發布'), terr(e), 'cross');
  }
}

// the map workshop: drawing an island, seeing it on the 3D map, playing it
function openEditor() {
  closeMenus();
  if (map) map.holdAssets(false);
  menu = showEditor(app, {
    dialogs: menuDialogs(),
    toast,
    onBack: () => {
      menu = null;
      openMenu();
      showPreview(false);
    },
    onPlay: (def) => {
      registerMap(def);
      settings.map = def.id;
      settings.opponents = def.players[1] - 1;
      fitSettings(settings);
      saveSettings(settings);
      openSetup();
      showPreview(true);
    },
    onPreview: (def, area) => editorPreview(def, area),
    ...(mapsAvailable()
      ? {
          onPublish: (draft) => publishFlow(draft),
          published: async () => {
            await loadUser();
            if (!currentUser()) return null;
            return (await myPublished()).maps || [];
          },
          unpublish: async (code) => {
            try {
              await hideMap(code);
              toast(t('已從列表移除'), t('地圖 {code} 不再出現在公開列表（代號還能用）', { code }), 'check');
              return true;
            } catch (e) {
              toast(t('無法移除'), terr(e), 'cross');
              return false;
            }
          },
        }
      : {}),
  });
}

// the island being drawn, on the 3D map, framed in the part of the screen the workshop leaves free
async function editorPreview(def, area) {
  registerMap(def);
  loading(true);
  await nextFrame();
  try {
    const players = playersFromSettings({ ...settings, opponents: def.players[1] - 1 });
    const st = createGame({ seed: randomSeed(), players, map: def.id });
    buildMap(st, players, settings.quality);
  } catch (e) {
    loading(false);
    toast(t('無法預覽'), terr(e), 'cross');
    return;
  }
  loading(false);
  setDrift(null);
  map.onFrame = null;
  map.setMapMode('terrain');
  map.frameLand(area, map.camera.fitIsland(1.12));
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
    dialogs: menuDialogs,
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
    toast(t('無法建立房間'), terr(e), 'cross');
    session = null;
    if (save) startGame(save);
    else openMenu();
    return;
  }
  if (save) {
    // reopen the same room and resume; returning players reclaim their seats automatically
    setDrift(null);
    loading(true, t('重新開放房間'));
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
  setDrift(null);
  loading(true, t('佈置戰場'));
  await nextFrame();
  // official rooms play the standard game (10 points, balanced numbers) on the island they listed
  const gs = official ? officialSettings(settings) : settings;
  const preview = createGame({ seed: previewSeed, players, ...gameSetup(gs) });
  if (!official) countPlay(preview.map);
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
  setDrift(null);
  if (!switched) {
    loading(true, t('進入戰場'));
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
function becomeHost(info, from) {
  if (from && from.retire) from.retire();
  if (matching && matching === from) matching = null;
  const old = game;
  const oldHud = old ? old.hud : null;
  const gs = { ...settings, target: info.target };
  const hs = new HostSession({
    app,
    settings: gs,
    toast,
    official: info.official,
    chat: info.chat,
    onLeave: () => {
      session = null;
      openMenu();
    },
    onDemoted: (d) => becomeClient(d),
  });
  session = hs;
  hs.takeover(info);
  if (old) {
    old.destroy();
    if (game === old) game = null;
  }
  closeMenus();
  setDrift(null);
  const players = info.state.players.map((p) => ({ name: p.name, color: p.color, kind: p.kind, ai: p.ai }));
  buildMap(info.state, players, settings.quality);
  map.onFrame = null;
  map.holdAssets(false);
  game = new Game({ app, map, settings: gs, players, saved: { state: info.state }, net: hs.netApi(), onExit: () => exitOnline() });
  game.hud.adopt(oldHud);
  hookGame();
  game.start({ switched: !!old, clockLeft: info.dl == null ? null : Math.max(info.dl, 15000) });
  hs.resume(game);
  game.hud.log(info.planned ? t('你的電腦接手主持這場戰役：規則判定與電腦玩家改在你的頁面上運行') : t('{name} 斷線了，你的電腦接手主持這場戰役', { name: esc(localName(info.oldHostName || t('主持人'))) }), { hl: true });
  toast(t('你現在是主持人'), t('這場戰役改在你的頁面上運行，請保持這個分頁開著。'), 'people');
}

// Another page runs the campaign now: this page plays on as a player. The game stays on screen,
// frozen, until the new host's first update arrives.
function becomeClient(d, from) {
  if (from && from.retire) from.retire();
  if (matching && matching === from) matching = null;
  const old = game;
  if (old) old.freeze(true, t('主持人交接中…'));
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
    toast(t('連線中斷'), t('無法繼續這場戰役。'), 'cross');
    exitOnline();
  });
}

// test hooks (mock rooms, or tests that switch hooks on): the room session, the 3D map, the screen open
if (window.__mockRoom || window.__testHooks) {
  window.__sess = () => session;
  window.__mapView = () => map;
  window.__screen = () => menu;
}

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
    toast(t('無法配對'), terr(e), 'cross');
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
    toast(t('無法加入房間'), terr(e), 'cross');
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
      if (d && d.recorded && d.user && !g.destroyed) g.hud.toast(t('已記入戰績'), t('{name}：{games} 場 · {wins} 勝', { name: tx(d.user.name), games: d.user.games, wins: d.user.wins }), 'vp', 4200);
    });
  };
  // (a map players published) rating it when the campaign is over
  g.overExtra = () => {
    const code = publishedCode(g.state && g.state.map);
    return code && mapsAvailable() ? ratingStars(code, toast) : null;
  };
  game.onSettings = (s, key) => {
    // in-game settings never carry a game's own rules back to the menus (an official game plays to 10)
    const { target, numbers, opponents, seats, vpAdj, discard, dice, mix, ...rest } = s;
    settings = { ...settings, ...rest };
    saveSettings(settings);
    if (key === 'lang') return relaunch();
    applyLook(settings);
  };
  window.__game = game;
}

async function startGame(saved) {
  setDrift(null);
  if (menu) {
    menu.close();
    menu = null;
  }
  loading(true, saved ? t('載入戰役') : t('佈置戰場'));
  await nextFrame();
  let players;
  let state;
  if (saved) {
    state = saved.state;
    // (a campaign on a map drawn in the workshop carries the map: known again whatever became of the draft)
    if (state.mapDef) registerMap(state.mapDef);
    // (a default name in the language of the page, whichever one it was saved in)
    players = state.players.map((p) => ({ name: localName(p.name), color: p.color, kind: p.kind, ai: p.ai }));
    settings = { ...settings, ...(saved.settings || {}), quality: settings.quality };
  } else {
    players = playersFromSettings(settings);
    state = createGame({ seed: previewSeed, players, ...gameSetup(settings) });
    countPlay(state.map);
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
  el.innerHTML = `<div style="letter-spacing:0.1em;max-width:32em;text-align:center;line-height:1.7">${t('無法啟動 3D 地圖。')}<br><span style="font-family:var(--font-body);font-size:13px;color:var(--ink-faint)">${t('這個裝置或瀏覽器可能不支援 WebGL 2，或已停用硬體加速。請改用最新版 Chrome、Edge、Safari 或 Firefox。')}<br>(${esc(String(e && e.message ? e.message : e))})</span></div>`;
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

// a map link (#map=CODE) opens the campaign menu on that published map
function mapLinkCode() {
  const m = /(?:^#|[#&])map=([A-Za-z0-9]{6})\b/.exec(location.hash || '');
  if (!m || !CODE_RE.test(m[1].toUpperCase())) return null;
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* sandboxed */
  }
  return m[1].toUpperCase();
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
  // the page was reloaded in a new language in the middle of a campaign on this device: back to it
  let resume = false;
  try {
    resume = sessionStorage.getItem(RESUME_KEY) === '1';
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    /* storage unavailable */
  }
  const kept = resume ? loadSave() : null;
  if (kept && !kept.net && kept.state && kept.state.phase !== 'over') {
    startGame(kept);
    return;
  }
  const linked = mapsAvailable() ? mapLinkCode() : null;
  if (linked) {
    loadPublished(linked).then(
      (def) => useMapForCampaign(def),
      (e) => {
        toast(t('打不開這張地圖'), terr(e), 'cross');
        openMenu();
        showPreview(false);
      },
    );
    return;
  }
  openMenu();
  showPreview(false);
}

if (hot && hot.ready) hot.ready(boot);
else boot(hot && hot.data ? hot.data : {});

export { clearSave };
