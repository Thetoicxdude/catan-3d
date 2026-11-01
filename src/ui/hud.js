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
} from '../engine/engine.js';
import { resCard, icon, dieFace, RES_NAMES, RES_EN } from './icons.js';
import { Fx } from './fx.js';
import { sfx } from './sfx.js';
import { flagURL } from './flags.js';
import { esc, cardsText } from './text.js';

const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
const RES_HEX = { wood: '#2f6b2f', brick: '#b5532c', wool: '#8fcf4f', grain: '#e8c547', ore: '#8d8d96' };
// what the build buttons build; their cost shows over the button on hover (long press on touch)
const BUILD = {
  road: { name: '道路', en: 'Road', fx: '連接你的村莊與城市。連續最長、至少 5 條的道路得 2 分。', cost: COSTS.road, piece: 'roads', unit: '條' },
  settlement: { name: '村莊', en: 'Settlement', fx: '+1 勝利分數。相鄰地形擲出點數時產出 1 張資源。', cost: COSTS.settlement, piece: 'settlements', unit: '座' },
  city: { name: '城市', en: 'City', fx: '由村莊升級：再 +1 勝利分數，產出加倍。', cost: COSTS.city, piece: 'cities', unit: '座' },
  dev: { name: '發展卡', en: 'Development', fx: '抽 1 張：騎士、道路建設、豐收之年、壟斷或分數卡。', cost: COSTS.dev },
  ship: { name: '船', en: 'Ship', fx: '在海上或海岸邊，接在你的船或海邊的村莊、城市旁。船隊能把村莊送到別的島。', cost: COSTS.ship, piece: 'ships', unit: '艘' },
};
const TERRAIN_HEX = { forest: '#2f6b2f', hills: '#b5532c', pasture: '#8fcf4f', fields: '#e8c547', mountains: '#8d8d96', desert: '#d9c48e', gold: '#f0b62a', fog: '#7d8790' };

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export class Hud {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
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
      c.title = `銀行：${RES_NAMES[res]} 剩 ${n} 張`;
    }
    const d = this.bankCards.dev;
    d.querySelector('.cnt').textContent = this.bankShown.dev;
    d.classList.toggle('zero', this.bankShown.dev === 0);
    d.title = `發展卡堆：剩 ${this.bankShown.dev} 張`;
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
        <div class="stat cards" title="手牌總數">${icon('cards', 18)}<span class="n num">0</span></div>
        <div class="stat devs" title="發展卡">${icon('dev', 18)}<span class="n num">0</span></div>
        <div class="stat knights" title="已打出的騎士">${icon('knight', 18)}<span class="n num">0</span></div>
        <div class="stat vp" title="勝利分數">${icon('vp', 20)}<span class="n num">0</span><small>/10</small></div>
      </div>
      <div class="tb-spacer"></div>
      <div class="tb-right">
        <div class="turn-clock" hidden role="timer" title="這一步剩下的時間">${icon('hourglass', 18)}<b class="num">0:00</b></div>
        <div class="turn-box desk-only"><div class="t1">回合</div><div class="t2"></div></div>
        <div class="dice" title="上一次擲骰"></div>
        <button class="btn ghost icon-btn mobile-only" data-k="nations" title="諸國" aria-label="諸國">${icon('people', 20)}</button>
        <button class="btn ghost icon-btn mobile-only" data-k="log" title="記錄" aria-label="記錄">${icon('log', 20)}</button>
        <button class="btn ghost icon-btn" data-k="rules" title="規則" aria-label="規則">${icon('rules', 20)}</button>
        <button class="btn ghost icon-btn" data-k="settings" title="設定" aria-label="設定">${icon('gear', 20)}</button>
        <button class="btn ghost icon-btn" data-k="menu" title="主選單" aria-label="主選單">${icon('menu', 20)}</button>
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
    this.bankEl.innerHTML = `<div class="ol-head"><span>銀行</span><small>BANK</small></div><div class="bk-row"></div>`;
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
    this.logEl.innerHTML = `<div class="log-head"><div class="log-tabs" role="tablist"><button type="button" role="tab" class="on" data-tab="log" aria-selected="true">戰報</button><button type="button" role="tab" data-tab="chat" aria-selected="false" hidden>聊天<i class="dot" hidden></i></button></div><button class="btn ghost icon-btn log-fold" type="button" aria-label="收合">−</button></div><div class="log-body" aria-live="polite"></div><div class="chat-body" hidden><div class="chat-list" aria-live="polite"></div><form class="chat-form" autocomplete="off"><input type="text" maxlength="80" placeholder="輸入訊息，按 Enter 送出" aria-label="聊天訊息" enterkeyhint="send"><button type="submit" class="btn primary">送出</button></form></div>`;
    if (window.innerWidth <= 900) this.logEl.classList.add('collapsed');
    this.logBody = this.logEl.querySelector('.log-body');
    this.chatBody = this.logEl.querySelector('.chat-body');
    this.chatList = this.logEl.querySelector('.chat-list');
    this.chatTab = this.logEl.querySelector('[data-tab="chat"]');
    this.logEl.querySelector('.log-fold').addEventListener('click', () => this.logEl.classList.toggle('collapsed'));
    this.logEl.querySelectorAll('.log-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    r.appendChild(this.logEl);

    // action bar
    this.bar = el('nav', 'actionbar panel');
    const acts = [
      ['roll', 'dice', '擲骰', 'R'],
      ['sep'],
      ['road', 'road', '道路', '1', COSTS.road],
      ['settlement', 'settlement', '村莊', '2', COSTS.settlement],
      ['city', 'city', '城市', '3', COSTS.city],
      ['dev', 'devbuy', '發展卡', '4', COSTS.dev],
      // (Seafarers; shown only on maps with the sea)
      ['ship', 'ship', '船', '5', COSTS.ship],
      ['moveShip', 'moveShip', '移船', '6'],
      ['sep'],
      ['trade', 'trade', '交易', 'T'],
      ['cards', 'cards', '手中卡牌', 'C'],
      ['sep'],
      ['end', 'end', '結束回合', '␣'],
    ];
    this.btns = {};
    for (const a of acts) {
      if (a[0] === 'sep') {
        this.bar.appendChild(el('div', 'act-sep'));
        continue;
      }
      const [k, ic, label, key, cost] = a;
      const b = el('button', 'act');
      b.type = 'button';
      b.innerHTML = `<span class="key">${key}</span>${icon(ic, 28)}<span class="lbl">${label}</span>`;
      if (cost) b.setAttribute('aria-label', `${label}（${Object.entries(cost).map(([res, n]) => RES_NAMES[res] + (n > 1 ? '×' + n : '')).join('＋')}）`);
      // unavailable actions stay clickable so they can explain why they are unavailable
      b.addEventListener('click', () => {
        if (b.classList.contains('off')) this.flashHint(b.dataset.why || '現在不能這樣做');
        else this.h.button(k);
      });
      this.bar.appendChild(b);
      this.btns[k] = b;
      if (cost) this.costPop(b, k);
    }
    r.appendChild(this.bar);
    this.hint = el('div', 'nexthint');
    this.hint.hidden = true;
    this.hint.setAttribute('role', 'status');
    r.appendChild(this.hint);

    // minimap + map modes (the camera turns and tilts with the mouse and keys: right-drag, Q/E, Z/X, Home)
    this.mini = el('div', 'minimap panel');
    this.mini.innerHTML = `<canvas width="368" height="300" aria-label="小地圖"></canvas><div class="mapmodes"></div>`;
    this.miniCanvas = this.mini.querySelector('canvas');
    this.miniCanvas.addEventListener('click', (e) => {
      const rr = this.miniCanvas.getBoundingClientRect();
      const f = this.miniFrame();
      const x = f.cx + (((e.clientX - rr.left) / rr.width) * f.W - f.W / 2) / f.k;
      const z = f.cz + (((e.clientY - rr.top) / rr.height) * f.H - f.H / 2) / f.k;
      this.h.focus(x, z);
    });
    const modes = this.mini.querySelector('.mapmodes');
    this.modeBtns = {};
    for (const [k, ic, t] of [
      ['terrain', 'terrain', '地形（M）'],
      ['political', 'political', '政治：國家領土'],
      ['production', 'production', '產量：擲出機率'],
      ['resource', 'resources', '資源種類'],
    ]) {
      const b = el('button', k === 'terrain' ? 'on' : '');
      b.type = 'button';
      b.title = t;
      b.setAttribute('aria-label', t);
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
    this.netChip.innerHTML = `<i></i><span class="tx">線上 · </span>${esc(String(net.code || '').toUpperCase())}<span class="tx">${n ? ` · ${n} 人` : ''}</span>`;
    this.netChip.title = net.role === 'host' ? '你是主持人：規則判定與電腦玩家都在你的頁面上運行' : '已連線到主持人';
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
    if (v.phase === 'setup') sub.innerHTML = '開局佈置';
    else if (v.phase === 'over') sub.innerHTML = '戰役結束';
    else if (v.sub) {
      // 5–6 players: the part of the turn after the main player's
      const who = v.current === me ? '<b>你</b>' : esc(players[v.current].name);
      sub.innerHTML = v.sub.k === 'pair' ? `${who}（第二位）` : `特別建造：${who}`;
    } else sub.innerHTML = v.current === me ? '<b>你的回合</b>' : `${esc(players[v.current].name)} 的回合`;

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
        c.setAttribute('aria-label', `${RES_NAMES[res]} ${disp} 張`);
        c.title = `${RES_NAMES[res]}：${n} 張 · 產量 ${rates[res]}/36（每次擲骰平均 ${(rates[res] / 36).toFixed(2)} 張）· 銀行剩 ${v.bank[res]}`;
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
      const vp = publicVP(v, me) + viewer.dev.filter((c) => c.type === 'victoryPoint').length;
      this.top.querySelector('.stat.vp .n').textContent = vp;
      this.top.querySelector('.stat.vp small').textContent = '/' + v.targetVP;
    }
    this.top.querySelector('.turn-box .t2').textContent = v.phase === 'setup' ? '開局' : `第 ${v.turn} 回合`;

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
        const kind = P.away ? '電腦代管' : P.kind === 'ai' ? `電腦·${{ easy: '簡單', normal: '普通', hard: '困難' }[P.ai.level] || '普通'}` : isMe ? '你' : P.kind === 'remote' ? '線上玩家' : ctx.online ? '主持人' : '玩家';
        const badges = [];
        if (v.longestRoad === p.id) badges.push(v.ships ? `<span class="badge" title="最長貿易路線（道路與船）+2">${icon('road2', 12)}貿易路線</span>` : `<span class="badge" title="最長道路 +2">${icon('road2', 12)}最長道路</span>`);
        if (p.chits) badges.push(`<span class="badge" title="新島嶼的第一座村莊 +${GEO.def.isleBonus || 2}">${icon('isle', 12)}島嶼 +${p.chits}</span>`);
        if (v.largestArmy === p.id) badges.push(`<span class="badge" title="最大騎士團 +2">${icon('knight', 12)}騎士團</span>`);
        const thinking = ctx.thinking === p.id ? `<span class="thinking"><span class="spinner"></span>思考中</span>` : '';
        const lead = v.sub && v.sub.lead === p.id && v.phase !== 'over';
        return `<div class="nation${v.current === p.id && v.phase !== 'over' ? ' current' : ''}${lead ? ' lead' : ''}" data-p="${p.id}">
          <img class="flag" alt="" src="${flagURL(P.color, p.id)}">
          <div class="nm" style="color:${P.color}">${esc(P.name)}<em>${kind}</em></div>
          <div class="vp" title="${isMe ? '你的分數（含分數卡）' : '公開分數'}"><b class="num">${vp}</b><span>分</span></div>
          <div class="meta">
            <span title="手牌">${icon('cards', 14)}<b>${p.resCount}</b></span>
            <span title="發展卡">${icon('dev', 14)}<b>${p.devCount}</b></span>
            <span title="打出的騎士">${icon('knight', 14)}<b>${p.knights}</b></span>
            <span title="最長道路長度">${icon('road2', 14)}<b>${v.roadLen[p.id]}</b></span>
            ${badges.join('')}
          </div>${thinking}
        </div>`;
      })
      .join('');
    this.olBody.innerHTML = `<div class="ol-head"><span>諸國</span></div>${rows}`;
    // five or six nations: tighter rows (and the list scrolls when the screen is short)
    this.outliner.classList.toggle('many', v.players.length > 4);
    this.bankShown = { ...v.bank, dev: v.devDeckCount };
    this.paintBank();
  }

  renderActions(ctx) {
    const { view: v, me } = ctx;
    const pl = me >= 0 ? v.players[me] : null;
    const myTurn = pl && v.phase === 'play' && v.current === me && !ctx.locked;
    const free = myTurn && !v.pending && !v.trade;
    const set = (k, enabled, title, extra = {}) => {
      const b = this.btns[k];
      b.classList.toggle('off', !enabled);
      b.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      b.dataset.why = enabled ? '' : title || '現在不能這樣做';
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
      if (!pd) return v.trade && v.trade.from !== me ? '請先回覆交易提議' : '';
      if (pd.type === 'discard') return pd.amounts[me] !== undefined ? `請先棄掉 ${pd.amounts[me]} 張牌` : '等待其他國家棄牌';
      if (pd.type === 'robber') return v.current === me ? '請先移動強盜：點選地圖上有白色圓圈的地形' : '等待對手移動強盜';
      if (pd.type === 'steal') return '請先選擇要搶奪的國家';
      if (pd.type === 'roadBuilding') return '請先放置免費道路（或按上方的「不用了」）';
      return '請先完成目前的動作';
    };
    const turnWhy = () => (!pl ? '你正在觀戰' : v.phase === 'setup' ? '開局佈置中' : v.phase === 'over' ? '遊戲已結束' : ctx.locked ? '正在等待回應' : '還沒輪到你');
    set('roll', free && !v.rolled, needRoll ? '擲骰（R）' : !myTurn ? turnWhy() : v.pending || v.trade ? pendingWhy() : '本回合已經擲過骰子', { primary: needRoll, glow: needRoll && !ctx.mode });
    const why = (cost, legalCount, pieces, label) => {
      if (!myTurn) return turnWhy();
      if (v.pending || v.trade) return pendingWhy() || '請先完成目前的動作';
      if (!v.rolled) return '請先擲骰';
      if (pieces === 0) return `${label}已經用完了`;
      if (!canAfford(pl.res, cost)) return '資源不足：還缺 ' + cardsText(missingFor(pl.res, cost).missing);
      if (legalCount === 0) return '目前沒有可以建造的位置';
      return '';
    };
    const roads = free && v.rolled ? legalRoadEdges(v, me).length : 0;
    const setts = free && v.rolled ? legalSettlementSpots(v, me).length : 0;
    const cities = free && v.rolled ? legalCitySpots(v, me).length : 0;
    const okRoad = free && v.rolled && pl.pieces.roads > 0 && canAfford(pl.res, COSTS.road) && roads > 0;
    const okSet = free && v.rolled && pl.pieces.settlements > 0 && canAfford(pl.res, COSTS.settlement) && setts > 0;
    const okCity = free && v.rolled && pl.pieces.cities > 0 && canAfford(pl.res, COSTS.city) && cities > 0;
    const okDev = free && v.rolled && canAfford(pl.res, COSTS.dev) && v.devDeckCount > 0;
    set('road', okRoad, okRoad ? '建造道路（1）：木材＋磚塊' : why(COSTS.road, roads, pl ? pl.pieces.roads : 1, '道路'), { on: ctx.mode === 'road' });
    set('settlement', okSet, okSet ? '建造村莊（2）：木材＋磚塊＋羊毛＋小麥' : why(COSTS.settlement, setts, pl ? pl.pieces.settlements : 1, '村莊'), { on: ctx.mode === 'settlement' });
    set('city', okCity, okCity ? '升級城市（3）：小麥×2＋礦石×3' : why(COSTS.city, cities, pl ? pl.pieces.cities : 1, '城市'), { on: ctx.mode === 'city' });
    set('dev', okDev, okDev ? '購買發展卡（4）：羊毛＋小麥＋礦石' : v.devDeckCount === 0 ? '發展卡已賣完' : why(COSTS.dev, 1, 1, '發展卡'));
    // (Seafarers) build a ship, move one
    const seafaring = !!v.ships;
    this.btns.ship.hidden = !seafaring;
    this.btns.moveShip.hidden = !seafaring;
    if (seafaring) {
      const ships = free && v.rolled ? legalShips(v, me).length : 0;
      const okShip = free && v.rolled && pl.pieces.ships > 0 && canAfford(pl.res, COSTS.ship) && ships > 0;
      set('ship', okShip, okShip ? '建造船（5）：木材＋羊毛' : why(COSTS.ship, ships, pl ? pl.pieces.ships : 1, '船'), { on: ctx.mode === 'ship' });
      const movable = free && v.rolled && !v.shipMoved && !(v.sub && v.sub.k === 'sbp') ? movableShips(v, me).filter((e) => shipTargets(v, me, e).length).length : 0;
      set('moveShip', movable > 0, movable ? '移動一艘船（6）：航線末端、之前回合建造的船，每回合一次' : !myTurn ? turnWhy() : v.pending || v.trade ? pendingWhy() : !v.rolled ? '請先擲骰' : v.shipMoved ? '這回合已經移過船了' : '沒有可以移動的船（只能移動航線末端、之前回合建造、不在海盜旁的船）', { on: ctx.mode === 'moveShip' || ctx.mode === 'moveShipTo' });
    }
    // 5–6 players: the special building phase allows no trading at all; the second player of a paired
    // turn trades with the bank only (the trade dialog shows just that)
    const sbp = !!v.sub && v.sub.k === 'sbp';
    const canTrade = myTurn && v.rolled && !v.pending && !sbp;
    set('trade', canTrade, canTrade ? (v.sub ? '海上貿易（T）：第二位只能和銀行交易' : '交易（T）') : !myTurn ? turnWhy() : v.pending ? pendingWhy() : sbp ? '特別建造階段不能交易' : '擲骰後才能交易', { on: !!(v.trade && v.trade.from === me) });
    const playable = pl ? playableDev(v, me).length : 0;
    set('cards', !!pl, '手中的發展卡（C）', { count: pl && pl.dev && pl.dev.length ? pl.dev.length : null, on: playable > 0 && myTurn });
    const canEnd = myTurn && v.rolled && !v.pending;
    set('end', canEnd, canEnd ? (v.sub ? '結束（Space）' : '結束回合（Space）') : !myTurn ? turnWhy() : v.pending ? pendingWhy() : '請先擲骰');
    this.bar.style.visibility = v.phase === 'over' ? 'hidden' : '';
    this.popCtx = { res: pl ? pl.res : null, pieces: pl ? pl.pieces : null, deck: v.devDeckCount };
    if (this.popFor) this.renderPop();
  }

  // the cost card of a build button: on hover or keyboard focus, or a long press on a touch screen
  costPop(b, k) {
    let timer = null;
    let pressed = false;
    const show = () => {
      this.popFor = k;
      this.renderPop();
    };
    const hide = () => {
      if (this.popFor !== k) return;
      this.popFor = null;
      this.renderPop();
    };
    b.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && show());
    b.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && hide());
    b.addEventListener('focus', () => b.matches(':focus-visible') && show());
    b.addEventListener('blur', hide);
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pressed = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        pressed = true;
        show();
      }, 420);
    });
    const release = (e) => {
      if (e.pointerType !== 'touch') return;
      clearTimeout(timer);
      if (pressed) setTimeout(hide, 1800);
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    // a long press only shows the cost; it doesn't also build
    b.addEventListener(
      'click',
      (e) => {
        if (!pressed) return;
        pressed = false;
        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  renderPop() {
    if (this.pop) {
      this.pop.remove();
      this.pop = null;
    }
    const k = this.popFor;
    const info = BUILD[k];
    this.bar.classList.toggle('popping', !!(info && this.popCtx));
    if (!info || !this.popCtx) return;
    const { res, pieces, deck } = this.popCtx;
    const needs = Object.entries(info.cost)
      .map(([r, n]) => {
        const have = res ? res[r] : null;
        const short = have != null && have < n;
        return `<div class="need${short ? ' short' : ''}">${resCard(r, { count: n > 1 ? '×' + n : null })}<small>${have != null ? `持有 ${have}` : ''}</small></div>`;
      })
      .join('');
    const b = this.btns[k];
    const why = b.dataset.why;
    const left = info.piece && pieces ? `還剩 ${pieces[info.piece]} ${info.unit}` : k === 'dev' && deck != null ? `卡堆剩 ${deck} 張` : '';
    const ok = `可以${k === 'dev' ? '購買' : k === 'city' ? '升級' : '建造'}${left ? '・' + left : ''}`;
    const pop = el('div', 'cost-pop');
    pop.setAttribute('role', 'tooltip');
    pop.innerHTML = `<div class="hd"><b>${info.name}</b><i>${info.en}</i></div><div class="fx">${info.fx}</div><div class="row">${needs}</div><div class="st${why ? ' bad' : ''}">${why ? esc(why) : ok}</div>`;
    this.bar.appendChild(pop);
    this.pop = pop;
    if (getComputedStyle(pop).position !== 'fixed') {
      // above the button, kept inside the window
      pop.style.left = b.offsetLeft + b.offsetWidth / 2 + 'px';
      const r = pop.getBoundingClientRect();
      const shift = Math.max(0, 8 - r.left) - Math.max(0, r.right - (window.innerWidth - 8));
      if (shift) pop.style.left = b.offsetLeft + b.offsetWidth / 2 + shift + 'px';
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
      else if (why === 'fast') this.flashHint('訊息送得太快了，請稍等一下');
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
      who.textContent = m.mine ? '你' : m.name || '玩家';
      if (m.color) who.style.color = m.color;
      const t = el('span', 'tx');
      t.textContent = m.text;
      p.append(who, t);
    }
    this.chatList.appendChild(p);
    while (this.chatList.childElementCount > 80) this.chatList.firstElementChild.remove();
    this.chatList.scrollTop = this.chatList.scrollHeight;
    if (!m.mine && !m.note && !this.chatShown()) {
      this.chatUnread = (this.chatUnread || 0) + 1;
      // on a phone the panel is folded away: show the line briefly
      if (this.logEl.classList.contains('collapsed')) this.toast(m.name || '玩家', m.text, 'chat', 3200);
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
    c.title = this.clockMine ? '你這一步剩下的時間，時間到會自動完成這一步' : '這一步剩下的時間';
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
    if (!c.offsetParent) return;
    const g = c.getContext('2d');
    const { W, H, k, cx, cz } = this.miniFrame();
    const sx = (x) => W / 2 + (x - cx) * k;
    const sz = (z) => H / 2 + (z - cz) * k;
    g.fillStyle = '#244258';
    g.fillRect(0, 0, W, H);
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
      g.fillStyle = TERRAIN_HEX[Hx.terrain] || '#8a8a7a';
      g.fill();
      g.strokeStyle = 'rgba(20,16,10,0.55)';
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
      g.strokeStyle = 'rgba(255,248,225,0.95)';
      g.lineWidth = 2;
      g.beginPath();
      viewport.forEach((p, i) => (i ? g.lineTo(sx(p.x), sz(p.z)) : g.moveTo(sx(p.x), sz(p.z))));
      g.closePath();
      g.stroke();
    }
  }
}
