// The building cards on the home screen (rules and saving: meta/collection.js, meta/store.js):
//   openCards   the Cards side page: the three blueprints (one in use) and every card, the basic ones
//               first; the ones not owned yet are grey, and a card opened says how to get it
//   openShop    the Draw & Shop side page: drawing cards for coins, the shop (shards for a chosen
//               card), the missions and their rewards
//   deckLine    the blueprint in use, in a line (single-player setup, room lobby: nothing to choose
//               there, it is chosen at home)
//   rewardsBox  what a finished game earned (the end-of-game sheet)
// Both side pages are sheets of the dialogs layer that slide in from the left of the screen. Small
// cards show only their figure, name and points: what a card costs and does is on the card opened
// (cardDetail), where the resources are large enough to read.
import { BUILDINGS, BUILDING_IDS, DIRS, DIR_NAMES, BLUEPRINT_SIZE, WONDER_VP, SCORE_VP, BASIC, BASIC_NAMES, isWonder, isBasic } from '../engine/develop.js';
import { COSTS } from '../engine/engine.js';
import { POOL, MISSIONS, STARTER, DRAW_COST, DRAW10_COST, COINS, owns, ownedBlueprint, missionFor, missionOf, missionState, claim, claimable, draw, buy, priceOf, dupShards, chanceOf, seen, slotNew } from '../meta/collection.js';
import { cards as collection, commit, onCards } from '../meta/store.js';
import { DIR_COLOR, BUILDING_TEXT, buildingName, blueprintName } from './develop-ui.js';
import { buildingIcon, icon, resIcon, RES_NAMES } from './icons.js';
import { emblemSvg } from './emblems.js';
import { t, N_, list } from '../i18n/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => Number(n).toLocaleString('en-US');
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const btn = (label, cls, onClick) => {
  const b = el('button', 'btn ' + (cls || ''), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};
export const coinHtml = (n) => `<span class="cur coin" title="${esc(t('金幣'))}">${icon('coin', 16)}<b class="num">${num(n)}</b></span>`;
export const shardHtml = (n) => `<span class="cur shard" title="${esc(t('碎片'))}">${icon('shard', 16)}<b class="num">${num(n)}</b></span>`;

// ── every card: the basic ones and the buildings ──

// the basic cards' colour, figure (icons.js) and words (the build menu's own)
const BASIC_COLOR = '#7a6448';
const BASIC_FIGURE = { road: 'road', settlement: 'settlement', city: 'city', dev: 'devbuy' };
const BASIC_TEXT = {
  road: N_('連接你的村莊與城市。連續最長、至少 5 條的道路得 2 分。'),
  settlement: N_('+1 勝利分數。相鄰地形擲出點數時產出 1 張資源。'),
  city: N_('由村莊升級：再 +1 勝利分數，產出加倍。'),
  dev: N_('抽 1 張：騎士、道路建設、豐收之年、壟斷或分數卡。'),
};
const KIND = { func: N_('功能建築'), score: N_('計分建築'), wonder: N_('世界奇觀') };
export const cardName = (k) => (isBasic(k) ? t(BASIC_NAMES[k]) : buildingName(k));
export const cardColor = (k) => (isBasic(k) ? BASIC_COLOR : DIR_COLOR[BUILDINGS[k].dir]);
export const cardIcon = (k, size) => (isBasic(k) ? icon(BASIC_FIGURE[k], size) : buildingIcon(k, size));
// a card's points in a corner: 1, +3 (a scoring building), 5 (a wonder); the basic cards: a settlement
// 1, a city 2 (none for the others)
function ptsShort(k) {
  if (isBasic(k)) return k === 'settlement' ? '1' : k === 'city' ? '2' : '';
  const kind = BUILDINGS[k].kind;
  return kind === 'wonder' ? String(WONDER_VP) : kind === 'score' ? '+' + SCORE_VP : '1';
}
const kindLine = (k) => (isBasic(k) ? t('基本卡') : `${t(DIR_NAMES[BUILDINGS[k].dir])}・${t(KIND[BUILDINGS[k].kind])}`);

// A card as a small collectible card: its colour's frame, the figure, name and kind, its points. marks:
// locked (not owned: grey), on (in the blueprint shown), fresh (new), sel (opened).
export function cardFace(k, { locked = false, on = false, fresh = false, sel = false, tag = 'div', small = false } = {}) {
  const kind = isBasic(k) ? 'basic' : BUILDINGS[k].kind;
  const cls = ['cc', 'k-' + kind, locked && 'locked', on && 'on', fresh && 'fresh', sel && 'sel', small && 'small'].filter(Boolean).join(' ');
  const attrs = tag === 'button' ? ` type="button" aria-pressed="${sel}"` : '';
  const pts = ptsShort(k);
  return `<${tag} class="${cls}" data-k="${k}" style="--dc:${cardColor(k)}"${attrs} title="${esc(cardName(k))}">
    ${pts ? `<span class="cc-pts num">${pts}</span>` : ''}
    <span class="cc-art">${cardIcon(k, small ? 30 : 44)}</span>
    <b class="cc-name">${esc(cardName(k))}</b>
    ${small ? '' : `<small class="cc-kind">${esc(kindLine(k))}</small>`}
    ${fresh && !locked ? `<span class="cc-new">${esc(t('新'))}</span>` : ''}
  </${tag}>`;
}

// a cost as resource cards large enough to read: the card, how many, its name
function costBig(cost) {
  return `<span class="cb-row">${Object.entries(cost)
    .map(([r, n]) => `<span class="cb" title="${esc(RES_NAMES[r])}">${resIcon(r, 38)}<span class="cb-n"><b class="num">×${n}</b><small>${esc(RES_NAMES[r])}</small></span></span>`)
    .join('')}</span>`;
}

// A card opened: everything about it, the cost in large resource cards (a wonder: its three stages).
export function cardDetail(k, { on = false, locked = false } = {}) {
  const b = BUILDINGS[k];
  const pts = isBasic(k) ? (k === 'settlement' ? t('{n} 分', { n: 1 }) : k === 'city' ? t('{n} 分', { n: 2 }) : '') : b.kind === 'wonder' ? t('完工 {n} 分', { n: WONDER_VP }) : k === 'adventurers' ? t('持有最大騎士團時 +{n}', { n: SCORE_VP }) : k === 'post' ? t('持有最長道路時 +{n}', { n: SCORE_VP }) : t('{n} 分', { n: 1 });
  const cost = isBasic(k)
    ? costBig(COSTS[k])
    : b.kind === 'wonder'
      ? b.stages.map((c, i) => `<div class="cd-stage"><i class="num">${i + 1}</i>${costBig(c)}</div>`).join('')
      : costBig(b.cost);
  const words = isBasic(k)
    ? `<p class="cd-fx">${esc(t(BASIC_TEXT[k]))}</p><p class="cd-note">${esc(t('沒放進藍圖的話，這局就不能花錢蓋（開局照常放村莊和道路）。'))}</p>`
    : `<p class="cd-cond"><b>${esc(t('條件'))}</b>${esc(t(BUILDING_TEXT[k].cond))}</p><p class="cd-fx"><b>${esc(t('效果'))}</b>${esc(t(BUILDING_TEXT[k].fx))}</p>`;
  return `<div class="cd${on ? ' on' : ''}${locked ? ' locked' : ''}" style="--dc:${cardColor(k)}">
    <div class="cd-top"><span class="cd-ico">${cardIcon(k, 34)}</span><span class="cd-title"><b>${esc(cardName(k))}</b><small>${esc(kindLine(k))}</small></span>${pts ? `<span class="cd-pts">${esc(pts)}</span>` : ''}</div>
    <div class="cd-cost"><h6>${esc(b && b.kind === 'wonder' ? t('三個階段的花費') : t('花費'))}</h6>${cost}</div>
    ${words}
  </div>`;
}

// how a card not owned yet is had: its mission, or drawing and the shop
function howToGet(c, k) {
  const m = missionFor(k);
  if (m) {
    const s = missionState(c, m.id);
    return { text: t('任務：{m}（{n}/{goal}）', { m: t(m.text), n: s.n, goal: s.goal }), tab: 'missions' };
  }
  if (POOL.includes(k)) return { text: t('抽卡可以抽到（每次 {p}%），也可以在商店用 {n} 碎片兌換', { p: (chanceOf(k) * 100).toFixed(1), n: priceOf(k) }), tab: 'draw' };
  return { text: isBasic(k) ? t('基本卡：每位玩家都有') : t('一開始就有'), tab: null };
}

// a side page: a sheet of the dialogs layer against the left edge of the screen
function sidePage(dialogs, { kind, title, body, headExtra = '', onClose = null, foot = [] }) {
  return dialogs.open({ kind, title, body, foot, cls: 'side-page', headExtra, onClose });
}

// ── the Cards page ──

// opts.onShop(tab): to the Draw & Shop page (a locked card's way to get it)
export function openCards(dialogs, settings, save, opts = {}) {
  const c = collection();
  const body = el('div', 'cards-page');
  let cur = [0, 1, 2].includes(settings.bpCur) ? settings.bpCur : 0;
  let sel = null;
  let flash = '';
  // (the blueprints keep to the cards owned: one shown with a card that went is put right)
  for (let i = 0; i < 3; i++) settings.bps[i] = ownedBlueprint(c, settings.bps[i]);
  const render = () => {
    const bp = settings.bps[cur];
    const tabs = [0, 1, 2]
      .map((i) => `<button type="button" class="cp-tab${i === cur ? ' on' : ''}" data-set="${i}" aria-pressed="${i === cur}"><b>${esc(t('藍圖 {n}', { n: i + 1 }))}</b><small>${i === settings.bpCur ? esc(t('使用中')) : `${settings.bps[i].length}/${BLUEPRINT_SIZE}`}</small></button>`)
      .join('');
    const slots = Array.from({ length: BLUEPRINT_SIZE }, (_, i) => (bp[i] ? `<button type="button" class="cp-slot" data-slot="${bp[i]}" title="${esc(t('拿出藍圖'))}">${cardFace(bp[i], { small: true })}</button>` : `<span class="cp-slot empty"><i class="num">${i + 1}</i></span>`)).join('');
    const status = `${bp.length}/${BLUEPRINT_SIZE}${bp.length >= BLUEPRINT_SIZE ? ' · ' + esc(blueprintName(bp)) : ''}`;
    const face = (k) => cardFace(k, { tag: 'button', locked: !owns(c, k), on: bp.includes(k), fresh: c.fresh.includes(k), sel: k === sel });
    const groups =
      `<section class="cp-group" style="--dc:${BASIC_COLOR}"><h5>${esc(t('基本卡'))}</h5><div class="cc-grid">${BASIC.map(face).join('')}</div></section>` +
      DIRS.map((d) => `<section class="cp-group" style="--dc:${DIR_COLOR[d]}"><h5>${esc(t(DIR_NAMES[d]))}</h5><div class="cc-grid">${BUILDING_IDS.filter((k) => BUILDINGS[k].dir === d).map(face).join('')}</div></section>`).join('');
    body.innerHTML = `
      <section class="cp-deck">
        <div class="cp-tabs" role="group" aria-label="${esc(t('藍圖'))}">${tabs}</div>
        <div class="cp-slots">${slots}</div>
        <div class="cp-deckbar"><span class="cp-status num">${status}</span><span class="cp-use"></span></div>
        <p class="cp-note">${esc(t('藍圖 7 張，含基本卡（道路、村莊、城市、發展卡）：沒帶的基本卡，這局就不能花錢蓋。開發不用卡牌。最多 1 座世界奇觀；開局帶「使用中」的那套。'))}</p>
        ${flash ? `<p class="cp-flash" role="status">${esc(flash)}</p>` : ''}
      </section>
      <div class="cp-main">
        <section class="cp-coll">
          <h4>${esc(t('收藏'))} <span class="num">${c.own.length + BASIC.length}/${BUILDING_IDS.length + BASIC.length}</span></h4>
          ${groups}
        </section>
        <aside class="cp-detail" aria-live="polite"></aside>
      </div>`;
    flash = '';
    // which blueprint the next game takes
    const use = body.querySelector('.cp-use');
    if (cur === settings.bpCur) use.innerHTML = `<span class="cp-inuse">${esc(t('使用中'))}</span>`;
    else
      use.appendChild(
        btn(esc(t('使用這套')), 'primary', () => {
          settings.bpCur = cur;
          save(settings);
          render();
        }),
      );
    body.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => ((cur = +b.dataset.set), render())));
    body.querySelectorAll('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        settings.bps[cur] = bp.filter((x) => x !== b.dataset.slot);
        sel = b.dataset.slot;
        save(settings);
        render();
      }),
    );
    body.querySelectorAll('.cp-coll .cc[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        sel = b.dataset.k;
        // (a new card looked at loses its mark)
        if (seen(c, [sel])) commit();
        render();
      }),
    );
    paintDetail();
  };
  // the selected card: everything it does, and putting it in or taking it out
  const paintDetail = () => {
    const box = body.querySelector('.cp-detail');
    if (!sel) {
      box.innerHTML = `<p class="cp-hint">${esc(t('點一張卡看它的效果，再放進藍圖或拿出來。'))}</p>`;
      return;
    }
    const bp = settings.bps[cur];
    box.innerHTML = cardDetail(sel, { on: bp.includes(sel), locked: !owns(c, sel) });
    const acts = el('div', 'cp-acts');
    if (!owns(c, sel)) {
      const how = howToGet(c, sel);
      acts.appendChild(el('p', 'cp-how', `<span>${esc(how.text)}</span>`));
      if (how.tab && opts.onShop) acts.appendChild(btn(how.tab === 'missions' ? esc(t('看任務')) : esc(t('去抽卡')), '', () => opts.onShop(how.tab)));
    } else if (bp.includes(sel)) {
      acts.appendChild(
        btn(esc(t('拿出藍圖')), '', () => {
          settings.bps[cur] = bp.filter((x) => x !== sel);
          save(settings);
          render();
        }),
      );
    } else {
      acts.appendChild(
        btn(esc(t('放進藍圖')), 'primary', () => {
          const k = sel;
          if (isWonder(k) && bp.some(isWonder)) settings.bps[cur] = bp.map((x) => (isWonder(x) ? k : x));
          else if (bp.length >= BLUEPRINT_SIZE) {
            flash = t('藍圖已滿：先拿出一張');
            return render();
          } else settings.bps[cur] = [...bp, k];
          save(settings);
          render();
        }),
      );
      if (isWonder(sel) && bp.some(isWonder)) acts.appendChild(el('p', 'cp-how', esc(t('藍圖只能帶 1 座世界奇觀：會換掉原本的那座'))));
    }
    box.appendChild(acts);
  };
  sidePage(dialogs, { kind: 'cards', title: t('卡牌'), body, onClose: opts.onClose });
  render();
}

// ── the Draw & Shop page ──

const TABS = [
  ['draw', N_('抽卡')],
  ['shop', N_('商店')],
  ['missions', N_('任務')],
];

// opts: tab ('draw', 'shop', 'missions'), settings and save (a new card goes into the blueprint in use
// when it has room), onCards() (to the Cards page), onClose
export function openShop(dialogs, opts = {}) {
  const { settings, save } = opts;
  const c = collection();
  let tab = TABS.some(([k]) => k === opts.tab) ? opts.tab : 'draw';
  let reveal = null;
  let note = '';
  const body = el('div', 'shop-page');
  const gained = (k) => {
    if (settings && slotNew(settings.bps[[0, 1, 2].includes(settings.bpCur) ? settings.bpCur : 0], k)) {
      save(settings);
      return true;
    }
    return false;
  };
  const balances = () => {
    const box = dialogs.cur && dialogs.cur.el.querySelector('.sp-bals');
    if (box) box.innerHTML = coinHtml(c.coins) + shardHtml(c.shards);
  };
  const render = () => {
    const n = claimable(c);
    const tabs = TABS.map(([k, label]) => `<button type="button" class="sp-tab${k === tab ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${k === tab}">${esc(t(label))}${k === 'missions' && n ? `<i class="badge num">${n}</i>` : ''}</button>`).join('');
    body.innerHTML = `<div class="sp-tabs" role="tablist">${tabs}</div><div class="sp-body"></div>${note ? `<p class="sp-note" role="status">${esc(note)}</p>` : ''}`;
    note = '';
    body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => ((tab = b.dataset.tab), (reveal = null), render())));
    const box = body.querySelector('.sp-body');
    if (tab === 'draw') paintDraw(box);
    else if (tab === 'shop') paintShop(box);
    else paintMissions(box);
    balances();
  };

  // drawing: the pack, one or ten, what came out (turning over one after another)
  const paintDraw = (box) => {
    const total = POOL.length;
    const wonders = POOL.filter(isWonder).length;
    box.innerHTML = `
      <div class="sp-pack">
        <div class="sp-packart" aria-hidden="true">${emblemSvg('cards', 74)}</div>
        <div class="sp-packinfo">
          <b>${esc(t('建築卡包'))}</b>
          <p>${esc(t('{n} 種建築、{w} 座世界奇觀，抽到已經有的卡換成碎片（建築 {a}、奇觀 {b}）。', { n: total - wonders, w: wonders, a: dupShards(POOL.find((k) => !isWonder(k))), b: dupShards(POOL.find(isWonder)) }))}</p>
          <div class="sp-buy"></div>
        </div>
      </div>
      <div class="sp-reveal"></div>
      <details class="sp-odds"><summary>${esc(t('每張卡的機率'))}</summary><div class="sp-oddlist">${POOL.map((k) => `<span>${buildingIcon(k, 14)}${esc(buildingName(k))}<b class="num">${(chanceOf(k) * 100).toFixed(1)}%</b></span>`).join('')}</div></details>
      <p class="sp-earn">${esc(t('金幣怎麼來：打完一局 +{a}、獲勝 +{b}、線上房間 +{c}、每天第一局 +{d}，還有任務。', { a: COINS.game, b: COINS.win, c: COINS.online, d: COINS.daily }))}</p>`;
    const buy1 = btn(`${esc(t('抽 1 次'))}${coinHtml(DRAW_COST)}`, 'primary sp-draw', () => doDraw(1));
    const buy10 = btn(`${esc(t('抽 10 次'))}${coinHtml(DRAW10_COST)}`, 'primary sp-draw', () => doDraw(10));
    buy1.disabled = c.coins < DRAW_COST;
    buy10.disabled = c.coins < DRAW10_COST;
    box.querySelector('.sp-buy').append(buy1, buy10);
    if (c.coins < DRAW_COST) box.querySelector('.sp-buy').appendChild(el('small', 'sp-short', esc(t('金幣不夠：打一局或完成任務'))));
    if (reveal) {
      const r = box.querySelector('.sp-reveal');
      r.classList.toggle('ten', reveal.length > 1);
      r.innerHTML = reveal
        .map(
          (x, i) => `<div class="rv" style="--i:${i}"><div class="rv-in"><div class="rv-back">${emblemSvg('cards', 40)}</div><div class="rv-face">${cardFace(x.k, { small: reveal.length > 1 })}</div></div>
          <span class="rv-tag${x.fresh ? ' new' : ''}">${x.fresh ? esc(t('新卡！')) + (x.slotted ? `<small>${esc(t('已放進藍圖'))}</small>` : '') : `${icon('shard', 13)}+${x.shards}`}</span></div>`,
        )
        .join('');
    }
  };
  const doDraw = (n) => {
    const r = draw(c, n, rand);
    if (r.error) {
      note = t(r.error);
      return render();
    }
    reveal = r.cards.map((x) => ({ ...x, slotted: x.fresh && gained(x.k) }));
    commit();
    render();
  };

  // the shop: the cards of the pack for shards
  const paintShop = (box) => {
    box.innerHTML = `<p class="sp-lead">${esc(t('用抽到重複卡換來的碎片，兌換指定的卡。'))}</p><div class="cc-grid shop"></div>`;
    const grid = box.querySelector('.cc-grid');
    for (const k of POOL) {
      const cell = el('div', 'sp-item' + (owns(c, k) ? ' owned' : ''), cardFace(k, { locked: !owns(c, k) }));
      if (owns(c, k)) cell.appendChild(el('span', 'sp-owned', esc(t('已擁有'))));
      else {
        const b = btn(`${esc(t('兌換'))}${shardHtml(priceOf(k))}`, 'sp-trade', () => {
          const r = buy(c, k);
          if (r.error) note = t(r.error);
          else {
            note = gained(k) ? t('換到{name}，已放進藍圖', { name: buildingName(k) }) : t('換到{name}', { name: buildingName(k) });
            commit();
          }
          render();
        });
        b.disabled = c.shards < priceOf(k);
        cell.appendChild(b);
      }
      grid.appendChild(cell);
    }
  };

  // the missions: the granary's cards first, then the challenges
  const paintMissions = (box) => {
    const row = (m) => {
      const s = missionState(c, m.id);
      const reward = m.reward.card ? `${cardFace(m.reward.card, { small: true, locked: !owns(c, m.reward.card) && !s.got })}` : `<span class="ms-coins">${coinHtml(m.reward.coins)}</span>`;
      const pct = Math.round((100 * s.n) / s.goal);
      return `<div class="ms-row${s.done ? ' done' : ''}${s.got ? ' got' : ''}" data-m="${m.id}">
        <div class="ms-text"><b>${esc(t(m.text))}</b><span class="ms-bar" aria-hidden="true"><i style="width:${pct}%"></i></span><small class="num">${s.n}/${s.goal}</small></div>
        <div class="ms-reward">${reward}</div>
        <div class="ms-act">${s.got ? `<span class="ms-got">${esc(t('已領取'))}</span>` : s.done ? `<button type="button" class="btn primary" data-claim="${m.id}">${esc(t('領取'))}</button>` : ''}</div>
      </div>`;
    };
    const first = MISSIONS.filter((m) => m.id === 'welcome' || m.reward.card);
    const rest = MISSIONS.filter((m) => !first.includes(m));
    box.innerHTML = `
      <h5 class="ms-head">${esc(t('新手任務：湊齊穀倉系列'))}</h5>
      <p class="sp-lead">${esc(t('完成這些任務，加上一開始的{cards}，就有穀倉系列的 6 種建築（不含空中花園）。', { cards: list(STARTER.map(buildingName)) }))}</p>
      ${first.map(row).join('')}
      <h5 class="ms-head">${esc(t('挑戰'))}</h5>
      ${rest.map(row).join('')}`;
    box.querySelectorAll('[data-claim]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = claim(c, b.dataset.claim);
        if (!r) return;
        if (r.coins) note = t('領到 {n} 金幣', { n: r.coins });
        else if (r.shards) note = t('已經有{name}：換成 {n} 碎片', { name: buildingName(r.card), n: r.shards });
        else note = gained(r.card) ? t('拿到{name}，已放進藍圖', { name: buildingName(r.card) }) : t('拿到{name}', { name: buildingName(r.card) });
        commit();
        render();
      }),
    );
  };

  const foot = opts.onCards ? [btn(`${icon('cards', 16)}${esc(t('卡牌'))}`, 'ghost', () => opts.onCards())] : [];
  sidePage(dialogs, { kind: 'shop', title: t('抽卡・商店'), body, headExtra: '<span class="sp-bals"></span>', onClose: opts.onClose, foot });
  render();
}

// a random number for drawing (the page's own randomness: nothing to replay)
function rand() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

// ── around the game ──

// The blueprint the next game takes, in a line: its name, how many cards, the cards themselves.
// onChange(): to the Cards page (null: no link).
export function deckLine(settings, onChange = null) {
  const c = collection();
  const i = [0, 1, 2].includes(settings.bpCur) ? settings.bpCur : 0;
  const bp = ownedBlueprint(c, settings.bps && settings.bps[i]);
  const box = el('div', 'deck-line');
  const cardsHtml = bp.map((k) => `<span class="dk-card" style="--dc:${cardColor(k)}" title="${esc(cardName(k))}">${cardIcon(k, 16)}</span>`).join('') + '<span class="dk-card empty"></span>'.repeat(BLUEPRINT_SIZE - bp.length);
  box.innerHTML = `<span class="dl-name"><b>${esc(t('藍圖 {n}', { n: i + 1 }))}</b><small class="num">${bp.length}/${BLUEPRINT_SIZE}</small></span><span class="dk-cards">${cardsHtml}</span>`;
  if (onChange) box.appendChild(btn(esc(t('在「卡牌」更換')), 'ghost dl-change', onChange));
  else box.appendChild(el('small', 'dl-hint', esc(t('在主畫面的「卡牌」更換'))));
  return box;
}

// What a finished game earned (meta/collection.js gameOver): the coins by what for, the missions done.
const EARNED = { game: N_('打完一局'), win: N_('獲勝'), online: N_('線上房間'), daily: N_('每天第一局') };
export function rewardsBox(out) {
  if (!out) return null;
  const box = el('div', 'rewards');
  const lines = out.coins.map(([k, n]) => `<span class="rw-line">${esc(t(EARNED[k]))}<b class="num">+${n}</b></span>`).join('');
  const done = out.done.map((id) => missionOf(id)).filter(Boolean);
  box.innerHTML = `<div class="rw-coins">${icon('coin', 22)}<b class="num">+${num(out.total)}</b><span class="rw-what">${lines}</span></div>
    ${done.length ? `<div class="rw-missions">${icon('mission', 18)}<span>${esc(t('任務完成：'))}${list(done.map((m) => `<b>${esc(t(m.text))}</b>`))}<small>${esc(t('到主畫面的「抽卡・商店」領取'))}</small></span></div>` : ''}`;
  return box;
}

// the marks on the home screen's Cards and Draw & Shop buttons: new cards, rewards waiting, coins
export function homeMarks() {
  const c = collection();
  return { fresh: c.fresh.length, claim: claimable(c), coins: c.coins };
}
export { onCards };
