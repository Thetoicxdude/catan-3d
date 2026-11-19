// The development mode's interface pieces (the rules are in engine/develop.js): what each building does
// in words (the Cards page shows it: cards-ui.js), the strip of a nation's blueprint in the nations'
// panel, and the dialogs of a turn.
import { BUILDINGS, BUILDING_NAMES, DIR_NAMES, PRESETS, PRESET_IDS, PRESET_NAMES, BASIC, BASIC_NAMES, isWonder, validBlueprint, specialsOf, WONDER_VP, SCORE_VP, PLOT_COST, GUILD_HALL_PER, funcVP, CARAVAN_GIVE } from '../engine/develop.js';
import { buildingIcon, icon, resIcon, costTokens, RES_NAMES } from './icons.js';
import { t, N_ } from '../i18n/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// each direction's colour (the cards' frames, the build menu's marks)
export const DIR_COLOR = { farm: '#6f8f2c', trade: '#2a76a0', army: '#a4362a', frontier: '#b0702a', lore: '#6a4c9c', neutral: '#66707a' };

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
  // (2026-11-18) the directions': each lifts a limit of the rules
  farmstead: { cond: N_('所附的聚落是城市'), fx: N_('這座城市相鄰的開發地塊可以升到三級，每次產出再多拿 1 張') },
  homestead: { cond: N_('你至少有 2 個開發'), fx: N_('旁邊有你道路的地塊也能開發，不需要聚落') },
  grange: { cond: N_('你至少有 1 個二級開發'), fx: N_('計分建築：開發數最多（至少 3 個，平手也算）時 +3') },
  caravan: { cond: N_('所附的聚落不在海岸邊'), fx: N_('在你的回合用 2 張不同的資源向銀行換 1 張任意資源，次數不限') },
  harborOffice: { cond: N_('你至少有 2 個港口（造船廠也算）'), fx: N_('計分建築：港口數最多（至少 3 個，造船廠也算，平手也算）時 +3') },
  roadworks: { cond: N_('你已經有 15 條道路'), fx: N_('道路上限 +10') },
  newTown: { cond: N_('你場上至少有 5 座村莊或城市'), fx: N_('村莊、城市的上限各 +2') },
  townHall: { cond: N_('所附的聚落是城市'), fx: N_('你的每座聚落多附 1 座特殊建築（村莊 2 座、城市 3 座）') },
  governor: { cond: N_('你至少有 3 座村莊'), fx: N_('計分建築：場上村莊數最多（至少 4 座，不算城市，平手也算）時 +3') },
  lectureHall: { cond: N_('你至少打出過 2 張發展卡'), fx: N_('每回合可以打 2 張發展卡（騎士仍然最多 1 張）') },
  scriptorium: { cond: N_('你至少有 1 座城市'), fx: N_('每蓋一座城市，免費拿 1 張發展卡（藍圖不用帶「發展卡」）') },
  university: { cond: N_('你至少拿過 3 張發展卡'), fx: N_('計分建築：拿過的發展卡最多（至少 5 張，平手也算）時 +3') },
  // (the neutral ones: no condition, any blueprint)
  warehouse: { cond: N_('附在你的一座聚落旁'), fx: N_('擲骰後可以存最多 3 張資源：不算手牌、不會被搶、擲出 7 不用棄，在自己的回合拿回') },
  countingHouse: { cond: N_('附在你的一座聚落旁'), fx: N_('你的回合結束時，手牌 8 張以上就從銀行拿 1 張任選資源') },
  almshouse: { cond: N_('附在你的一座聚落旁'), fx: N_('你的回合開始時，手牌 2 張以下就從銀行拿 1 張任選資源') },
  smithy: { cond: N_('附在你的一座聚落旁'), fx: N_('每回合一次，蓋東西缺 1 張資源時，用 1 張礦石代替') },
  terraces: { cond: N_('附在你的一座聚落旁'), fx: N_('你在數字 2、3、11、12 地塊上的聚落，每次產出多拿 1 張') },
  observatory: { cond: N_('附在你的一座聚落旁'), fx: N_('每回合一次，擲骰後可以付 1 張羊毛重擲，用第二次的結果') },
  watchtower: { cond: N_('附在你的一座聚落旁'), fx: N_('別人要把強盜移到這座聚落旁的地塊，得先隨機給你 1 張資源；手上沒牌就不能移過來') },
  temple: { cond: N_('附在你的一座聚落旁'), fx: N_('強盜移到你的聚落旁時，別人不能從你這裡搶牌（產出照樣被擋）') },
  builders: { cond: N_('附在你的一座聚落旁'), fx: N_('你的奇觀每個階段少付 1 張，少付哪張自己選') },
  garrison: { cond: N_('附在你的一座聚落旁'), fx: N_('你的奇觀被強盜攻擊時，也可以改付 2 張任意資源防衛') },
  workshop: { cond: N_('附在你的一座聚落旁'), fx: N_('你蓋特殊建築時少付 1 張，少付哪張自己選') },
  guildHall: { cond: N_('附在你的一座聚落旁'), fx: N_('沒有基本分；你每有 3 座特殊建築（含這座）+1 分') },
  monument: { cond: N_('附在你的一座聚落旁'), fx: N_('2 分，沒有其他效果') },
};
// the development (not a building of the blueprints: everyone may build it)
export const DEVELOP_TEXT = N_('在你有聚落的地塊上蓋產量設施：這塊地每次產出時，你多拿 1 張所選資源。最多兩級（農莊旁的地塊三級）；選這塊地本身的資源比較便宜。');

export const buildingName = (k) => t(BUILDING_NAMES[k]);
// a building's points in words
export function pointsText(k) {
  const kind = BUILDINGS[k].kind;
  if (kind === 'wonder') return t('完工 {n} 分', { n: WONDER_VP });
  if (k === 'adventurers') return t('持有最大騎士團時 +{n}', { n: SCORE_VP });
  if (k === 'post') return t('持有最長道路時 +{n}', { n: SCORE_VP });
  // (2026-11-18) the most of something; the guild hall's
  if (k === 'grange') return t('開發數最多時 +{n}', { n: SCORE_VP });
  if (k === 'harborOffice') return t('港口數最多時 +{n}', { n: SCORE_VP });
  if (k === 'governor') return t('村莊數最多時 +{n}', { n: SCORE_VP });
  if (k === 'university') return t('拿過的發展卡最多時 +{n}', { n: SCORE_VP });
  if (k === 'guildHall') return t('每 {n} 座特殊建築 1 分', { n: GUILD_HALL_PER });
  return t('{n} 分', { n: funcVP(k) });
}

// a cost as resource tokens, one per card (icons.js)
export function costHtml(cost, size = 18) {
  return costTokens(cost, { size, cls: 'dv-need' });
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
    return `<span class="${cls}" data-k="${k}" style="--dc:${DIR_COLOR[BUILDINGS[k].dir]}" title="${esc(title)}">${buildingIcon(k, 14)}${mark}</span>`;
  });
  return `<div class="bp-strip">${[...items, ...missing].join('')}</div>`;
}
// the basic cards' figures (icons.js)
const BASIC_ICON = { road: 'road', settlement: 'settlement', city: 'city', dev: 'devbuy' };

// the development's cost for a hex and a resource, as words for a choice
export function plotCostHtml(level, local, r) {
  const c = PLOT_COST[level][r === local ? 'local' : 'other'];
  return costHtml(c, 18);
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
    b.innerHTML = `${resIcon(r, 34)}<b>${esc(RES_NAMES[r])}</b>${c && c.cost ? `<span class="rp-cost">${costHtml(c.cost, 17)}</span>` : ''}${c && c.off ? `<small class="why">${esc(c.off)}</small>` : ''}`;
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
// (plan: what the hand pays for a cost, the smithy's ore in place of a card it lacks; null: it cannot)
export function developDialog(dialogs, { res, level, local, place, plan = null }, onPick) {
  const body = div('dv-dialog');
  const lead = level >= 2 ? t('{place}：三級開發（農莊），再選一種資源。', { place }) : level ? t('{place}：二級開發（精耕），再選一種資源（可以和一級相同）。', { place }) : t('{place}：一級開發（開墾）。這塊地每次產出時，你多拿 1 張所選的資源。', { place });
  body.appendChild(div('lead', `<p>${esc(lead)}</p><p class="note">${esc(t('選這塊地本身的資源（{res}）比較便宜。', { res: RES_NAMES[local] }))}</p>`));
  body.appendChild(
    resourceChoice(onPick, (r) => {
      const cost = PLOT_COST[level][r === local ? 'local' : 'other'];
      const p = plan ? plan(cost) : Object.entries(cost).every(([x, n]) => (res[x] || 0) >= n) ? { cost } : null;
      return { cost: p ? p.cost : cost, off: p ? '' : t('資源不足') };
    }),
  );
  dialogs.open({ kind: 'develop', title: level >= 2 ? t('三級開發') : level ? t('二級開發') : t('開發'), body, foot: [btn(t('取消'), '', () => dialogs.close())], cls: 'narrow' });
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
        const b = btn(`${r ? resIcon(r, 22) : costHtml({ wool: 1, grain: 1, ore: 1 }, 18)}<b>${esc(label)}</b>`, 'dv-opt' + (lib === r ? ' on' : ''), () => ((lib = r), render()));
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

// The robber has come to your wonder: a knight from your hand saves it (or, with a garrison, two cards
// of any kind: `garrison` is the hand then). seconds: a limit (online), at the end of which a knight in
// hand defends by itself. onAnswer(yes, pay): pay, the garrison's two cards.
export function defendDialog(dialogs, { who, wonder, stage, done, knights, seconds, garrison = null }, onAnswer) {
  const body = div('dv-dialog defend');
  const state = done ? t('已完工') : t('施工中 {s}/3', { s: stage });
  const cards = garrison ? RES_ORDER.reduce((n, r) => n + garrison[r], 0) : 0;
  body.innerHTML = `<p class="lead">${t('{who} 把強盜移到你的<b>{wonder}</b>（{state}）。', { who, wonder: esc(wonder), state: esc(state) })}</p>
    <p>${esc(knights ? t('打出手上 1 張騎士就能保住它（算進你打出的騎士數，不受每回合一張的限制）；不防衛的話，奇觀被摧毀，已付的資源不退。') : garrison && cards >= 2 ? t('你手上沒有騎士，但衛戍所可以改付 2 張資源保住它；不防衛的話，奇觀被摧毀，已付的資源不退。') : t('你手上沒有騎士，保不住這座奇觀：它會被摧毀，已付的資源不退。'))}</p>`;
  let timer = null;
  const answer = (yes, pay) => {
    if (timer) clearInterval(timer);
    onAnswer(yes, pay);
  };
  // (the garrison) two cards, picked one by one (the most plentiful two to begin with)
  let pay = null;
  if (garrison && cards >= 2) {
    pay = {};
    const left = { ...garrison };
    for (let i = 0; i < 2; i++) {
      const r = RES_ORDER.slice().sort((a, b) => left[b] - left[a])[0];
      pay[r] = (pay[r] || 0) + 1;
      left[r]--;
    }
    const box = div('dv-garrison');
    const paint = () => {
      box.innerHTML = `<div class="dv-h">${esc(t('衛戍所：付哪 2 張'))}</div>`;
      const row = div('dv-opts res');
      for (const r of RES_ORDER) {
        const n = pay[r] || 0;
        const b = btn(`${resIcon(r, 26)}<small>${n ? `×${n}` : garrison[r]}</small>`, 'dv-res' + (n ? ' on' : ''), () => {
          // a click adds this card (the oldest pick goes when two are picked already); on one picked
          // as many times as the hand has, it is taken back
          const total = RES_ORDER.reduce((m, x) => m + (pay[x] || 0), 0);
          if ((pay[r] || 0) >= garrison[r]) delete pay[r];
          else {
            if (total >= 2) {
              const drop = RES_ORDER.find((x) => x !== r && pay[x]) || r;
              pay[drop]--;
              if (!pay[drop]) delete pay[drop];
            }
            pay[r] = (pay[r] || 0) + 1;
          }
          paint();
        });
        b.disabled = !garrison[r];
        b.title = RES_NAMES[r];
        row.appendChild(b);
      }
      box.appendChild(row);
      paid.disabled = RES_ORDER.reduce((m, x) => m + (pay[x] || 0), 0) !== 2;
    };
    const paid = btn(`${icon('robber', 18)}${esc(t('付 2 張防衛'))}`, knights ? '' : 'primary', () => answer(true, { ...pay }));
    body.appendChild(box);
    body.paid = paid;
    paint();
  }
  const yes = btn(`${icon('knight', 18)}${esc(t('打出騎士防衛'))}`, 'primary', () => answer(true));
  yes.disabled = !knights;
  const no = btn(esc(knights || pay ? t('不防衛') : t('知道了')), '', () => answer(false));
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
  const h = dialogs.open({ kind: 'defend', title: t('奇觀遭到攻擊'), body, foot: body.paid ? [no, body.paid, yes] : [no, yes], dismissable: false, cls: 'narrow' });
  h.timer = timer;
  return h;
}

// ── 2026-11-18: the buildings' choices ──

// (the observatory) the dice came up `sum`: keep it, or a wool for a second roll (the second counts).
// seconds: a limit (online), at the end of which the roll stands.
export function rerollDialog(dialogs, { sum, dice, seconds }, onAnswer) {
  const body = div('dv-dialog defend');
  body.innerHTML = `<p class="lead">${t('擲出 <b>{sum}</b>（{a}＋{b}）。', { sum, a: dice ? dice[0] : '', b: dice ? dice[1] : '' })}</p><p>${esc(t('天文台：付 1 張羊毛可以重擲一次，用第二次的結果（不能再重擲）。'))}</p>`;
  let timer = null;
  const answer = (yes) => {
    if (timer) clearInterval(timer);
    onAnswer(yes);
  };
  const keep = btn(esc(t('就用 {sum}', { sum })), '', () => answer(false));
  const again = btn(`${resIcon('wool', 20)}${esc(t('付羊毛重擲'))}`, 'primary', () => answer(true));
  if (seconds) {
    const bar = div('timebar', '<i></i>');
    body.appendChild(bar);
    let left = seconds;
    timer = setInterval(() => {
      left--;
      bar.firstChild.style.width = (left / seconds) * 100 + '%';
      if (left <= 0) answer(false);
    }, 1000);
  }
  const h = dialogs.open({ kind: 'reroll', title: t('天文台'), body, foot: [keep, again], dismissable: false, cls: 'narrow' });
  h.timer = timer;
  return h;
}

// (the counting house at the turn's end, the almshouse at the roll) one card from the bank, of the
// player's choice (bank: what it has). onPick(res); cancelling (the counting house only) goes back.
export function bonusDialog(dialogs, { why, bank }, onPick, onCancel) {
  const body = div('dv-dialog');
  body.appendChild(div('lead', `<p>${esc(why === 'almshouse' ? t('救濟院：手牌 2 張以下，回合開始先從銀行拿 1 張資源。') : t('錢莊：手牌 8 張以上，結束回合時從銀行拿 1 張資源。'))}</p>`));
  body.appendChild(resourceChoice(onPick, (r) => ({ cost: null, off: bank[r] > 0 ? '' : t('銀行沒有了') })));
  const foot = onCancel ? [btn(t('取消'), '', () => (dialogs.close(), onCancel()))] : [];
  dialogs.open({ kind: 'bonus', title: why === 'almshouse' ? t('救濟院') : t('錢莊'), body, foot, dismissable: !!onCancel, cls: 'narrow' });
}

// (the caravanserai) two different resources (CARAVAN_GIVE) for one of any kind, as often as liked.
export function caravanDialog(dialogs, { res, bank }, onTrade) {
  let give = RES_ORDER.filter((r) => res[r] > 0).slice(0, CARAVAN_GIVE);
  let get = null;
  const body = div('dv-dialog');
  const go = btn(t('交換'), 'primary', () => onTrade(give.slice(), get));
  const render = () => {
    body.innerHTML = `<p class="lead">${esc(t('商隊旅館：用 2 張不同的資源向銀行換 1 張任意資源，次數不限。'))}</p>`;
    body.appendChild(div('dv-h', esc(t('給出 2 種各 1 張'))));
    const a = div('dv-opts res');
    for (const r of RES_ORDER) {
      const on = give.includes(r);
      const b = btn(`${resIcon(r, 26)}<small>${res[r]}</small>`, 'dv-res' + (on ? ' on' : ''), () => {
        if (on) give = give.filter((x) => x !== r);
        else give = [...give.slice(give.length >= CARAVAN_GIVE ? 1 : 0), r];
        render();
      });
      b.disabled = res[r] < 1;
      b.title = RES_NAMES[r];
      a.appendChild(b);
    }
    body.appendChild(a);
    body.appendChild(div('dv-h', esc(t('換到 1 張'))));
    const c = div('dv-opts res');
    for (const r of RES_ORDER) {
      const b = btn(`${resIcon(r, 26)}<small>${t('銀行 {n}', { n: bank[r] })}</small>`, 'dv-res' + (get === r ? ' on' : ''), () => ((get = r), render()));
      b.disabled = bank[r] <= 0;
      b.title = RES_NAMES[r];
      c.appendChild(b);
    }
    body.appendChild(c);
    go.disabled = give.length !== CARAVAN_GIVE || !get;
  };
  render();
  dialogs.open({ kind: 'trade', title: t('商隊旅館'), body, foot: [btn(t('取消'), '', () => dialogs.close()), go], cls: 'narrow' });
}

// (the warehouse) cards put away (after the roll; up to `max` in it) or taken back, in one go.
// canPut: whether the dice are rolled. onDo({ put, take }).
export function warehouseDialog(dialogs, { res, store, max, canPut }, onDo) {
  const put = {};
  const take = {};
  const body = div('dv-dialog');
  const go = btn(t('確定'), 'primary', () => onDo({ put: { ...put }, take: { ...take } }));
  const sum = (m) => RES_ORDER.reduce((n, r) => n + (m[r] || 0), 0);
  const render = () => {
    const stored = sum(store) + sum(put) - sum(take);
    body.innerHTML = `<p class="lead">${esc(t('貨棧：存著的牌不算手牌，不會被搶、擲出 7 不用棄，也不會被壟斷；在自己的回合拿回。'))}</p><p class="note">${esc(canPut ? t('存著 {n}/{max} 張', { n: stored, max }) : t('存著 {n}/{max} 張（擲骰後才能存入）', { n: stored, max }))}</p>`;
    const g = div('dv-store');
    for (const r of RES_ORDER) {
      const hand = res[r] - (put[r] || 0) + (take[r] || 0);
      const inStore = store[r] + (put[r] || 0) - (take[r] || 0);
      const row = div('dv-srow');
      row.innerHTML = `${resIcon(r, 24)}<span class="sr-n"><b class="num">${hand}</b><small>${esc(t('手牌§store'))}</small></span>`;
      const into = btn('→', 'dv-sbtn', () => {
        if (take[r]) take[r]--;
        else put[r] = (put[r] || 0) + 1;
        render();
      });
      into.title = t('存入');
      into.disabled = hand < 1 || stored >= max || (!take[r] && !canPut);
      const back = btn('←', 'dv-sbtn', () => {
        if (put[r]) put[r]--;
        else take[r] = (take[r] || 0) + 1;
        render();
      });
      back.title = t('拿回');
      back.disabled = inStore < 1;
      row.append(into, back);
      row.insertAdjacentHTML('beforeend', `<span class="sr-n st"><b class="num">${inStore}</b><small>${esc(t('貨棧§store'))}</small></span>`);
      g.appendChild(row);
    }
    body.appendChild(g);
    go.disabled = !sum(put) && !sum(take);
  };
  render();
  dialogs.open({ kind: 'warehouse', title: t('貨棧'), body, foot: [btn(t('取消'), '', () => dialogs.close()), go], cls: 'narrow' });
}

// (the apprentice workshop, the builders' yard) which card of the cost to leave out: one of each kind
// the cost has (def: the one picked to begin with). onPick(res).
export function skipDialog(dialogs, { name, cost, def, wonder }, onPick) {
  let pick = def;
  const body = div('dv-dialog');
  const go = btn(t('建造'), 'primary', () => onPick(pick));
  const render = () => {
    body.innerHTML = `<p class="lead">${esc(wonder ? t('營造廠：{name}這個階段少付 1 張，選要少付哪一張。', { name }) : t('學徒工坊：{name}少付 1 張，選要少付哪一張。', { name }))}</p>`;
    const a = div('dv-opts res');
    for (const r of RES_ORDER) {
      if (!cost[r]) continue;
      const b = btn(`${resIcon(r, 26)}<small>${esc(RES_NAMES[r])}</small>`, 'dv-res' + (pick === r ? ' on' : ''), () => ((pick = r), render()));
      b.title = RES_NAMES[r];
      a.appendChild(b);
    }
    body.appendChild(a);
    const left = { ...cost, [pick]: cost[pick] - 1 };
    body.appendChild(div('dv-pay', `<span>${esc(t('要付'))}</span>${costHtml(left, 20)}`));
  };
  render();
  dialogs.open({ kind: 'develop', title: wonder ? t('營造廠') : t('學徒工坊'), body, foot: [btn(t('取消'), '', () => dialogs.close()), go], cls: 'narrow' });
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
