// The in-game HUD: nation bar, order banner, nations outliner, action bar, log, minimap,
// dispatches (toasts) and hex tooltips. Pure DOM; reads a redacted view of the game.
import { GEO } from '../engine/geometry.js';
import { TERRAIN_RES, pips } from '../engine/board.js';
import {
  COSTS,
  canAfford,
  missingFor,
  legalRoadEdges,
  legalSettlementSpots,
  legalCitySpots,
  playableDev,
  publicVP,
  handSize,
  tradeRatios,
  legalShips,
  movableShips,
  shipTargets,
  freeRoad,
} from '../engine/engine.js';
import { developOn, plotSpots, plotCost, specialWhy, specialHosts, hostWhy, slotsAt, wonderSpots, wonderWhy, wonderOf, wonderDone, stageCost, isWonder, hasBuilt, BUILDINGS, BUILDING_NAMES, PLOT_COST, BLUEPRINT_SIZE, hasBasic, specialsOf, NO_CARD, payFor, STORE_MAX, CARAVAN_GIVE } from '../engine/develop.js';
import { BUILDING_TEXT, DEVELOP_TEXT, DIR_COLOR, nationStrip, pointsText } from './develop-ui.js';
import { resCard, resIcon, costTokens, icon, dieFace, RES_NAMES, RES_EN, buildingIcon, buildingGlyph } from './icons.js';
import { badgeSvg, ensureBadgeDefs } from './badges.js';
import { Fx } from './fx.js';
import { sfx } from './sfx.js';
import { shake, pop, reduced, EASE } from './motion.js';
import { flagURL } from './flags.js';
import { esc, cardsText } from './text.js';
import { t, N_, cap, isZh, list } from '../i18n/index.js';

const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
const RES_HEX = { wood: '#2f6b2f', brick: '#b5532c', wool: '#8fcf4f', grain: '#e8c547', ore: '#8d8d96' };
// what the build buttons build; their cost shows over the button on hover (long press on touch)
// (name, fx and left are keys: read through t() when shown)
const BUILD = {
  road: { name: N_('道路'), en: 'Road', fx: N_('連接你的村莊與城市。連續最長、至少 5 條的道路得 2 分。'), cost: COSTS.road, piece: 'roads', left: N_('還剩 {n} 條') },
  settlement: { name: N_('村莊'), en: 'Settlement', fx: N_('+1 勝利分數。相鄰地形擲出點數時產出 1 張資源。'), cost: COSTS.settlement, piece: 'settlements', left: N_('還剩 {n} 座村莊') },
  city: { name: N_('城市'), en: 'City', fx: N_('由村莊升級：再 +1 勝利分數，產出加倍。'), cost: COSTS.city, piece: 'cities', left: N_('還剩 {n} 座城市') },
  dev: { name: N_('發展卡'), en: 'Development', fx: N_('抽 1 張：騎士、道路建設、豐收之年、壟斷或分數卡。'), cost: COSTS.dev },
  ship: { name: N_('船'), en: 'Ship', fx: N_('在海上或海岸邊，接在你的船或海邊的村莊、城市旁。船隊能把村莊送到別的島。'), cost: COSTS.ship, piece: 'ships', left: N_('還剩 {n} 艘') },
  moveShip: { name: N_('移船'), en: 'Move ship', fx: N_('每回合一次（擲骰後）：移動航線末端、之前回合建造、不在海盜旁的一艘船。'), cost: null },
  // (the development mode) a development: the cheapest way shown, the hex's own resource
  develop: { name: N_('開發'), en: 'Development', fx: DEVELOP_TEXT, cost: PLOT_COST[0].local },
};
// the build menu's rows, in order, with their keys and icons (ship and moveShip: maps with the sea)
const BUILD_ROWS = [
  ['road', '1', 'road'],
  ['settlement', '2', 'settlement'],
  ['city', '3', 'city'],
  ['dev', '4', 'devbuy'],
  ['ship', '5', 'ship'],
  ['moveShip', '6', 'moveShip'],
  ['develop', '5', 'develop'],
];
// each build row's badge (ui/badges.js), in the player's own colour: the shape it has on the map
const ROW_BADGE = { road: ['square', 'stone-path'], settlement: ['circle', 'house'], city: ['hex', 'castle'], dev: ['square', 'card-draw'], ship: ['tri', 'sailboat'], moveShip: ['tri', 'ship-wheel'], develop: ['square', 'windmill'] };
const rowBadge = (k, color) => {
  const [shape, glyph] = ROW_BADGE[k];
  return badgeSvg(shape, glyph, color, { mine: true });
};
const TERRAIN_HEX = { forest: '#2f6b2f', hills: '#b5532c', pasture: '#8fcf4f', fields: '#e8c547', mountains: '#8d8d96', desert: '#d9c48e', gold: '#f0b62a', fog: '#7d8790' };
// (the map table: washes of colour on the parchment, which shows through as the sea)
const TERRAIN_WASH = { forest: '#7f9c66', hills: '#cf8a5e', pasture: '#b5cd84', fields: '#e8cd78', mountains: '#aeaba2', desert: '#eadbb0', gold: '#e9bd52', fog: '#c2bcae' };

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// (the development mode) why a wonder can begin nowhere: what its first desert says (one with a
// settlement of the player's first)
function firstWhy(v, me) {
  const deserts = GEO.hexes.filter((h) => v.board.hexes[h.id].terrain === 'desert').map((h) => h.id);
  const mine = deserts.filter((h) => GEO.hexes[h].vertices.some((u) => v.vertices[u] && v.vertices[u].p === me));
  const h = mine.length ? mine[0] : deserts[0];
  return h == null ? N_('這張地圖沒有沙漠') : wonderWhy(v, me, h);
}
// why a building has no settlement to stand beside: no room left, or what the first with room lacks
function hostReason(v, me, k) {
  const own = [];
  v.vertices.forEach((b, u) => b && b.p === me && own.push(u));
  const roomy = own.filter((u) => slotsAt(v, u) > 0);
  if (!roomy.length) return t('你的聚落旁都沒有空位了（村莊 1 座、城市 2 座）');
  return t(hostWhy(v, me, k, roomy[0]));
}

export class Hud {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    // (the badges' shared gradients: the orders' gilt pictograms and the dice are filled with them)
    ensureBadgeDefs();
    this.prevRes = null;
    this.logCount = 0;
    // cards still flying towards the hand are not counted yet: the number ticks up on arrival
    this.pending = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    // the same for cards on their way back into the bank
    this.bankPending = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    this.bankShown = null;
    this.shown = null;
    this.build();
    this.fx = new Fx(root);
  }

  // reserve n incoming cards of a resource (shown count stays put until they land)
  holdRes(res, n = 1) {
    this.pending[res] += n;
    this.paintRes();
  }
  // one card arrived: count it, bump the chip, chime
  landRes(res, step = 0) {
    this.pending[res] = Math.max(0, this.pending[res] - 1);
    this.paintRes();
    const c = this.chips[res];
    c.classList.remove('gain', 'flash', 'drain');
    void c.offsetWidth;
    c.classList.add('gain');
    const r = c.getBoundingClientRect();
    this.fx.plus(r.left + r.width / 2, r.top + r.height + 6, '+1');
    sfx.chime(res, step);
  }
  chipCenter(res) {
    const r = this.chips[res].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  // the bank's card for a resource (or the deck); with the panel folded away, its toggle corner
  bankPoint(res) {
    const c = !this.outliner.classList.contains('closed') && this.bankCards[res];
    if (c) {
      const r = c.getBoundingClientRect();
      if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: window.innerWidth - 40, y: 70 };
  }
  // cards on their way into the bank: the count goes up as each one lands
  holdBank(res, n = 1) {
    if (!(res in this.bankPending)) return;
    this.bankPending[res] += n;
    this.paintBank();
  }
  landBank(res) {
    if (!(res in this.bankPending)) return;
    this.bankPending[res] = Math.max(0, this.bankPending[res] - 1);
    this.paintBank();
    const c = this.bankCards[res];
    c.classList.remove('bump');
    void c.offsetWidth;
    c.classList.add('bump');
  }
  paintBank() {
    if (!this.bankShown) return;
    for (const res of RES) {
      const n = Math.max(0, this.bankShown[res] - this.bankPending[res]);
      const c = this.bankCards[res];
      c.querySelector('.cnt').textContent = n;
      c.classList.toggle('low', n <= 3);
      c.classList.toggle('zero', n === 0);
      c.title = t('銀行：{res} 剩 {n} 張', { res: RES_NAMES[res], n });
    }
    const d = this.bankCards.dev;
    d.querySelector('.cnt').textContent = this.bankShown.dev;
    d.classList.toggle('zero', this.bankShown.dev === 0);
    d.title = t('發展卡堆：剩 {n} 張', { n: this.bankShown.dev });
  }
  // where cards for another nation go: its row in the outliner, or off the top of the screen
  nationPoint(p) {
    const row = !this.outliner.classList.contains('closed') && this.outliner.querySelector(`.nation[data-p="${p}"]`);
    if (row) {
      const r = row.getBoundingClientRect();
      if (r.width > 0) return { x: r.left + 26, y: r.top + r.height / 2 };
    }
    return { x: window.innerWidth / 2, y: -30 };
  }
  vpTarget(p, me) {
    if (p === me) return this.top.querySelector('.stat.vp');
    const row = !this.outliner.classList.contains('closed') && this.outliner.querySelector(`.nation[data-p="${p}"] .vp`);
    return row || null;
  }
  paintRes() {
    if (!this.shown) return;
    for (const res of RES) {
      const n = Math.max(0, this.shown[res] - this.pending[res]);
      const c = this.chips[res];
      c.querySelector('.n').textContent = n;
      c.classList.toggle('zero', n === 0);
    }
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    // top bar
    this.top = el('header', 'topbar');
    this.top.innerHTML = `
      <div class="tb-nation"><img class="flag" alt=""><div><div class="tb-name"></div><div class="tb-sub"></div></div></div>
      <div class="tb-res"></div>
      <div class="tb-stats">
        <div class="stat cards" title="${t('手牌總數')}">${icon('cards', 18)}<span class="n num">0</span></div>
        <div class="stat devs" title="${t('發展卡')}">${icon('dev', 18)}<span class="n num">0</span></div>
        <div class="stat knights" title="${t('已打出的騎士')}">${icon('knight', 18)}<span class="n num">0</span></div>
        <div class="stat store" hidden>${buildingIcon('warehouse', 18)}<span class="n num">0</span></div>
        <div class="stat vp" title="${t('勝利分數')}">${icon('vp', 20)}<span class="n num">0</span><small>/10</small></div>
      </div>
      <div class="tb-spacer"></div>
      <div class="tb-right">
        <div class="turn-clock" hidden role="timer" title="${t('這一步剩下的時間')}">${icon('hourglass', 18)}<b class="num">0:00</b></div>
        <div class="turn-box desk-only"><div class="t1">${t('回合')}</div><div class="t2"></div></div>
        <div class="dice" title="${t('上一次擲骰')}"></div>
        <button class="btn ghost icon-btn mobile-only" data-k="nations" title="${t('諸國')}" aria-label="${t('諸國')}">${icon('people', 20)}</button>
        <button class="btn ghost icon-btn mobile-only" data-k="log" title="${t('記錄')}" aria-label="${t('記錄')}">${icon('log', 20)}</button>
        <button class="btn ghost icon-btn" data-k="rules" title="${t('規則')}" aria-label="${t('規則')}">${icon('rules', 20)}</button>
        <button class="btn ghost icon-btn" data-k="settings" title="${t('設定')}" aria-label="${t('設定')}">${icon('gear', 20)}</button>
        <button class="btn ghost icon-btn" data-k="menu" title="${t('主選單')}" aria-label="${t('主選單')}">${icon('menu', 20)}</button>
      </div>`;
    r.appendChild(this.top);
    if (typeof ResizeObserver === 'function') {
      this.topObs = new ResizeObserver(() => r.style.setProperty('--tb-real', Math.round(this.top.getBoundingClientRect().bottom) + 'px'));
      this.topObs.observe(this.top);
    }
    this.resBox = this.top.querySelector('.tb-res');
    this.chips = {};
    for (const res of RES) {
      // each resource is a card hanging from the bar, its count on a token in the card's top corner
      const c = el('div', `res-chip rcard rc-${res}`);
      c.style.setProperty('--n', String(Math.max(4, RES_EN[res].length)));
      c.title = RES_NAMES[res];
      c.innerHTML = `<span class="nm">${RES_EN[res]}</span><b class="n num">0</b>`;
      this.resBox.appendChild(c);
      this.chips[res] = c;
    }
    this.top.querySelectorAll('[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.k;
        if (k === 'nations') this.outliner.classList.toggle('closed');
        else if (k === 'log') {
          this.logEl.classList.toggle('collapsed');
          // unread chat: open straight on it
          if (!this.logEl.classList.contains('collapsed') && this.chatUnread) this.showTab('chat');
          this.paintUnread();
        }
        else this.h.ui(k);
      }),
    );

    // banner
    this.banner = el('div', 'banner panel');
    this.banner.hidden = true;
    r.appendChild(this.banner);

    // outliner
    this.outliner = el('aside', 'outliner panel');
    if (window.innerWidth <= 900) this.outliner.classList.add('closed');
    // the bank on top: what is left of each resource and of the development deck
    this.bankEl = el('div', 'bank');
    this.bankEl.innerHTML = `<div class="ol-head"><span>${t('銀行')}</span><small>BANK</small></div><div class="bk-row"></div>`;
    const bkRow = this.bankEl.querySelector('.bk-row');
    this.bankCards = {};
    for (const res of RES) {
      const c = el('div', `bk-card rcard rc-${res}`);
      c.innerHTML = '<b class="cnt num">19</b>';
      bkRow.appendChild(c);
      this.bankCards[res] = c;
    }
    const deck = el('div', 'bk-card rcard dcard dc-back');
    deck.innerHTML = '<b class="cnt num">25</b>';
    bkRow.appendChild(deck);
    this.bankCards.dev = deck;
    this.olBody = el('div', 'ol-body');
    this.outliner.append(this.bankEl, this.olBody);
    r.appendChild(this.outliner);

    // log
    // the battle log; in online games a second tab holds the room's chat
    this.logEl = el('section', 'log panel');
    this.logEl.innerHTML = `<div class="log-head"><div class="log-tabs" role="tablist"><button type="button" role="tab" class="on" data-tab="log" aria-selected="true">${t('戰報')}</button><button type="button" role="tab" data-tab="chat" aria-selected="false" hidden>${t('聊天')}<i class="dot" hidden></i></button></div><button class="btn ghost icon-btn log-fold" type="button" aria-label="${t('收合')}">−</button></div><div class="log-body" aria-live="polite"></div><div class="chat-body" hidden><div class="chat-list" aria-live="polite"></div><form class="chat-form" autocomplete="off"><input type="text" maxlength="80" placeholder="${t('輸入訊息，按 Enter 送出')}" aria-label="${t('聊天訊息')}" enterkeyhint="send"><button type="submit" class="btn primary">${t('送出')}</button></form></div>`;
    if (window.innerWidth <= 900) this.logEl.classList.add('collapsed');
    this.logBody = this.logEl.querySelector('.log-body');
    this.chatBody = this.logEl.querySelector('.chat-body');
    this.chatList = this.logEl.querySelector('.chat-list');
    this.chatList.dataset.empty = t('對所有玩家說話。訊息只會出現在這場戰役裡。');
    this.chatTab = this.logEl.querySelector('[data-tab="chat"]');
    this.logEl.querySelector('.log-fold').addEventListener('click', () => this.logEl.classList.toggle('collapsed'));
    this.logEl.querySelectorAll('.log-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    r.appendChild(this.logEl);

    // action bar: a few orders; everything that costs resources is in the build menu above it, one row
    // each (so new things to build make the list longer, not the bar wider)
    this.bar = el('nav', 'actionbar panel');
    const acts = [
      ['roll', 'dice', t('擲骰'), 'R'],
      ['sep'],
      ['build', 'build', t('建造§bar'), 'B'],
      ['sep'],
      ['trade', 'trade', t('交易'), 'T'],
      ['cards', 'cards', t('手中卡牌'), 'C'],
      ['sep'],
      ['end', 'end', t('結束回合'), '␣'],
    ];
    this.btns = {};
    for (const a of acts) {
      if (a[0] === 'sep') {
        this.bar.appendChild(el('div', 'act-sep'));
        continue;
      }
      const [k, ic, label, key] = a;
      const b = el('button', 'act');
      b.type = 'button';
      b.dataset.k = k;
      // (a shorter name for a phone's narrow buttons: the same in Chinese; lang-en.css)
      const short = { end: t('結束回合§short') }[k] || label;
      b.innerHTML = `<span class="key">${key}</span>${icon(ic, 28)}<span class="lbl"><span class="l">${label}</span><span class="s" aria-hidden="true">${short}</span></span>`;
      // unavailable actions stay clickable so they can explain why they are unavailable
      b.addEventListener('click', () => {
        if (b.classList.contains('off')) this.refuse(b);
        else this.h.button(k);
      });
      this.bar.appendChild(b);
      this.btns[k] = b;
    }
    this.btns.build.setAttribute('aria-haspopup', 'true');
    this.btns.build.setAttribute('aria-expanded', 'false');
    // the build menu: a row for each thing to build, its cost against the hand, how many are left, and
    // why not (when not); 1–6 pick a row without opening the menu
    this.buildMenu = el('div', 'build-menu panel');
    this.buildMenu.hidden = true;
    this.buildMenu.setAttribute('role', 'menu');
    this.buildMenu.innerHTML = `<div class="bm-head"><b>${t('建造')}</b><small>${t('1–6 直接選')}</small></div>`;
    for (const [k, key, ic] of BUILD_ROWS) {
      const info = BUILD[k];
      const row = el('button', 'bm-row');
      row.type = 'button';
      row.dataset.k = k;
      row.setAttribute('role', 'menuitem');
      row.innerHTML = `<span class="bm-ico">${icon(ic, 24)}<i class="key">${key}</i></span><b class="bm-name">${t(info.name)}</b><span class="bm-cost"></span><small class="bm-sub"></small><small class="bm-left"></small>`;
      row.addEventListener('click', () => {
        if (row.classList.contains('off')) {
          this.refuse(row);
          return;
        }
        // (a placement on the map: the menu makes way; a card bought: it stays for the next)
        if (k !== 'dev') this.toggleBuild(false);
        this.h.button(k);
      });
      this.buildMenu.appendChild(row);
      this.btns[k] = row;
    }
    // (the development mode) the seven buildings of the blueprint, below the rest
    this.bpBox = el('div', 'bm-bp');
    this.bpBox.hidden = true;
    this.buildMenu.appendChild(this.bpBox);
    this.bpKeys = [];
    this.bpSig = '';
    this.bar.appendChild(this.buildMenu);
    // (a click anywhere else closes it)
    this.buildAway = (e) => {
      if (this.buildOpen && !this.bar.contains(e.target)) this.toggleBuild(false);
    };
    document.addEventListener('pointerdown', this.buildAway, true);
    r.appendChild(this.bar);
    this.hint = el('div', 'nexthint');
    this.hint.hidden = true;
    this.hint.setAttribute('role', 'status');
    r.appendChild(this.hint);

    // minimap + map modes (the camera turns and tilts with the mouse and keys: right-drag, Q/E, Z/X, Home)
    this.mini = el('div', 'minimap panel');
    this.mini.innerHTML = `<canvas width="368" height="300" aria-label="${t('小地圖')}"></canvas><div class="mapmodes"></div>`;
    this.miniCanvas = this.mini.querySelector('canvas');
    // (whether the minimap is on screen, kept up to date by the browser: read from the layout in the
    // middle of a map frame, it made the page work out its styles and layout again there and then)
    this.miniShown = true;
    if (typeof IntersectionObserver !== 'undefined') {
      this.miniObs = new IntersectionObserver((es) => {
        this.miniShown = es[es.length - 1].isIntersecting;
      });
      this.miniObs.observe(this.miniCanvas);
    }
    this.miniCanvas.addEventListener('click', (e) => {
      const rr = this.miniCanvas.getBoundingClientRect();
      const f = this.miniFrame();
      const x = f.cx + (((e.clientX - rr.left) / rr.width) * f.W - f.W / 2) / f.k;
      const z = f.cz + (((e.clientY - rr.top) / rr.height) * f.H - f.H / 2) / f.k;
      this.h.focus(x, z);
    });
    const modes = this.mini.querySelector('.mapmodes');
    this.modeBtns = {};
    for (const [k, ic, tip] of [
      ['terrain', 'terrain', t('地形（M）')],
      ['political', 'political', t('政治：國家領土')],
      ['production', 'production', t('產量：擲出機率')],
      ['resource', 'resources', t('資源種類')],
    ]) {
      const b = el('button', k === 'terrain' ? 'on' : '');
      b.type = 'button';
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.innerHTML = icon(ic, 18);
      b.addEventListener('click', () => this.h.mapMode(k));
      modes.appendChild(b);
      this.modeBtns[k] = b;
    }
    r.appendChild(this.mini);

    this.toastBox = el('div', 'toasts');
    r.appendChild(this.toastBox);
    this.tip = el('div', 'tooltip');
    this.tip.hidden = true;
    r.appendChild(this.tip);
  }

  // the part of the screen the map shows unhidden (client pixels): below the top bar and the cards that
  // hang from it, above the action bar, left of the nations panel while it is open (the opening view
  // puts the land there)
  freeRect() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const out = { left: 0, top: 0, right: W, bottom: H };
    let top = this.top.getBoundingClientRect().bottom;
    for (const c of this.top.querySelectorAll('.tb-res > *')) top = Math.max(top, c.getBoundingClientRect().bottom);
    if (top > 0 && top < H / 3) out.top = top;
    const bar = this.bar.getBoundingClientRect();
    if (bar.height && bar.top > H / 2) out.bottom = bar.top;
    if (!this.outliner.classList.contains('closed')) {
      const o = this.outliner.getBoundingClientRect();
      if (o.width && o.left > W / 2) out.right = o.left;
    }
    return out;
  }

  setNet(net) {
    if (!this.netChip) {
      this.netChip = el('div', 'net-chip desk-only');
      this.top.querySelector('.tb-right').prepend(this.netChip);
    }
    const n = net.peersOnline ? net.peersOnline() : null;
    this.netChip.innerHTML = `<i></i><span class="tx">${t('線上 ·')} </span>${esc(String(net.code || '').toUpperCase())}<span class="tx">${n ? ' · ' + t('{n} 人', { n }) : ''}</span>`;
    this.netChip.title = net.role === 'host' ? t('你是主持人：規則判定與電腦玩家都在你的頁面上運行') : t('已連線到主持人');
  }

  setHint(h) {
    const key = h ? h.text + (h.urgent ? '!' : '') : '';
    if (key === this.hintKey) return;
    this.hintKey = key;
    clearTimeout(this.hintTimer);
    if (!h) {
      this.hint.hidden = true;
      return;
    }
    this.hint.hidden = false;
    this.hint.className = 'nexthint' + (h.urgent ? ' urgent' : '');
    this.hint.innerHTML = `${h.urgent ? icon('robber', 16) : ''}<span>${esc(h.text)}</span>`;
  }

  // a short explanation after clicking an unavailable action; the regular hint returns afterwards
  // something pressed that cannot be done now: it shakes, the resources it lacks flash, the reason shows
  refuse(el) {
    this.flashHint(el.dataset.why || t('現在不能這樣做'));
    shake(el);
    const short = [...el.querySelectorAll('.bm-need.short')];
    for (const s of short) {
      s.classList.remove('flash');
      void s.offsetWidth;
      s.classList.add('flash');
    }
    clearTimeout(this.shortTimer);
    if (short.length) this.shortTimer = setTimeout(() => short.forEach((s) => s.classList.remove('flash')), 1000);
  }

  flashHint(text) {
    const prev = this.hintKey;
    this.hint.hidden = false;
    this.hint.className = 'nexthint why';
    this.hint.innerHTML = `${icon('cross', 14)}<span>${esc(text)}</span>`;
    this.hintKey = '__flash';
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.hintKey = null;
      if (this.lastHint !== undefined) this.setHint(this.lastHint);
      else if (!prev) this.hint.hidden = true;
    }, 2600);
  }

  setMapMode(mode) {
    for (const [k, b] of Object.entries(this.modeBtns)) b.classList.toggle('on', k === mode);
  }

  // ── per-state render ──
  render(ctx) {
    const { view: v, me, players } = ctx;
    const viewer = me >= 0 ? v.players[me] : null;
    const pIdx = me >= 0 ? me : v.current;
    const pl = players[pIdx];
    // nation block
    const img = this.top.querySelector('.tb-nation .flag');
    const url = flagURL(pl.color, pIdx);
    if (img.src !== url) img.src = url;
    this.top.querySelector('.tb-name').textContent = pl.name;
    const sub = this.top.querySelector('.tb-sub');
    if (v.phase === 'setup') sub.innerHTML = t('開局佈置');
    else if (v.phase === 'over') sub.innerHTML = t('戰役結束');
    else if (v.sub) {
      // 5–6 players: the part of the turn after the main player's
      const who = v.current === me ? t('<b>你</b>') : esc(players[v.current].name);
      sub.innerHTML = cap(v.sub.k === 'pair' ? t('{who}（第二位）', { who }) : t('特別建造：{who}', { who }));
    } else sub.innerHTML = v.current === me ? t('<b>你的回合</b>') : t('{who} 的回合', { who: esc(players[v.current].name) });

    // resources
    if (viewer && viewer.res) {
      const rates = this.rates(v, me);
      this.shown = { ...viewer.res };
      for (const res of RES) {
        const c = this.chips[res];
        const n = viewer.res[res];
        const disp = Math.max(0, n - this.pending[res]);
        c.querySelector('.n').textContent = disp;
        c.classList.toggle('zero', disp === 0);
        c.setAttribute('aria-label', t('{res} {n} 張', { res: RES_NAMES[res], n: disp }));
        c.title = t('{res}：{n} 張 · 產量 {rate}/36（每次擲骰平均 {avg} 張）· 銀行剩 {bank}', { res: RES_NAMES[res], n, rate: rates[res], avg: (rates[res] / 36).toFixed(2), bank: v.bank[res] });
        // gains arriving as flying cards bump on landing instead
        if (this.prevRes && this.prevRes[res] !== n && !(n > this.prevRes[res] && this.pending[res] > 0)) {
          c.classList.remove('flash', 'drain');
          void c.offsetWidth;
          c.classList.add(n > this.prevRes[res] ? 'flash' : 'drain');
        }
      }
      this.prevRes = { ...viewer.res };
      this.top.querySelector('.stat.cards .n').textContent = handSize(viewer.res);
      this.top.querySelector('.stat.devs .n').textContent = viewer.dev.length;
      this.top.querySelector('.stat.knights .n').textContent = viewer.knights;
      // (the development mode: the cards put away in a warehouse)
      const store = this.top.querySelector('.stat.store');
      store.hidden = !viewer.store;
      if (viewer.store) {
        store.querySelector('.n').textContent = handSize(viewer.store);
        store.title = t('貨棧：{cards}（最多 {n} 張）', { cards: cardsText(viewer.store), n: STORE_MAX });
      }
      const vp = publicVP(v, me) + viewer.dev.filter((c) => c.type === 'victoryPoint').length;
      this.top.querySelector('.stat.vp .n').textContent = vp;
      this.top.querySelector('.stat.vp small').textContent = '/' + v.targetVP;
    }
    this.top.querySelector('.turn-box .t2').textContent = v.phase === 'setup' ? t('開局') : t('第 {n} 回合§box', { n: v.turn });

    // dice
    const dice = this.top.querySelector('.dice');
    const dkey = v.dice ? v.dice.join(',') + ':' + v.turn : '';
    if (dkey !== this.diceKey) {
      this.diceKey = dkey;
      if (v.dice) {
        const sum = v.dice[0] + v.dice[1];
        dice.innerHTML = dieFace(v.dice[0], 30) + dieFace(v.dice[1], 30) + `<span class="sum num">${sum}</span>`;
        dice.classList.toggle('red', sum === 7);
        dice.classList.remove('rolling');
        void dice.offsetWidth;
        dice.classList.add('rolling');
      } else dice.innerHTML = '';
    }

    this.renderOutliner(ctx);
    this.renderActions(ctx);
    this.renderBanner(ctx.banner);
    this.lastHint = ctx.hint || null;
    if (this.hintKey !== '__flash') this.setHint(this.lastHint);
  }

  rates(v, p) {
    const r = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    v.vertices.forEach((b, vid) => {
      if (!b || b.p !== p) return;
      for (const h of GEO.vertices[vid].hexes) {
        const H = v.board.hexes[h];
        const res = TERRAIN_RES[H.terrain];
        if (!res || v.board.robber === h) continue;
        r[res] += pips(H.number) * (b.t === 'c' ? 2 : 1);
      }
    });
    return r;
  }

  renderOutliner(ctx) {
    const { view: v, me, players } = ctx;
    const rows = v.players
      .map((p) => {
        const P = players[p.id];
        const isMe = p.id === me;
        const vp = publicVP(v, p.id) + ((isMe || v.phase === 'over') && p.dev ? p.dev.filter((c) => c.type === 'victoryPoint').length : 0);
        const kind = P.away ? t('電腦代管') : P.kind === 'ai' ? { easy: t('電腦·簡單§short'), normal: t('電腦·普通§short'), hard: t('電腦·困難§short') }[P.ai.level] || t('電腦·普通§short') : isMe ? t('你§label') : P.kind === 'remote' ? t('線上玩家') : ctx.online ? t('主持人') : t('玩家');
        const badges = [];
        if (v.longestRoad === p.id) badges.push(v.ships ? `<span class="badge" title="${t('最長貿易路線（道路與船）+2')}">${icon('road2', 12)}${t('貿易路線')}</span>` : `<span class="badge" title="${t('最長道路 +2')}">${icon('road2', 12)}${t('最長道路')}</span>`);
        if (p.chits) badges.push(`<span class="badge" title="${t('新島嶼的第一座村莊 +{n}', { n: GEO.def.isleBonus || 2 })}">${icon('isle', 12)}${t('島嶼 +{n}', { n: p.chits })}</span>`);
        if (v.largestArmy === p.id) badges.push(`<span class="badge" title="${t('最大騎士團 +2')}">${icon('knight', 12)}${t('騎士團')}</span>`);
        const thinking = ctx.thinking === p.id ? `<span class="thinking"><span class="spinner"></span>${t('思考中')}</span>` : '';
        const lead = v.sub && v.sub.lead === p.id && v.phase !== 'over';
        // a trade offer out: beside each nation asked, its answer (a tick, a cross) or that it is thinking
        const asked = v.trade && v.trade.resp && p.id in v.trade.resp ? v.trade.resp[p.id] : undefined;
        const answer =
          asked === undefined ? '' : asked === 'yes' ? `<span class="ol-resp yes" data-a="yes" title="${t('已接受交易')}">${icon('check', 12)}</span>` : asked ? `<span class="ol-resp no" data-a="no" title="${t('已拒絕交易')}">${icon('cross', 11)}</span>` : `<span class="ol-resp wait" data-a="" title="${t('考慮中')}">…</span>`;
        return `<div class="nation${v.current === p.id && v.phase !== 'over' ? ' current' : ''}${lead ? ' lead' : ''}" data-p="${p.id}" style="--pc:${P.color}">
          <img class="flag" alt="" src="${flagURL(P.color, p.id)}">${answer}
          <div class="nm" style="color:${P.color}">${esc(P.name)}<em>${kind}</em></div>
          <div class="vp" title="${isMe ? t('你的分數（含分數卡）') : t('公開分數')}"><b class="num">${vp}</b><span>${t('分')}</span></div>
          <div class="meta">
            <span title="${t('手牌')}">${icon('cards', 14)}<b>${p.resCount}</b></span>
            <span title="${t('發展卡')}">${icon('dev', 14)}<b>${p.devCount}</b></span>
            <span title="${t('打出的騎士')}">${icon('knight', 14)}<b>${p.knights}</b></span>
            <span title="${t('最長道路長度')}">${icon('road2', 14)}<b>${v.roadLen[p.id]}</b></span>
            ${badges.join('')}
          </div>${developOn(v) ? nationStrip(v, p.id) : ''}${thinking}
        </div>`;
      })
      .join('');
    this.olBody.innerHTML = `<div class="ol-head"><span>${t('諸國')}</span></div>${rows}`;
    // five or six nations: tighter rows (and the list scrolls when the screen is short)
    this.outliner.classList.toggle('many', v.players.length > 4);
    this.turnSlide(v);
    // an answer just given bounces once
    const tid = v.trade ? v.trade.id : null;
    const was = this.olAnswers && this.olAnswers.id === tid ? this.olAnswers.a : {};
    const now = {};
    for (const m of this.olBody.querySelectorAll('.ol-resp')) {
      const q = m.closest('.nation').dataset.p;
      now[q] = m.dataset.a;
      if (m.dataset.a && was[q] !== m.dataset.a) pop(m, { scale: 1.6, ms: 360 });
    }
    this.olAnswers = { id: tid, a: now };
    this.bankShown = { ...v.bank, dev: v.devDeckCount };
    this.paintBank();
  }

  // The turn passed on: the mark of the current turn slides from the last nation's row to this one's
  // (a copy of it, under the rows, while the row's own mark waits).
  turnSlide(v) {
    const cur = v.phase === 'over' ? -1 : v.current;
    const was = this.olCur;
    this.olCur = cur;
    if (was == null || was === cur || cur < 0 || was < 0 || reduced() || this.outliner.classList.contains('closed')) return;
    const a = this.olBody.querySelector(`.nation[data-p="${was}"]`);
    const b = this.olBody.querySelector(`.nation.current[data-p="${cur}"]`);
    if (!a || !b || !b.offsetHeight) return;
    const mark = el('i', 'nation current ol-turn');
    mark.setAttribute('aria-hidden', 'true');
    Object.assign(mark.style, { left: b.offsetLeft + 'px', top: b.offsetTop + 'px', width: b.offsetWidth + 'px', height: b.offsetHeight + 'px' });
    // (first: the rows are drawn over it)
    this.olBody.prepend(mark);
    b.classList.add('arriving');
    const done = () => {
      mark.remove();
      b.classList.remove('arriving');
    };
    const an = mark.animate([{ translate: `0 ${a.offsetTop - b.offsetTop}px`, scale: `1 ${a.offsetHeight / b.offsetHeight}` }, { translate: '0 0', scale: '1 1' }], { duration: 300, easing: EASE.out });
    an.onfinish = done;
    an.oncancel = done;
    // (never left half way: a page in the background holds its animations)
    setTimeout(done, 900);
  }

  renderActions(ctx) {
    const { view: v, me } = ctx;
    const pl = me >= 0 ? v.players[me] : null;
    // (the build rows' badges in this player's colour: a friend at this device has another)
    const myColor = (ctx.players && ctx.players[me] && ctx.players[me].color) || '#9a8a70';
    if (myColor !== this.rowColor) {
      this.rowColor = myColor;
      for (const [k] of BUILD_ROWS) {
        const ico = this.btns[k] && this.btns[k].querySelector('.bm-ico');
        if (!ico) continue;
        const key = ico.querySelector('.key');
        ico.classList.add('bdgi');
        ico.innerHTML = `<span class="bdg">${rowBadge(k, myColor)}</span>`;
        if (key) ico.appendChild(key);
      }
      this.bpSig = null;
    }
    const myTurn = pl && v.phase === 'play' && v.current === me && !ctx.locked;
    const free = myTurn && !v.pending && !v.trade;
    const set = (k, enabled, title, extra = {}) => {
      const b = this.btns[k];
      b.classList.toggle('off', !enabled);
      b.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      b.dataset.why = enabled ? '' : title || t('現在不能這樣做');
      if (BUILD[k]) b.removeAttribute('title');
      else b.title = title || '';
      b.classList.toggle('on', !!extra.on);
      b.classList.toggle('primary', !!extra.primary);
      b.classList.toggle('glow', !!extra.glow);
      const cnt = b.querySelector('.count');
      if (extra.count != null) {
        if (cnt) cnt.textContent = extra.count;
        else b.insertAdjacentHTML('beforeend', `<span class="count">${extra.count}</span>`);
      } else if (cnt) cnt.remove();
    };
    const needRoll = myTurn && !v.rolled && !v.pending;
    const pendingWhy = () => {
      const pd = v.pending;
      if (!pd) return v.trade && v.trade.from !== me ? t('請先回覆交易提議') : '';
      if (pd.type === 'discard') return pd.amounts[me] !== undefined ? t('請先棄掉 {n} 張牌', { n: pd.amounts[me] }) : t('等待其他國家棄牌');
      if (pd.type === 'robber') return v.current === me ? t('請先移動強盜：點選地圖上有白色圓圈的地形') : t('等待對手移動強盜');
      if (pd.type === 'steal') return t('請先選擇要搶奪的國家');
      if (pd.type === 'roadBuilding') return t('請先放置免費道路（或按上方的「不用了」）');
      if (pd.type === 'defend') return pd.p === me ? t('請先決定是否防衛奇觀') : t('等待奇觀的主人決定是否防衛');
      if (pd.type === 'pick') return t('請先選擇要留下的發展卡');
      if (pd.type === 'reroll') return pd.p === me ? t('請先決定要不要用天文台重擲') : t('等待擲骰的國家決定要不要重擲');
      return t('請先完成目前的動作');
    };
    const turnWhy = () => (!pl ? t('你正在觀戰') : v.phase === 'setup' ? t('開局佈置中') : v.phase === 'over' ? t('遊戲已結束') : ctx.locked ? t('正在等待回應') : t('還沒輪到你'));
    // what the hand pays for a cost (the development mode: the smithy's ore, the discounts), or null
    const plan = (cost, kind = 'build') => (!pl || !pl.res ? null : developOn(v) ? payFor(v, me, cost, kind) : canAfford(pl.res, cost) ? { cost } : null);
    set('roll', free && !v.rolled, needRoll ? t('擲骰（R）') : !myTurn ? turnWhy() : v.pending || v.trade ? pendingWhy() : t('本回合已經擲過骰子'), { primary: needRoll, glow: needRoll && !ctx.mode });
    const why = (cost, legalCount, pieces, usedUp, kind = 'build') => {
      if (!myTurn) return turnWhy();
      if (v.pending || v.trade) return pendingWhy() || t('請先完成目前的動作');
      if (!v.rolled) return t('請先擲骰');
      if (pieces === 0) return usedUp;
      if (!plan(cost, kind)) return t('資源不足：還缺 ') + cardsText(missingFor(pl.res, cost).missing);
      if (legalCount === 0) return t('目前沒有可以建造的位置');
      return '';
    };
    const roads = free && v.rolled ? legalRoadEdges(v, me).length : 0;
    const setts = free && v.rolled ? legalSettlementSpots(v, me).length : 0;
    const cities = free && v.rolled ? legalCitySpots(v, me).length : 0;
    // (the development mode: the royal road's free road)
    const freeR = !!pl && freeRoad(v, me);
    // (the development mode: a basic card left out of the blueprint is never paid for this game)
    const card = (k) => !pl || hasBasic(v, me, k);
    const okRoad = free && v.rolled && pl.pieces.roads > 0 && (freeR || (card('road') && !!plan(COSTS.road, 'road'))) && roads > 0;
    const okSet = free && v.rolled && card('settlement') && pl.pieces.settlements > 0 && !!plan(COSTS.settlement) && setts > 0;
    const okCity = free && v.rolled && card('city') && pl.pieces.cities > 0 && !!plan(COSTS.city) && cities > 0;
    // (the smithy: the cost as it will be paid, an ore for the card the hand lacks; the road bureau: a
    // card less for the turn's first road)
    this.plans = {};
    if (pl && developOn(v)) for (const k of ['road', 'settlement', 'city']) {
      const pr = plan(COSTS[k], k === 'road' ? 'road' : 'build');
      if (pr && (pr.smith || pr.skip)) this.plans[k] = pr;
    }
    // (the development mode: the great library buys one for any single card)
    const libCard = !!pl && developOn(v) && wonderDone(v, me, 'library') && !v.used.library && RES.some((r) => pl.res[r] > 0);
    const okDev = free && v.rolled && ((card('dev') && canAfford(pl.res, COSTS.dev)) || libCard) && v.devDeckCount > 0;
    set('road', okRoad, okRoad ? t('建造道路（1）：木材＋磚塊') : !freeR && !card('road') ? t(NO_CARD.road) : why(freeR ? {} : COSTS.road, roads, pl ? pl.pieces.roads : 1, t('道路已經用完了'), 'road'), { on: ctx.mode === 'road' });
    set('settlement', okSet, okSet ? t('建造村莊（2）：木材＋磚塊＋羊毛＋小麥') : !card('settlement') ? t(NO_CARD.settlement) : why(COSTS.settlement, setts, pl ? pl.pieces.settlements : 1, t('村莊已經用完了（可先升級城市）')), { on: ctx.mode === 'settlement' });
    set('city', okCity, okCity ? t('升級城市（3）：小麥×2＋礦石×3') : !card('city') ? t(NO_CARD.city) : why(COSTS.city, cities, pl ? pl.pieces.cities : 1, t('城市已經用完了')), { on: ctx.mode === 'city' });
    set('dev', okDev, okDev ? t('購買發展卡（4）：羊毛＋小麥＋礦石') : v.devDeckCount === 0 ? t('發展卡已賣完') : !card('dev') && !libCard ? t(NO_CARD.dev) : why(COSTS.dev, 1, 1, ''));
    for (const k of ['road', 'settlement', 'city', 'dev']) this.btns[k].classList.toggle('nocard', !card(k));
    // (Seafarers) build a ship, move one
    const seafaring = !!v.ships;
    this.btns.ship.hidden = !seafaring;
    this.btns.moveShip.hidden = !seafaring;
    if (seafaring) {
      const ships = free && v.rolled ? legalShips(v, me).length : 0;
      const okShip = free && v.rolled && pl.pieces.ships > 0 && canAfford(pl.res, COSTS.ship) && ships > 0;
      set('ship', okShip, okShip ? t('建造船（5）：木材＋羊毛') : why(COSTS.ship, ships, pl ? pl.pieces.ships : 1, t('船已經用完了')), { on: ctx.mode === 'ship' });
      const movable = free && v.rolled && !v.shipMoved && !(v.sub && v.sub.k === 'sbp') ? movableShips(v, me).filter((e) => shipTargets(v, me, e).length).length : 0;
      set('moveShip', movable > 0, movable ? t('移動一艘船（6）：航線末端、之前回合建造的船，每回合一次') : !myTurn ? turnWhy() : v.pending || v.trade ? pendingWhy() : !v.rolled ? t('請先擲骰') : v.shipMoved ? t('這回合已經移過船了') : t('沒有可以移動的船（只能移動航線末端、之前回合建造、不在海盜旁的船）'), { on: ctx.mode === 'moveShip' || ctx.mode === 'moveShipTo' });
    }
    // (the development mode) developments and the blueprint's buildings
    const developing = !!pl && developOn(v);
    this.btns.develop.hidden = !developing;
    this.bpBox.hidden = !developing;
    this.buildMenu.classList.toggle('dev', developing);
    if (developing) this.renderBlueprint(ctx, { myTurn, free, why, turnWhy, pendingWhy, plan });
    // 5–6 players: the special building phase allows no trading at all; the second player of a paired
    // turn trades with the bank only (the trade dialog shows just that)
    const sbp = !!v.sub && v.sub.k === 'sbp';
    const canTrade = myTurn && v.rolled && !v.pending && !sbp;
    set('trade', canTrade, canTrade ? (v.sub ? t('海上貿易（T）：第二位只能和銀行交易') : t('交易（T）')) : !myTurn ? turnWhy() : v.pending ? pendingWhy() : sbp ? t('特別建造階段不能交易') : t('擲骰後才能交易'), { on: !!(v.trade && v.trade.from === me) });
    const playable = pl ? playableDev(v, me).length : 0;
    set('cards', !!pl, t('手中的發展卡（C）'), { count: pl && pl.dev && pl.dev.length ? pl.dev.length : null, on: playable > 0 && myTurn });
    const canEnd = myTurn && v.rolled && !v.pending;
    set('end', canEnd, canEnd ? (v.sub ? t('結束（Space）') : t('結束回合（Space）')) : !myTurn ? turnWhy() : v.pending ? pendingWhy() : t('請先擲骰'));
    // the build button: open while its menu is, lit while placing what it builds, and how many of its rows
    // can be built now
    const building = ['road', 'settlement', 'city', 'ship', 'moveShip', 'moveShipTo', 'develop', 'wonder'].includes(ctx.mode) || (!!ctx.mode && ctx.mode.startsWith('bp:'));
    const rowKeys = [...BUILD_ROWS.map(([k]) => k), ...(developing ? this.bpKeys : [])];
    const ready = myTurn && v.rolled ? rowKeys.filter((k) => !this.btns[k].hidden && !this.btns[k].classList.contains('off')).length : 0;
    set('build', !!pl, !pl ? turnWhy() : t('建造（B）'), { on: building || this.buildOpen, count: ready || null });
    this.btns.build.classList.toggle('open', !!this.buildOpen);
    this.bar.style.visibility = v.phase === 'over' ? 'hidden' : '';
    if (v.phase === 'over' && this.buildOpen) this.toggleBuild(false);
    this.buildCtx = { res: pl ? pl.res : null, pieces: pl ? pl.pieces : null, deck: v.devDeckCount, freeRoad: freeR, bp: developing ? this.bpInfo : null, plans: this.plans };
    if (this.buildOpen) this.paintBuild();
  }

  // the build menu, open or shut (B, the Build button, Esc, a click elsewhere, a row picked)
  // The menu grows up out of the Build button and sinks back into it (a tenth of a second: what was
  // picked happens at once, the menu only fades while it does).
  toggleBuild(open = !this.buildOpen) {
    const was = this.buildOpen;
    this.buildOpen = !!open;
    const m = this.buildMenu;
    this.btns.build.setAttribute('aria-expanded', String(this.buildOpen));
    this.btns.build.classList.toggle('open', this.buildOpen);
    clearTimeout(this.buildHide);
    if (this.buildFade) this.buildFade.cancel();
    this.buildFade = null;
    m.classList.remove('closing');
    if (this.buildOpen) {
      m.hidden = false;
      this.paintBuild();
      if (!was && !reduced()) m.animate([{ opacity: 0, translate: '0 12px', scale: 0.97 }, { opacity: 1, translate: '0 0', scale: 1 }], { duration: 170, easing: EASE.out });
    } else if (was && !m.hidden && !reduced()) {
      m.classList.add('closing');
      this.buildFade = m.animate([{ opacity: 1 }, { opacity: 0, translate: '0 8px', scale: 0.98 }], { duration: 110, easing: EASE.in, fill: 'forwards' });
      this.buildHide = setTimeout(() => {
        m.hidden = true;
        m.classList.remove('closing');
        if (this.buildFade) this.buildFade.cancel();
        this.buildFade = null;
      }, 110);
    } else m.hidden = true;
  }

  // the rows' costs against the hand, the pieces left, and why a row is shut
  paintBuild() {
    const c = this.buildCtx;
    if (!c) return;
    for (const [k] of BUILD_ROWS) {
      const info = BUILD[k];
      const row = this.btns[k];
      if (row.hidden) continue;
      // (the royal road: this turn's road is free)
      // (a token per card, the ones the hand lacks hollow)
      // (the smithy: the cost as it will be paid)
      const pr = c.plans && c.plans[k];
      const cost = k === 'road' && c.freeRoad ? `<span class="bm-free">${t('免費（皇家大道）')}</span>` : info.cost
        ? costTokens(pr ? pr.cost : info.cost, { size: 24, have: c.res, cls: 'bm-need' })
        : `<span class="bm-free">${t('不用資源')}</span>`;
      row.querySelector('.bm-cost').innerHTML = cost;
      const why = row.dataset.why;
      const notes = pr ? [pr.skip && t('築路司：少付 1 張{res}', { res: RES_NAMES[pr.skip] }), pr.smith && t('鐵匠鋪：1 張礦石代替{res}', { res: RES_NAMES[pr.smith] })].filter(Boolean) : [];
      row.querySelector('.bm-sub').textContent = why || (notes.length ? list(notes) : t(info.fx));
      // (the rule on one line; all of it on the row's tooltip)
      row.title = why ? '' : t(info.fx);
      row.querySelector('.bm-sub').classList.toggle('why', !!why);
      const left = info.piece && c.pieces ? t(info.left, { n: c.pieces[info.piece] }) : k === 'dev' && c.deck != null ? t('卡堆剩 {n} 張', { n: c.deck }) : k === 'develop' ? t('其他資源多 1 張小麥') : '';
      row.querySelector('.bm-left').textContent = left;
    }
    if (c.bp) this.paintBlueprint(c);
  }

  // ── the development mode: the blueprint's rows ──

  // The seven buildings of the viewer's blueprint, a row each (built when the blueprint changes: a
  // friend at this device has another); whether each can be built now, and why not.
  renderBlueprint(ctx, { myTurn, free, why, turnWhy, pendingWhy, plan }) {
    const { view: v, me } = ctx;
    const pl = v.players[me];
    const sig = (pl.bp || []).join(',');
    if (sig !== this.bpSig) {
      this.bpSig = sig;
      for (const k of this.bpKeys) delete this.btns[k];
      this.bpKeys = [];
      this.bpBox.innerHTML = `<div class="bm-head"><b>${t('藍圖')}</b><small>${t('每種每人一座；奇觀分三階段')}</small></div>`;
      // (a phone: the blueprint folds away under its head)
      this.bpBox.firstChild.addEventListener('click', () => window.innerWidth <= 760 && this.bpBox.classList.toggle('fold'));
      for (const k of specialsOf(pl.bp)) {
        const key = 'bp:' + k;
        const row = el('button', 'bm-row bm-b' + (isWonder(k) ? ' wonder' : ''));
        row.type = 'button';
        row.dataset.k = key;
        row.style.setProperty('--dc', DIR_COLOR[BUILDINGS[k].dir]);
        row.setAttribute('role', 'menuitem');
        const col = this.rowColor || '#9a8a70';
        const bdg = badgeSvg(isWonder(k) ? 'rosette' : 'diamond', buildingGlyph(k), col, { mine: true, gold: isWonder(k) });
        row.innerHTML = `<span class="bm-ico bdgi"><span class="bdg">${bdg}</span></span><b class="bm-name">${t(BUILDING_NAMES[k])}</b><span class="bm-cost"></span><small class="bm-sub"></small><small class="bm-left"></small>`;
        row.addEventListener('click', () => {
          if (row.classList.contains('off')) {
            this.refuse(row);
            return;
          }
          this.toggleBuild(false);
          this.h.button(key);
        });
        this.bpBox.appendChild(row);
        this.btns[key] = row;
        this.bpKeys.push(key);
      }
      // (a blueprint of the few cards a new player owns: where the rest come from)
      if ((pl.bp || []).length < BLUEPRINT_SIZE) this.bpBox.appendChild(el('p', 'bm-bp-note', esc(t('藍圖 {n}/7：更多建築卡從任務、抽卡與商店拿（主畫面）', { n: (pl.bp || []).length }))));
    }
    const set = (key, ok, whyText, on) => {
      const b = this.btns[key];
      b.classList.toggle('off', !ok);
      b.setAttribute('aria-disabled', ok ? 'false' : 'true');
      b.dataset.why = ok ? '' : whyText || t('現在不能這樣做');
      b.classList.toggle('on', !!on);
    };
    const open = free && v.rolled;
    // developments: somewhere to develop, and the hand for one of its ways
    const spots = open ? plotSpots(v, me) : [];
    const okPlot = spots.some((h) => ['wood', 'brick', 'wool', 'grain', 'ore'].some((r) => !!plan(plotCost(v, h, r), 'develop')));
    set('develop', okPlot, !open ? why(PLOT_COST[0].local, 1, 1, '') : !spots.length ? t('目前沒有可以開發的地塊：要在有你聚落的地塊上，沒有別人的開發，也沒有強盜') : why(PLOT_COST[0].local, spots.length, 1, ''), ctx.mode === 'develop');
    this.bpInfo = {};
    const w = wonderOf(v, me);
    for (const key of this.bpKeys) {
      const k = key.slice(3);
      const info = { cost: null, status: '', fx: t(BUILDING_TEXT[k].fx) };
      if (isWonder(k)) {
        const mine = w && w.k === k ? w : null;
        info.cost = stageCost(v, me);
        info.status = mine ? (mine.done ? t('完工') : t('施工中 {s}/3', { s: mine.s })) : '';
        info.wonder = mine ? mine.s : 0;
        if (mine && mine.done) set(key, false, t('奇觀已經完工'), false);
        else if (!open) set(key, false, why(info.cost || {}, 1, 1, ''), false);
        else {
          const sites = wonderSpots(v, me);
          const reason = !sites.length ? (mine ? wonderWhy(v, me, mine.h) : firstWhy(v, me, k)) : '';
          info.plan = plan(info.cost, 'wonder');
          set(key, !reason && !!info.plan, reason ? t(reason) : why(info.cost, sites.length, 1, '', 'wonder'), ctx.mode === 'wonder');
        }
      } else if (hasBuilt(v, me, k)) {
        info.status = t('已建造');
        // (the market, once it stands: its trade, once a turn)
        if (k === 'market') {
          info.cost = null;
          info.fx = t('每回合一次：2 張同種資源換 1 張任意資源');
          const can = open && !v.used.market && ['wood', 'brick', 'wool', 'grain', 'ore'].some((r) => pl.res[r] >= 2);
          set(key, can, !open ? why({}, 1, 1, '') : v.used.market ? t('這回合已經用過市集了') : t('需要 2 張相同的資源'), false);
          info.use = true;
        } else if (k === 'caravan') {
          // (the caravanserai: two different cards for one, as often as liked)
          info.cost = null;
          info.fx = t('2 張不同的資源換 1 張任意資源，次數不限');
          const can = open && RES.filter((r) => pl.res[r] > 0).length >= CARAVAN_GIVE;
          set(key, can, !open ? why({}, 1, 1, '') : t('需要 2 種不同的資源'), false);
          info.use = true;
        } else if (k === 'warehouse') {
          // (the warehouse: put away after the roll, taken back any time in the player's turn)
          info.cost = null;
          const stored = handSize(pl.store || {});
          info.fx = t('存著 {n}/{max} 張：擲骰後存入，自己的回合拿回', { n: stored, max: STORE_MAX });
          const can = free && ((v.rolled && handSize(pl.res) > 0 && stored < STORE_MAX) || stored > 0);
          set(key, can, !myTurn ? turnWhy() : v.pending || v.trade ? pendingWhy() : !v.rolled ? t('請先擲骰') : t('手上沒有牌可以存'), false);
          info.use = true;
        } else set(key, false, t('已建造：每種每人一座'), false);
      } else {
        info.cost = BUILDINGS[k].cost;
        if (!open) set(key, false, why(info.cost, 1, 1, ''), false);
        else {
          const cond = specialWhy(v, me, k);
          const hosts = cond ? [] : specialHosts(v, me, k);
          const reason = cond ? t(cond) : !hosts.length ? hostReason(v, me, k) : '';
          info.plan = plan(info.cost, 'special');
          set(key, !reason && !!info.plan, reason || why(info.cost, hosts.length, 1, '', 'special'), ctx.mode === key);
        }
      }
      this.bpInfo[k] = info;
    }
  }

  paintBlueprint(c) {
    for (const key of this.bpKeys) {
      const k = key.slice(3);
      const info = c.bp[k];
      const row = this.btns[key];
      if (!info || !row) continue;
      // (a discount or the smithy: the cost as it will be paid, and a word on it)
      const pr = info.cost && info.plan && (info.plan.skip || info.plan.smith) ? info.plan : null;
      row.querySelector('.bm-cost').innerHTML = info.cost
        ? costTokens(pr ? pr.cost : info.cost, { size: 21, have: c.res, cls: 'bm-need' })
        : info.use
          ? `<span class="bm-free">${t('使用')}</span>`
          : '';
      const why = row.dataset.why;
      const sub = row.querySelector('.bm-sub');
      const notes = [];
      if (pr && pr.skip) notes.push(isWonder(k) ? t('營造廠：少付 1 張{res}', { res: RES_NAMES[pr.skip] }) : t('學徒工坊：少付 1 張{res}', { res: RES_NAMES[pr.skip] }));
      if (pr && pr.smith) notes.push(t('鐵匠鋪：1 張礦石代替{res}', { res: RES_NAMES[pr.smith] }));
      sub.textContent = why || (notes.length ? list(notes) : info.fx);
      sub.classList.toggle('why', !!why && !info.status);
      row.title = t('{name}：{fx}（{pts}）', { name: t(BUILDING_NAMES[k]), fx: info.fx, pts: pointsText(k) });
      row.querySelector('.bm-left').textContent = info.status || (isWonder(k) ? t('第 {s} 階段', { s: (info.wonder || 0) + 1 }) : pointsText(k));
      row.classList.toggle('built', !!info.status && !info.use);
    }
  }

  renderBanner(b) {
    if (!b) {
      this.banner.hidden = true;
      this.bannerKey = '';
      return;
    }
    const key = b.html + '|' + (b.buttons || []).map((x) => x.label).join(',') + (b.wait ? 'w' : '');
    if (key === this.bannerKey && !this.banner.hidden) return;
    this.bannerKey = key;
    this.banner.hidden = false;
    this.banner.classList.toggle('wait', !!b.wait);
    this.banner.classList.toggle('urgent', !!b.urgent);
    this.banner.innerHTML = `${b.wait ? '<span class="spinner"></span>' : ''}<div class="msg">${b.html}</div><div class="acts"></div>`;
    const acts = this.banner.querySelector('.acts');
    for (const x of b.buttons || []) {
      const btn = el('button', 'btn' + (x.primary ? ' primary' : ''), x.label);
      btn.type = 'button';
      btn.addEventListener('click', x.onClick);
      acts.appendChild(btn);
    }
    // your turn begins: the order drops down from the bar with a little bounce (once a turn)
    if (b.turn != null && b.turn !== this.turnDrop) {
      this.turnDrop = b.turn;
      if (reduced()) this.banner.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      else
        this.banner.animate(
          [
            { opacity: 0, translate: '0 -26px', scale: 0.92 },
            { opacity: 1, translate: '0 4px', scale: 1.04, offset: 0.6 },
            { opacity: 1, translate: '0 0', scale: 1 },
          ],
          { duration: 420, easing: EASE.out },
        );
    }
  }

  // ── chat (online games) ──
  enableChat(onSend) {
    this.chatSend = onSend;
    this.chatTab.hidden = false;
    const form = this.logEl.querySelector('.chat-form');
    const input = form.querySelector('input');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const why = this.chatSend ? this.chatSend(input.value) : 'off';
      if (!why) input.value = '';
      else if (why === 'fast') this.flashHint(t('訊息送得太快了，請稍等一下'));
    });
    // typing never reaches the game's keyboard shortcuts
    input.addEventListener('keydown', (e) => e.stopPropagation());
  }

  showTab(tab) {
    const chat = tab === 'chat' && !this.chatTab.hidden;
    this.logEl.querySelectorAll('.log-tabs [data-tab]').forEach((b) => {
      const on = b.dataset.tab === (chat ? 'chat' : 'log');
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.logBody.hidden = chat;
    this.chatBody.hidden = !chat;
    this.logEl.classList.toggle('chatting', chat);
    if (chat) {
      this.logEl.classList.remove('collapsed');
      this.chatUnread = 0;
      this.chatList.scrollTop = this.chatList.scrollHeight;
    }
    this.paintUnread();
  }

  chatShown() {
    return !this.chatBody.hidden && !this.logEl.classList.contains('collapsed');
  }

  paintUnread() {
    const n = this.chatShown() ? 0 : this.chatUnread || 0;
    this.chatTab.querySelector('.dot').hidden = !n;
    const lb = this.top.querySelector('[data-k="log"]');
    if (lb) lb.classList.toggle('unread', !!n);
  }

  // { name, color, text, mine, note } — note: a line from the game itself (who hosts now, and so on)
  addChat(m) {
    const p = el('p', m.note ? 'note' : m.mine ? 'mine' : '');
    if (m.note) p.textContent = m.text;
    else {
      const who = el('b', 'who');
      who.textContent = m.mine ? t('你') : m.name || t('玩家');
      if (m.color) who.style.color = m.color;
      const tx = el('span', 'tx');
      tx.textContent = m.text;
      p.append(who, tx);
    }
    this.chatList.appendChild(p);
    while (this.chatList.childElementCount > 80) this.chatList.firstElementChild.remove();
    this.chatList.scrollTop = this.chatList.scrollHeight;
    if (!m.mine && !m.note && !this.chatShown()) {
      this.chatUnread = (this.chatUnread || 0) + 1;
      // on a phone the panel is folded away: show the line briefly
      if (this.logEl.classList.contains('collapsed')) this.toast(m.name || t('玩家'), m.text, 'chat', 3200);
    }
    this.paintUnread();
  }

  // ── the turn clock (online games) ──
  setClock(deadline, mine) {
    this.clockAt = deadline || 0;
    this.clockMine = !!mine;
    this.paintClock();
  }

  paintClock() {
    const c = this.top.querySelector('.turn-clock');
    if (!this.clockAt) {
      c.hidden = true;
      return;
    }
    const left = Math.max(0, this.clockAt - Date.now());
    const s = Math.ceil(left / 1000);
    c.hidden = false;
    c.querySelector('b').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    c.classList.toggle('mine', this.clockMine);
    c.classList.toggle('low', s <= 20);
    c.title = this.clockMine ? t('你這一步剩下的時間，時間到會自動完成這一步') : t('這一步剩下的時間');
  }

  // a new HUD for the same game (this page became the host, or stopped being it): keep what was said
  adopt(old) {
    if (!old) return;
    while (old.logBody.firstChild) this.logBody.appendChild(old.logBody.firstChild);
    while (old.chatList.firstChild) this.chatList.appendChild(old.chatList.firstChild);
    this.logBody.scrollTop = this.logBody.scrollHeight;
    this.chatUnread = old.chatUnread || 0;
    if (old.logEl.classList.contains('collapsed')) this.logEl.classList.add('collapsed');
    else this.logEl.classList.remove('collapsed');
    if (old.chatShown && old.chatShown() && !this.chatTab.hidden) this.showTab('chat');
    this.paintUnread();
  }

  // ── log & toasts ──
  log(html, { hl = false, sep = false } = {}) {
    if (!html) return;
    const p = el('p', (hl ? 'hl' : '') + (sep ? ' sep' : ''), html);
    if (sep) p.style.marginTop = '4px';
    this.logBody.appendChild(p);
    this.logCount++;
    while (this.logBody.childElementCount > 120) this.logBody.firstElementChild.remove();
    this.logBody.scrollTop = this.logBody.scrollHeight;
  }

  clearLog() {
    this.logBody.innerHTML = '';
  }

  toast(title, text, ic = 'vp', ms = 3800) {
    const t = el('div', 'toast');
    t.innerHTML = `<div class="ti">${icon(ic, 20)}</div><h4>${esc(title)}</h4><p>${esc(text)}</p>`;
    this.toastBox.appendChild(t);
    while (this.toastBox.childElementCount > 3) this.toastBox.firstElementChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 450);
    }, ms);
  }

  showTip(html, x, y) {
    if (!html) {
      this.tip.hidden = true;
      return;
    }
    this.tip.innerHTML = html;
    // (it comes in with a quick fade, not when it only moves or changes)
    if (this.tip.hidden && this.tip.animate) this.tip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    const nx = Math.min(window.innerWidth - w - 8, x + 16);
    const ny = Math.min(window.innerHeight - h - 8, y + 18);
    this.tip.style.left = Math.max(8, nx) + 'px';
    this.tip.style.top = Math.max(8, ny) + 'px';
  }

  // ── minimap ──
  // the part of the world the minimap shows (the whole map with a margin), k pixels per world unit
  miniFrame() {
    const c = this.miniCanvas;
    const b = GEO.bounds;
    const x0 = b.minX - 16.7;
    const x1 = b.maxX + 16.7;
    const z0 = b.minZ - 9;
    const z1 = b.maxZ + 9;
    return { W: c.width, H: c.height, k: Math.min(c.width / (x1 - x0), c.height / (z1 - z0)), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  }

  drawMinimap(view, players, viewport) {
    const c = this.miniCanvas;
    if (!this.miniShown) return;
    const g = c.getContext('2d');
    const { W, H, k, cx, cz } = this.miniFrame();
    const sx = (x) => W / 2 + (x - cx) * k;
    const sz = (z) => H / 2 + (z - cz) * k;
    const atlas = document.documentElement.classList.contains('ui3');
    if (atlas) g.clearRect(0, 0, W, H);
    else {
      g.fillStyle = '#244258';
      g.fillRect(0, 0, W, H);
    }
    const s = 10 * k;
    for (const h of GEO.hexes) {
      const Hx = view.board.hexes[h.id];
      if (Hx.terrain === 'sea') continue;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i + 30);
        const x = sx(h.x) + Math.cos(a) * s;
        const y = sz(h.z) + Math.sin(a) * s;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = (atlas ? TERRAIN_WASH : TERRAIN_HEX)[Hx.terrain] || '#8a8a7a';
      g.fill();
      g.strokeStyle = atlas ? 'rgba(58,36,20,0.7)' : 'rgba(20,16,10,0.55)';
      g.lineWidth = 1;
      g.stroke();
      if (view.board.robber === h.id) {
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(sx(h.x), sz(h.z), 5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.lineCap = 'round';
    view.edges.forEach((p, e) => {
      if (p < 0) return;
      const ge = GEO.edges[e];
      const A = GEO.vertices[ge.v[0]];
      const B = GEO.vertices[ge.v[1]];
      g.strokeStyle = '#1a140c';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(sx(A.x), sz(A.z));
      g.lineTo(sx(B.x), sz(B.z));
      g.stroke();
      g.strokeStyle = players[p].color;
      g.lineWidth = 3;
      g.stroke();
    });
    // (Seafarers) ships as short dashes, the pirate as a black flag
    if (view.ships) {
      g.setLineDash([3, 3]);
      view.ships.forEach((p, e) => {
        if (p < 0) return;
        const ge = GEO.edges[e];
        const A = GEO.vertices[ge.v[0]];
        const B = GEO.vertices[ge.v[1]];
        g.strokeStyle = players[p].color;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(sx(A.x), sz(A.z));
        g.lineTo(sx(B.x), sz(B.z));
        g.stroke();
      });
      g.setLineDash([]);
      const ph = view.board.pirate;
      if (ph != null && ph >= 0) {
        const h = GEO.hexes[ph];
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(sx(h.x), sz(h.z), 6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#e8d9b0';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    view.vertices.forEach((b, vid) => {
      if (!b) return;
      const V = GEO.vertices[vid];
      g.fillStyle = players[b.p].color;
      g.strokeStyle = '#1a140c';
      g.lineWidth = 1.5;
      const r = b.t === 'c' ? 7 : 5;
      g.fillRect(sx(V.x) - r, sz(V.z) - r, r * 2, r * 2);
      g.strokeRect(sx(V.x) - r, sz(V.z) - r, r * 2, r * 2);
    });
    if (viewport && viewport.every(Boolean)) {
      g.strokeStyle = atlas ? 'rgba(142,36,22,0.9)' : 'rgba(255,248,225,0.95)';
      g.lineWidth = 2;
      g.beginPath();
      viewport.forEach((p, i) => (i ? g.lineTo(sx(p.x), sz(p.z)) : g.moveTo(sx(p.x), sz(p.z))));
      g.closePath();
      g.stroke();
    }
  }
}
