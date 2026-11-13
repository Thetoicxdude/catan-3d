// Title & campaign setup screen (sits over a live preview of the island you will play on).
import { flagURL } from './flags.js';
import { esc } from './text.js';
import { mapDef, MAP_TABLE } from '../engine/maps.js';

export const PALETTE = [
  { hex: '#c8372d', name: '赤' },
  { hex: '#2f6fd0', name: '蒼' },
  { hex: '#e8892b', name: '琥珀' },
  { hex: '#17a9bd', name: '碧' },
  { hex: '#3f9a4a', name: '翠' },
  { hex: '#8a5cc2', name: '紫' },
];
export const AI_NAMES = ['北境公國', '蒼藍聯邦', '琥珀公國', '碧海共和國', '翡翠王國', '紫晶帝國', '赤沙酋長國', '銀港自由市', '霧峰同盟'];

// What the graphics chip can carry: integrated graphics (laptop APUs, Intel, phones) get medium quality,
// software rendering low. Checked once.
let tierCache = null;
export function gpuTier() {
  if (tierCache) return tierCache;
  tierCache = 'high';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return (tierCache = 'low');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(r)) tierCache = 'low';
    else if (/Intel|UHD|Iris|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+ Graphics|Mali|Adreno|PowerVR/i.test(r)) tierCache = 'medium';
  } catch {
    tierCache = 'medium';
  }
  return tierCache;
}

export function defaultSettings() {
  const mobile = typeof window !== 'undefined' && (window.innerWidth < 760 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
  const weak = typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  const tier = typeof document !== 'undefined' ? gpuTier() : 'high';
  return {
    name: '曙光王國',
    color: '#c8372d',
    opponents: 3,
    seats: [
      { name: '蒼藍聯邦', kind: 'ai', level: 'normal' },
      { name: '琥珀公國', kind: 'ai', level: 'normal' },
      { name: '碧海共和國', kind: 'ai', level: 'normal' },
      { name: '翡翠王國', kind: 'ai', level: 'normal' },
      { name: '紫晶帝國', kind: 'ai', level: 'normal' },
    ],
    // the island (maps.js) and, on the 5–6 player island, how the turn is shared
    map: 'base-4',
    turns: 'paired',
    numbers: 'balanced',
    // the house rules (houseRules below): standard unless changed
    vpAdj: 0,
    discard: 7,
    dice: 'random',
    mix: 'standard',
    speed: 'normal',
    // the interface: 'classic' (bronze frames) or 'clean' (theme2.css)
    ui: 'classic',
    // how often the map is drawn (render/pace.js): 'eco' | 'std' | 'max'; perfInfo: the read-out
    fps: 'std',
    perfInfo: false,
    sound: true,
    quality: mobile || tier === 'low' ? 'low' : weak || tier === 'medium' ? 'medium' : 'high',
  };
}

// The house rules a campaign or a room may change, standard first: the points to win (moved from the
// map's own: 10 on the standard islands, a scenario's or a drawn map's own), the hand limit for a 7,
// the dice (or the dice deck: engine.js drawDice), how the numbers are dealt (board.js richNumbers).
export const VP_ADJ = [-2, 0, 2, 4];
export const DISCARD = [7, 8, 9, 10];
export const DICE = ['random', 'deck'];
export const MIX = ['standard', 'rich'];

// the points to win with these settings
export function targetFor(s) {
  return Math.max(3, (mapDef(s.map).vp || 10) + (VP_ADJ.includes(s.vpAdj) ? s.vpAdj : 0));
}

// what an official room plays: the standard game on the standard island
export function officialSettings(s) {
  return { ...s, map: 'base-4', turns: 'paired', numbers: 'balanced', vpAdj: 0, discard: 7, dice: 'random', mix: 'standard' };
}

// the house rules in words, those that differ from the standard game only (for a room's terms)
export function houseRulesText(s, withTarget = false) {
  const out = [];
  if (withTarget) out.push(`${targetFor(s)} 分勝利`);
  if (s.discard !== 7 && DISCARD.includes(s.discard)) out.push(`手牌超過 ${s.discard} 張才棄牌`);
  if (s.dice === 'deck') out.push('平衡骰');
  if (s.mix === 'rich') out.push('數字偏向高機率');
  return out;
}

// what each house rule does, for the notes under the choices (only those not at their standard)
export function houseRulesNotes(s) {
  const out = [];
  if (s.dice === 'deck') out.push('平衡骰：36 種骰子組合各一張牌，依序翻開，翻完（最後幾張不用）再重洗。每個點數出現的次數會貼近機率，不會前面一直出 6、後面一直出 8。');
  if (s.mix === 'rich') out.push('數字偏向高機率：島上的 2、3、11、12 少一些，5、9（大地圖還有 4、10）多一些，6 和 8 數量不變；好位置比較多、比較好選。');
  if (s.discard !== 7 && DISCARD.includes(s.discard)) out.push(`擲出 7 時，手牌超過 ${s.discard} 張的國家才要棄掉一半（標準是超過 7 張）。`);
  return out;
}

// Settings saved by an older version: five opponent seats, a known map, an opponent count that fits it.
export function fitSettings(s) {
  const def = mapDef(s.map);
  s.map = def.id;
  if (s.turns !== 'sbp') s.turns = 'paired';
  // (the points to win were a number for the standard islands only: 8, 10 or 12)
  if (!VP_ADJ.includes(s.vpAdj)) s.vpAdj = s.target === 8 ? -2 : s.target === 12 ? 2 : 0;
  delete s.target;
  if (!DISCARD.includes(s.discard)) s.discard = 7;
  if (!DICE.includes(s.dice)) s.dice = 'random';
  if (!MIX.includes(s.mix)) s.mix = 'standard';
  if (s.ui !== 'clean') s.ui = 'classic';
  if (!['eco', 'std', 'max'].includes(s.fps)) s.fps = 'std';
  s.perfInfo = s.perfInfo === true;
  if (!Array.isArray(s.seats)) s.seats = [];
  for (let i = s.seats.length; i < 5; i++) {
    const used = new Set([s.name, ...s.seats.map((x) => x.name)]);
    s.seats.push({ name: AI_NAMES.find((n) => !used.has(n)) || AI_NAMES[i], kind: 'ai', level: 'normal' });
  }
  const [lo, hi] = def.players;
  s.opponents = Math.min(hi - 1, Math.max(lo - 1, Number(s.opponents) || hi - 1));
  return s;
}

// what createGame needs from the settings: the map, how its numbers are dealt, the points to win and
// the rules (the map's turn rule, the house rules that differ from the standard game)
export function gameSetup(s) {
  const def = mapDef(s.map);
  const out = { map: def.id, targetVP: 10, vpAdj: VP_ADJ.includes(s.vpAdj) ? s.vpAdj : 0, board: { numbers: s.numbers === 'spiral' ? 'spiral' : 'balanced' } };
  if (s.mix === 'rich') out.board.mix = 'rich';
  const rules = {};
  if (def.rules && def.rules.turns) rules.turns = s.turns === 'sbp' ? 'sbp' : 'paired';
  if (DISCARD.includes(s.discard) && s.discard !== 7) rules.discard = s.discard;
  if (s.dice === 'deck') rules.dice = 'deck';
  if (Object.keys(rules).length) out.rules = rules;
  return out;
}

export function seatColors(s) {
  const used = [s.color];
  return s.seats.slice(0, s.opponents).map((seat) => {
    // a colour saved before the palette changed (the old white) gives way to a current one
    let c = seat.color && PALETTE.some((p) => p.hex === seat.color) && !used.includes(seat.color) ? seat.color : null;
    if (!c) c = PALETTE.map((p) => p.hex).find((h) => !used.includes(h));
    used.push(c);
    return c;
  });
}

export function playersFromSettings(s) {
  const cols = seatColors(s);
  const players = [{ name: s.name.trim() || '曙光王國', color: s.color, kind: 'human' }];
  s.seats.slice(0, s.opponents).forEach((seat, i) => {
    players.push({
      name: (seat.name || '').trim() || AI_NAMES[i],
      color: cols[i],
      kind: seat.kind === 'human' ? 'human' : 'ai',
      ai: seat.kind === 'human' ? null : { level: seat.level || 'normal' },
    });
  });
  return players;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// how the turn is shared among 5–6 players, in a sentence (with ships, what the rule says of them)
export function turnsNote(turns, def) {
  const sea = !!(def && def.rules && def.rules.seafarers);
  return turns === 'sbp'
    ? `每位玩家回合結束後，其他人依序可以建造或購買發展卡（不能交易、不能使用發展卡${sea ? '、不能移船' : ''}）。`
    : `官方現行規則：每回合由兩位玩家行動。主要玩家照常擲骰、交易、建造；結束後由對面（左手邊第三位）的玩家接著建造、和銀行交易、使用一張發展卡${sea ? '、移動一艘船' : ''}，但不能擲骰或和其他國家交易。`;
}

// The house rules as rows of choices (the campaign menu and a custom room): `row(label, key, options,
// reroll)` adds one (reroll: the island changes with it), and `note(html)` says what the changed ones do.
export function houseRuleRows(s, row, note) {
  const def = mapDef(s.map);
  const base = def.vp || 10;
  const own = def.vp ? (def.custom ? '地圖' : '劇本') : '標準';
  row('勝利分數', 'vpAdj', VP_ADJ.map((d) => [d, `${Math.max(3, base + d)} 分${d === 0 ? `（${own}）` : ''}`]));
  row('棄牌門檻', 'discard', DISCARD.map((n) => [n, n === 7 ? '7 張（標準）' : `${n} 張`]));
  row('骰子', 'dice', [
    ['random', '隨機（標準）'],
    ['deck', '平衡骰'],
  ]);
  row('數字分布', 'mix', [
    ['standard', '標準'],
    ['rich', '偏向高機率'],
  ], true);
  // (the official spiral exists for the standard island only, with its own tokens)
  if (def.spiral && s.mix !== 'rich')
    row('數字排列', 'numbers', [
      ['balanced', '平衡隨機'],
      ['spiral', '官方螺旋'],
    ], true);
  const notes = houseRulesNotes(s);
  if (notes.length) note(notes.map(esc).join('<br>'));
}

// The maps to choose from (the campaign menu and a custom room): by kind, the 3–4 player map in the
// left column and its 5–6 player counterpart in the right; then maps players made (`extra`), one to a
// row.
export function mapTable(current, pick, extra = []) {
  const box = el('div', 'seg maps');
  box.appendChild(el('span', 'mt-col', '3–4 人'));
  box.appendChild(el('span', 'mt-col', '5–6 人'));
  for (const kind of MAP_TABLE) {
    box.appendChild(el('span', 'mt-kind', esc(kind.kind)));
    for (const row of kind.rows) {
      row.forEach((def, i) => {
        const b = el('button', (i ? 'r' : '') + (def.id === current ? ' on' : ''), esc(def.short || def.name));
        b.type = 'button';
        b.dataset.map = def.id;
        b.title = `${def.name}（${Math.max(3, def.players[0])}–${def.players[1]} 人）`;
        b.addEventListener('click', () => def.id !== current && pick(def.id));
        box.appendChild(b);
      });
    }
  }
  if (extra.length) {
    box.appendChild(el('span', 'mt-kind', '玩家地圖'));
    for (const def of extra) {
      const b = el('button', 'wide' + (def.id === current ? ' on' : ''), `${esc(def.name)}<small>${def.author ? esc(def.author) + '・' : ''}${def.players[0]}–${def.players[1]} 人</small>`);
      b.type = 'button';
      b.dataset.map = def.id;
      b.title = `${def.name}（${def.players[0]}–${def.players[1]} 人，${def.vp} 分勝利）`;
      b.addEventListener('click', () => def.id !== current && pick(def.id));
      box.appendChild(b);
    }
  }
  return box;
}

// which version of the site is running (written by the build; helps when reporting a problem)
// the deployed version (self-hosted site), as plain text
export function buildInfo() {
  const b = typeof window !== 'undefined' ? window.__build : null;
  if (!b || !b.sha) return '';
  let when = '';
  try {
    when = new Date(b.at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    /* no Intl */
  }
  const branch = b.branch && b.branch !== 'main' ? `・${b.branch}` : '';
  return `版本 ${String(b.sha).replace(/[^0-9a-z]/gi, '').slice(0, 7)}${branch}${when ? `・${when}` : ''}`;
}
function buildLabel() {
  const t = buildInfo();
  return t ? `<p class="credits build">${esc(t)}</p>` : '';
}

// The single-player setup: nation, opponents, number layout, victory points and the island.
export function showMenu(root, { settings, hasSave, onStart, onContinue, onRules, onReroll, onChange, onOnline, onBack, onEditor, onBrowse, customMaps = [] }) {
  const scr = el('div', 'menu-screen');
  scr.innerHTML = `
    <div class="title-block">
      <div class="eyebrow">Single Player · Island Campaign</div>
      <h1>單人遊戲<span>卡坦島 3D 戰略版</span></h1>
      <p>和電腦對手，或同一台裝置上的朋友輪流，在立體戰略地圖上開拓、交易、築城。率先取得勝利分數的國家，將統一整座島嶼。</p>${buildLabel()}
    </div>
    <div class="setup-card panel">
      <div class="modal-head"><h3>新戰役</h3></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    </div>`;
  const body = scr.querySelector('.modal-body');
  const foot = scr.querySelector('.modal-foot');

  const render = () => {
    body.innerHTML = '';
    const g = el('div', 'form-grid');
    g.appendChild(el('label', '', '你的國家'));
    const name = el('input');
    name.type = 'text';
    name.id = 'menu-name';
    name.maxLength = 8;
    name.value = settings.name;
    name.addEventListener('input', () => {
      settings.name = name.value;
      onChange(settings);
    });
    g.appendChild(name);

    g.appendChild(el('label', '', '國家顏色'));
    const sw = el('div', 'swatches');
    for (const p of PALETTE) {
      const b = el('button', 'swatch' + (settings.color === p.hex ? ' on' : ''));
      b.type = 'button';
      b.style.background = p.hex;
      b.title = p.name;
      b.setAttribute('aria-label', p.name + '色');
      b.addEventListener('click', () => {
        settings.color = p.hex;
        onChange(settings);
        render();
      });
      sw.appendChild(b);
    }
    g.appendChild(sw);

    const seg = (label, key, opts) => {
      g.appendChild(el('label', '', label));
      const s = el('div', 'seg');
      for (const [val, text] of opts) {
        const b = el('button', settings[key] === val ? 'on' : '', text);
        b.type = 'button';
        b.addEventListener('click', () => {
          const changed = settings[key] !== val;
          settings[key] = val;
          onChange(settings, key);
          if (key === 'numbers' && changed) onReroll(false);
          render();
        });
        s.appendChild(b);
      }
      g.appendChild(s);
    };
    // the island first: it decides how many nations can play
    g.appendChild(el('label', '', '地圖'));
    g.appendChild(
      mapTable(
        settings.map,
        (id) => {
          settings.map = id;
          settings.opponents = mapDef(id).players[1] - 1;
          fitSettings(settings);
          onChange(settings, 'map');
          onReroll(false);
          render();
        },
        customMaps,
      ),
    );
    if (onEditor || onBrowse) {
      g.appendChild(el('span', ''));
      const links = el('div', 'map-links');
      if (onBrowse) {
        const br = el('button', 'btn ghost ed-open', '公開地圖…');
        br.type = 'button';
        br.addEventListener('click', () => onBrowse());
        links.appendChild(br);
      }
      if (onEditor) {
        const ed = el('button', 'btn ghost ed-open', '地圖工坊：畫一座自己的島 →');
        ed.type = 'button';
        ed.addEventListener('click', () => onEditor());
        links.appendChild(ed);
      }
      g.appendChild(links);
    }
    const big = mapDef(settings.map).players[0] >= 5;
    seg(
      '對手數量',
      'opponents',
      big
        ? [
            [4, '4 國（5 人局）'],
            [5, '5 國（6 人局）'],
          ]
        : [
            [2, '2 國（3 人局）'],
            [3, '3 國（4 人局）'],
          ],
    );
    if (big) {
      seg('回合規則', 'turns', [
        ['paired', '配對回合'],
        ['sbp', '特別建造階段'],
      ]);
      g.appendChild(el('span', ''));
      g.appendChild(el('p', 'form-note', turnsNote(settings.turns, mapDef(settings.map))));
    }
    body.appendChild(g);

    const seats = el('div', 'seat-list');
    const cols = seatColors(settings);
    settings.seats.slice(0, settings.opponents).forEach((seat, i) => {
      const row = el('div', 'seat');
      row.innerHTML = `<img class="flag sm" alt="" src="${flagURL(cols[i], i + 1)}">`;
      const nm = el('input');
      nm.type = 'text';
      nm.id = 'seat-name-' + i;
      nm.maxLength = 8;
      nm.value = seat.name;
      nm.setAttribute('aria-label', `第 ${i + 1} 個對手的名稱`);
      nm.style.cssText = 'width:100%;box-sizing:border-box;height:32px;padding:0 8px;background:rgba(0,0,0,.35);border:1px solid rgba(199,166,96,.25);color:var(--ink);font:inherit;border-radius:2px;min-width:0';
      nm.addEventListener('input', () => {
        seat.name = nm.value;
        onChange(settings);
      });
      row.appendChild(nm);
      const sel = el('select');
      sel.id = 'seat-kind-' + i;
      sel.setAttribute('aria-label', '控制方式');
      sel.style.cssText = 'height:32px;background:rgba(0,0,0,.35);border:1px solid rgba(199,166,96,.25);color:var(--ink);font:inherit;border-radius:2px';
      for (const [v, t] of [
        ['ai:easy', '電腦·簡單'],
        ['ai:normal', '電腦·普通'],
        ['ai:hard', '電腦·困難'],
        ['human', '玩家（同裝置）'],
      ]) {
        const o = el('option', '', t);
        o.value = v;
        if ((seat.kind === 'human' && v === 'human') || (seat.kind !== 'human' && v === 'ai:' + (seat.level || 'normal'))) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        if (sel.value === 'human') seat.kind = 'human';
        else {
          seat.kind = 'ai';
          seat.level = sel.value.split(':')[1];
        }
        onChange(settings);
      });
      row.appendChild(sel);
      seats.appendChild(row);
    });
    body.appendChild(seats);

    const g2 = el('div', 'form-grid');
    const seg2 = (label, key, opts, reroll) => {
      g2.appendChild(el('label', '', label));
      const s = el('div', 'seg');
      for (const [val, text] of opts) {
        const b = el('button', settings[key] === val ? 'on' : '', text);
        b.type = 'button';
        b.addEventListener('click', () => {
          const changed = settings[key] !== val;
          settings[key] = val;
          onChange(settings, key);
          if (reroll && changed) onReroll(false);
          render();
        });
        s.appendChild(b);
      }
      g2.appendChild(s);
    };
    houseRuleRows(settings, seg2, (html) => {
      g2.appendChild(el('span', ''));
      g2.appendChild(el('p', 'form-note', html));
    });
    g2.appendChild(el('label', '', '島嶼'));
    const rr = el('div', 'menu-actions');
    const reroll = el('button', 'btn', '換一座島嶼');
    reroll.type = 'button';
    reroll.addEventListener('click', () => onReroll(true));
    rr.appendChild(reroll);
    rr.appendChild(el('span', '', '<span style="color:var(--ink-faint);font-size:12px;align-self:center">背景就是你將要開拓的島</span>'));
    g2.appendChild(rr);
    body.appendChild(g2);
  };
  render();

  if (onBack) {
    const back = el('button', 'btn', '返回');
    back.type = 'button';
    back.dataset.k = 'back';
    back.addEventListener('click', onBack);
    foot.appendChild(back);
  }
  const rules = el('button', 'btn', '規則說明');
  rules.type = 'button';
  rules.addEventListener('click', onRules);
  foot.appendChild(rules);
  if (hasSave) {
    const cont = el('button', 'btn', '繼續上一局');
    cont.type = 'button';
    cont.addEventListener('click', onContinue);
    foot.appendChild(cont);
  }
  if (onOnline) {
    const online = el('button', 'btn', '線上對戰');
    online.type = 'button';
    online.addEventListener('click', onOnline);
    foot.appendChild(online);
  }
  const start = el('button', 'btn primary', '開始戰役');
  start.type = 'button';
  start.addEventListener('click', () => onStart(settings));
  foot.appendChild(start);
  root.appendChild(scr);
  return { el: scr, close: () => scr.remove(), render };
}

export { esc };
