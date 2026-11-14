// Event → log/toast text, and the rules reference (in the reader's language: i18n/).
import { RES_NAMES, resIcon, icon, TERRAIN_NAMES } from './icons.js';
import { seaInfo, homeIslands } from '../engine/engine.js';
import { GEO } from '../engine/geometry.js';
import { t, N_, cap, list, low, isZh } from '../i18n/index.js';
import { placeName } from '../i18n/places.js';

// the development cards' names and what they do, in the language of the moment
const dev = (name, desc, icon) => ({
  get name() {
    return t(name);
  },
  get desc() {
    return t(desc);
  },
  icon,
});
export const DEV_INFO = {
  knight: dev(N_('騎士'), N_('移動強盜到任一地形，並從該地形旁的一位玩家手中抽走 1 張資源卡。打出的騎士計入最大騎士團。'), 'knight'),
  victoryPoint: dev(N_('分數卡'), N_('秘密保留，直接計 1 分勝利分數。不需要打出。'), 'vp'),
  roadBuilding: dev(N_('道路建設'), N_('立即免費建造 2 條道路（須符合一般建造規則）。'), 'road'),
  yearOfPlenty: dev(N_('豐收之年'), N_('從銀行拿取任意 2 張資源卡（可相同），本回合即可使用。'), 'grain'),
  monopoly: dev(N_('壟斷'), N_('指定一種資源，所有其他玩家必須把該資源全部交給你。'), 'trade'),
};

// a nation's name in its colour ('you' for the reader's own)
export function who(players, p, me) {
  if (p < 0 || p == null) return '';
  const pl = players[p];
  const name = p === me ? t('你') : esc(pl.name);
  return `<span class="who" style="color:${pl.color}">${name}</span>`;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function cardsHtml(map, size = 16) {
  const parts = [];
  for (const r of ['wood', 'brick', 'wool', 'grain', 'ore']) {
    const n = map && map[r];
    if (n) parts.push(`<span class="c">${resIcon(r, size)}${n}</span>`);
  }
  return parts.length ? `<span class="cards-inline">${parts.join('')}</span>` : '—';
}

export function cardsText(map) {
  const parts = [];
  for (const r of ['wood', 'brick', 'wool', 'grain', 'ore']) if (map && map[r]) parts.push(`${RES_NAMES[r]}×${map[r]}`);
  return list(parts) || t('無');
}

const BUILD_NAMES = { road: N_('道路'), settlement: N_('村莊'), city: N_('城市'), ship: N_('船') };

// Returns { log: html|null, hl: bool, toast: {title, text, icon}|null }
export function describe(e, players, me, view) {
  const out = describe0(e, players, me, view);
  if (out.log) out.log = cap(out.log);
  if (out.toast && out.toast.text) out.toast.text = cap(out.toast.text);
  return out;
}

function describe0(e, players, me, view) {
  const W = (p) => who(players, p, me);
  const hexName = (h) => (view && view.board.hexes[h] ? esc(placeName(view.board.hexes[h])) : '');
  const R = (r) => RES_NAMES[r];
  switch (e.type) {
    case 'roll':
      return { log: t('{who} 擲出 <b>{sum}</b>（{a}＋{b}）', { who: W(e.p), sum: e.sum, a: e.dice[0], b: e.dice[1] }), hl: e.p === me };
    case 'produce': {
      const per = {};
      for (const c of e.paid) {
        per[c.p] = per[c.p] || {};
        per[c.p][c.res] = (per[c.p][c.res] || 0) + c.amt;
      }
      const lines = Object.keys(per).map((p) => t('{who} 獲得 {cards}', { who: W(+p), cards: cardsHtml(per[p], 14) }));
      if (e.blocked >= 0) lines.push(t('強盜阻擋了 {hex} 的產出', { hex: hexName(e.blocked) }));
      for (const s of e.shortages) {
        lines.push(s.partial ? t('銀行的{res}不足，{who} 只拿到 {n} 張', { res: R(s.res), who: W(s.p), n: s.got }) : t('銀行的{res}不足，本次無人獲得{res}', { res: R(s.res) }));
      }
      // (Seafarers) gold fields: the owners pick their resources next
      if (e.gold) for (const [q, n] of Object.entries(e.gold)) lines.push(t('{who} 從金礦取得 {n} 張任選資源', { who: W(+q), n }));
      if (!lines.length) lines.push(t('沒有人獲得資源'));
      return { log: lines.map(cap).join('<br>'), hl: !!per[me] || !!(e.gold && e.gold[me]) };
    }
    case 'build': {
      const what = low(t(BUILD_NAMES[e.what]));
      return { log: e.setup ? t('{who} 放置了{what}', { who: W(e.p), what }) : e.free ? t('{who} 免費建造了{what}', { who: W(e.p), what }) : t('{who} 建造了{what}', { who: W(e.p), what }), hl: e.p === me };
    }
    case 'startingResources':
      return { log: t('{who} 獲得開局資源 {cards}', { who: W(e.p), cards: cardsHtml(e.gains, 14) }), hl: e.p === me };
    case 'buyDev':
      return { log: e.card && e.p === me ? t('{who} 購買了一張發展卡（{card}）', { who: W(e.p), card: DEV_INFO[e.card].name }) : t('{who} 購買了一張發展卡', { who: W(e.p) }), hl: e.p === me };
    case 'playDev': {
      if (e.card === 'knight') return { log: t('{who} 派出騎士（共 {n} 位）', { who: W(e.p), n: e.knights }), hl: e.p === me, toast: null };
      if (e.card === 'roadBuilding') return { log: t('{who} 使用了 道路建設', { who: W(e.p) }), hl: e.p === me };
      if (e.card === 'yearOfPlenty') return { log: t('{who} 使用 豐收之年，取得 {res}', { who: W(e.p), res: list(e.res.map(R)) }), hl: e.p === me };
      if (e.card === 'monopoly') {
        const mine = e.taken && e.taken[me];
        return {
          log: t('{who} 壟斷了 {res}，共奪得 {n} 張', { who: W(e.p), res: R(e.res), n: e.total }),
          hl: true,
          toast:
            e.p === me
              ? { title: t('壟斷成功'), text: t('你奪得了 {n} 張{res}', { n: e.total, res: R(e.res) }), icon: 'trade' }
              : mine
                ? { title: t('貿易壟斷'), text: t('{name} 壟斷{res}，奪走你 {n} 張', { name: players[e.p].name, res: R(e.res), n: mine }), icon: 'trade' }
                : null,
        };
      }
      return { log: null };
    }
    case 'robber':
      return { log: t('{who} 將強盜移到 {hex}', { who: W(e.p), hex: hexName(e.to) }), hl: e.p === me };
    // (Seafarers)
    case 'pirate':
      return { log: t('{who} 讓海盜開往另一片海域', { who: W(e.p) }), hl: e.p === me };
    case 'moveShip':
      return { log: t('{who} 移動了一艘船', { who: W(e.p) }), hl: e.p === me };
    case 'gold':
      return { log: t('{who} 從金礦選了 {cards}', { who: W(e.p), cards: cardsHtml(e.res, 14) }), hl: e.p === me };
    case 'discover': {
      // (Seafarers, the fog islands)
      const land = low(TERRAIN_NAMES[e.terrain] || e.terrain);
      const what = e.number ? t('{terrain}（數字 {n}）', { terrain: land, n: e.number }) : land;
      const p = { who: W(e.p), what, cards: e.res ? cardsHtml({ [e.res]: 1 }, 14) : '', land, res: e.res ? R(e.res) : '' };
      const log =
        e.terrain === 'sea' ? t('{who} 在霧中發現了一片海', p) : e.res ? t('{who} 在霧中發現了{what}，獲得 {cards}', p) : e.terrain === 'gold' ? t('{who} 在霧中發現了{what}，可任選 1 張資源', p) : t('{who} 在霧中發現了{what}', p);
      const mine = e.terrain === 'sea' ? t('霧裡是一片海，再往前探索看看') : e.res ? t('發現了{land}，獲得 1 張{res}', p) : e.terrain === 'gold' ? t('發現了{land}，可以任選 1 張資源', p) : t('發現了{land}', p);
      return { log, hl: true, toast: e.p === me ? { title: t('霧散了'), text: mine, icon: 'isle' } : null };
    }
    case 'isleBonus':
      return {
        log: t('{who} 首次登上新島嶼，獲得 {n} 分', { who: W(e.p), n: e.vp }),
        hl: true,
        toast: e.p === me ? { title: t('登上新島嶼'), text: t('第一座村莊建在這座島上：+{n} 分', { n: e.vp }), icon: 'isle' } : null,
      };
    case 'steal': {
      if (e.res === undefined) return { log: null };
      const known = e.res && (e.p === me || e.from === me);
      return {
        log: known ? t('{who} 搶走了 {from} 的 {res}', { who: W(e.p), from: W(e.from), res: R(e.res) }) : t('{who} 搶走了 {from} 的 1 張牌', { who: W(e.p), from: W(e.from) }),
        hl: e.p === me || e.from === me,
        toast: e.from === me ? { title: t('遭到劫掠'), text: e.res ? t('{name} 搶走了你的{res}', { name: players[e.p].name, res: R(e.res) }) : t('{name} 搶走了你的一張牌', { name: players[e.p].name }), icon: 'robber' } : null,
      };
    }
    case 'discardRequired': {
      const mine = e.amounts[me];
      const lim = (view && view.rules && view.rules.discard) || 7;
      return {
        log: t('擲出 7！手牌超過 {n} 張的玩家必須棄掉一半', { n: lim }),
        hl: true,
        toast: { title: t('強盜出沒'), text: mine ? t('你必須棄掉 {n} 張牌', { n: mine }) : t('手牌超過 {n} 張的國家必須棄牌', { n: lim }), icon: 'robber' },
      };
    }
    case 'discard':
      return { log: t('{who} 棄掉了 {n} 張牌', { who: W(e.p), n: e.count }), hl: e.p === me };
    case 'bankTrade': {
      const p = { who: W(e.p), n: e.ratio, give: R(e.give), get: R(e.get) };
      return { log: e.ratio === 4 ? t('{who} 與銀行交易：{n} {give} → 1 {get}', p) : t('{who} 與港口交易：{n} {give} → 1 {get}', p), hl: e.p === me };
    }
    case 'offer':
      return { log: t('{who} 提議交易：給出 {give} 換取 {get}', { who: W(e.p), give: cardsHtml(e.give, 14), get: cardsHtml(e.get, 14) }), hl: e.p === me };
    case 'respond':
      return { log: e.accept ? t('{who} 願意接受提議', { who: W(e.p) }) : e.lack ? t('{who} 手上沒有你要的資源', { who: W(e.p) }) : t('{who} 拒絕了提議', { who: W(e.p) }), hl: e.p === me || e.from === me };
    case 'trade':
      return { log: t('{a} 與 {b} 完成交易：{give} ⇄ {get}', { a: W(e.from), b: W(e.to), give: cardsHtml(e.give, 14), get: cardsHtml(e.get, 14) }), hl: e.from === me || e.to === me };
    case 'offerCancelled':
      return { log: null };
    case 'longestRoad':
      if (e.to >= 0)
        return {
          log: t('{who} 以 {n} 段道路取得<b>最長道路</b>（+2 分）', { who: W(e.to), n: e.length }),
          hl: true,
          toast: { title: t('最長道路'), text: e.to === me ? t('你擁有最長的道路（{n} 段），獲得 2 分', { n: e.length }) : t('{name} 擁有最長的道路（{n} 段），獲得 2 分', { name: players[e.to].name, n: e.length }), icon: 'road' },
        };
      return { log: t('最長道路暫時無人持有'), hl: true, toast: { title: t('最長道路易主'), text: t('道路被截斷，最長道路暫時無人持有'), icon: 'road' } };
    case 'largestArmy':
      return {
        log: t('{who} 以 {n} 位騎士組成<b>最大騎士團</b>（+2 分）', { who: W(e.to), n: e.size }),
        hl: true,
        toast: { title: t('最大騎士團'), text: e.to === me ? t('你擁有最強的軍隊（{n} 位騎士），獲得 2 分', { n: e.size }) : t('{name} 擁有最強的軍隊（{n} 位騎士），獲得 2 分', { name: players[e.to].name, n: e.size }), icon: 'knight' },
      };
    case 'turnStart': {
      if (e.sub === 'pair') return { log: t('{who} 接著行動（第二位）', { who: W(e.p) }), hl: e.p === me };
      // (each player's building step is not logged, only what they build)
      if (e.sub === 'sbp') return { log: e.p === me ? t('特別建造：輪到你建造') : null, hl: true };
      const whose = e.p === me ? `<span class="who" style="color:${players[e.p].color}">${t('你的回合')}</span>` : t('{who} 的回合', { who: W(e.p) });
      return { log: `<span class="t">${t('第 {n} 回合', { n: e.turn })}</span>${cap(whose)}`, sep: true, hl: e.p === me };
    }
    case 'phase':
      return { log: t('開局完成，遊戲正式開始'), hl: true };
    case 'roadBuildingDone':
      return { log: null };
    case 'gameOver':
      return { log: t('{who} 達到 {n} 分，贏得勝利！', { who: W(e.winner), n: e.vp }), hl: true };
    default:
      return { log: null };
  }
}

export function hexTooltip(view, hexId, players) {
  const H = view.board.hexes[hexId];
  const res = { forest: 'wood', hills: 'brick', pasture: 'wool', fields: 'grain', mountains: 'ore' }[H.terrain];
  const pip = H.number ? 6 - Math.abs(7 - H.number) : 0;
  const lines = [];
  if (H.terrain === 'fog') {
    // (Seafarers, the fog islands)
    return t('<h5>未探索</h5><p>霧裡可能是陸地、金礦或海。道路或船抵達旁邊的路口就會揭開：揭開陸地的國家得到 1 張那種資源（金礦任選）。</p>');
  }
  if (H.terrain === 'sea') {
    // (Seafarers)
    lines.push(t('<p>海域：船可以在這裡航行</p>'));
    if (view.board.pirate === hexId) lines.push(t('<p><b style="color:#e07a6a">海盜出沒</b>：旁邊不能造船，旁邊的船也不能移動</p>'));
    return `<h5>${TERRAIN_NAMES.sea}</h5>${lines.join('')}`;
  }
  if (H.terrain === 'gold') lines.push(t('<p>金礦：產出時由你<b>任選資源</b></p>'));
  else lines.push(res ? t('<p>{terrain}，產出 <b>{res}</b></p>', { terrain: TERRAIN_NAMES[H.terrain], res: RES_NAMES[res] }) : t('<p>{terrain}，沒有產出</p>', { terrain: TERRAIN_NAMES[H.terrain] }));
  if (H.number) lines.push(t('<p>擲出 <b>{n}</b> 時產出 · 機率 <b>{pip}/36</b>（約 {pct}%）</p>', { n: H.number, pip, pct: Math.round((pip / 36) * 100) }));
  if (view.board.robber === hexId) lines.push(t('<p><b style="color:#e07a6a">強盜佔領中</b>，暫停產出</p>'));
  // (Seafarers) the viewer's home island, or an island where a first settlement earns points
  const me = view.viewer;
  if (view.ships && GEO.def.isleBonus && me != null && me >= 0 && view.players[me]) {
    const isle = seaInfo(view.board).island[hexId];
    const home = view.phase === 'setup' && !(view.players[me].home || []).length && !(GEO.def.setup && GEO.def.setup.group) ? null : homeIslands(view, me);
    if (home && home.includes(isle)) lines.push(t('<p>你的本島</p>'));
    else if (home) {
      const got = view.players[me].isles || [];
      const full = GEO.def.isleBonusMax && got.length >= GEO.def.isleBonusMax;
      if (!got.includes(isle) && !full) lines.push(GEO.def.isleBonusMax ? t('<p>外島：你在這座島的第一座村莊 <b>+{n} 分</b>（只算一次）</p>', { n: GEO.def.isleBonus }) : t('<p>外島：你在這座島的第一座村莊 <b>+{n} 分</b></p>', { n: GEO.def.isleBonus }));
    }
  }
  return `<h5>${esc(placeName(H))}</h5>${lines.join('')}`;
}

// the rules reference, written out in each language
export function rulesHtml() {
  const c = (m) => cardsHtml(m, 15);
  return isZh() ? rulesZh(c) : rulesEn(c);
}

// i18n-keep: the Chinese rules (rulesEn below is the English)
function rulesZh(c) {
  return `<div class="rules">
<h4>目標</h4>
<p>率先在<b>自己的回合</b>達到 <b>10 分</b>的國家獲勝。村莊 1 分、城市 2 分、最長道路 2 分、最大騎士團 2 分、分數卡 1 分。</p>
<h4>開局</h4>
<ul>
<li>依序每人放置 1 個村莊和 1 條相連的道路；第二輪<b>反向</b>再放一次（蛇形順序）。</li>
<li>第二個村莊旁的每塊地形各給你 1 張對應資源。</li>
<li>任何時候都要遵守<b>距離規則</b>：村莊相鄰的三個路口都不能有建築。</li>
</ul>
<h4>回合流程</h4>
<ul>
<li><b>擲骰</b>：點數相符的地形，旁邊每個村莊產出 1 張、城市產出 2 張資源（強盜所在地形除外）。</li>
<li><b>交易與建造</b>：可任意順序進行。與其他國家交易時必須由你主導；海上貿易為 4:1，擁有港口時為 3:1 或指定資源 2:1。</li>
<li>銀行某種資源不足以分給所有人時，該資源本次無人獲得（只有一人時拿走剩下的）。</li>
</ul>
<h4>擲出 7</h4>
<ul>
<li>沒有產出。手牌 <b>8 張以上</b>的玩家棄掉一半（無條件捨去）。</li>
<li>擲骰者把強盜移到另一塊地形，並從該地形旁的一位玩家隨機抽走 1 張牌。</li>
</ul>
<h4>建造成本</h4>
<div class="cost-table">
<span>道路</span>${c({ wood: 1, brick: 1 })}<span class="vp">0 分</span>
<span>村莊</span>${c({ wood: 1, brick: 1, wool: 1, grain: 1 })}<span class="vp">1 分</span>
<span>城市（升級村莊）</span>${c({ grain: 2, ore: 3 })}<span class="vp">2 分</span>
<span>發展卡</span>${c({ wool: 1, grain: 1, ore: 1 })}<span class="vp">?</span>
</div>
<p>每人最多 15 條道路、5 個村莊、4 座城市。道路須連接自己的道路或建築，且不能穿過對手的建築；新村莊必須連到自己的道路。</p>
<h4>發展卡（共 25 張）</h4>
<ul>
<li>騎士 14、分數卡 5、道路建設 2、豐收之年 2、壟斷 2。</li>
<li>每回合最多打出 1 張，可在擲骰前使用；當回合購買的卡要到下回合才能用（分數卡例外，直接計分）。</li>
</ul>
<h4>特殊加分</h4>
<ul>
<li><b>最長道路</b>：最先擁有連續 5 段以上道路者取得，被超越時轉手；平手時由原持有者保留，若道路被截斷導致多人平手則暫時無人持有。</li>
<li><b>最大騎士團</b>：最先打出 3 張騎士者取得，他人打出更多時轉手。</li>
</ul>
<h4>5–6 人（大島嶼）</h4>
<ul>
<li>30 塊地形（森林、牧場、田地各 6，丘陵、山脈各 5，沙漠 2）、28 個數字牌、11 個港口；銀行每種資源 24 張；發展卡 34 張（騎士 20、分數卡 5、道路建設、豐收之年、壟斷各 3）。</li>
<li><b>配對回合</b>（官方現行規則）：每回合有兩位玩家。主要玩家照常擲骰、交易、建造、使用發展卡；結束後由他左手邊第三位（六人局就是對面）的玩家接著行動，可以建造、和銀行或港口交易、使用一張發展卡，但不能擲骰，也不能和其他國家交易。兩人都可能在這個回合獲勝；主要玩家達到勝利分數就立刻獲勝。</li>
<li><b>特別建造階段</b>（舊規則，可在開局設定選用）：每位玩家結束回合後，其他人依序可以建造或購買發展卡，但不能交易、不能使用發展卡；在這個階段達到勝利分數，要等到自己的回合才算獲勝。</li>
</ul>
<h4>航海家：駛向新海岸</h4>
<ul>
<li>目標 <b>14 分</b>。主島在西邊，東邊海上是每局不同的小島（含 2 塊<b>金礦</b>）。開局的兩個村莊都要在主島上；海邊的開局村莊可以放<b>船</b>代替道路。</li>
<li><b>船</b>（木材＋羊毛，每人 15 艘）：放在海上或海岸邊的航道（地圖外框也算海），接在你的船、或海邊的村莊或城市旁；同一條海岸邊只能有道路或船其中一種。道路和船只在你的村莊或城市處相接。船隊到達的海岸可以建村莊。</li>
<li><b>移船</b>：每回合一次（擲骰後），只能移動航線末端、之前回合建造、不在海盜旁的船。</li>
<li><b>海盜</b>：擲出 7 或打出騎士時，可以改移海盜到另一片海域，搶奪旁邊有船的國家一張牌；海盜旁不能造船，旁邊的船也不能移動。</li>
<li><b>金礦</b>：擲出時旁邊的村莊得 1 張、城市得 2 張，資源任選。</li>
<li><b>最長貿易路線</b>取代最長道路：道路與船一起算（只在你的村莊或城市處相連）。<b>道路建設</b>卡可以建 2 條道路、2 艘船或各 1。</li>
<li><b>小島加分</b>：你在每座小島上的第一個村莊額外 <b>+2 分</b>（別人先登島也照樣算）。</li>
</ul>
<h4>航海家：四座島嶼</h4>
<ul>
<li>目標 <b>13 分</b>。四座島之間隔著海峽，沒有沙漠也沒有金礦；強盜一開始在數字 12 的地形上。</li>
<li>開局的兩個村莊可以放在<b>任何島上</b>（同一座或兩座）：開局所在的島是你的<b>本島</b>，其他的島對你來說是外島。</li>
<li><b>外島加分</b>：你在每座外島上的第一個村莊額外 <b>+2 分</b>（別人先登島也照樣算）。只有一座本島的話，最多可以拿 6 分。</li>
<li>船、移船、海盜與最長貿易路線的規則和「駛向新海岸」相同。</li>
</ul>
<h4>航海家：霧島</h4>
<ul>
<li>目標 <b>12 分</b>。西邊有上下兩座島，開局的村莊放在這兩座島上；東邊的 12 格籠罩在霧裡。強盜一開始在數字 12 的地形上。</li>
<li><b>探索</b>：你的道路或船抵達霧旁邊的路口時，霧就散開，可能是陸地、金礦或海。陸地會放上新的數字牌，並給你 1 張那種資源；金礦讓你任選 1 張；海則什麼都沒有。</li>
<li>霧裡是什麼，要到揭開的那一刻才抽出來，誰都無法事先知道。海盜不能開進還沒探索的霧裡。</li>
<li>沒有外島加分；其他規則和前兩個劇本相同。</li>
</ul>
<h4>航海家：新世界</h4>
<ul>
<li>目標 <b>12 分</b>。每一局都是新的世界：23 塊陸地（沒有沙漠與金礦）隨機分成 3 到 5 座互不相連的島，其餘是海；數字與港口也每局不同。</li>
<li>開局的兩個村莊可以放在任何島上，開局所在的島是你的本島；在外島蓋的第一座村莊 <b>+1 分</b>，每人只算一次。</li>
<li>強盜和海盜一開始都在地圖外，第一次被移動時才進場。</li>
</ul>
<h4>航海家：5–6 人</h4>
<ul>
<li>四個劇本都有 5–6 人版：地圖比較大（56 到 63 格），用 5–6 人擴充的銀行（每種資源 24 張）、發展卡（34 張）、11 個港口（霧島 9 個）與回合規則。</li>
<li><b>駛向新海岸</b>：主島和大島嶼一樣是 30 塊地形，東邊海峽的南北兩側有 10 塊小島（含 3 塊金礦）。<b>六座島嶼</b>：六座 5–6 塊地形的島，北三座、南三座，規則和四座島嶼相同（只有一座本島的話，外島最多 +10 分）。<b>霧島</b>：上下兩座島共 26 塊地形（含沙漠與 2 塊金礦，強盜從沙漠出發），東邊 25 格在霧裡。<b>新世界</b>：42 塊陸地（含 3 塊沙漠、4 塊金礦）隨機分成 3 到 5 座島。</li>
<li>配對回合的第二位也可以移動一艘自己的船；特別建造階段不能移船。</li>
</ul>
<h4>操作</h4>
<ul>
<li>滾輪或雙指縮放，拖曳或 WASD 平移；拉遠會切換成紙本地圖。</li>
<li>轉動與傾斜：右鍵（或中鍵）拖曳、Q／E 旋轉、Z／X 或 Shift＋滾輪調整斜度、雙指旋轉；小地圖旁的羅盤與滑桿也可以調整，Home 回到預設視角。</li>
<li>快捷鍵：R 擲骰、1 道路、2 村莊、3 城市、4 發展卡、5 船與 6 移船（航海家）、T 交易、Space 結束回合、M 切換地圖模式、Esc 取消。</li>
</ul>
<h4>素材</h4>
<p>樹木、灌木、岩石、地表照片材質，以及城堡塔樓、木碼頭、帆船與道具來自 <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a>；村莊與城市的中世紀木構房屋來自 <a href="https://www.blendswap.com/blends/view/75519" target="_blank" rel="noopener">Blend Swap 的 Daniel74</a>；有動畫的農場動物來自 <a href="https://quaternius.com" target="_blank" rel="noopener">Quaternius</a>。皆為 CC0 公眾領域授權。</p>
</div>`;
}


function rulesEn(c) {
  return `<div class="rules">
<h4>Goal</h4>
<p>The first nation to reach <b>10 victory points</b> on <b>its own turn</b> wins. A settlement is worth 1 point, a city 2, the Longest Road 2, the Largest Army 2 and a Victory Point card 1.</p>
<h4>Setup</h4>
<ul>
<li>In turn, each player places 1 settlement and 1 road next to it; then a second round <b>in reverse order</b> (snake order).</li>
<li>Each hex next to your second settlement gives you 1 card of its resource.</li>
<li>The <b>distance rule</b> always applies: the three corners next to a settlement must stay empty.</li>
</ul>
<h4>Your turn</h4>
<ul>
<li><b>Roll</b>: every hex with the number rolled produces 1 card for each settlement and 2 for each city next to it (except the hex with the robber).</li>
<li><b>Trade and build</b>, in any order. Trades with other nations must include you; maritime trade is 4:1, or 3:1 and 2:1 for one resource with a harbor.</li>
<li>When the bank cannot give everyone their cards of a resource, no one gets that resource this time (a single player takes what is left).</li>
</ul>
<h4>Rolling a 7</h4>
<ul>
<li>Nothing is produced. Players holding <b>8 cards or more</b> discard half (rounded down).</li>
<li>The roller moves the robber to another hex and takes 1 random card from a player with a building next to it.</li>
</ul>
<h4>Building costs</h4>
<div class="cost-table">
<span>Road</span>${c({ wood: 1, brick: 1 })}<span class="vp">0 VP</span>
<span>Settlement</span>${c({ wood: 1, brick: 1, wool: 1, grain: 1 })}<span class="vp">1 VP</span>
<span>City (upgrades a settlement)</span>${c({ grain: 2, ore: 3 })}<span class="vp">2 VP</span>
<span>Development card</span>${c({ wool: 1, grain: 1, ore: 1 })}<span class="vp">?</span>
</div>
<p>Each player has 15 roads, 5 settlements and 4 cities. A road must connect to your own road or building and cannot pass through a rival's building; a new settlement must connect to your own road.</p>
<h4>Development cards (25)</h4>
<ul>
<li>14 Knights, 5 Victory Points, 2 Road Building, 2 Year of Plenty, 2 Monopoly.</li>
<li>Play at most 1 per turn, before the roll if you like; a card bought this turn can be played from your next turn (Victory Point cards count at once).</li>
</ul>
<h4>Special cards</h4>
<ul>
<li><b>Longest Road</b>: the first player with a continuous road of 5 or more segments takes it, and loses it to anyone who builds a longer one; on a tie the holder keeps it, and if a cut road leaves several players tied, no one holds it for now.</li>
<li><b>Largest Army</b>: the first player to play 3 Knights takes it, and loses it to anyone who plays more.</li>
</ul>
<h4>5–6 players (Large Island)</h4>
<ul>
<li>30 hexes (6 each of forest, pasture and fields, 5 each of hills and mountains, 2 deserts), 28 number tokens and 11 harbors; 24 cards of each resource in the bank; 34 development cards (20 Knights, 5 Victory Points, 3 each of Road Building, Year of Plenty and Monopoly).</li>
<li><b>Paired players</b> (the current official rule): two players act each turn. The main player rolls, trades, builds and plays development cards as usual; then the third player to the left (opposite, with six players) builds, trades with the bank or a harbor and may play one development card, but may not roll or trade with other nations. Both may win on this turn; the main player wins at once on reaching the points to win.</li>
<li><b>Special building phase</b> (the older rule, chosen in the game setup): after each turn, every other player in order may build or buy development cards, but may not trade or play development cards; a player who reaches the points to win in this phase wins on their own next turn.</li>
</ul>
<h4>Seafarers: Heading for New Shores</h4>
<ul>
<li>Goal: <b>14 VP</b>. The home island lies in the west; out to sea in the east are small islands that change every game (with 2 <b>gold fields</b>). Both starting settlements go on the home island; a starting settlement on the coast may take a <b>ship</b> instead of a road.</li>
<li><b>Ships</b> (lumber + wool, 15 each): placed on a sea or coastal edge (the map's border counts as sea), next to your ship or to your settlement or city on the coast; one coastal edge holds a road or a ship, not both. Roads and ships join only at your settlements and cities. You may build a settlement on any coast your fleet reaches.</li>
<li><b>Moving a ship</b>: once a turn (after the roll); only a ship at the open end of a route, built on an earlier turn and not next to the pirate.</li>
<li><b>The pirate</b>: on a 7 or a Knight you may move the pirate to another sea hex instead and rob a nation with a ship next to it; no ships can be built next to the pirate, and the ships next to it cannot move.</li>
<li><b>Gold fields</b>: on their number, each settlement next to one gets 1 card and each city 2, of any resources.</li>
<li>The <b>Longest Trade Route</b> replaces the Longest Road: roads and ships count together (joined only at your settlements and cities). <b>Road Building</b> builds 2 roads, 2 ships or one of each.</li>
<li><b>Island bonus</b>: your first settlement on each small island earns <b>+2 VP</b> (even if someone else landed there first).</li>
</ul>
<h4>Seafarers: The Four Islands</h4>
<ul>
<li>Goal: <b>13 VP</b>. Straits run between the four islands; there is no desert and no gold. The robber starts on the hex numbered 12.</li>
<li>The starting settlements may go on <b>any island</b> (one island or two): an island where you start is your <b>home island</b>, and the others are outer islands to you.</li>
<li><b>Outer island bonus</b>: your first settlement on each outer island earns <b>+2 VP</b> (even if someone else landed there first). With one home island you can earn up to 6 VP this way.</li>
<li>Ships, moving ships, the pirate and the Longest Trade Route work as in Heading for New Shores.</li>
</ul>
<h4>Seafarers: The Fog Islands</h4>
<ul>
<li>Goal: <b>12 VP</b>. Two islands lie in the west, one above the other, and the starting settlements go on them; the 12 hexes in the east are hidden in fog. The robber starts on the hex numbered 12.</li>
<li><b>Exploring</b>: when your road or ship reaches a corner next to the fog, the fog lifts to reveal land, a gold field or sea. Land gets a new number token and gives you 1 card of its resource; a gold field lets you choose 1; the sea gives nothing.</li>
<li>What the fog hides is drawn only when it lifts, so no one can know beforehand. The pirate cannot sail into unexplored fog.</li>
<li>There is no outer island bonus; the other rules are as in the two scenarios above.</li>
</ul>
<h4>Seafarers: New World</h4>
<ul>
<li>Goal: <b>12 VP</b>. Every game is a new world: 23 land hexes (no desert, no gold) split at random into 3 to 5 separate islands, the rest sea; the numbers and harbors change every game too.</li>
<li>The starting settlements may go on any island, and an island where you start is your home island; your first settlement on an outer island earns <b>+1 VP</b>, once per player.</li>
<li>The robber and the pirate both start off the map and come in the first time they are moved.</li>
</ul>
<h4>Seafarers: 5–6 players</h4>
<ul>
<li>All four scenarios have a 5–6 player version: a larger map (56 to 63 hexes), with the 5–6 player bank (24 cards of each resource), development cards (34), 11 harbors (9 on the Fog Islands) and turn rule.</li>
<li><b>Heading for New Shores</b>: the home island has 30 hexes like the Large Island, with 10 hexes of small islands north and south of the eastern strait (3 of them gold). <b>The Six Islands</b>: six islands of 5–6 hexes, three in the north and three in the south, with the rules of The Four Islands (with one home island, up to +10 VP from outer islands). <b>The Fog Islands</b>: two islands with 26 hexes between them (a desert and 2 gold fields; the robber starts in the desert), and 25 hexes of fog in the east. <b>New World</b>: 42 land hexes (3 deserts, 4 gold fields) split at random into 3 to 5 islands.</li>
<li>The paired player may also move one of their own ships; no ships move in the special building phase.</li>
</ul>
<h4>Controls</h4>
<ul>
<li>Scroll or pinch to zoom, drag or WASD to pan; zooming far out switches to the paper map.</li>
<li>Turn and tilt: drag with the right (or middle) button, Q / E to turn, Z / X or Shift + scroll to tilt, or turn with two fingers; the compass and slider beside the minimap work too, and Home goes back to the default view.</li>
<li>Keys: R roll, 1 road, 2 settlement, 3 city, 4 development card, 5 ship and 6 move ship (Seafarers), T trade, Space end turn, M map mode, Esc cancel.</li>
</ul>
<h4>Credits</h4>
<p>Trees, bushes, rocks, the photographic ground textures, the castle towers, wooden pier, sailing ships and props come from <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a>; the medieval timber-framed houses of the settlements and cities come from <a href="https://www.blendswap.com/blends/view/75519" target="_blank" rel="noopener">Daniel74 on Blend Swap</a>; the animated farm animals come from <a href="https://quaternius.com" target="_blank" rel="noopener">Quaternius</a>. All are CC0 (public domain).</p>
</div>`;
}

export { icon };
