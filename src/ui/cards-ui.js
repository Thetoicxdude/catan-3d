// The building cards' pages (rules and saving: meta/collection.js, meta/store.js), each shown full
// screen by the page shell (pages.js) that the home screen's side bar opens:
//   cardsPage     Cards: the three blueprints (one in use) and every card, the basic ones first; the ones
//                 not owned yet are grey, and a card opened says how to get it
//   shopPage      Draw & Shop: drawing cards for coins, the shop (shards for a chosen card)
//   missionsPage  Missions and their rewards
//   deckLine      the blueprint in use, in a line (single-player setup, room lobby: nothing to choose
//                 there, it is chosen on the Cards page)
//   rewardsBox    what a finished game earned (the end-of-game sheet)
// Small cards show only their figure, name and points: what a card costs and does is on the card opened
// (cardDetail), where the resources are large enough to read.
// host (the page shell): mount(el) puts the page's body in place; bals() is where the coins and shards
// are shown (filled by the page that counts them); go(page, opts) goes to another page.
import { BUILDINGS, DIR_NAMES, BLUEPRINT_SIZE, WONDER_VP, SCORE_VP, BASIC_NAMES, isWonder, isBasic } from '../engine/develop.js';
import { COSTS } from '../engine/engine.js';
import { POOL, MISSIONS, STARTER, DRAW_COST, DRAW10_COST, COINS, RARITIES, ALL_CARDS, rarityOf, owns, ownedBlueprint, missionFor, missionOf, missionState, claim, claimable, draw, buy, priceOf, dupShards, chanceOf, seen, slotNew } from '../meta/collection.js';
import { cards as collection, commit, onCards } from '../meta/store.js';
import { DIR_COLOR, BUILDING_TEXT, buildingName, blueprintName } from './develop-ui.js';
import { buildingIcon, icon, resIcon, RES_NAMES } from './icons.js';
import { fly, burst, count, pop, stamp, shake, fadeIn, whenShown, EASE, reduced } from './motion.js';
import { sfx } from './sfx.js';
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
// a card's direction (the dot on its kind line); its frame is its rarity (rarityColor)
export const cardColor = (k) => (isBasic(k) ? BASIC_COLOR : DIR_COLOR[BUILDINGS[k].dir]);
export const cardIcon = (k, size) => (isBasic(k) ? icon(BASIC_FIGURE[k], size) : buildingIcon(k, size));

// ── rarity (meta/collection.js rarityOf): the colour of the card's frame, and a gem cut for each, so
// that the shape tells it as well as the colour (basic: none, common: round, rare: four sides, epic:
// six, legendary: eight). The colours are collection.css's .r-*: the frame's light, middle and dark. ──
export const RARITY_NAMES = { basic: N_('基本§rarity'), common: N_('普通§rarity'), rare: N_('稀有'), epic: N_('史詩'), legendary: N_('傳說') };
export const RARITY_COLOR = { basic: '#a4abb3', common: '#62b046', rare: '#3f8fe0', epic: '#a95ce0', legendary: '#efa72e' };
export const rarityColor = (k) => RARITY_COLOR[rarityOf(k)];
const GEMS = {};
const pts2 = (pts) => pts.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ');
export function gemSvg(r) {
  if (r === 'basic' || !RARITY_COLOR[r]) return '';
  if (GEMS[r]) return GEMS[r];
  // (the frame's colours inside a card, which a card not owned mutes; elsewhere the rarity's own)
  const c1 = 'var(--r1, var(--c1))';
  const c2 = 'var(--r2, var(--c2))';
  const c3 = 'var(--r3, var(--c3))';
  if (r === 'common')
    return (GEMS[r] = `<svg class="gem-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.4" style="fill:${c3}" stroke="#120b04" stroke-width="1.2"/><circle cx="12" cy="12" r="7.6" style="fill:${c2}"/><path d="M6.3 9.6a6.4 6.4 0 0 1 6.9-4.6" fill="none" style="stroke:${c1}" stroke-width="2.3" stroke-linecap="round"/><circle cx="9" cy="8.3" r="1.3" fill="#fff" opacity=".85"/></svg>`);
  const n = r === 'rare' ? 4 : r === 'epic' ? 6 : 8;
  const a0 = r === 'legendary' ? -Math.PI / 2 + Math.PI / 8 : -Math.PI / 2;
  const at = (rad, i) => [12 + rad * Math.cos(a0 + (i * 2 * Math.PI) / n), 12 + rad * Math.sin(a0 + (i * 2 * Math.PI) / n)];
  const outer = Array.from({ length: n }, (_, i) => at(11, i));
  const inner = Array.from({ length: n }, (_, i) => at(r === 'rare' ? 5.2 : 6, i));
  // (each facet lit from the upper left)
  let facets = '';
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mid = a0 + ((i + 0.5) * 2 * Math.PI) / n;
    const lit = 0.7 * (Math.cos(mid) + Math.sin(mid));
    facets += `<polygon points="${pts2([outer[i], outer[j], inner[j], inner[i]])}" style="fill:${lit < -0.35 ? c1 : lit < 0.35 ? c2 : c3}"/>`;
  }
  return (GEMS[r] =
    `<svg class="gem-svg" viewBox="0 0 24 24" aria-hidden="true"><polygon points="${pts2(outer)}" stroke="#120b04" stroke-width="1.6" stroke-linejoin="round" style="fill:${c3}"/>${facets}` +
    `<polygon points="${pts2(inner)}" style="fill:${c2}"/><polygon points="${pts2([inner[n - 1], inner[0], [12, 12]])}" fill="#fff" opacity=".55"/></svg>`);
}
// a rarity's gem and name, on its own (the collection's filter, the profile, the shop)
export const rarityTag = (r) => `<span class="rar r-${r}">${gemSvg(r) || '<i class="gem-none" aria-hidden="true"></i>'}<span>${esc(t(RARITY_NAMES[r]))}</span></span>`;
// a legendary card's crown, on the top of its frame
const CROWN =
  '<svg class="cc-crown" viewBox="0 0 38 20" aria-hidden="true"><path d="M4 16 L3 5.5 L11 10.5 L19 2.5 L27 10.5 L35 5.5 L34 16 Z" style="fill:var(--r2)" stroke="#2a1606" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M5.5 13.5 L5 8.5 L11 12.4 L19 5.2 L27 12.4 L33 8.5 L32.5 13.5 Z" style="fill:var(--r1)" opacity=".55"/><rect x="4" y="15" width="30" height="4" rx="1" style="fill:var(--r3)" stroke="#2a1606" stroke-width="1.1"/>' +
  '<circle cx="3" cy="5.5" r="2" style="fill:var(--r1)" stroke="#2a1606" stroke-width=".9"/><circle cx="19" cy="2.5" r="2.2" style="fill:var(--r1)" stroke="#2a1606" stroke-width=".9"/><circle cx="35" cy="5.5" r="2" style="fill:var(--r1)" stroke="#2a1606" stroke-width=".9"/><circle cx="19" cy="17" r="1.4" fill="#d2402e"/></svg>';
// The back of a building card (drawing): a compass rose over the island's hexagon, in gold on deep
// green. Drawn here, used whole (the frame round it: collection.css .cc-back).
const CARD_BACK =
  '<svg class="cb-art" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#d8b56a" stroke-linejoin="round">' +
  '<polygon points="50,8 86.4,29 86.4,71 50,92 13.6,71 13.6,29" stroke-width="2.2"/><polygon points="50,15 80.3,32.5 80.3,67.5 50,85 19.7,67.5 19.7,32.5" stroke-width="0.9" opacity=".7"/>' +
  '<circle cx="50" cy="50" r="22" stroke-width="1.2" opacity=".8"/><circle cx="50" cy="50" r="27" stroke-width="0.6" stroke-dasharray="1.5 2.5" opacity=".7"/></g>' +
  '<g fill="#e7c77c" stroke="#5a3d12" stroke-width=".6" stroke-linejoin="round"><polygon points="50,20 54.5,45.5 50,50 45.5,45.5"/><polygon points="50,80 45.5,54.5 50,50 54.5,54.5" fill="#b98d3e"/>' +
  '<polygon points="80,50 54.5,54.5 50,50 54.5,45.5" fill="#b98d3e"/><polygon points="20,50 45.5,45.5 50,50 45.5,54.5"/>' +
  '<polygon points="63,37 52.6,50 50,50 50,47.4" fill="#b98d3e" opacity=".9"/><polygon points="37,63 47.4,50 50,50 50,52.6" opacity=".9"/><polygon points="63,63 50,52.6 50,50 52.6,50" opacity=".9"/><polygon points="37,37 50,47.4 50,50 47.4,50" fill="#b98d3e" opacity=".9"/></g>' +
  '<circle cx="50" cy="50" r="3.2" fill="#f3dc9c" stroke="#5a3d12" stroke-width=".6"/></svg>';
// a card's points in a corner: 1, +3 (a scoring building), 5 (a wonder); the basic cards: a settlement
// 1, a city 2 (none for the others)
function ptsShort(k) {
  if (isBasic(k)) return k === 'settlement' ? '1' : k === 'city' ? '2' : '';
  const kind = BUILDINGS[k].kind;
  return kind === 'wonder' ? String(WONDER_VP) : kind === 'score' ? '+' + SCORE_VP : '1';
}
const kindLine = (k) => (isBasic(k) ? t('基本卡') : `${t(DIR_NAMES[BUILDINGS[k].dir])}・${t(KIND[BUILDINGS[k].kind])}`);

// A card as a collectible card: its rarity's metal frame round a dark body, the picture at the top with
// the rarity's gem on its lower edge, the name and kind under it, the points in the corner (a legendary
// card wears a crown). marks: locked (not owned: grey, the frame muted), on (in the blueprint shown),
// fresh (new), sel (opened). small: no kind line and the small picture (the blueprint's places, the
// missions' rewards, the pack); big: the card on its stand (the Cards page).
export function cardFace(k, { locked = false, on = false, fresh = false, sel = false, tag = 'div', small = false, big = false } = {}) {
  const kind = isBasic(k) ? 'basic' : BUILDINGS[k].kind;
  const r = rarityOf(k);
  const cls = ['cc', 'r-' + r, 'k-' + kind, locked && 'locked', on && 'on', fresh && 'fresh', sel && 'sel', small && 'small', big && 'big'].filter(Boolean).join(' ');
  const attrs = tag === 'button' ? ` type="button" aria-pressed="${sel}"` : '';
  const pts = ptsShort(k);
  return `<${tag} class="${cls}" data-k="${k}" style="--dc:${cardColor(k)}"${attrs} title="${esc(`${cardName(k)} · ${t(RARITY_NAMES[r])}`)}">
    ${r === 'legendary' ? CROWN : ''}${pts ? `<span class="cc-pts num">${pts}</span>` : ''}
    <span class="cc-art"><span class="cc-pic" style="--pic:url(assets/cards/bld_${k}${small ? '_s' : ''}.webp)"></span>${cardIcon(k, big ? 84 : small ? 30 : 46)}</span>
    <span class="cc-gem">${gemSvg(r)}</span>
    <b class="cc-name">${esc(cardName(k))}</b>
    ${small ? '' : `<small class="cc-kind"><i aria-hidden="true"></i>${esc(kindLine(k))}</small>`}
    ${fresh && !locked ? `<span class="cc-new">${esc(t('新'))}</span>` : ''}
  </${tag}>`;
}

// a cost as resource cards large enough to read: the card, how many, its name
function costBig(cost) {
  return `<span class="cb-row">${Object.entries(cost)
    .map(([r, n]) => `<span class="cb" title="${esc(RES_NAMES[r])}">${resIcon(r, 38)}<span class="cb-n"><b class="num">×${n}</b><small>${esc(RES_NAMES[r])}</small></span></span>`)
    .join('')}</span>`;
}

// A card opened: the card itself, large, on a lit stand; its rarity and points; the cost in large
// resource cards (a wonder: its three stages); what it asks and does.
export function cardDetail(k, { on = false, locked = false } = {}) {
  const b = BUILDINGS[k];
  const r = rarityOf(k);
  const pts = isBasic(k) ? (k === 'settlement' ? t('{n} 分', { n: 1 }) : k === 'city' ? t('{n} 分', { n: 2 }) : '') : b.kind === 'wonder' ? t('完工 {n} 分', { n: WONDER_VP }) : k === 'adventurers' ? t('持有最大騎士團時 +{n}', { n: SCORE_VP }) : k === 'post' ? t('持有最長道路時 +{n}', { n: SCORE_VP }) : t('{n} 分', { n: 1 });
  const cost = isBasic(k)
    ? costBig(COSTS[k])
    : b.kind === 'wonder'
      ? b.stages.map((c, i) => `<div class="cd-stage"><i class="num">${i + 1}</i>${costBig(c)}</div>`).join('')
      : costBig(b.cost);
  const words = isBasic(k)
    ? `<p class="cd-fx">${esc(t(BASIC_TEXT[k]))}</p><p class="cd-note">${esc(t('沒放進藍圖的話，這局就不能花錢蓋（開局照常放村莊和道路）。'))}</p>`
    : `<p class="cd-cond"><b>${esc(t('條件'))}</b>${esc(t(BUILDING_TEXT[k].cond))}</p><p class="cd-fx"><b>${esc(t('效果'))}</b>${esc(t(BUILDING_TEXT[k].fx))}</p>`;
  return `<div class="cd r-${r}${on ? ' on' : ''}${locked ? ' locked' : ''}" style="--dc:${cardColor(k)}">
    <div class="cd-show" role="img" aria-label="${esc(cardName(k))}">${cardFace(k, { big: true, locked, on })}</div>
    <div class="cd-meta">${rarityTag(r)}${pts ? `<span class="cd-pts">${esc(pts)}</span>` : ''}</div>
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

// ── the Cards page ──

// an empty place in the blueprint: a building's elevation sketched in a draughtsman's lines
const SKETCH =
  '<svg class="cp-sketch" viewBox="0 0 40 40" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">' +
  '<path d="M9 33V18.5L20 9.5l11 9V33z"/><path d="M16.5 33v-7h7v7"/><path d="M12.5 21.5h4M23.5 21.5h4"/><path d="M5 36h30" stroke-dasharray="1.5 2.5"/>' +
  '<path d="M5.5 18.5v14.5M4 18.5h3M4 33h3" stroke-width="0.9"/><path d="M20 4.5v3M9 7h22" stroke-width="0.9" stroke-dasharray="1.5 2"/></g></svg>';
// the card shown when none is picked: the last one looked at (kept for the next visit)
let looked = null;

export function cardsPage(host, settings, save) {
  const c = collection();
  const body = el('div', 'cards-page');
  let cur = [0, 1, 2].includes(settings.bpCur) ? settings.bpCur : 0;
  let sel = null;
  // the rarity the collection shows (null: every card)
  let only = null;
  let toTop = false;
  let flash = '';
  // (the blueprints keep to the cards owned: one shown with a card that went is put right)
  for (let i = 0; i < 3; i++) settings.bps[i] = ownedBlueprint(c, settings.bps[i]);
  // the card on the stand: the one picked; else the last one looked at, a new one, the rarest owned
  const shown = () => sel || (looked && ALL_CARDS.includes(looked) ? looked : c.fresh.find((k) => owns(c, k)) || [...ALL_CARDS].reverse().find((k) => owns(c, k)));
  const render = () => {
    const bp = settings.bps[cur];
    const tabs = [0, 1, 2]
      .map((i) => `<button type="button" class="cp-tab${i === cur ? ' on' : ''}" data-set="${i}" aria-pressed="${i === cur}"><b>${esc(t('藍圖 {n}', { n: i + 1 }))}</b><small>${i === settings.bpCur ? esc(t('使用中')) : `${settings.bps[i].length}/${BLUEPRINT_SIZE}`}</small></button>`)
      .join('');
    const slots = Array.from({ length: BLUEPRINT_SIZE }, (_, i) => (bp[i] ? `<button type="button" class="cp-slot" data-slot="${bp[i]}" title="${esc(t('拿出藍圖'))}">${cardFace(bp[i], { small: true })}</button>` : `<span class="cp-slot empty">${SKETCH}<i class="num">${i + 1}</i></span>`)).join('');
    const status = `${bp.length}/${BLUEPRINT_SIZE}${bp.length >= BLUEPRINT_SIZE ? ' · ' + esc(blueprintName(bp)) : ''}`;
    const face = (k) => cardFace(k, { tag: 'button', locked: !owns(c, k), on: bp.includes(k), fresh: c.fresh.includes(k), sel: k === sel });
    // (every card in one grid, by rarity; the rarities' chips show one alone, and how many are owned)
    const chips =
      `<button type="button" class="cp-chip all${only ? '' : ' on'}" data-r="" aria-pressed="${!only}">${esc(t('全部'))}</button>` +
      RARITIES.map((r) => {
        const ks = ALL_CARDS.filter((k) => rarityOf(k) === r);
        return `<button type="button" class="cp-chip${only === r ? ' on' : ''}" data-r="${r}" aria-pressed="${only === r}">${rarityTag(r)}<small class="num">${ks.filter((k) => owns(c, k)).length}/${ks.length}</small></button>`;
      }).join('');
    const cards = ALL_CARDS.filter((k) => !only || rarityOf(k) === only);
    // (the blueprint stays at the top of the page; the collection scrolls under it, kept where it was
    // as the page is drawn again)
    const was = body.querySelector('.cp-scroll');
    const keep = was && !toTop ? was.scrollTop : 0;
    // (the chips' own row, scrolled sideways on a phone, stays where it was)
    const chipsWas = body.querySelector('.cp-filter');
    const chipsKeep = chipsWas ? chipsWas.scrollLeft : 0;
    toTop = false;
    // (a blueprint strip across the top; under it the collection, scrolling, and the card on its stand
    // beside it — on a phone, a sheet coming up from below when a card is picked)
    body.innerHTML = `
      <section class="cp-deck">
        <div class="cp-tabs" role="group" aria-label="${esc(t('藍圖'))}">${tabs}</div>
        <div class="cp-slots">${slots}</div>
        <div class="cp-deckbar"><span class="cp-status num">${status}</span><span class="cp-use"></span></div>
        ${flash ? `<p class="cp-flash" role="status">${esc(flash)}</p>` : ''}
      </section>
      <div class="cp-scroll pg-sheet panel">
        <section class="cp-coll">
          <div class="cp-head"><h4>${esc(t('收藏'))} <span class="num">${ALL_CARDS.filter((k) => owns(c, k)).length}/${ALL_CARDS.length}</span></h4><div class="cp-filter" role="group" aria-label="${esc(t('稀有度'))}">${chips}</div></div>
          <div class="cc-grid cp-grid">${cards.map(face).join('')}</div>
        </section>
        <p class="cp-note">${esc(t('藍圖 7 張，含基本卡（道路、村莊、城市、發展卡）：沒帶的基本卡，這局就不能花錢蓋。開發不用卡牌。最多 1 座世界奇觀；開局帶「使用中」的那套。'))}</p>
      </div>
      <aside class="cp-detail pg-sheet panel" aria-live="polite"></aside>`;
    body.classList.toggle('picked', !!sel);
    if (keep) body.querySelector('.cp-scroll').scrollTop = keep;
    if (chipsKeep) body.querySelector('.cp-filter').scrollLeft = chipsKeep;
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
          // (set down like a seal)
          stamp(body.querySelector('.cp-inuse'));
          pop(body.querySelector('.cp-tab.on small'), { scale: 1.2 });
        }),
      );
    body.querySelectorAll('[data-set]').forEach((b) =>
      b.addEventListener('click', () => {
        const was = cur;
        cur = +b.dataset.set;
        render();
        // (the other blueprint slides in from its side)
        if (was !== cur && !reduced()) body.querySelector('.cp-slots').animate([{ opacity: 0, translate: `${cur > was ? 24 : -24}px 0` }, { opacity: 1, translate: '0 0' }], { duration: 180, easing: EASE.out });
      }),
    );
    body.querySelectorAll('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        sel = b.dataset.slot;
        takeOut(b.dataset.slot);
      }),
    );
    body.querySelectorAll('.cp-coll .cc[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        const was = shown();
        sel = looked = b.dataset.k;
        // (a new card looked at loses its mark)
        if (seen(c, [sel])) commit();
        render();
        if (was !== sel) fadeIn(body.querySelector('.cp-detail'));
      }),
    );
    // a rarity alone (again, or "all": every card)
    body.querySelectorAll('.cp-chip[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = b.dataset.r || null;
        only = r && r !== only ? r : null;
        toTop = true;
        render();
        fadeIn(body.querySelector('.cp-grid'), { y: 6, ms: 180 });
      }),
    );
    paintDetail();
  };
  // A card put in the blueprint flies there from the collection (look: a copy of it as it was, from:
  // where it was), and its place bounces as it lands.
  const landIn = (k, look, from) => {
    const slot = body.querySelector(`.cp-slot[data-slot="${k}"]`);
    const card = slot && slot.querySelector('.cc');
    if (!card || !look || !from || reduced()) return;
    card.style.visibility = 'hidden';
    sfx.whoosh();
    fly(look, from, card, {
      arc: 70,
      onArrive: () => {
        card.style.visibility = '';
        pop(slot, { scale: 1.12 });
        pop(body.querySelector('.cp-status'), { scale: 1.15 });
      },
    });
  };
  // A card taken out of the blueprint: the ones after it close the gap, and it goes back to its place
  // in the collection (or drops away, when that place is out of sight).
  const takeOut = (k) => {
    const before = new Map([...body.querySelectorAll('.cp-slot[data-slot]')].map((s) => [s.dataset.slot, s.getBoundingClientRect()]));
    const old = body.querySelector(`.cp-slot[data-slot="${k}"] .cc`);
    const look = old && old.cloneNode(true);
    const from = old && old.getBoundingClientRect();
    settings.bps[cur] = settings.bps[cur].filter((x) => x !== k);
    save(settings);
    render();
    if (reduced()) return;
    for (const s of body.querySelectorAll('.cp-slot[data-slot]')) {
      const a = before.get(s.dataset.slot);
      if (!a) continue;
      const b = s.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (dx || dy) s.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 220, easing: EASE.out });
    }
    if (!look || !from) return;
    const home = body.querySelector(`.cp-coll .cc[data-k="${k}"]`);
    const r = home && home.getBoundingClientRect();
    // (in sight in the collection's scrolling part)
    const view = body.querySelector('.cp-scroll').getBoundingClientRect();
    if (r && r.bottom > view.top + 10 && r.top < view.bottom - 10) fly(look, from, home, { ms: 420, arc: 30, onArrive: () => pop(home, { scale: 1.06 }) });
    else dropAway(look, from);
  };
  // a card leaving the blueprint for nowhere in sight: it sinks a little and fades
  const dropAway = (look, from) => fly(look, from, { left: from.left + from.width * 0.1, top: from.top + 28, width: from.width * 0.8, height: from.height * 0.8 }, { ms: 260, arc: 0, fade: true });
  // the card on the stand (the one picked, or the one looked at last): everything it does, and putting
  // it in or taking it out
  const paintDetail = () => {
    const box = body.querySelector('.cp-detail');
    const k = shown();
    if (!k) {
      box.innerHTML = `<p class="cp-hint">${esc(t('點一張卡看它的效果，再放進藍圖或拿出來。'))}</p>`;
      return;
    }
    const bp = settings.bps[cur];
    box.innerHTML = cardDetail(k, { on: bp.includes(k), locked: !owns(c, k) });
    // (a phone: the card opened is a sheet over the collection, put away with this)
    const x = btn(icon('cross', 16), 'ghost icon-btn cp-x', () => {
      sel = null;
      render();
    });
    x.setAttribute('aria-label', t('關閉'));
    box.prepend(x);
    const acts = el('div', 'cp-acts');
    if (!owns(c, k)) {
      const how = howToGet(c, k);
      acts.appendChild(el('p', 'cp-how', `<span>${esc(how.text)}</span>`));
      if (how.tab && host.go) acts.appendChild(btn(how.tab === 'missions' ? esc(t('看任務')) : esc(t('去抽卡')), '', () => host.go(how.tab === 'missions' ? 'missions' : 'shop', { tab: 'draw' })));
    } else if (bp.includes(k)) {
      acts.appendChild(
        btn(esc(t('拿出藍圖')), '', () => {
          looked = k;
          takeOut(k);
        }),
      );
    } else {
      acts.appendChild(
        btn(esc(t('放進藍圖')), 'primary', () => {
          looked = k;
          // (the card as it is in the collection, to fly from there)
          const src = body.querySelector(`.cp-coll .cc[data-k="${k}"]`);
          const from = src && src.getBoundingClientRect();
          const look = src && src.cloneNode(true);
          // (one wonder only: the one there makes way, fading out of its place as the new one flies in)
          let gone = null;
          if (isWonder(k) && bp.some(isWonder)) {
            const old = body.querySelector(`.cp-slot[data-slot="${bp.find(isWonder)}"] .cc`);
            if (old) gone = { look: old.cloneNode(true), from: old.getBoundingClientRect() };
            settings.bps[cur] = bp.map((x) => (isWonder(x) ? k : x));
          } else if (bp.length >= BLUEPRINT_SIZE) {
            flash = t('藍圖已滿：先拿出一張');
            render();
            return shake(body.querySelector('.cp-slots'));
          } else settings.bps[cur] = [...bp, k];
          save(settings);
          render();
          if (gone && !reduced()) dropAway(gone.look, gone.from);
          landIn(k, look, from);
        }),
      );
      if (isWonder(k) && bp.some(isWonder)) acts.appendChild(el('p', 'cp-how', esc(t('藍圖只能帶 1 座世界奇觀：會換掉原本的那座'))));
    }
    box.appendChild(acts);
  };
  host.mount(body);
  render();
}

// ── the Draw & Shop page ──

// how long a wonder's back glows before it turns over (collection.css .rv.wonder: the same 0.45 s)
const WONDER_GLOW = 450;
// the missions' progress as last shown (this browser): a bar that has gone up since grows to its new
// length the next time it is shown (after a game)
const SEEN_KEY = 'hexverse-ms-seen';
const readSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY)) || {};
  } catch {
    return {};
  }
};
const writeSeen = (m) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(m));
  } catch {
    /* (private browsing: the bars just show where they are) */
  }
};

const TABS = [
  ['draw', N_('抽卡')],
  ['shop', N_('商店')],
];

// The coins and shards in the page's head, as shown: they count to what the collection holds as coins
// are spent and as coins and shards land on them (made once, so a count is not cut short by a render).
function wallet(host, c) {
  const shown = { coins: c.coins, shards: c.shards };
  const paint = () => {
    const box = host.bals && host.bals();
    if (box && !box.firstChild) box.innerHTML = coinHtml(shown.coins) + shardHtml(shown.shards);
  };
  const balEl = (kind, part = '.num') => {
    const box = host.bals && host.bals();
    return box && box.querySelector(`.cur.${kind === 'coins' ? 'coin' : 'shard'} ${part}`);
  };
  // to the collection's number, counting
  const settle = (kind, ms = 450) => {
    const from = shown[kind];
    shown[kind] = c[kind];
    count(balEl(kind), from, c[kind], { ms, fmt: num });
  };
  // a coin or shard has landed: `by` more
  const bump = (kind, by, i = 0) => {
    shown[kind] = Math.min(c[kind], shown[kind] + by);
    const e = balEl(kind);
    if (e) {
      e.textContent = num(shown[kind]);
      pop(e, { scale: 1.22 });
    }
    sfx.coin(i);
  };
  // n coins (or shards) fly from `from` into the head, the number going up as each lands
  const flying = { coins: 0, shards: 0 };
  const rain = (kind, total, from, n) => {
    const parts = Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
    const to = balEl(kind, '.ico');
    if (!to || reduced()) return bump(kind, total);
    flying[kind]++;
    burst(icon(kind === 'coins' ? 'coin' : 'shard', 22), from, to, n, {
      cls: kind === 'coins' ? '' : 'shard',
      onEach: (i) => bump(kind, parts[i], i),
      // (all landed: the number is what the collection holds)
      onDone: () => --flying[kind] === 0 && shown[kind] !== c[kind] && settle(kind, 200),
    });
  };
  return { paint, settle, bump, rain };
}

// the pack's cards of one rarity under its gem and name, and a word on them (the draw's list, the shop)
const tier = (r, face, note) =>
  `<section class="sp-tier r-${r}"><div class="sp-tierhead">${rarityTag(r)}<small>${esc(note)}</small></div><div class="cc-grid shop">${POOL.filter((k) => rarityOf(k) === r).map(face).join('')}</div></section>`;

// a new card goes into the blueprint in use when that has room
function keeper(settings, save) {
  return (k) => {
    if (settings && slotNew(settings.bps[[0, 1, 2].includes(settings.bpCur) ? settings.bpCur : 0], k)) {
      save(settings);
      return true;
    }
    return false;
  };
}

// opts: tab ('draw', 'shop'), settings and save (a new card goes into the blueprint in use when it has
// room)
export function shopPage(host, opts = {}) {
  const { settings, save } = opts;
  const c = collection();
  let tab = TABS.some(([k]) => k === opts.tab) ? opts.tab : 'draw';
  let reveal = null;
  let note = '';
  const body = el('div', 'shop-page');
  const gained = keeper(settings, save);
  const { paint: balances, settle, bump, rain } = wallet(host, c);
  const render = () => {
    const tabs = TABS.map(([k, label]) => `<button type="button" class="sp-tab${k === tab ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${k === tab}">${esc(t(label))}</button>`).join('');
    body.innerHTML = `<div class="sp-tabs" role="tablist">${tabs}</div><div class="sp-body sp-${tab}${tab === 'shop' ? ' pg-sheet panel' : ''}"></div>${note ? `<p class="sp-note" role="status">${esc(note)}</p>` : ''}`;
    note = '';
    body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => ((tab = b.dataset.tab), (reveal = null), render())));
    const box = body.querySelector('.sp-body');
    if (tab === 'draw') paintDraw(box);
    else paintShop(box);
    balances();
  };

  // drawing: the pack's banner (its legendary cards fanned out under a light), one or ten, what came
  // out (turning over one after another), then every card in the pack by rarity, the ones owned in colour
  const paintDraw = (box) => {
    const total = POOL.length;
    const wonders = POOL.filter(isWonder);
    const fan = wonders.map((k, i) => `<div class="sp-fc" style="--i:${i - (wonders.length - 1) / 2}">${cardFace(k, { small: true })}</div>`).join('');
    box.innerHTML = `
      <div class="sp-banner pg-sheet panel">
        <div class="sp-stage" aria-hidden="true"><div class="sp-fan">${fan}</div></div>
        <div class="sp-packinfo">
          <b>${esc(t('建築卡包'))}</b>
          <p>${esc(t('{n} 種建築、{w} 座世界奇觀，抽到已經有的卡換成碎片（建築 {a}、奇觀 {b}）。', { n: total - wonders.length, w: wonders.length, a: dupShards(POOL.find((k) => !isWonder(k))), b: dupShards(wonders[0]) }))}</p>
          <div class="sp-odds"><span>${esc(t('每次抽到'))}</span>${['epic', 'legendary'].map((r) => `${rarityTag(r)}<b class="num">${(POOL.filter((k) => rarityOf(k) === r).reduce((p, k) => p + chanceOf(k), 0) * 100).toFixed(1)}%</b>`).join('')}</div>
          <div class="sp-buy"></div>
        </div>
      </div>
      <div class="sp-reveal"></div>
      <div class="sp-pool pg-sheet panel">
        <h4 class="pg-h">${esc(t('卡包裡的卡'))}</h4>
        ${['epic', 'legendary'].map((r) => tier(r, (k) => cardFace(k, { small: true, locked: !owns(c, k) }), t('{n} 張，每張 {p}%', { n: POOL.filter((k) => rarityOf(k) === r).length, p: (chanceOf(POOL.find((k) => rarityOf(k) === r)) * 100).toFixed(1) }))).join('')}
        <p class="sp-earn">${esc(t('金幣怎麼來：打完一局 +{a}、獲勝 +{b}、線上房間 +{c}、每天第一局 +{d}，還有任務。', { a: COINS.game, b: COINS.win, c: COINS.online, d: COINS.daily }))}</p>
      </div>`;
    const buy1 = btn(`${esc(t('抽 1 次'))}${coinHtml(DRAW_COST)}`, 'primary sp-draw', () => doDraw(1));
    const buy10 = btn(`${esc(t('抽 10 次'))}${coinHtml(DRAW10_COST)}`, 'primary sp-draw', () => doDraw(10));
    buy1.disabled = c.coins < DRAW_COST;
    buy10.disabled = c.coins < DRAW10_COST;
    box.querySelector('.sp-buy').append(buy1, buy10);
    if (c.coins < DRAW_COST) box.querySelector('.sp-buy').appendChild(el('small', 'sp-short', esc(t('金幣不夠：打一局或完成任務'))));
    if (reveal) {
      const r = box.querySelector('.sp-reveal');
      r.classList.toggle('ten', reveal.length > 1);
      // (a wonder's back glows gold for a moment before it turns over: collection.css .rv.wonder)
      r.innerHTML = reveal
        .map(
          (x, i) => `<div class="rv${isWonder(x.k) ? ' wonder' : ''}" style="--i:${i}">${isWonder(x.k) ? '<i class="rv-glow" aria-hidden="true"></i>' : ''}<div class="rv-in"><div class="rv-back cc-back">${CARD_BACK}</div><div class="rv-face">${cardFace(x.k, { small: reveal.length > 1 })}</div></div>
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
    settle('coins');
    // a card drawn again turns into shards: they fly from under it into the head as its tag shows
    // (the tags show one after another, a wonder's after its glow: collection.css .rv-tag, .rv.wonder)
    const box = body.querySelector('.sp-reveal');
    const tags = box.querySelectorAll('.rv-tag');
    const later = [];
    // (each runs once: on time, or at once when all are turned over)
    const at = (fn, ms, sound = false) => {
      const l = { fn, sound };
      l.id = setTimeout(() => {
        const i = later.indexOf(l);
        if (i >= 0) later.splice(i, 1);
        fn();
      }, ms);
      later.push(l);
    };
    let end = 0;
    reveal.forEach((x, i) => {
      const wait = isWonder(x.k) ? WONDER_GLOW : 0;
      end = Math.max(end, 750 + i * 130 + wait);
      if (isWonder(x.k) && !reduced()) at(() => box.isConnected && sfx.fanfare(false), 330 + i * 130 + wait, true);
      if (x.fresh) return;
      const tag = tags[i];
      at(() => (tag && tag.isConnected ? rain('shards', x.shards, tag, 2) : bump('shards', x.shards)), reduced() ? 0 : 640 + i * 130 + wait);
    });
    if (reduced() || reveal.length < 2) return;
    // ten at once take a while: "turn them all over" (or a click on the cards) shows them at once
    const skip = btn(esc(t('全部翻開')), 'ghost rv-skip', () => flipAll());
    box.after(skip);
    const flipAll = () => {
      if (!skip.isConnected) return;
      skip.remove();
      for (const a of box.getAnimations({ subtree: true })) a.finish();
      // (what was still to come, at once; a wonder's fanfare once)
      let sound = null;
      for (const l of later.splice(0)) {
        clearTimeout(l.id);
        if (l.sound) sound = l.fn;
        else l.fn();
      }
      if (sound) sound();
    };
    box.addEventListener('click', flipAll, { once: true });
    setTimeout(() => skip.isConnected && skip.remove(), end + 300);
  };

  // the shop: the cards of the pack for shards, by rarity
  const paintShop = (box) => {
    box.innerHTML = `<p class="sp-lead">${esc(t('用抽到重複卡換來的碎片，兌換指定的卡。'))}</p>${['epic', 'legendary'].map((r) => tier(r, () => '', t('每張 {n} 碎片', { n: priceOf(POOL.find((k) => rarityOf(k) === r)) }))).join('')}`;
    for (const k of POOL) {
      const grid = box.querySelector(`.sp-tier.r-${rarityOf(k)} .cc-grid`);
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
          if (r.error) return;
          // the shards counted off, the card stamped as owned
          settle('shards');
          const card = body.querySelector(`.sp-item .cc[data-k="${k}"]`);
          if (card) {
            pop(card, { scale: 1.08 });
            stamp(card.parentElement.querySelector('.sp-owned'));
          }
        });
        b.disabled = c.shards < priceOf(k);
        cell.appendChild(b);
      }
      grid.appendChild(cell);
    }
  };

  host.mount(body);
  render();
}

// opts: settings and save (a card won goes into the blueprint in use when it has room)
export function missionsPage(host, opts = {}) {
  const { settings, save } = opts;
  const c = collection();
  let note = '';
  const body = el('div', 'missions-page');
  const gained = keeper(settings, save);
  const { paint: balances, rain } = wallet(host, c);
  const render = () => {
    body.innerHTML = `<div class="sp-body sp-missions pg-sheet panel"></div>${note ? `<p class="sp-note" role="status">${esc(note)}</p>` : ''}`;
    note = '';
    paintMissions(body.querySelector('.sp-body'));
    balances();
  };

  // the missions: the granary's cards first, then the challenges
  const paintMissions = (box) => {
    const was = readSeen();
    const now = {};
    const grow = [];
    const row = (m) => {
      const s = missionState(c, m.id);
      const reward = m.reward.card ? `${cardFace(m.reward.card, { small: true, locked: !owns(c, m.reward.card) && !s.got })}` : `<span class="ms-coins">${coinHtml(m.reward.coins)}</span>`;
      const pct = Math.min(100, Math.round((100 * s.n) / s.goal));
      now[m.id] = s.n;
      if (typeof was[m.id] === 'number' && was[m.id] < s.n) grow.push([m.id, Math.min(100, Math.round((100 * was[m.id]) / s.goal)), pct]);
      // (the bar is as long as the track, slid back by what is still to do)
      return `<div class="ms-row${s.done ? ' done' : ''}${s.got ? ' got' : ''}" data-m="${m.id}">
        <div class="ms-text"><b>${esc(t(m.text))}</b><span class="ms-bar" aria-hidden="true"><i style="translate:${pct - 100}% 0"></i></span><small class="num">${s.n}/${s.goal}</small></div>
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
    // what went up since the last look grows from where it was, one after another
    writeSeen(now);
    if (!reduced())
      grow.forEach(([id, from, to], i) => {
        const bar = box.querySelector(`.ms-row[data-m="${id}"] .ms-bar i`);
        if (bar) bar.animate([{ translate: `${from - 100}% 0` }, { translate: `${to - 100}% 0` }], { duration: 650, delay: 220 + i * 90, easing: EASE.out, fill: 'backwards' });
      });
    box.querySelectorAll('[data-claim]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.claim;
        const from = b.getBoundingClientRect();
        const r = claim(c, id);
        if (!r) return;
        if (r.coins) note = t('領到 {n} 金幣', { n: r.coins });
        else if (r.shards) note = t('已經有{name}：換成 {n} 碎片', { name: buildingName(r.card), n: r.shards });
        else note = gained(r.card) ? t('拿到{name}，已放進藍圖', { name: buildingName(r.card) }) : t('拿到{name}', { name: buildingName(r.card) });
        commit();
        render();
        // the reward on its way: coins (or shards) into the head, a card turning over; the row stamped
        const row = body.querySelector(`.ms-row[data-m="${id}"]`);
        if (r.coins) rain('coins', r.coins, from, Math.max(3, Math.min(8, Math.round(r.coins / 30))));
        else if (r.shards) rain('shards', r.shards, from, 3);
        else if (row) pop(row.querySelector('.ms-reward .cc'), { scale: 1.18, ms: 320 });
        if (row) stamp(row.querySelector('.ms-got'), { sound: !r.coins && !r.shards });
      }),
    );
  };

  host.mount(body);
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
  const cardsHtml = bp.map((k) => `<span class="dk-card" style="--dc:${rarityColor(k)}" title="${esc(cardName(k))}">${cardIcon(k, 16)}</span>`).join('') + '<span class="dk-card empty"></span>'.repeat(BLUEPRINT_SIZE - bp.length);
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
    ${done.length ? `<div class="rw-missions">${icon('mission', 18)}<span>${esc(t('任務完成：'))}${list(done.map((m) => `<b>${esc(t(m.text))}</b>`))}<small>${esc(t('到主畫面的「任務」領取'))}</small></span></div>` : ''}`;
  // once on screen: the coins counted up from nothing, what for line by line, then the missions done
  whenShown(box, () => {
    count(box.querySelector('.rw-coins > b'), 0, out.total, { ms: 800, delay: 250, fmt: (n) => '+' + num(n) });
    box.querySelectorAll('.rw-line').forEach((x, i) => fadeIn(x, { delay: 250 + i * 160, y: 4 }));
    const m = box.querySelector('.rw-missions');
    if (m) fadeIn(m, { delay: 1100, y: 10, ms: 260 });
    if (out.total) setTimeout(() => sfx.coin(3), 1000);
  });
  return box;
}

// the marks on the side bar (pages.js): new cards, rewards waiting; the coins and shards
export function homeMarks() {
  const c = collection();
  return { fresh: c.fresh.length, claim: claimable(c), coins: c.coins, shards: c.shards };
}
export { onCards };
