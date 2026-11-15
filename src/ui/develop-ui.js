// The development mode's interface pieces (the rules are in engine/develop.js): what each building does
// in words (the Cards page shows it: cards-ui.js), the strip of a nation's blueprint in the nations'
// panel, and the dialogs of a turn.
import { BUILDINGS, BUILDING_NAMES, DIR_NAMES, PRESETS, PRESET_IDS, PRESET_NAMES, BASIC, BASIC_NAMES, isWonder, validBlueprint, specialsOf, WONDER_VP, SCORE_VP, PLOT_COST } from '../engine/develop.js';
import { buildingIcon, icon, resIcon, RES_NAMES } from './icons.js';
import { t, N_ } from '../i18n/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// each direction's colour (the cards' frames, the build menu's marks)
export const DIR_COLOR = { farm: '#6f8f2c', trade: '#2a76a0', army: '#a4362a', frontier: '#b0702a', lore: '#6a4c9c' };

// what each building asks and does (keys, read through t())
export const BUILDING_TEXT = {
  aqueduct: { cond: N_('所附的聚落相鄰你的開發地塊'), fx: N_('擲骰不是 7、而你一張資源都沒拿到時，自動拿 1 張手上最少的資源') },
  granary: { cond: N_('所附的聚落相鄰田地'), fx: N_('擲出 7 時，手牌超過 10 張才需要棄牌（原本 7 張）') },
  market: { cond: N_('所附的聚落相鄰 3 種不同的產資源地形'), fx: N_('每回合一次，用 2 張同種資源向銀行換 1 張任意資源') },
  shipyard: { cond: N_('所附的聚落在海岸邊'), fx: N_('蓋的時候選一種資源，之後這種資源可以 2:1 和銀行交易') },
  guild: { cond: N_('你至少有 1 個港口（聚落在港口上，或已有造船廠）'), fx: N_('你和其他國家成交時，雙方各從銀行多拿 1 張自己換到的資源；每回合一次') },
  barracks: { cond: N_('你至少有 1 座城市'), fx: N_('買發展卡時可以改成指定拿騎士（牌堆還有騎士時）') },
  wall: { cond: N_('附在你的一座聚落旁'), fx: N_('這座聚落不受強盜影響：照常產出，也不會因為它被搶') },
  mercenaries: { cond: N_('你至少打出過 1 張騎士'), fx: N_('你移動強盜後，從那塊地旁的每位對手各搶 1 張') },
  adventurers: { cond: N_('你至少打出過 3 張騎士'), fx: N_('計分建築，沒有其他效果') },
  post: { cond: N_('你的最長道路至少 5 條'), fx: N_('計分建築，沒有其他效果') },
  camp: { cond: N_('所附的聚落相鄰一塊沒有其他建築的地塊'), fx: N_('之後每蓋一座村莊，立刻從它相鄰的地塊各拿 1 張資源') },
  academy: { cond: N_('你至少買過 2 張發展卡'), fx: N_('買發展卡時抽 2 張留 1 張，另一張放回牌堆底') },
  press: { cond: N_('所附的聚落相鄰森林'), fx: N_('當回合買的發展卡可以立刻使用（仍然每回合只能打一張）') },
  gardens: { cond: N_('沙漠的路口上要有你的村莊或城市'), fx: N_('你所有開發地塊每次產出時，再多拿 1 張（種類和一級開發相同）') },
  lighthouse: { cond: N_('沙漠的路口上要有你的村莊或城市'), fx: N_('你和銀行交易一律 2:1（任何資源）') },
  greatWall: { cond: N_('沙漠的路口上要有你的村莊或城市'), fx: N_('強盜不能移到你任何聚落相鄰的地塊；長城本身因此不會再被摧毀') },
  royalRoad: { cond: N_('沙漠的路口上要有你的村莊或城市'), fx: N_('每回合可以免費蓋 1 條道路') },
  library: { cond: N_('沙漠的路口上要有你的村莊或城市'), fx: N_('每回合一次，用任意 1 張資源買 1 張發展卡') },
};
// the development (not a building of the blueprints: everyone may build it)
export const DEVELOP_TEXT = N_('在你有聚落的地塊上蓋產量設施：這塊地每次產出時，你多拿 1 張所選資源。最多兩級；選這塊地本身的資源比較便宜。');

export const buildingName = (k) => t(BUILDING_NAMES[k]);
// a building's points in words
export function pointsText(k) {
  const kind = BUILDINGS[k].kind;
  if (kind === 'wonder') return t('完工 {n} 分', { n: WONDER_VP });
  if (k === 'adventurers') return t('持有最大騎士團時 +{n}', { n: SCORE_VP });
  if (k === 'post') return t('持有最長道路時 +{n}', { n: SCORE_VP });
  return t('{n} 分', { n: 1 });
}

// a cost as small cards with counts
export function costHtml(cost, size = 18) {
  return Object.entries(cost)
    .map(([r, n]) => `<span class="dv-need" title="${esc(RES_NAMES[r])}">${resIcon(r, size)}<b class="num">${n}</b></span>`)
    .join('');
}

// the name of a blueprint: a ready-made one's, or "your own"
export function blueprintName(bp) {
  if (!validBlueprint(bp)) return t('未完成的藍圖');
  const k = PRESET_IDS.find((id) => PRESETS[id].length === bp.length && PRESETS[id].every((x) => bp.includes(x)));
  return k ? t(PRESET_NAMES[k]) : t('自訂藍圖');
}
// What a nation has of its blueprint, for the nations' panel: each building lit when built, the
// wonder with its stages.
export function nationStrip(v, p) {
  const pl = v.players[p];
  if (!pl.bp) return '';
  const built = pl.built || {};
  const w = (v.wonders || []).find((x) => x.p === p);
  // (the basic cards it left out, crossed: it cannot pay for those this game)
  const missing = v.rules && v.rules.cards ? BASIC.filter((k) => !pl.bp.includes(k)).map((k) => `<span class="bp-mini nobasic" title="${esc(t('沒帶{name}卡', { name: t(BASIC_NAMES[k]) }))}">${icon(BASIC_ICON[k], 14)}</span>`) : [];
  const items = specialsOf(pl.bp).map((k) => {
    let cls = 'bp-mini';
    let mark = '';
    let title = buildingName(k);
    if (isWonder(k)) {
      if (w && w.k === k) {
        cls += w.done ? ' built' : ' going';
        mark = w.done ? '' : `<i>${w.s}/3</i>`;
        title += w.done ? t('（完工）') : t('（施工中 {s}/3）', { s: w.s });
      }
    } else if (built[k] !== undefined) {
      cls += ' built';
      title += t('（已建造）');
    }
    return `<span class="${cls}" style="--dc:${DIR_COLOR[BUILDINGS[k].dir]}" title="${esc(title)}">${buildingIcon(k, 14)}${mark}</span>`;
  });
  return `<div class="bp-strip">${[...items, ...missing].join('')}</div>`;
}
// the basic cards' figures (icons.js)
const BASIC_ICON = { road: 'road', settlement: 'settlement', city: 'city', dev: 'devbuy' };

// the development's cost for a hex and a resource, as words for a choice
export function plotCostHtml(level, local, r) {
  const c = PLOT_COST[level][r === local ? 'local' : 'other'];
  return costHtml(c, 16);
}

// the five resources to choose one from (a development, the shipyard), each with what it costs
export function resourceChoice(onPick, costOf = null) {
  const box = document.createElement('div');
  box.className = 'res-choice';
  for (const r of ['wood', 'brick', 'wool', 'grain', 'ore']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'res-pick';
    b.dataset.res = r;
    const c = costOf ? costOf(r) : null;
    b.innerHTML = `${resIcon(r, 34)}<b>${esc(RES_NAMES[r])}</b>${c ? `<span class="rp-cost">${costHtml(c.cost, 14)}</span>${c.off ? `<small class="why">${esc(c.off)}</small>` : ''}` : ''}`;
    if (c && c.off) b.classList.add('off');
    b.addEventListener('click', () => !b.classList.contains('off') && onPick(r));
    box.appendChild(b);
  }
  return box;
}

// ── the dialogs of a turn in the development mode ──

const DEV_NAMES = { knight: N_('騎士'), victoryPoint: N_('分數卡'), roadBuilding: N_('道路建設'), yearOfPlenty: N_('豐收之年'), monopoly: N_('壟斷') };
const btn = (label, cls, onClick) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + (cls || '');
  b.innerHTML = label;
  b.addEventListener('click', onClick);
  return b;
};
const div = (cls, html) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (html != null) d.innerHTML = html;
  return d;
};

// A development on hex h, or its second level: the resource it brings, each with its cost (the hex's
// own is one card cheaper); those the hand cannot pay are shut.
export function developDialog(dialogs, { res, level, local, place }, onPick) {
  const body = div('dv-dialog');
  body.appendChild(div('lead', `<p>${esc(level ? t('{place}：二級開發（精耕），再選一種資源（可以和一級相同）。', { place }) : t('{place}：一級開發（開墾）。這塊地每次產出時，你多拿 1 張所選的資源。', { place }))}</p><p class="note">${esc(t('選這塊地本身的資源（{res}）比較便宜。', { res: RES_NAMES[local] }))}</p>`));
  body.appendChild(
    resourceChoice(onPick, (r) => {
      const cost = PLOT_COST[level][r === local ? 'local' : 'other'];
      const short = Object.entries(cost).some(([x, n]) => (res[x] || 0) < n);
      return { cost, off: short ? t('資源不足') : '' };
    }),
  );
  dialogs.open({ kind: 'develop', title: level ? t('二級開發') : t('開發'), body, foot: [btn(t('取消'), '', () => dialogs.close())], cls: 'narrow' });
}

// the shipyard's resource: 2:1 with the bank from now on
export function shipyardDialog(dialogs, onPick) {
  const body = div('dv-dialog');
  body.appendChild(div('lead', `<p>${esc(t('選一種資源：之後這種資源可以 2:1 和銀行交易。'))}</p>`));
  body.appendChild(resourceChoice(onPick));
  dialogs.open({ kind: 'develop', title: t('造船廠'), body, foot: [btn(t('取消'), '', () => dialogs.close())], cls: 'narrow' });
}

// Buying a development card when a building changes how: the barracks (the top knight), the academy
// (two drawn, one kept), the great library (paid with any one resource, once a turn).
// opts: { barracks, academy, library, normal (the hand pays the usual cost), res (the hand) }
export function buyDevDialog(dialogs, opts, onBuy) {
  let how = opts.academy ? 'pick' : '';
  let lib = opts.normal || !opts.library ? null : RES_ORDER.find((r) => opts.res[r] > 0) || null;
  const body = div('dv-dialog');
  const buy = btn(t('購買'), 'primary', () => onBuy({ how: how || undefined, lib: lib || undefined }));
  const render = () => {
    const draws = [['', t('照常抽一張'), '']];
    if (opts.barracks) draws.push(['knight', t('兵營：指定拿騎士'), t('牌堆最上面的一張騎士（牌堆沒有騎士時照常抽）')]);
    if (opts.academy) draws.push(['pick', t('學院：抽 2 張留 1 張'), t('另一張放回牌堆底')]);
    const pays = [];
    if (opts.normal) pays.push([null, t('羊毛、小麥、礦石各 1'), '']);
    if (opts.library) for (const r of RES_ORDER) if (opts.res[r] > 0) pays.push([r, t('大圖書館：用 1 張{res}', { res: RES_NAMES[r] }), '']);
    body.innerHTML = '';
    if (draws.length > 1) {
      body.appendChild(div('dv-h', esc(t('抽法'))));
      const g = div('dv-opts');
      for (const [k, label, note] of draws) {
        const b = btn(`<b>${esc(label)}</b>${note ? `<small>${esc(note)}</small>` : ''}`, 'dv-opt' + (how === k ? ' on' : ''), () => ((how = k), render()));
        g.appendChild(b);
      }
      body.appendChild(g);
    }
    if (pays.length > 1) {
      body.appendChild(div('dv-h', esc(t('付法'))));
      const g = div('dv-opts');
      for (const [r, label] of pays) {
        const b = btn(`${r ? resIcon(r, 18) : costHtml({ wool: 1, grain: 1, ore: 1 }, 14)}<b>${esc(label)}</b>`, 'dv-opt' + (lib === r ? ' on' : ''), () => ((lib = r), render()));
        g.appendChild(b);
      }
      body.appendChild(g);
    }
    buy.disabled = !opts.normal && !lib;
  };
  render();
  dialogs.open({ kind: 'dev', title: t('購買發展卡'), body, foot: [btn(t('取消'), '', () => dialogs.close()), buy], cls: 'narrow' });
}
const RES_ORDER = ['wood', 'brick', 'wool', 'grain', 'ore'];

// The academy: of the two cards drawn, the one to keep (the other goes under the deck).
export function pickDevDialog(dialogs, cards, devCard, onPick) {
  const body = div('dv-dialog');
  body.appendChild(div('lead', `<p>${esc(t('學院：從抽到的兩張中留下一張，另一張放回牌堆底。'))}</p>`));
  const g = div('dv-pick');
  cards.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dv-card';
    b.innerHTML = `${devCard(c, t(DEV_NAMES[c]), { lg: true })}<b>${esc(t(DEV_NAMES[c]))}</b>`;
    b.addEventListener('click', () => onPick(i));
    g.appendChild(b);
  });
  body.appendChild(g);
  dialogs.open({ kind: 'dev', title: t('學院'), body, dismissable: false, cls: 'narrow' });
}

// The robber has come to your wonder: a knight from your hand saves it. seconds: a limit (online), at
// the end of which a knight in hand defends by itself.
export function defendDialog(dialogs, { who, wonder, stage, done, knights, seconds }, onAnswer) {
  const body = div('dv-dialog defend');
  const state = done ? t('已完工') : t('施工中 {s}/3', { s: stage });
  body.innerHTML = `<p class="lead">${t('{who} 把強盜移到你的<b>{wonder}</b>（{state}）。', { who, wonder: esc(wonder), state: esc(state) })}</p>
    <p>${esc(knights ? t('打出手上 1 張騎士就能保住它（算進你打出的騎士數，不受每回合一張的限制）；不防衛的話，奇觀被摧毀，已付的資源不退。') : t('你手上沒有騎士，保不住這座奇觀：它會被摧毀，已付的資源不退。'))}</p>`;
  let timer = null;
  const answer = (yes) => {
    if (timer) clearInterval(timer);
    onAnswer(yes);
  };
  const yes = btn(`${icon('knight', 18)}${esc(t('打出騎士防衛'))}`, 'primary', () => answer(true));
  yes.disabled = !knights;
  const no = btn(esc(knights ? t('不防衛') : t('知道了')), '', () => answer(false));
  if (seconds) {
    const bar = div('timebar', '<i></i>');
    body.appendChild(bar);
    let left = seconds;
    timer = setInterval(() => {
      left--;
      bar.firstChild.style.width = (left / seconds) * 100 + '%';
      if (left <= 0) answer(knights > 0);
    }, 1000);
  }
  const h = dialogs.open({ kind: 'defend', title: t('奇觀遭到攻擊'), body, foot: [no, yes], dismissable: false, cls: 'narrow' });
  h.timer = timer;
  return h;
}

// The market: two of a kind for one of any other, once a turn.
export function marketDialog(dialogs, { res, bank }, onTrade) {
  let give = RES_ORDER.find((r) => res[r] >= 2) || null;
  let get = null;
  const body = div('dv-dialog');
  const go = btn(t('交換'), 'primary', () => onTrade(give, get));
  const render = () => {
    body.innerHTML = `<p class="lead">${esc(t('市集：每回合一次，用 2 張同種資源向銀行換 1 張任意資源。'))}</p>`;
    body.appendChild(div('dv-h', esc(t('給出 2 張'))));
    const a = div('dv-opts res');
    for (const r of RES_ORDER) {
      const b = btn(`${resIcon(r, 26)}<small>${res[r]}</small>`, 'dv-res' + (give === r ? ' on' : ''), () => ((give = r), get === r && (get = null), render()));
      b.disabled = res[r] < 2;
      b.title = RES_NAMES[r];
      a.appendChild(b);
    }
    body.appendChild(a);
    body.appendChild(div('dv-h', esc(t('換到 1 張'))));
    const c = div('dv-opts res');
    for (const r of RES_ORDER) {
      const b = btn(`${resIcon(r, 26)}<small>${t('銀行 {n}', { n: bank[r] })}</small>`, 'dv-res' + (get === r ? ' on' : ''), () => ((get = r), render()));
      b.disabled = r === give || bank[r] <= 0;
      b.title = RES_NAMES[r];
      c.appendChild(b);
    }
    body.appendChild(c);
    go.disabled = !give || !get;
  };
  render();
  dialogs.open({ kind: 'trade', title: t('市集'), body, foot: [btn(t('取消'), '', () => dialogs.close()), go], cls: 'narrow' });
}

export { icon };
