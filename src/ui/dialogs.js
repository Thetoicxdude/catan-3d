// Modal dialogs: discard, steal, trade (bank & players), incoming offers, development cards,
// Year of Plenty / Monopoly pickers, game over, rules and settings.
import { RES, tradeRatios, playableDev, handSize, publicVP, legalRoadEdges } from '../engine/engine.js';
import { resIcon, resCard, devCard, icon, RES_NAMES } from './icons.js';
import { flagURL } from './flags.js';
import { esc, cardsHtml, DEV_INFO, rulesHtml } from './text.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function button(label, cls, onClick) {
  const b = el('button', 'btn ' + (cls || ''), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
const emptyRes = () => ({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
const total = (m) => RES.reduce((s, r) => s + (m[r] || 0), 0);

export class Dialogs {
  constructor(layer) {
    this.layer = layer;
    this.cur = null;
    this.layer.hidden = true;
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.target === this.layer && this.cur && this.cur.dismissable) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.cur && this.cur.dismissable) {
        e.stopPropagation();
        this.close();
      }
    });
  }

  get kind() {
    return this.cur ? this.cur.kind : null;
  }

  open({ kind, title, cls = '', body, foot = [], dismissable = true, clear = false, onClose = null, refresh = null, headExtra = '' }) {
    this.close(true);
    const m = el('div', 'modal panel ' + cls);
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', title);
    const head = el('div', 'modal-head', `<h3>${esc(title)}</h3>${headExtra}`);
    if (dismissable) {
      const x = button(icon('cross', 16), 'ghost icon-btn', () => this.close());
      x.setAttribute('aria-label', '關閉');
      head.appendChild(x);
    }
    m.appendChild(head);
    const b = el('div', 'modal-body');
    if (typeof body === 'string') b.innerHTML = body;
    else if (body) b.appendChild(body);
    m.appendChild(b);
    const f = el('div', 'modal-foot');
    for (const x of foot) f.appendChild(x);
    if (foot.length) m.appendChild(f);
    this.layer.innerHTML = '';
    this.layer.appendChild(m);
    this.layer.hidden = false;
    this.layer.classList.toggle('clear', clear);
    this.cur = { kind, el: m, body: b, foot: f, dismissable, onClose, refresh };
    const first = m.querySelector('.modal-foot .btn.primary') || m.querySelector('.modal-body button:not(:disabled)');
    if (first && window.innerWidth > 760) setTimeout(() => first.focus({ preventScroll: true }), 30);
    return this.cur;
  }

  close(silent = false) {
    if (!this.cur) return;
    const c = this.cur;
    this.cur = null;
    this.layer.innerHTML = '';
    this.layer.hidden = true;
    if (c.timer) clearInterval(c.timer);
    if (!silent && c.onClose) c.onClose();
  }

  refresh(ctx) {
    if (this.cur && this.cur.refresh) this.cur.refresh(ctx);
  }

  // ── discard ──
  discard(ctx, amount, onConfirm) {
    const pl = ctx.view.players[ctx.me];
    const sel = emptyRes();
    const body = el('div');
    body.innerHTML = `<p class="lead">擲出 7！你手上有 <b>${handSize(pl.res)}</b> 張牌，必須棄掉 <b>${amount}</b> 張（交回銀行）。</p><div class="res-grid"></div>`;
    const grid = body.querySelector('.res-grid');
    const confirm = button('確認棄牌', 'primary', () => onConfirm({ ...sel }));
    const auto = button('自動挑選', '', () => {
      Object.assign(sel, emptyRes());
      const h = { ...pl.res };
      for (let i = 0; i < amount; i++) {
        const r = RES.slice().sort((a, b) => h[b] - h[a])[0];
        h[r]--;
        sel[r]++;
      }
      draw();
    });
    const draw = () => {
      grid.innerHTML = '';
      for (const r of RES) {
        const c = el('div', 'res-pick');
        c.innerHTML = `${resCard(r)}<span class="sub">持有 ${pl.res[r]}</span>`;
        const st = el('div', 'stepper');
        const minus = button('−', '', () => {
          sel[r]--;
          draw();
        });
        minus.className = '';
        minus.disabled = sel[r] <= 0;
        const plus = button('+', '', () => {
          sel[r]++;
          draw();
        });
        plus.className = '';
        plus.disabled = sel[r] >= pl.res[r] || total(sel) >= amount;
        st.append(minus, el('span', 'v', String(sel[r])), plus);
        c.appendChild(st);
        grid.appendChild(c);
      }
      confirm.disabled = total(sel) !== amount;
      confirm.textContent = `確認棄牌（${total(sel)}/${amount}）`;
    };
    draw();
    return this.open({ kind: 'discard', title: '強盜出沒：棄牌', body, foot: [auto, confirm], dismissable: false, cls: 'narrow' });
  }

  // ── steal ──
  steal(ctx, victims, onPick) {
    const body = el('div');
    body.innerHTML = `<p class="lead">強盜所在地形旁有多個國家，選擇要搶奪的對象（隨機抽走 1 張牌）。</p>`;
    const list = el('div', 'resp-list');
    for (const q of victims) {
      const P = ctx.players[q];
      const p = ctx.view.players[q];
      const row = el('div', 'resp');
      row.innerHTML = `<img class="flag sm" alt="" src="${flagURL(P.color, q)}"><b style="color:${P.color}">${esc(P.name)}</b><span class="st">${icon('cards', 14)} ${p.resCount} 張 · ${publicVP(ctx.view, q)} 分</span>`;
      row.appendChild(button('搶奪', 'primary', () => onPick(q)));
      list.appendChild(row);
    }
    body.appendChild(list);
    return this.open({ kind: 'steal', title: '選擇搶奪對象', body, dismissable: false, cls: 'narrow' });
  }

  // ── trade ──
  trade(ctx, act, startTab = 'bank') {
    let tab = ctx.view.trade && ctx.view.trade.from === ctx.me ? 'players' : startTab;
    let give = null;
    let get = null;
    const offerGive = emptyRes();
    const offerGet = emptyRes();
    let last = ctx;
    const body = el('div');
    const render = (c) => {
      last = c;
      const v = c.view;
      const me = c.me;
      const pl = v.players[me];
      const ratios = tradeRatios(v, me);
      body.innerHTML = '';
      const tabs = el('div', 'tabs');
      for (const [k, label] of [
        ['bank', '海上貿易'],
        ['players', '與其他國家交易'],
      ]) {
        const b = el('button', tab === k ? 'on' : '', label);
        b.type = 'button';
        b.addEventListener('click', () => {
          tab = k;
          render(last);
        });
        tabs.appendChild(b);
      }
      body.appendChild(tabs);
      if (tab === 'bank') {
        body.appendChild(el('p', 'lead', '用多張相同資源向銀行換 1 張。基本 4:1；擁有港口村莊時可用 3:1 或指定資源 2:1。'));
        body.appendChild(el('div', 'row-label', '交出'));
        const g1 = el('div', 'res-grid');
        for (const r of RES) {
          const b = el('button', 'res-pick' + (give === r ? ' on' : ''));
          b.type = 'button';
          b.innerHTML = `${resCard(r)}<span class="big">${ratios[r]}:1</span><span class="sub">持有 ${pl.res[r]}</span>`;
          b.disabled = pl.res[r] < ratios[r];
          b.addEventListener('click', () => {
            give = r;
            if (get === r) get = null;
            render(last);
          });
          g1.appendChild(b);
        }
        body.appendChild(g1);
        body.appendChild(el('div', 'row-label', '換得 1 張'));
        const g2 = el('div', 'res-grid');
        for (const r of RES) {
          const b = el('button', 'res-pick' + (get === r ? ' on' : ''));
          b.type = 'button';
          b.innerHTML = `${resCard(r)}<span class="sub">銀行 ${v.bank[r]}</span>`;
          b.disabled = v.bank[r] <= 0 || r === give;
          b.addEventListener('click', () => {
            get = r;
            render(last);
          });
          g2.appendChild(b);
        }
        body.appendChild(g2);
        const row = el('div', 'menu-actions');
        row.style.marginTop = '14px';
        const ok = button(give && get ? `交易：${ratios[give]} ${RES_NAMES[give]} → 1 ${RES_NAMES[get]}` : '選擇要交出與換得的資源', 'primary', () => {
          if (act({ type: 'bankTrade', p: me, give, get })) {
            if (pl.res[give] - ratios[give] < ratios[give]) give = null;
          }
        });
        ok.disabled = !(give && get && pl.res[give] >= ratios[give] && v.bank[get] > 0);
        row.appendChild(ok);
        body.appendChild(row);
      } else {
        const t = v.trade;
        if (t && t.from === me) {
          body.appendChild(el('p', 'lead', '提議已送出，等待各國回覆。可與任何一個接受的國家成交。'));
          const line = el('div', 'offer-line', `你給出 ${cardsHtml(t.give, 18)} <span style="color:var(--ink-faint)">⇄</span> 換取 ${cardsHtml(t.get, 18)}`);
          body.appendChild(line);
          const list = el('div', 'resp-list');
          for (const q of Object.keys(t.resp).map(Number)) {
            const P = c.players[q];
            const st = t.resp[q];
            const row = el('div', 'resp');
            row.innerHTML = `<img class="flag sm" alt="" src="${flagURL(P.color, q)}"><b style="color:${P.color}">${esc(P.name)}</b>`;
            const s = el(
              'span',
              'st ' + (st === 'yes' ? 'yes' : st === 'no' || st === 'lack' ? 'no' : ''),
              st === 'yes' ? `${icon('check', 14)}願意` : st === 'no' ? `${icon('cross', 14)}不需要` : st === 'lack' ? `${icon('cross', 14)}沒有這些資源` : `<span class="spinner"></span>考慮中`,
            );
            row.appendChild(s);
            if (st === 'yes') row.appendChild(button('成交', 'primary', () => act({ type: 'acceptOffer', p: me, with: q })));
            list.appendChild(row);
          }
          body.appendChild(list);
          const row = el('div', 'menu-actions');
          row.style.marginTop = '12px';
          row.appendChild(button('撤回提議', '', () => act({ type: 'cancelOffer', p: me })));
          body.appendChild(row);
        } else {
          body.appendChild(el('p', 'lead', '設定要給出與想得到的資源，向所有國家提出。雙方都必須至少給出 1 張牌，且不能交換相同的資源。'));
          const mk = (label, map, max) => {
            body.appendChild(el('div', 'row-label', label));
            const g = el('div', 'res-grid');
            for (const r of RES) {
              const card = el('div', 'res-pick');
              card.innerHTML = `${resCard(r)}<span class="sub">${max === null ? '　' : '持有 ' + pl.res[r]}</span>`;
              const st = el('div', 'stepper');
              const minus = el('button', '', '−');
              minus.type = 'button';
              minus.disabled = map[r] <= 0;
              minus.addEventListener('click', () => {
                map[r]--;
                render(last);
              });
              const plus = el('button', '', '+');
              plus.type = 'button';
              plus.disabled = max === null ? map[r] >= 9 : map[r] >= pl.res[r];
              plus.addEventListener('click', () => {
                map[r]++;
                const other = map === offerGive ? offerGet : offerGive;
                other[r] = 0;
                render(last);
              });
              st.append(minus, el('span', 'v', String(map[r])), plus);
              card.appendChild(st);
              g.appendChild(card);
            }
            body.appendChild(g);
          };
          mk('你給出', offerGive, 'have');
          mk('你想要', offerGet, null);
          const row = el('div', 'menu-actions');
          row.style.marginTop = '14px';
          const send = button('向所有國家提議', 'primary', () => {
            act({ type: 'offer', p: me, give: { ...offerGive }, get: { ...offerGet } });
          });
          send.disabled = !(total(offerGive) > 0 && total(offerGet) > 0);
          row.appendChild(send);
          body.appendChild(row);
        }
      }
    };
    render(ctx);
    return this.open({ kind: 'trade', title: '交易', body, refresh: render, cls: '' });
  }

  incoming(ctx, onRespond, seconds = 25) {
    const t = ctx.view.trade;
    const P = ctx.players[t.from];
    const me = ctx.me;
    const pl = ctx.view.players[me];
    const can = RES.every((r) => pl.res[r] >= (t.get[r] || 0));
    const body = el('div');
    body.innerHTML = `<p class="lead"><img class="flag sm" alt="" src="${flagURL(P.color, t.from)}" style="vertical-align:middle;margin-right:6px"><b style="color:${P.color}">${esc(P.name)}</b> 提議與你交易：</p>
      <div class="offer-line">你得到 ${cardsHtml(t.give, 20)}</div>
      <div class="offer-line" style="margin-top:6px">你給出 ${cardsHtml(t.get, 20)}</div>
      ${can ? '' : '<p class="lead" style="margin-top:10px;color:var(--danger)">你沒有足夠的資源接受這筆交易。</p>'}
      <div class="bar" style="height:3px;margin-top:12px;background:rgba(199,166,96,.2)"><i style="display:block;height:100%;width:100%;background:var(--brass);transition:width 1s linear"></i></div>`;
    const accept = button('接受', 'primary', () => onRespond(true));
    accept.disabled = !can;
    const reject = button('拒絕', '', () => onRespond(false));
    const h = this.open({ kind: 'incoming', title: '交易提議', body, foot: [reject, accept], dismissable: false, cls: 'narrow' });
    let left = seconds;
    const bar = body.querySelector('.bar i');
    h.timer = setInterval(() => {
      left--;
      bar.style.width = (left / seconds) * 100 + '%';
      if (left <= 0) {
        clearInterval(h.timer);
        onRespond(false);
      }
    }, 1000);
    return h;
  }

  // ── development cards ──
  devCards(ctx, onPlay) {
    const body = el('div');
    const render = (c) => {
      const v = c.view;
      const me = c.me;
      const pl = v.players[me];
      const playable = new Set(playableDev(v, me));
      body.innerHTML = '';
      const groups = {};
      for (const card of pl.dev) {
        groups[card.type] = groups[card.type] || { n: 0, fresh: 0 };
        groups[card.type].n++;
        if (card.turn >= v.turn) groups[card.type].fresh++;
      }
      const rule = v.devPlayed ? '本回合已使用過發展卡。' : v.current !== me ? '只能在自己的回合使用發展卡。' : '每回合可使用 1 張，可在擲骰前使用。';
      body.appendChild(el('p', 'lead', `${rule} 已打出騎士 <b>${pl.knights}</b> 位。卡堆剩 <b>${v.devDeckCount}</b> 張。`));
      if (!pl.dev.length) {
        body.appendChild(el('p', 'lead', '你目前沒有發展卡。購買發展卡需要 羊毛＋小麥＋礦石。'));
        return;
      }
      const grid = el('div', 'dev-grid');
      for (const type of ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint']) {
        const g = groups[type];
        if (!g) continue;
        const info = DEV_INFO[type];
        const card = el('div', 'dev-card' + (type !== 'victoryPoint' && !playable.has(type) ? ' dim' : ''));
        card.innerHTML = `${devCard(type, info.name, { count: '×' + g.n, lg: true })}<h4>${info.name}</h4><p>${info.desc}</p>`;
        if (type === 'victoryPoint') card.appendChild(el('div', 'note', '已自動計入你的分數'));
        else {
          const b = button('使用', 'primary', () => onPlay(type));
          b.disabled = !playable.has(type);
          if (g.fresh === g.n && v.current === me) b.title = '本回合買的卡要下回合才能使用';
          card.appendChild(b);
          if (g.fresh) card.appendChild(el('div', 'note', `其中 ${g.fresh} 張為本回合購買`));
        }
        grid.appendChild(card);
      }
      body.appendChild(grid);
    };
    render(ctx);
    return this.open({ kind: 'dev', title: '發展卡', body, refresh: render, cls: 'wide' });
  }

  pickResources(ctx, count, title, lead, onConfirm) {
    const sel = [];
    const body = el('div');
    const confirm = button('確認', 'primary', () => onConfirm(sel.slice()));
    const render = () => {
      body.innerHTML = `<p class="lead">${lead}</p>`;
      const g = el('div', 'res-grid');
      for (const r of RES) {
        const n = sel.filter((x) => x === r).length;
        const b = el('button', 'res-pick' + (n ? ' on' : ''));
        b.type = 'button';
        const bankLeft = ctx.view.bank[r] - n;
        b.innerHTML = `${resCard(r)}<span class="sub">${count > 1 ? `已選 ${n} · 銀行 ${ctx.view.bank[r]}` : ''}</span>`;
        b.disabled = count > 1 && bankLeft <= 0 && !n;
        b.addEventListener('click', () => {
          if (count === 1) {
            sel.length = 0;
            sel.push(r);
          } else if (sel.length < count && bankLeft > 0) sel.push(r);
          else {
            const i = sel.indexOf(r);
            if (i >= 0) sel.splice(i, 1);
            else if (bankLeft > 0) {
              sel.shift();
              sel.push(r);
            }
          }
          render();
        });
        g.appendChild(b);
      }
      body.appendChild(g);
      if (count > 1) {
        const clr = el('div', 'menu-actions');
        clr.style.marginTop = '10px';
        clr.appendChild(button('清除選擇', 'ghost', () => {
          sel.length = 0;
          render();
        }));
        body.appendChild(clr);
      }
      confirm.disabled = sel.length !== count;
    };
    render();
    const cancel = button('取消', '', () => this.close());
    return this.open({ kind: 'pick', title, body, foot: [cancel, confirm], cls: 'narrow' });
  }

  // ── game over ──
  gameOver(ctx, onNew, onView) {
    const v = ctx.view;
    const rows = v.players
      .map((p) => {
        let s = 0;
        let c = 0;
        v.vertices.forEach((b) => {
          if (b && b.p === p.id) b.t === 'c' ? c++ : s++;
        });
        const vpCards = p.dev ? p.dev.filter((d) => d.type === 'victoryPoint').length : 0;
        const tot = s + c * 2 + (v.longestRoad === p.id ? 2 : 0) + (v.largestArmy === p.id ? 2 : 0) + vpCards;
        return { p, s, c, vpCards, tot };
      })
      .sort((a, b) => (b.p.id === v.winner) - (a.p.id === v.winner) || b.tot - a.tot);
    const body = el('div');
    const win = ctx.players[v.winner];
    body.innerHTML = `<p class="lead" style="font-size:15px">${v.winner === ctx.me ? '<b>你統一了卡坦島！</b>' : `<b style="color:${win.color}">${esc(win.name)}</b> 在第 ${v.turn} 回合達成 ${v.targetVP} 分，贏得戰役。`}</p>`;
    const st = el('div', 'standings');
    rows.forEach((r, i) => {
      const P = ctx.players[r.p.id];
      const parts = [`村莊 ${r.s}`, `城市 ${r.c}×2`];
      if (v.longestRoad === r.p.id) parts.push('最長道路 2');
      if (v.largestArmy === r.p.id) parts.push('最大騎士團 2');
      if (r.vpCards) parts.push(`分數卡 ${r.vpCards}`);
      const row = el('div', 'standing' + (r.p.id === v.winner ? ' win' : ''));
      row.innerHTML = `<span class="rk">${i + 1}</span><img class="flag sm" alt="" src="${flagURL(P.color, r.p.id)}"><div><b style="color:${P.color}">${esc(P.name)}</b><div class="bd">${parts.join(' · ')}</div></div><span class="tot num">${r.tot}</span>`;
      st.appendChild(row);
    });
    body.appendChild(st);
    const max = Math.max(1, ...v.rolls.slice(2));
    const totalRolls = v.rolls.reduce((a, b) => a + b, 0);
    body.appendChild(el('div', 'row-label', `擲骰統計（共 ${totalRolls} 次）`));
    const hist = el('div', 'hist');
    for (let n = 2; n <= 12; n++) {
      const d = el('div', '', `<b>${v.rolls[n]}</b><i style="height:${(v.rolls[n] / max) * 80}%"></i><span>${n}</span>`);
      hist.appendChild(d);
    }
    body.appendChild(hist);
    return this.open({ kind: 'over', title: v.winner === ctx.me ? '勝利' : '戰役結束', body, foot: [button('檢視地圖', '', onView), button('再來一局', 'primary', onNew)], dismissable: true, cls: '' });
  }

  rules() {
    return this.open({ kind: 'rules', title: '卡坦島規則', body: rulesHtml(), cls: 'wide' });
  }

  settings(settings, onChange) {
    const body = el('div');
    const render = () => {
      body.innerHTML = '';
      const g = el('div', 'form-grid');
      const seg = (label, key, opts) => {
        g.appendChild(el('label', '', label));
        const s = el('div', 'seg');
        for (const [val, text] of opts) {
          const b = el('button', settings[key] === val ? 'on' : '', text);
          b.type = 'button';
          b.addEventListener('click', () => {
            settings[key] = val;
            if (key === 'quality') settings.qualityPicked = true; // chosen by hand: no more automatic default
            onChange(settings, key);
            render();
          });
          s.appendChild(b);
        }
        g.appendChild(s);
      };
      seg('電腦速度', 'speed', [
        ['slow', '慢'],
        ['normal', '普通'],
        ['fast', '快'],
        ['turbo', '極快'],
      ]);
      seg('畫面品質', 'quality', [
        ['high', '高'],
        ['medium', '中'],
        ['low', '低'],
      ]);
      seg('音效', 'sound', [
        [true, '開'],
        [false, '關'],
      ]);
      body.appendChild(g);
      body.appendChild(el('p', 'lead', '畫面品質會在下一局或重新載入地圖時套用。'));
    };
    render();
    return this.open({ kind: 'settings', title: '設定', body, cls: 'narrow' });
  }
}

export { legalRoadEdges };
