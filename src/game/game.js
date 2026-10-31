// Local game controller: owns the authoritative engine state, runs computer players with
// human-like pacing, and wires the 3D map + HUD + dialogs together. Hot-seat aware.
import {
  createGame,
  applyAction,
  makeView,
  actorsNow,
  RuleError,
  redactEvent,
  legalRoadEdges,
  legalSettlementSpots,
  legalCitySpots,
  playableDev,
  totalVP,
  publicVP,
  RES,
  COSTS,
} from '../engine/engine.js';
import { GEO } from '../engine/geometry.js';
import { aiAct } from '../ai/ai.js';
import { makeRng } from '../engine/rng.js';
import { Hud } from '../ui/hud.js';
import { Dialogs } from '../ui/dialogs.js';
import { describe, hexTooltip, esc, DEV_INFO } from '../ui/text.js';
import { sfx, setSfx } from '../ui/sfx.js';
import { TERRAIN_RES } from '../engine/board.js';
import { turnKey, turnLimit, timeoutAction } from './clock.js';

const SAVE_KEY = 'catan3d-save-v1';
const SPEED = { slow: 1.7, normal: 1, fast: 0.45, turbo: 0.12 };
const DELAY = {
  roll: 750,
  settlement: 850,
  road: 700,
  city: 850,
  buyDev: 700,
  playDev: 950,
  robber: 1050,
  steal: 650,
  discard: 550,
  respond: 520,
  offer: 950,
  acceptOffer: 750,
  cancelOffer: 600,
  bankTrade: 650,
  endTurn: 600,
  endRoadBuilding: 300,
};
const MAP_MODES = ['terrain', 'political', 'production', 'resource'];
const DISCARD_MS = 30000; // after a 7, everyone who must discard gets at least this long

export function loadSave() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    const d = JSON.parse(s);
    if (!d || !d.state || d.state.v !== 1 || d.state.phase === 'over') return null;
    return d;
  } catch {
    return null;
  }
}
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class Game {
  constructor({ app, map, settings, players, seed, saved, onExit, net = null }) {
    this.app = app;
    this.map = map;
    this.settings = settings;
    this.onExit = onExit;
    this.net = net;
    this.client = !!(net && net.role === 'client');
    if (this.client) {
      this.state = net.view;
      this.mem = [];
    } else if (saved) {
      this.state = saved.state;
      this.mem = saved.mem || this.state.players.map(() => ({}));
      if (!net) {
        // an online campaign resumed offline: absent players become computer players
        for (const p of this.state.players) {
          if (p.kind === 'remote') {
            p.kind = 'ai';
            p.ai = { level: 'normal' };
          }
        }
      }
    } else {
      this.state = createGame({ seed, players, targetVP: settings.target || 10, board: { numbers: settings.numbers }, entropy: net && net.entropy ? net.entropy : undefined });
      this.mem = players.map(() => ({}));
    }
    this.players = this.state.players.map((p) => ({ name: p.name, color: p.color, kind: p.kind, ai: p.ai }));
    this.rnd = makeRng((this.state.seed ^ 0x5bd1e995) >>> 0);
    this.humans = this.client ? [net.seat] : this.players.map((p, i) => (p.kind === 'human' ? i : -1)).filter((i) => i >= 0);
    this.viewer = this.humans.length ? this.humans[0] : -1;
    this.mode = null;
    this.timer = null;
    this.thinking = null;
    this.mapMode = 'terrain';
    this.overShown = false;
    this.passTo = null;
    this.lastMini = 0;
    this.destroyed = false;

    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'hud';
    app.appendChild(this.hudRoot);
    this.hud = new Hud(this.hudRoot, {
      button: (k) => this.onButton(k),
      mapMode: (m) => this.setMapMode(m),
      focus: (x, z) => this.map.focus(x, z),
      ui: (k) => this.onUi(k),
      cam: (op, v) => this.camOp(op, v),
    });
    this.layer = document.createElement('div');
    this.layer.className = 'modal-layer';
    this.hudRoot.appendChild(this.layer);
    this.dialogs = new Dialogs(this.layer);
    // online games: a clock for every step, and the room's chat next to the battle log
    this.deadline = 0;
    this.clockKey = null;
    this.frozen = false;
    if (net && net.chat) {
      this.hud.enableChat((text) => net.chat.post(text));
      this.chatSink = (m) => !this.destroyed && this.hud.addChat(m);
      net.chat.attach(this.chatSink);
    }

    this.map.onHexHover = (hex, x, y) => {
      if (hex == null) this.hud.showTip(null);
      else this.hud.showTip(hexTooltip(this.view(), hex, this.players), x, y);
    };
    this.map.canvas.addEventListener('pointerleave', () => this.hud.showTip(null));
    this.map.onFrame = (dt, moved) => {
      const now = performance.now();
      if ((moved && now - this.lastMini > 90) || now - this.lastMini > 1500) {
        this.lastMini = now;
        this.hud.drawMinimap(this.lastView || this.view(), this.players, this.map.viewportGround());
      }
    };
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
  }

  // ── lifecycle ──
  // switched: the same campaign carries on on this page in another role (the host changed): the
  // camera stays and nothing is announced again. clockLeft: what was left of the turn clock.
  start({ switched = false, clockLeft = null } = {}) {
    this.map.sync(this.view(), [], false);
    if (!switched) {
      this.map.camera.resetView();
      if (this.state.phase === 'setup') this.map.focus(0, 5, this.map.camera.fitIsland(1.12));
      this.hud.log(`戰役開始：${this.players.map((p, i) => `<span class="who" style="color:${p.color}">${i === this.viewer ? '你' : esc(p.name)}</span>`).join('、')}`, { hl: true });
      if (this.state.phase === 'setup') this.hud.log('開局：依序放置村莊與道路（第二輪順序相反）。', {});
    }
    // hot seat: when another player at this device moves first, hand the device over before anything else
    this.pickViewer();
    if (this.net) {
      this.updateClock();
      if (!this.client && clockLeft != null) this.deadline = Date.now() + clockLeft;
      this.clockTimer = setInterval(() => this.clockFrame(), 500);
    }
    this.refresh();
    this.schedule();
    if (!switched) this.focusHome();
    if (this.net && this.net.role === 'host') this.net.onChange(this.state, []);
  }

  focusHome() {
    if (this.viewer < 0) return;
    const mine = [];
    this.state.vertices.forEach((b, v) => b && b.p === this.viewer && mine.push(v));
    if (mine.length) {
      const g = GEO.vertices[mine[0]];
      this.map.focus(g.x, g.z, 80);
    }
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    clearInterval(this.clockTimer);
    if (this.net && this.net.chat && this.chatSink) this.net.chat.detach(this.chatSink);
    window.removeEventListener('keydown', this.keyHandler);
    this.dialogs.close(true);
    this.map.setInteraction(null);
    this.map.onHexHover = null;
    this.map.onFrame = null;
    this.hudRoot.remove();
  }

  view() {
    return this.client ? this.state : makeView(this.state, this.viewer);
  }

  ctx(extra = {}) {
    const busy = this.client && this.net.busy && this.net.busy();
    const view = this.view();
    this.lastView = view; // the minimap redraws from this while the camera moves
    let thinking = this.thinking;
    if (this.client && view.phase !== 'over') {
      const others = actorsNow(view).filter((p) => p !== this.viewer);
      thinking = others.length ? others[0] : null;
    }
    return { view, me: this.viewer, players: this.players, mode: this.mode, thinking, locked: !!this.passTo || busy || this.viewer < 0, online: this.net, ...extra };
  }

  serialize() {
    if (this.client) return null;
    return { state: this.state, mem: this.mem, settings: this.settings, net: this.net && this.net.serialize ? this.net.serialize() : null };
  }

  // host: apply a remote player's move; returns an error message or null
  dispatchFrom(action) {
    if (this.destroyed) return '遊戲已結束';
    if (this.frozen) return '主持人交接中，請稍候再試';
    let events;
    try {
      events = applyAction(this.state, action);
    } catch (e) {
      if (e instanceof RuleError) return e.message;
      throw e;
    }
    this.afterEvents(action, events);
    return null;
  }

  // host: a remote seat went away (computer takes over) or came back
  setSeatAway(i, away) {
    const sp = this.state.players[i];
    if (away) {
      sp.kind = 'ai';
      sp.ai = { level: 'normal' };
    } else {
      sp.kind = 'remote';
      sp.ai = null;
    }
    this.players[i] = { ...this.players[i], kind: sp.kind, ai: sp.ai, away };
    this.hud.log(`${esc(this.players[i].name)} ${away ? '離線，改由電腦代管' : '重新連線，接回自己的國家'}`, { hl: true });
    this.refresh();
    this.schedule();
    if (this.net && this.net.role === 'host') this.net.onChange(this.state, []);
  }

  setNetStatus(text) {
    if (this.netStatus === text) return;
    this.netStatus = text;
    this.refresh();
  }

  // host: hold everything while the campaign moves to another page (on: nothing moves here)
  freeze(on, note = '主持人交接中…') {
    this.frozen = !!on;
    if (on) {
      clearTimeout(this.timer);
      this.timer = null;
      this.dialogs.close(true);
    }
    this.setNetStatus(on ? note : null);
    if (!on) this.schedule();
  }

  // ── the turn clock (online games) ──
  // Each opening placement gets 2 minutes and each turn 3 (see clock.js). The host keeps the clock and
  // moves for a player whose time has run out; the other pages show the time they are sent.
  updateClock() {
    if (!this.net || this.client) return;
    const st = this.state;
    const key = turnKey(st);
    if (!key) {
      this.deadline = 0;
      this.clockKey = null;
      return;
    }
    if (key !== this.clockKey) {
      this.clockKey = key;
      this.deadline = Date.now() + turnLimit(st);
    }
    if (st.pending && st.pending.type === 'discard' && this.discardKey !== key) {
      this.discardKey = key;
      this.deadline = Math.max(this.deadline, Date.now() + DISCARD_MS);
    }
  }

  clockLeft() {
    return this.deadline && this.state.phase !== 'over' ? Math.max(0, this.deadline - Date.now()) : null;
  }

  // client: the time left as the host last published it (pn: that update's number, so the same
  // update heard again doesn't restart the clock)
  setRemoteClock(dl, pn) {
    if (pn != null && pn === this.clockPn) return;
    this.clockPn = pn;
    this.deadline = typeof dl === 'number' ? Date.now() + dl : 0;
  }

  clockFrame() {
    if (this.destroyed) return;
    if (!this.client && !this.frozen) this.clockTick();
    this.hud.paintClock();
    const v = this.view();
    if (!this.deadline || Date.now() < this.deadline || v.phase === 'over') return;
    const key = turnKey(v) + (v.pending ? ':' + v.pending.type : '');
    if (this.toldOut === key) return;
    this.toldOut = key;
    const who = actorsNow(v).filter((p) => this.players[p] && this.players[p].kind !== 'ai');
    if (who.includes(this.viewer)) this.hud.toast('時間到了', '系統會替你完成這一步：擲骰、結束回合，或由電腦代為選擇。', 'hourglass', 4200);
    if (this.client && who.length) this.hud.log(`${who.map((p) => (p === this.viewer ? '你' : esc(this.players[p].name))).join('、')}的時間到了，由系統代為完成`, {});
  }

  // host: someone's time is up — make the smallest move that gets the game going again (one a tick)
  clockTick() {
    if (!this.deadline || this.destroyed) return;
    const st = this.state;
    if (st.phase === 'over' || Date.now() < this.deadline) return;
    if (performance.now() < (this.fxHold || 0)) return; // the dice are still rolling
    for (const p of actorsNow(st)) {
      if (!this.players[p] || this.players[p].kind === 'ai') continue;
      const a = timeoutAction(st, p, this.mem[p], this.rnd);
      if (!a) continue;
      const k = this.clockKey + ':' + p;
      if (this.timedOut !== k) {
        this.timedOut = k;
        this.hud.log(`${p === this.viewer ? '你' : esc(this.players[p].name)}的時間到了，由系統代為完成`, { hl: true });
      }
      if (!this.dispatch(a, { quiet: true })) this.aiFallback(p);
      return;
    }
  }

  save() {
    if (this.client) return;
    try {
      if (this.state.phase === 'over') localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize()));
    } catch {
      /* storage unavailable: playing without autosave */
    }
  }

  // ── actions ──
  dispatch(action, { quiet = false } = {}) {
    if (this.destroyed) return false;
    if (this.frozen) {
      if (!quiet) this.hud.toast('請稍候', '主持人正在交接，馬上就好。', 'wait', 2200);
      return false;
    }
    if (this.client) {
      const ok = this.net.send(action);
      if (ok) {
        this.map.setInteraction(null);
        this.ikey = '';
        this.mode = null;
        this.hud.renderActions(this.ctx());
      }
      return ok;
    }
    let events;
    try {
      events = applyAction(this.state, action);
    } catch (e) {
      if (e instanceof RuleError) {
        if (!quiet) this.hud.toast('無法執行', e.message, 'cross', 2600);
        return false;
      }
      throw e;
    }
    this.afterEvents(action, events);
    return true;
  }

  // client side: a new authoritative view arrived from the host
  applyRemote(view, events, players) {
    if (this.destroyed) return;
    this.state = view;
    if (players) this.players = players;
    this.present(null, events);
  }

  afterEvents(action, events) {
    this.updateClock();
    this.pickViewer();
    this.present(action, events.map((e) => redactEvent(e, this.viewer)));
    if (this.net && this.net.role === 'host') this.net.onChange(this.state, events);
  }

  present(action, red) {
    const view = this.view();
    this.map.sync(view, red, true);
    // the camera stays where the player put it: nothing here moves it
    for (const e of red) {
      const d = describe(e, this.players, this.viewer, view);
      if (d.log) this.hud.log(d.log, { hl: d.hl, sep: d.sep });
      if (d.toast) this.hud.toast(d.toast.title, d.toast.text, d.toast.icon);
    }
    this.presentFx(red, view);
    if (this.mode && !this.modeValid()) this.mode = null;
    this.save();
    this.refresh();
    this.schedule();
  }

  // dice, flying resource cards, medals, sounds. Resource counts that arrive as cards are held
  // back in the HUD and tick up as each card lands.
  presentFx(events, view) {
    if (this.destroyed || !this.hud.fx) return;
    const me = this.viewer;
    const fx = this.hud.fx;
    const speed = SPEED[this.settings.speed] || 1;
    const fast = speed < 0.5;
    const name = (p) => (this.players[p] ? this.players[p].name : '');
    let land = 0;
    for (const e of events) {
      if (e.type === 'roll') {
        // big dice in the middle of the screen; the turn goes on only after the sum has been shown
        land = fx.roll(e.dice, { big: e.p === me || !fast, fast });
        this.diceUntil = performance.now() + land;
        this.fxHold = performance.now() + land + (fast ? 250 : 700);
        if (e.sum === 7) setTimeout(() => sfx.robber(), fx.rollLand || land);
      } else if (e.type === 'produce') {
        const flights = this.planCards(e.paid.flatMap((c) => Array(c.amt).fill({ res: c.res, p: c.p, hex: c.hex, vertex: c.vertex })), me);
        const go = () => {
          if (this.destroyed) return;
          this.map.showProduction(e);
          this.pulseTokens(e.sum);
          fx.cards(flights());
        };
        if (land) setTimeout(go, land);
        else go();
      } else if (e.type === 'startingResources') {
        const g = GEO.vertices[e.vertex];
        const src = (res) => g.hexes.find((h) => TERRAIN_RES[view.board.hexes[h].terrain] === res);
        const list = Object.entries(e.gains || {}).flatMap(([res, n]) => Array(n).fill({ res, p: e.p, hex: src(res), vertex: e.vertex }));
        const flights = this.planCards(list, me);
        setTimeout(() => !this.destroyed && fx.cards(flights()), 350);
      } else if (e.type === 'build') {
        sfx.build(e.what);
        if (e.what !== 'road') setTimeout(() => fx.medal(this.hud.vpTarget(e.p, me), '+1'), 260);
        // what it cost goes back to the bank (opening pieces and Road Building roads are free)
        if (!e.setup && !e.free) this.payBank(e.p, COSTS[e.what], me);
      } else if (e.type === 'discard') {
        this.payBank(e.p, e.cards, me);
      } else if (e.type === 'bankTrade') {
        this.payBank(e.p, { [e.give]: e.ratio }, me);
        const get = this.planCards([{ res: e.get, p: e.p, from: this.hud.bankPoint(e.get) }], me);
        setTimeout(() => !this.destroyed && fx.cards(get()), 320 + 90 * e.ratio);
      } else if (e.type === 'trade') {
        // both sides of an accepted offer cross over
        const list = [];
        for (const [res, n] of Object.entries(e.give || {})) for (let i = 0; i < n; i++) list.push({ res, p: e.to, from: this.cardPoint(e.from, res, me) });
        for (const [res, n] of Object.entries(e.get || {})) for (let i = 0; i < n; i++) list.push({ res, p: e.from, from: this.cardPoint(e.to, res, me) });
        if (list.length) fx.cards(this.planCards(list, me)());
      } else if (e.type === 'longestRoad' || e.type === 'largestArmy') {
        if (e.to < 0) continue;
        const road = e.type === 'longestRoad';
        fx.announce(road ? '最長道路' : '最大騎士團', `${e.to === me ? '你' : name(e.to)} ${road ? `以 ${e.length} 段道路` : `以 ${e.size} 位騎士`}取得，+2 分`, road ? 'road' : 'knight');
        sfx.fanfare(true);
        setTimeout(() => fx.medal(this.hud.vpTarget(e.to, me), '+2', true), 300);
      } else if (e.type === 'robber') {
        if (e.p !== me) this.hud.toast('強盜移動', `${name(e.p)} 把強盜移到 ${view.board.hexes[e.to].name}，那裡暫停產出`, 'robber');
        if (e.reason !== 'seven') sfx.robber();
      } else if (e.type === 'steal') {
        if (e.p !== me && e.from !== me) continue;
        sfx.steal();
        const r = e.res || null;
        if (r && e.p === me) {
          const flights = this.planCards([{ res: r, p: me, from: this.hud.nationPoint(e.from) }], me);
          fx.cards(flights());
        } else if (r && e.from === me) {
          const from = this.hud.chipCenter(r);
          fx.cards([{ res: r, from, to: this.hud.nationPoint(e.p), delay: 0, small: true }]);
          fx.plus(from.x, from.y + 26, '−1', 'loss');
        }
      } else if (e.type === 'playDev' && e.card === 'yearOfPlenty' && e.res) {
        fx.cards(this.planCards(e.res.map((res) => ({ res, p: e.p, from: this.hud.bankPoint(res) })), me)());
      } else if (e.type === 'playDev' && e.card === 'monopoly' && e.taken) {
        const list = [];
        for (const [q, n] of Object.entries(e.taken)) for (let i = 0; i < n; i++) list.push({ res: e.res, p: e.p, from: this.hud.nationPoint(+q) });
        fx.cards(this.planCards(list, me)());
      } else if (e.type === 'buyDev') {
        this.payBank(e.p, COSTS.dev, me);
        if (e.p !== me || !e.card || !DEV_INFO[e.card]) continue;
        const info = DEV_INFO[e.card];
        const note = e.card === 'victoryPoint' ? '已秘密計入你的分數' : '下回合起可以使用（可在擲骰前打出）';
        fx.devReveal({ type: e.card, name: info.name, desc: info.desc, note }, this.hud.top.querySelector('.stat.devs'));
      } else if (e.type === 'turnStart' && e.p === me) sfx.turn();
      else if (e.type === 'gameOver') sfx.fanfare(true);
    }
  }

  // where a player's card of `res` leaves from: the viewer's own card in the hand, else the nation's row
  cardPoint(p, res, me) {
    return p === me ? this.hud.chipCenter(res) : this.hud.nationPoint(p);
  }

  // cards spent on a build, a development card, a discard or a bank trade fly back into the bank
  payBank(p, cost, me) {
    if (!cost || this.destroyed) return;
    const list = [];
    let k = 0;
    for (const [res, n] of Object.entries(cost)) {
      for (let i = 0; i < n; i++) {
        const from = this.cardPoint(p, res, me);
        this.hud.holdBank(res, 1);
        list.push({
          res,
          from: { x: from.x + (Math.random() - 0.5) * 12, y: from.y + (Math.random() - 0.5) * 8 },
          to: this.hud.bankPoint(res),
          delay: k * 95,
          small: p !== me,
          end: p === me ? 0.52 : 1,
          onArrive: () => this.hud.landBank(res),
        });
        k++;
      }
    }
    if (list.length) this.hud.fx.cards(list);
  }

  // Reserve the viewer's incoming cards now (so the counters don't jump ahead) and return a
  // function that builds the flight list when the animation actually starts.
  planCards(items, me) {
    const mine = items.filter((c) => c.p === me);
    for (const c of mine) this.hud.holdRes(c.res, 1);
    const order = [...mine, ...items.filter((c) => c.p !== me)];
    return () => {
      const list = [];
      let step = 0;
      order.forEach((c, k) => {
        const own = c.p === me;
        // cards leave the building that earned them (it hops as each one goes), else the province
        let from = c.from || (c.vertex != null ? this.map.vertexScreen(c.vertex) : null) || (c.hex != null ? this.map.hexScreen(c.hex) : null);
        if (!from) from = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        from = { x: from.x + (Math.random() - 0.5) * 18, y: from.y + (Math.random() - 0.5) * 10 };
        if (!c.from && c.vertex != null && this.map.bumpBuilding) this.map.bumpBuilding(c.vertex, k * 115);
        const st = step;
        if (own) step++;
        list.push({
          res: c.res,
          from,
          to: own ? this.hud.chipCenter(c.res) : this.hud.nationPoint(c.p),
          delay: k * 115,
          small: !own,
          onArrive: own ? () => this.hud.landRes(c.res, st) : null,
        });
      });
      return list;
    };
  }

  pulseTokens(sum) {
    for (const t of this.map.tokenLabels || []) {
      if (this.state.board.hexes[t.hex].number !== sum) continue;
      const el = t.it.el;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    }
  }

  pickViewer() {
    if (this.client || this.humans.length <= 1) return;
    const actors = actorsNow(this.state);
    const humansActing = actors.filter((p) => this.players[p].kind === 'human');
    if (!humansActing.length) return;
    if (humansActing.includes(this.viewer)) return;
    const next = humansActing.includes(this.state.current) ? this.state.current : humansActing[0];
    if (next !== this.viewer) this.requestPass(next);
  }

  requestPass(p) {
    if (this.passTo === p) return;
    this.passTo = p;
    this.dialogs.close(true);
    this.map.setInteraction(null);
    if (this.passEl) this.passEl.remove();
    const P = this.players[p];
    const el = document.createElement('div');
    el.className = 'pass-screen';
    el.innerHTML = `<div class="panel"><h2>輪到 ${esc(P.name)}</h2><p style="margin:0;color:var(--ink-dim)">請把裝置交給這位玩家。其他人的手牌會保持隱藏。</p><button class="btn primary" type="button">我是 ${esc(P.name)}，繼續</button></div>`;
    el.querySelector('button').addEventListener('click', () => {
      this.viewer = p;
      this.passTo = null;
      el.remove();
      this.passEl = null;
      this.hud.prevRes = null;
      for (const r of RES) this.hud.pending[r] = 0;
      this.refresh();
      this.focusHome();
    });
    this.hudRoot.appendChild(el);
    this.passEl = el;
  }

  modeValid() {
    const v = this.view();
    const me = this.viewer;
    if (v.phase !== 'play' || v.current !== me || v.pending || v.trade || !v.rolled) return false;
    if (this.mode === 'road') return legalRoadEdges(v, me).length > 0 && v.players[me].res.wood > 0 && v.players[me].res.brick > 0 && v.players[me].pieces.roads > 0;
    if (this.mode === 'settlement') return legalSettlementSpots(v, me).length > 0;
    if (this.mode === 'city') return legalCitySpots(v, me).length > 0;
    return false;
  }

  setMode(m) {
    if (this.mode === m) this.mode = null;
    else {
      this.mode = m;
      if (!this.modeValid()) this.mode = null;
    }
    this.refresh();
  }

  onButton(k) {
    const me = this.viewer;
    if (me < 0 || this.passTo != null) return;
    const v = this.view();
    switch (k) {
      case 'roll':
        this.mode = null;
        this.dispatch({ type: 'roll', p: me });
        break;
      case 'road':
      case 'settlement':
      case 'city':
        this.setMode(k);
        break;
      case 'dev':
        this.mode = null;
        this.dispatch({ type: 'buyDev', p: me });
        break;
      case 'trade':
        this.mode = null;
        this.dialogs.trade(this.ctx(), (a) => this.dispatch(a));
        this.refresh();
        break;
      case 'cards':
        this.dialogs.devCards(this.ctx(), (card) => this.playDev(card));
        break;
      case 'end':
        this.mode = null;
        if (v.trade && v.trade.from === me) this.dispatch({ type: 'cancelOffer', p: me }, { quiet: true });
        this.dispatch({ type: 'endTurn', p: me });
        break;
    }
  }

  playDev(card) {
    const me = this.viewer;
    const v = this.view();
    if (card === 'yearOfPlenty') {
      const bankTotal = RES.reduce((s, r) => s + v.bank[r], 0);
      const n = Math.min(2, bankTotal);
      this.dialogs.pickResources(this.ctx(), n, '豐收之年', `從銀行選擇 ${n} 張資源（可以相同）。`, (res) => {
        this.dialogs.close(true);
        this.dispatch({ type: 'playDev', p: me, card, res });
      });
      return;
    }
    if (card === 'monopoly') {
      this.dialogs.pickResources(this.ctx(), 1, '壟斷', '選擇一種資源，其他國家必須交出手上所有的這種資源。', (res) => {
        this.dialogs.close(true);
        this.dispatch({ type: 'playDev', p: me, card, res: res[0] });
      });
      return;
    }
    this.dialogs.close(true);
    this.mode = null;
    this.dispatch({ type: 'playDev', p: me, card });
  }

  onUi(k) {
    if (k === 'rules') this.dialogs.rules();
    else if (k === 'settings')
      this.dialogs.settings(this.settings, (s) => {
        this.settings = s;
        setSfx(s.sound !== false);
        this.save();
        if (this.onSettings) this.onSettings(s);
      });
    else if (k === 'menu') {
      const body = document.createElement('div');
      body.innerHTML = this.net
        ? `<p class="lead">${this.client ? '離開後你的國家立刻改由電腦接手；之後可以用同一個房間代碼重新加入，取回你的國家。' : '你是主持人：離開後由另一位線上玩家的電腦接手主持，你的國家改由電腦接手。沒有其他線上玩家時房間會關閉。'}</p>`
        : '<p class="lead">遊戲會自動儲存，之後可從主選單「繼續上一局」接著玩。</p>';
      const back = document.createElement('button');
      back.className = 'btn';
      back.type = 'button';
      back.textContent = '繼續遊戲';
      back.onclick = () => this.dialogs.close();
      // on a narrow phone in an online game the rules button gives its place in the top bar to the clock
      const rules = document.createElement('button');
      rules.className = 'btn ghost';
      rules.type = 'button';
      rules.textContent = '規則';
      rules.onclick = () => this.dialogs.rules();
      const exit = document.createElement('button');
      exit.className = 'btn primary';
      exit.type = 'button';
      exit.textContent = this.net ? '離開房間' : '回到主選單';
      exit.onclick = () => {
        this.dialogs.close(true);
        this.onExit && this.onExit();
      };
      this.dialogs.open({ kind: 'menu', title: '主選單', body, foot: [rules, back, exit], cls: 'narrow' });
    }
  }

  camOp(op, v) {
    const c = this.map.camera;
    if (op === 'rotl') c.rotateBy(-Math.PI / 4);
    else if (op === 'rotr') c.rotateBy(Math.PI / 4);
    else if (op === 'north') c.resetView();
    else if (op === 'tilt') c.setTilt(v);
    else if (op === 'tiltup') c.tiltBy(8);
    else if (op === 'tiltdown') c.tiltBy(-8);
  }

  setMapMode(m) {
    this.mapMode = m;
    this.map.setMapMode(m);
    this.hud.setMapMode(m);
  }

  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Enter/Space on a focused button already click it; don't also run a shortcut
    if ((k === ' ' || k === 'enter') && e.target && e.target.closest && e.target.closest('button, a, input, select, [role="button"]')) return;
    if (k === 'escape') {
      if (this.dialogs.kind) return;
      if (this.mode) {
        this.mode = null;
        this.refresh();
      }
      return;
    }
    if (this.dialogs.kind && !['m'].includes(k)) return;
    const map = { r: 'roll', 1: 'road', 2: 'settlement', 3: 'city', 4: 'dev', t: 'trade', c: 'cards', ' ': 'end', enter: 'end' };
    if (k === 'm') {
      const i = MAP_MODES.indexOf(this.mapMode);
      this.setMapMode(MAP_MODES[(i + 1) % MAP_MODES.length]);
      return;
    }
    const b = map[k];
    if (!b) return;
    const btn = this.hud.btns[b];
    if (!btn) return;
    e.preventDefault();
    if (btn.classList.contains('off')) this.hud.flashHint(btn.dataset.why || '現在不能這樣做');
    else this.onButton(b);
  }

  // ── what the viewer should see/do now ──
  refresh() {
    if (this.destroyed) return;
    const v = this.view();
    const me = this.viewer;
    const P = (p) => `<span style="color:${this.players[p].color};font-weight:700">${p === me ? '你' : esc(this.players[p].name)}</span>`;
    let banner = null;
    let inter = null;
    let hint = null;
    const wantDialog = { kind: null };

    if (this.passTo != null) {
      this.hud.render(this.ctx({ banner: null }));
      return;
    }
    if (this.net) {
      this.hud.setNet(this.net);
      this.hud.setClock(this.deadline, this.viewer >= 0 && v.phase !== 'over' && actorsNow(v).includes(this.viewer));
    }

    // a 7 was just rolled: let the dice finish before asking anyone to discard or move the robber
    const diceLeft = (this.diceUntil || 0) - performance.now();
    if (diceLeft > 30 && v.pending && ['discard', 'robber', 'steal'].includes(v.pending.type)) {
      this.hud.render(this.ctx({ banner: { html: '擲出 <b>7</b>：強盜出動…', wait: true }, hint: null }));
      clearTimeout(this.diceRefresh);
      this.diceRefresh = setTimeout(() => this.refresh(), diceLeft + 20);
      return;
    }

    if (v.phase === 'over') {
      if (!this.overShown) {
        this.overShown = true;
        if (!this.client) clearSave();
        if (this.onGameOver) this.onGameOver(this.result());
        setTimeout(
          () =>
            this.dialogs.gameOver(
              this.ctx(),
              () => this.onExit && this.onExit(true),
              () => this.dialogs.close(),
            ),
          900,
        );
      }
      banner = { html: `${P(v.winner)} 贏得了卡坦島！`, buttons: [{ label: '戰役結果', onClick: () => this.dialogs.gameOver(this.ctx(), () => this.onExit && this.onExit(true), () => this.dialogs.close()) }] };
    } else if (v.phase === 'setup') {
      const p = v.setup.order[v.setup.i];
      const round = v.setup.i < v.players.length ? 1 : 2;
      if (p === me) {
        if (v.setup.step === 'settlement') {
          inter = { kind: 'vertex', ids: legalSettlementSpots(v, me, true), ghost: 'settlement', player: me, onPick: (id) => this.dispatch({ type: 'settlement', p: me, vertex: id }) };
          banner = { html: `開局第 ${round} 輪：選擇<b>村莊</b>的位置${round === 2 ? '（此村莊旁的地形會給你開局資源）' : ''}` };
          hint = { text: '點選白色圓圈放置村莊' };
        } else {
          inter = { kind: 'edge', ids: legalRoadEdges(v, me), ghost: 'road', player: me, onPick: (id) => this.dispatch({ type: 'road', p: me, edge: id }) };
          banner = { html: '放置一條與剛才村莊相連的<b>道路</b>' };
          hint = { text: '點選白色條紋放置道路' };
        }
      } else banner = { html: `${P(p)} 正在選擇開局位置…`, wait: true };
    } else if (v.pending && v.pending.type === 'discard') {
      if (v.pending.amounts[me] !== undefined) {
        wantDialog.kind = 'discard';
        banner = { html: `擲出 7：你必須棄掉 <b>${v.pending.amounts[me]}</b> 張牌`, urgent: true };
        hint = { text: `棄掉 ${v.pending.amounts[me]} 張牌`, urgent: true };
      } else banner = { html: '等待其他國家棄牌…', wait: true };
    } else if (v.pending && v.pending.type === 'robber') {
      if (v.current === me) {
        const ids = GEO.hexes.map((h) => h.id).filter((h) => h !== v.board.robber);
        inter = { kind: 'hex', ids, player: me, onPick: (id) => this.dispatch({ type: 'robber', p: me, hex: id }) };
        const why = v.pending.reason === 'knight' ? '騎士出征' : '擲出 7，強盜出沒';
        banner = { html: `${why}：點選一塊<b>有白色圓圈的地形</b>安置強盜，並搶奪旁邊國家的一張牌`, urgent: true };
        hint = { text: '移動強盜：點選有圓圈的地形', urgent: true };
        // make sure this is noticed (once per robber move); the camera is left alone
        const key = 'robber:' + v.turn + ':' + v.pending.reason;
        if (this.robberNotice !== key) {
          this.robberNotice = key;
          this.hud.toast(why, '點選地圖上有白色圓圈的地形安置強盜。完成之前不能結束回合。', 'robber', 5200);
        }
      } else banner = { html: `${P(v.current)} 正在移動強盜…`, wait: true };
    } else if (v.pending && v.pending.type === 'steal') {
      if (v.current === me) {
        wantDialog.kind = 'steal';
        hint = { text: '選擇要搶奪的國家', urgent: true };
      } else banner = { html: `${P(v.current)} 正在選擇搶奪對象…`, wait: true };
    } else if (v.pending && v.pending.type === 'roadBuilding') {
      if (v.current === me) {
        inter = { kind: 'edge', ids: legalRoadEdges(v, me), ghost: 'road', player: me, onPick: (id) => this.dispatch({ type: 'road', p: me, edge: id }) };
        banner = { html: `道路建設：還可以免費建造 <b>${v.pending.left}</b> 條道路`, buttons: [{ label: '不用了', onClick: () => this.dispatch({ type: 'endRoadBuilding', p: me }) }] };
        hint = { text: `免費道路：再放 ${v.pending.left} 條` };
      } else banner = { html: `${P(v.current)} 正在建造道路…`, wait: true };
    } else if (v.trade) {
      const t = v.trade;
      if (t.from === me) {
        banner = { html: '你的交易提議等待回覆中', buttons: [{ label: '查看', onClick: () => this.dialogs.trade(this.ctx(), (a) => this.dispatch(a), 'players') }] };
        if (this.dialogs.kind !== 'trade') wantDialog.kind = 'trade-open';
      } else if (t.resp[me] === null) {
        wantDialog.kind = 'incoming';
        hint = { text: '回覆交易提議' };
      }
      else banner = { html: `${P(t.from)} 正在考慮交易對象…`, wait: true };
    } else if (v.current === me) {
      if (!v.rolled) {
        const dev = playableDev(v, me);
        banner = { html: `你的回合：<b>擲骰</b>${dev.length ? '（也可以先使用發展卡）' : ''}` };
        hint = { text: '擲骰開始你的回合' };
      } else if (this.mode) {
        const ids = this.mode === 'road' ? legalRoadEdges(v, me) : this.mode === 'settlement' ? legalSettlementSpots(v, me) : legalCitySpots(v, me);
        const name = { road: '道路', settlement: '村莊', city: '城市' }[this.mode];
        inter = {
          kind: this.mode === 'road' ? 'edge' : 'vertex',
          ids,
          ghost: this.mode,
          player: me,
          onPick: (id) => {
            const m = this.mode;
            this.mode = null;
            this.dispatch(m === 'road' ? { type: 'road', p: me, edge: id } : { type: m, p: me, vertex: id });
          },
          onCancel: () => {
            this.mode = null;
            this.refresh();
          },
        };
        banner = { html: `選擇<b>${name}</b>的位置`, buttons: [{ label: '取消', onClick: () => inter.onCancel() }] };
        hint = { text: this.mode === 'road' ? '點選白色條紋建造道路（右鍵或 Esc 取消）' : `點選白色圓圈建造${name}（右鍵或 Esc 取消）` };
      } else banner = null;
    } else {
      banner = { html: `${P(v.current)} 的回合${me < 0 ? '（觀戰中）' : ''}`, wait: true };
    }

    if (this.netStatus) {
      banner = { html: esc(this.netStatus), wait: true };
      inter = null;
      hint = null;
    }
    this.hud.render(this.ctx({ banner, hint }));
    // interaction (only rebuild when it changes)
    const ikey = inter ? inter.kind + ':' + inter.ids.join(',') + ':' + (inter.ghost || '') : '';
    if (ikey !== this.ikey) {
      this.ikey = ikey;
      this.map.setInteraction(inter);
    } else if (inter) this.map.interaction = inter;

    // dialogs
    const dk = this.dialogs.kind;
    if (wantDialog.kind === 'discard' && dk !== 'discard') {
      const amt = v.pending.amounts[me];
      this.dialogs.discard(this.ctx(), amt, (cards) => {
        if (this.dispatch({ type: 'discard', p: me, cards })) this.dialogs.close(true);
      });
    } else if (wantDialog.kind === 'steal' && dk !== 'steal') {
      this.dialogs.steal(this.ctx(), v.pending.victims, (q) => {
        this.dialogs.close(true);
        this.dispatch({ type: 'steal', p: me, target: q });
      });
    } else if (wantDialog.kind === 'incoming' && dk !== 'incoming') {
      const tid = v.trade.id;
      this.dialogs.incoming(this.ctx(), (accept) => {
        this.dialogs.close(true);
        if (this.state.trade && this.state.trade.id === tid && this.state.trade.resp[me] === null) this.dispatch({ type: 'respond', p: me, accept });
      });
    } else {
      if (dk === 'trade' && (v.current !== me || v.phase !== 'play')) this.dialogs.close(true);
      if ((dk === 'discard' && wantDialog.kind !== 'discard') || (dk === 'steal' && wantDialog.kind !== 'steal') || (dk === 'incoming' && wantDialog.kind !== 'incoming')) this.dialogs.close(true);
      this.dialogs.refresh(this.ctx());
    }
  }

  // What the campaign came to for the player at this device, for their record (null: nothing to
  // record — a spectator, or several people sharing this device).
  result() {
    const v = this.view();
    const me = this.viewer;
    if (v.phase !== 'over' || me < 0 || !v.players[me]) return null;
    if (!this.net && this.players.filter((p) => p.kind === 'human').length !== 1) return null;
    const vp = (p) => {
      const pl = v.players[p];
      return publicVP(v, p) + (Array.isArray(pl.dev) ? pl.dev.filter((c) => c && c.type === 'victoryPoint').length : 0);
    };
    const won = v.winner === me;
    const mine = vp(me);
    const place = won ? 1 : 1 + v.players.filter((_, q) => q !== me && (q === v.winner || vp(q) > mine)).length;
    const gid = this.net ? `o:${this.net.code}:${v.mapSeed >>> 0}` : `s:${this.state.seed >>> 0}:${this.state.mapSeed >>> 0}`;
    const mode = this.net ? (this.net.official ? 'official' : 'online') : 'single';
    return { gid, mode, won, vp: Math.min(30, mine), place: Math.min(4, place), n: v.players.length, turns: Math.min(2000, v.turn || 0) };
  }

  // ── computer players ──
  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.client || this.frozen) return;
    if (this.destroyed || this.state.phase === 'over') {
      this.thinking = null;
      return;
    }
    const actors = actorsNow(this.state);
    const auto = typeof window !== 'undefined' && window.__autoHuman; // test hook: let the AI play human seats
    const ai = actors.filter((p) => this.players[p].kind === 'ai' || (auto && this.players[p].kind === 'human'));
    if (!ai.length) {
      if (this.thinking != null) {
        this.thinking = null;
        this.hud.renderOutliner(this.ctx());
      }
      return;
    }
    // responders/discarders before the active player
    for (const p of ai) {
      const seq = this.state.seq;
      const action = aiAct(makeView(this.state, p), p, this.mem[p], this.rnd);
      if (!action) continue;
      // let dice and flying cards finish before the computer moves on
      const hold = Math.max(0, (this.fxHold || 0) - performance.now());
      const delay = Math.max((DELAY[action.type] || 700) * (SPEED[this.settings.speed] || 1), hold);
      this.thinking = p;
      this.hud.renderOutliner(this.ctx());
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.destroyed) return;
        if (this.state.seq !== seq) return this.schedule();
        this.thinking = null;
        if (!this.dispatch(action, { quiet: true })) this.aiFallback(p);
      }, delay);
      return;
    }
    // AIs are waiting on humans (e.g. a trade offer); nothing to do until they answer
    this.thinking = null;
  }

  aiFallback(p) {
    const tries = [
      { type: 'endRoadBuilding', p },
      { type: 'cancelOffer', p },
      { type: 'endTurn', p },
    ];
    for (const a of tries) {
      try {
        const c = JSON.parse(JSON.stringify(this.state));
        applyAction(c, a);
        this.dispatch(a, { quiet: true });
        return;
      } catch {
        /* try next */
      }
    }
    console.warn('AI stuck', p, this.state.pending, this.state.phase);
  }
}

export { totalVP };
