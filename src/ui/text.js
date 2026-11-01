// Event → log/toast text (Traditional Chinese), and the rules reference.
import { RES_NAMES, resIcon, icon, TERRAIN_NAMES } from './icons.js';
import { seaInfo, homeIslands } from '../engine/engine.js';
import { GEO } from '../engine/geometry.js';

export const DEV_INFO = {
  knight: { name: '騎士', desc: '移動強盜到任一地形，並從該地形旁的一位玩家手中抽走 1 張資源卡。打出的騎士計入最大騎士團。', icon: 'knight' },
  victoryPoint: { name: '分數卡', desc: '秘密保留，直接計 1 分勝利分數。不需要打出。', icon: 'vp' },
  roadBuilding: { name: '道路建設', desc: '立即免費建造 2 條道路（須符合一般建造規則）。', icon: 'road' },
  yearOfPlenty: { name: '豐收之年', desc: '從銀行拿取任意 2 張資源卡（可相同），本回合即可使用。', icon: 'grain' },
  monopoly: { name: '壟斷', desc: '指定一種資源，所有其他玩家必須把該資源全部交給你。', icon: 'trade' },
};

export function who(players, p, me) {
  if (p < 0 || p == null) return '';
  const pl = players[p];
  const name = p === me ? '你' : esc(pl.name);
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
  return parts.join('、') || '無';
}

const BUILD_NAMES = { road: '道路', settlement: '村莊', city: '城市', ship: '船' };

// Returns { log: html|null, hl: bool, toast: {title, text, icon}|null }
export function describe(e, players, me, view) {
  const W = (p) => who(players, p, me);
  const hexName = (h) => (view && view.board.hexes[h] ? esc(view.board.hexes[h].name) : '');
  switch (e.type) {
    case 'roll':
      return { log: `${W(e.p)} 擲出 <b>${e.sum}</b>（${e.dice[0]}＋${e.dice[1]}）`, hl: e.p === me };
    case 'produce': {
      const per = {};
      for (const c of e.paid) {
        per[c.p] = per[c.p] || {};
        per[c.p][c.res] = (per[c.p][c.res] || 0) + c.amt;
      }
      const lines = Object.keys(per).map((p) => `${W(+p)} 獲得 ${cardsHtml(per[p], 14)}`);
      if (e.blocked >= 0) lines.push(`強盜阻擋了 ${hexName(e.blocked)} 的產出`);
      for (const s of e.shortages) {
        lines.push(s.partial ? `銀行的${RES_NAMES[s.res]}不足，${W(s.p)} 只拿到 ${s.got} 張` : `銀行的${RES_NAMES[s.res]}不足，本次無人獲得${RES_NAMES[s.res]}`);
      }
      // (Seafarers) gold fields: the owners pick their resources next
      if (e.gold) for (const [q, n] of Object.entries(e.gold)) lines.push(`${W(+q)} 從金礦取得 ${n} 張任選資源`);
      if (!lines.length) lines.push('沒有人獲得資源');
      return { log: lines.join('<br>'), hl: !!per[me] || !!(e.gold && e.gold[me]) };
    }
    case 'build':
      return { log: `${W(e.p)} ${e.setup ? '放置了' : e.free ? '免費建造了' : '建造了'}${BUILD_NAMES[e.what]}`, hl: e.p === me };
    case 'startingResources':
      return { log: `${W(e.p)} 獲得開局資源 ${cardsHtml(e.gains, 14)}`, hl: e.p === me };
    case 'buyDev':
      return { log: `${W(e.p)} 購買了一張發展卡${e.card && e.p === me ? `（${DEV_INFO[e.card].name}）` : ''}`, hl: e.p === me };
    case 'playDev': {
      if (e.card === 'knight')
        return { log: `${W(e.p)} 派出騎士（共 ${e.knights} 位）`, hl: e.p === me, toast: e.p !== me ? null : null };
      if (e.card === 'roadBuilding') return { log: `${W(e.p)} 使用了 道路建設`, hl: e.p === me };
      if (e.card === 'yearOfPlenty') return { log: `${W(e.p)} 使用 豐收之年，取得 ${e.res.map((r) => RES_NAMES[r]).join('、')}`, hl: e.p === me };
      if (e.card === 'monopoly') {
        const mine = e.taken && e.taken[me];
        return {
          log: `${W(e.p)} 壟斷了 ${RES_NAMES[e.res]}，共奪得 ${e.total} 張`,
          hl: true,
          toast:
            e.p === me
              ? { title: '壟斷成功', text: `你奪得了 ${e.total} 張${RES_NAMES[e.res]}`, icon: 'trade' }
              : mine
                ? { title: '貿易壟斷', text: `${players[e.p].name} 壟斷${RES_NAMES[e.res]}，奪走你 ${mine} 張`, icon: 'trade' }
                : null,
        };
      }
      return { log: null };
    }
    case 'robber':
      return { log: `${W(e.p)} 將強盜移到 ${hexName(e.to)}`, hl: e.p === me };
    // (Seafarers)
    case 'pirate':
      return { log: `${W(e.p)} 讓海盜開往另一片海域`, hl: e.p === me };
    case 'moveShip':
      return { log: `${W(e.p)} 移動了一艘船`, hl: e.p === me };
    case 'gold':
      return { log: `${W(e.p)} 從金礦選了 ${cardsHtml(e.res, 14)}`, hl: e.p === me };
    case 'isleBonus':
      return {
        log: `${W(e.p)} 首次登上新島嶼，獲得 ${e.vp} 分`,
        hl: true,
        toast: e.p === me ? { title: '登上新島嶼', text: `第一座村莊建在這座島上：+${e.vp} 分`, icon: 'isle' } : null,
      };
    case 'steal': {
      if (e.res === undefined) return { log: null };
      const what = e.res && (e.p === me || e.from === me) ? ` ${RES_NAMES[e.res]}` : ' 1 張牌';
      return {
        log: `${W(e.p)} 搶走了 ${W(e.from)} 的${what}`,
        hl: e.p === me || e.from === me,
        toast: e.from === me ? { title: '遭到劫掠', text: `${players[e.p].name} 搶走了你的${e.res ? RES_NAMES[e.res] : '一張牌'}`, icon: 'robber' } : null,
      };
    }
    case 'discardRequired': {
      const mine = e.amounts[me];
      return {
        log: `擲出 7！手牌超過 7 張的玩家必須棄掉一半`,
        hl: true,
        toast: { title: '強盜出沒', text: mine ? `你必須棄掉 ${mine} 張牌` : '手牌超過 7 張的國家必須棄牌', icon: 'robber' },
      };
    }
    case 'discard':
      return { log: `${W(e.p)} 棄掉了 ${e.count} 張牌`, hl: e.p === me };
    case 'bankTrade':
      return { log: `${W(e.p)} 與${e.ratio === 4 ? '銀行' : '港口'}交易：${e.ratio} ${RES_NAMES[e.give]} → 1 ${RES_NAMES[e.get]}`, hl: e.p === me };
    case 'offer':
      return { log: `${W(e.p)} 提議交易：給出 ${cardsHtml(e.give, 14)} 換取 ${cardsHtml(e.get, 14)}`, hl: e.p === me };
    case 'respond':
      return { log: `${W(e.p)} ${e.accept ? '願意接受提議' : e.lack ? '手上沒有你要的資源' : '拒絕了提議'}`, hl: e.p === me || e.from === me };
    case 'trade':
      return { log: `${W(e.from)} 與 ${W(e.to)} 完成交易：${cardsHtml(e.give, 14)} ⇄ ${cardsHtml(e.get, 14)}`, hl: e.from === me || e.to === me };
    case 'offerCancelled':
      return { log: null };
    case 'longestRoad':
      if (e.to >= 0)
        return {
          log: `${W(e.to)} 以 ${e.length} 段道路取得<b>最長道路</b>（+2 分）`,
          hl: true,
          toast: { title: '最長道路', text: `${e.to === me ? '你' : players[e.to].name} 擁有最長的道路（${e.length} 段），獲得 2 分`, icon: 'road' },
        };
      return { log: `最長道路暫時無人持有`, hl: true, toast: { title: '最長道路易主', text: '道路被截斷，最長道路暫時無人持有', icon: 'road' } };
    case 'largestArmy':
      return {
        log: `${W(e.to)} 以 ${e.size} 位騎士組成<b>最大騎士團</b>（+2 分）`,
        hl: true,
        toast: { title: '最大騎士團', text: `${e.to === me ? '你' : players[e.to].name} 擁有最強的軍隊（${e.size} 位騎士），獲得 2 分`, icon: 'knight' },
      };
    case 'turnStart':
      if (e.sub === 'pair') return { log: `${W(e.p)} 接著行動（第二位）`, hl: e.p === me };
      // (each player's building step is not logged, only what they build)
      if (e.sub === 'sbp') return { log: e.p === me ? '特別建造：輪到你建造' : null, hl: true };
      return { log: `<span class="t">第 ${e.turn} 回合</span>${W(e.p)} 的回合`, sep: true, hl: e.p === me };
    case 'phase':
      return { log: '開局完成，遊戲正式開始', hl: true };
    case 'roadBuildingDone':
      return { log: null };
    case 'gameOver':
      return { log: `${W(e.winner)} 達到 ${e.vp} 分，贏得勝利！`, hl: true };
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
    return '<h5>未探索</h5><p>霧裡可能是陸地、金礦或海。道路或船抵達旁邊的路口就會揭開：揭開陸地的國家得到 1 張那種資源（金礦任選）。</p>';
  }
  if (H.terrain === 'sea') {
    // (Seafarers)
    lines.push('<p>海域：船可以在這裡航行</p>');
    if (view.board.pirate === hexId) lines.push('<p><b style="color:#e07a6a">海盜出沒</b>：旁邊不能造船，旁邊的船也不能移動</p>');
    return `<h5>海域</h5>${lines.join('')}`;
  }
  if (H.terrain === 'gold') lines.push('<p>金礦：產出時由你<b>任選資源</b></p>');
  else lines.push(`<p>${TERRAIN_NAMES[H.terrain]}${res ? `，產出 <b>${RES_NAMES[res]}</b>` : '，沒有產出'}</p>`);
  if (H.number) lines.push(`<p>擲出 <b>${H.number}</b> 時產出 · 機率 <b>${pip}/36</b>（約 ${Math.round((pip / 36) * 100)}%）</p>`);
  if (view.board.robber === hexId) lines.push(`<p><b style="color:#e07a6a">強盜佔領中</b>，暫停產出</p>`);
  // (Seafarers) the viewer's home island, or an island where a first settlement earns points
  const me = view.viewer;
  if (view.ships && GEO.def.isleBonus && me != null && me >= 0 && view.players[me]) {
    const isle = seaInfo(view.board).island[hexId];
    const home = view.phase === 'setup' && !(view.players[me].home || []).length && !(GEO.def.setup && GEO.def.setup.group) ? null : homeIslands(view, me);
    if (home && home.includes(isle)) lines.push('<p>你的本島</p>');
    else if (home && !(view.players[me].isles || []).includes(isle)) lines.push(`<p>外島：你在這座島的第一座村莊 <b>+${GEO.def.isleBonus} 分</b></p>`);
  }
  return `<h5>${esc(H.name)}</h5>${lines.join('')}`;
}

export function rulesHtml() {
  const c = (m) => cardsHtml(m, 15);
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

export { icon };
