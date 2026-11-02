// The map workshop: draw an island on a grid of hexes — sea, land drawn at random, or a terrain picked
// hex by hex — choose how many play and the points to win, and the map is checked as it is drawn
// (custom.js). 3D 預覽 shows the island on the 3D map; 試玩 opens a campaign on it. Drafts stay on this
// device and are saved as they are drawn.
import { CELL_KINDS, LIMITS, checkDraft, normalizeDraft } from '../engine/custom.js';
import { esc } from './text.js';

const STORE = 'catan3d-drafts-v1';

// ── drafts on this device ──
export function loadDrafts() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.key === 'string' && x.draft).map((x) => ({ key: x.key, at: x.at || 0, draft: normalizeDraft(x.draft) })) : [];
  } catch {
    return [];
  }
}
function storeDrafts(list) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list.slice(0, 40)));
    return true;
  } catch {
    return false;
  }
}
export function saveDraft(key, draft) {
  const list = loadDrafts().filter((x) => x.key !== key);
  list.unshift({ key, at: Date.now(), draft: normalizeDraft(draft) });
  return storeDrafts(list);
}
export function deleteDraft(key) {
  storeDrafts(loadDrafts().filter((x) => x.key !== key));
}
const newKey = () => 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

// ── the grid ──
const S = 10; // hex circumradius in the drawing's units
const W = Math.sqrt(3) * S;
const PAD = 4;
const cx = (c, r) => PAD + W / 2 + (c + (r & 1) * 0.5) * W;
const cy = (r) => PAD + S + r * 1.5 * S;
const VIEW_W = PAD * 2 + W * (LIMITS.cols + 0.5);
const VIEW_H = PAD * 2 + S * 2 + (LIMITS.rows - 1) * 1.5 * S;
const corners = (x, y, s = S * 0.97) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i + 30);
    return `${(x + s * Math.cos(a)).toFixed(2)},${(y + s * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

// what can be drawn, its colour and the mark on its hex
const TOOLS = [
  ['x', '清除', null, ''],
  ['s', '海', '#2f6f93', ''],
  ['l', '隨機陸地', '#cbb88c', '?'],
  ['f', '森林', '#2f6b2f', '林'],
  ['h', '丘陵', '#b5532c', '丘'],
  ['p', '牧場', '#8fcf4f', '牧'],
  ['w', '農田', '#e8c547', '田'],
  ['m', '山脈', '#8d8d96', '山'],
  ['d', '沙漠', '#d9c48e', '漠'],
  ['g', '金礦', '#f0b62a', '金'],
];
const TOOL = Object.fromEntries(TOOLS.map((t) => [t[0], t]));

// shapes to start from: rows of [first column, last column] of random land, from a starting row
const rowsOf = (top, rows, k = 'l') => rows.flatMap(([c0, c1], i) => Array.from({ length: c1 - c0 + 1 }, (_, j) => [c0 + j, top + i, k]));
const TEMPLATES = [
  ['blank', '空白', () => ({ kit: 4, cells: [] })],
  ['standard', '標準島嶼的形狀', () => ({ kit: 4, cells: rowsOf(3, [[5, 7], [4, 7], [4, 8], [4, 7], [5, 7]]) })],
  ['large', '大島嶼的形狀（5–6 人）', () => ({ kit: 6, cells: rowsOf(2, [[5, 7], [4, 7], [4, 8], [3, 8], [4, 8], [4, 7], [5, 7]]) })],
  [
    'isles',
    '主島與小島',
    () => {
      const cells = [];
      for (let r = 1; r <= 9; r++) for (let c = 1; c <= 11; c++) cells.push([c, r, 's']);
      const land = rowsOf(3, [[2, 4], [1, 4], [1, 5], [1, 4], [2, 4]]);
      const isles = [
        [8, 2, 'l'], [9, 2, 'l'], [8, 3, 'g'],
        [9, 6, 'l'], [10, 6, 'l'], [9, 7, 'l'],
        [6, 8, 'l'], [7, 8, 'l'],
      ];
      const at = new Map(cells.map((x) => [x[0] + ',' + x[1], x]));
      for (const [c, r, k] of [...land, ...isles]) at.get(c + ',' + r)[2] = k;
      return { kit: 4, start: 'main', bonus: 2, vp: 12, cells: [...at.values()] };
    },
  ],
];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// opts: onBack(), onPlay(def), onPreview(def, area) → Promise (draws the island on the 3D map, framed
// in `area`, the part of the screen left free), onPreviewEnd(), dialogs (confirmations), toast
export function showEditor(app, opts) {
  const drafts = loadDrafts();
  let key = drafts[0] ? drafts[0].key : newKey();
  let draft = drafts[0] ? drafts[0].draft : normalizeDraft(TEMPLATES[1][2]());
  let tool = 'l';
  let mode = 'edit';
  let check = checkDraft(draft);

  const scr = el('div', 'menu-screen editor');
  scr.innerHTML = `
    <section class="ed-board panel">
      <div class="modal-head"><h3>地圖工坊</h3><div class="seg ed-modes"><button type="button" data-mode="edit" class="on">編輯</button><button type="button" data-mode="view">3D 預覽</button></div></div>
      <div class="ed-tools" role="toolbar" aria-label="畫筆"></div>
      <div class="ed-grid"><svg viewBox="0 0 ${VIEW_W.toFixed(1)} ${VIEW_H.toFixed(1)}" role="img" aria-label="地圖格子"></svg></div>
      <p class="ed-hint">選一種畫筆，點格子或按住拖曳連續畫。地圖外圍會自動當作海；隨機陸地每局抽一次地形。</p>
    </section>
    <section class="setup-card panel ed-side">
      <div class="modal-head"><h3>地圖設定</h3></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    </section>`;
  app.appendChild(scr);
  const svg = scr.querySelector('svg');
  const toolsEl = scr.querySelector('.ed-tools');
  const body = scr.querySelector('.ed-side .modal-body');
  const foot = scr.querySelector('.ed-side .modal-foot');

  // ── saving as it is drawn ──
  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!saveDraft(key, draft) && opts.toast) opts.toast('無法儲存', '這台裝置不能儲存草稿（瀏覽器的儲存空間被關閉）', 'cross');
    }, 400);
  };
  const changed = (redrawSide = true) => {
    draft = normalizeDraft(draft);
    check = checkDraft(draft);
    persist();
    paintGrid();
    if (redrawSide) renderSide();
  };

  // ── the palette ──
  const renderTools = () => {
    toolsEl.innerHTML = '';
    for (const [k, name, color] of TOOLS) {
      const b = el('button', 'ed-tool' + (k === tool ? ' on' : ''), `<i style="${color ? `background:${color}` : ''}"></i><span>${name}</span>`);
      b.type = 'button';
      b.dataset.tool = k;
      b.setAttribute('aria-pressed', String(k === tool));
      b.addEventListener('click', () => {
        tool = k;
        renderTools();
      });
      toolsEl.appendChild(b);
    }
  };

  // ── the grid ──
  const cellAt = new Map();
  const paintGrid = () => {
    cellAt.clear();
    for (const [c, r, k] of draft.cells) cellAt.set(c + ',' + r, k);
    const out = [];
    for (let r = 0; r < LIMITS.rows; r++) {
      for (let c = 0; c < LIMITS.cols; c++) {
        const k = cellAt.get(c + ',' + r);
        const x = cx(c, r);
        const y = cy(r);
        if (!k) {
          out.push(`<polygon class="ed-cell off" data-c="${c}" data-r="${r}" points="${corners(x, y)}"/>`);
          continue;
        }
        const [, , color, mark] = TOOL[k];
        out.push(`<polygon class="ed-cell ${k === 's' ? 'sea' : 'land'}" data-c="${c}" data-r="${r}" points="${corners(x, y)}" fill="${color}"/>`);
        if (mark) out.push(`<text x="${x.toFixed(2)}" y="${(y + 3.6).toFixed(2)}" class="ed-mark${k === 'l' ? ' q' : ''}">${mark}</text>`);
      }
    }
    svg.innerHTML = out.join('');
  };
  const put = (c, r) => {
    if (c < 0 || r < 0 || c >= LIMITS.cols || r >= LIMITS.rows) return false;
    const k = cellAt.get(c + ',' + r);
    const want = tool === 'x' ? undefined : tool;
    if (k === want) return false;
    draft.cells = draft.cells.filter(([a, b]) => a !== c || b !== r);
    if (want) draft.cells.push([c, r, want]);
    cellAt.set(c + ',' + r, want);
    return true;
  };
  // the cell under a point on the screen: the nearest hex centre
  const pick = (ev) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    const r = Math.round((p.y - PAD - S) / (1.5 * S));
    let best = null;
    let bd = Infinity;
    for (let rr = r - 1; rr <= r + 1; rr++) {
      if (rr < 0 || rr >= LIMITS.rows) continue;
      for (let c = 0; c < LIMITS.cols; c++) {
        const d = (cx(c, rr) - p.x) ** 2 + (cy(rr) - p.y) ** 2;
        if (d < bd) {
          bd = d;
          best = [c, rr];
        }
      }
    }
    return best && bd <= S * S * 1.1 ? best : null;
  };
  let drawing = false;
  let dirty = false;
  const stroke = (ev) => {
    const at = pick(ev);
    if (at && put(at[0], at[1])) {
      dirty = true;
      paintGrid();
    }
  };
  svg.addEventListener('pointerdown', (ev) => {
    if (mode !== 'edit') return;
    drawing = true;
    dirty = false;
    try {
      svg.setPointerCapture(ev.pointerId);
    } catch {
      /* pointer gone */
    }
    stroke(ev);
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', (ev) => drawing && stroke(ev));
  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (dirty) changed();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  // ── settings, checks, actions ──
  const segOf = (opts2, on, pickIt) => {
    const s = el('div', 'seg');
    for (const [val, text] of opts2) {
      const b = el('button', val === on ? 'on' : '', text);
      b.type = 'button';
      b.addEventListener('click', () => val !== on && pickIt(val));
      s.appendChild(b);
    }
    return s;
  };
  const renderSide = () => {
    const st = check.stats;
    body.innerHTML = '';
    const g = el('div', 'form-grid');
    g.appendChild(el('label', '', '名稱'));
    const nm = el('input');
    nm.type = 'text';
    nm.maxLength = LIMITS.name;
    nm.value = draft.name;
    nm.setAttribute('aria-label', '地圖名稱');
    nm.addEventListener('change', () => {
      draft.name = nm.value;
      changed();
    });
    g.appendChild(nm);
    g.appendChild(el('label', '', '人數'));
    g.appendChild(
      segOf(
        [
          [4, '3–4 人'],
          [6, '5–6 人'],
        ],
        draft.kit,
        (v) => {
          draft.kit = v;
          changed();
        },
      ),
    );
    g.appendChild(el('label', '', '勝利分數'));
    const vp = el('select');
    vp.setAttribute('aria-label', '勝利分數');
    for (let v = LIMITS.vp[0]; v <= LIMITS.vp[1]; v++) {
      const o = el('option', '', `${v} 分`);
      o.value = String(v);
      if (v === draft.vp) o.selected = true;
      vp.appendChild(o);
    }
    vp.addEventListener('change', () => {
      draft.vp = Number(vp.value);
      changed();
    });
    g.appendChild(vp);
    g.appendChild(el('label', '', '航海家規則'));
    const forced = st.islands > 1 || (check.draft.cells || []).some((x) => x[2] === 'g');
    const sh = el('label', 'ed-check', `<input type="checkbox"${st.seafarers ? ' checked' : ''}${forced ? ' disabled' : ''}> 船、海盜${forced ? '（好幾座島或有金礦時一定要）' : ''}`);
    sh.querySelector('input').addEventListener('change', (e) => {
      draft.ships = e.target.checked;
      changed();
    });
    g.appendChild(sh);
    if (st.seafarers) {
      g.appendChild(el('label', '', '開局'));
      g.appendChild(
        segOf(
          [
            ['any', '任何島'],
            ['main', '只在最大的島'],
          ],
          draft.start,
          (v) => {
            draft.start = v;
            changed();
          },
        ),
      );
      g.appendChild(el('label', '', '外島加分'));
      g.appendChild(
        segOf(
          [
            [0, '沒有'],
            [1, '+1 分'],
            [2, '+2 分'],
          ],
          draft.bonus,
          (v) => {
            draft.bonus = v;
            changed();
          },
        ),
      );
    }
    g.appendChild(el('label', '', '隨機陸地'));
    const ds = el('label', 'ed-check', `<input type="checkbox"${draft.desert ? ' checked' : ''}> 也抽沙漠（約 19 格 1 塊）`);
    ds.querySelector('input').addEventListener('change', (e) => {
      draft.desert = e.target.checked;
      changed();
    });
    g.appendChild(ds);
    body.appendChild(g);

    // the map in numbers
    const pool = Object.entries(st.pool)
      .map(([t, n]) => `${TOOL[Object.keys(CELL_KINDS).find((k) => CELL_KINDS[k] === t)][1]} ${n}`)
      .join('、');
    const facts = el(
      'div',
      'ed-facts',
      `<div><b>${st.tiles}</b><span>/ ${LIMITS.tiles} 格</span></div><div><b>${st.land}</b><span>陸地</span></div><div><b>${st.islands}</b><span>座島</span></div><div><b>${st.numbered}</b><span>數字牌</span></div><div><b>${st.harbors}</b><span>港口</span></div>` +
        (pool ? `<p>隨機陸地抽：${esc(pool)}</p>` : ''),
    );
    body.appendChild(facts);
    const msgs = el('ul', 'ed-msgs');
    for (const m of check.errors) msgs.appendChild(el('li', 'err', esc(m)));
    for (const m of check.warnings) msgs.appendChild(el('li', 'warn', esc(m)));
    for (const m of check.notes) msgs.appendChild(el('li', 'note', esc(m)));
    if (!check.errors.length && !check.warnings.length) msgs.appendChild(el('li', 'ok', `可以玩了：${check.def.players[0]}–${check.def.players[1]} 人，${draft.vp} 分勝利`));
    body.appendChild(msgs);

    // start again from a shape
    const tg = el('div', 'form-grid');
    tg.appendChild(el('label', '', '重新開始'));
    const sel = el('select');
    sel.setAttribute('aria-label', '從範本重新開始');
    sel.appendChild(el('option', '', '選一個範本…'));
    for (const [id, label] of TEMPLATES) {
      const o = el('option', '', label);
      o.value = id;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      const t = TEMPLATES.find((x) => x[0] === sel.value);
      if (!t) return;
      // a new draft: the one being drawn stays in 我的地圖
      key = newKey();
      draft = normalizeDraft({ name: '新的島嶼', ...t[2]() });
      changed();
    });
    tg.appendChild(sel);
    body.appendChild(tg);

    foot.innerHTML = '';
    const back = el('button', 'btn', '返回');
    back.type = 'button';
    back.addEventListener('click', () => close(true));
    const mine = el('button', 'btn', '我的地圖');
    mine.type = 'button';
    mine.addEventListener('click', () => showMine());
    const play = el('button', 'btn primary', '試玩');
    play.type = 'button';
    play.disabled = !check.def;
    play.title = check.def ? '用這張地圖開一局單人遊戲' : check.errors[0] || '';
    play.addEventListener('click', () => {
      if (!check.def) return;
      clearTimeout(saveTimer);
      saveDraft(key, draft);
      opts.onPlay(check.def);
    });
    foot.append(back, mine, play);
  };

  // ── my maps: the drafts on this device ──
  const showMine = () => {
    const list = loadDrafts();
    const box = el('div', 'ed-mine');
    if (!list.length) box.appendChild(el('p', 'lead', '還沒有儲存的地圖。'));
    for (const it of list) {
      const c = checkDraft(it.draft);
      const row = el('div', 'ed-mine-row' + (it.key === key ? ' on' : ''));
      row.innerHTML = `<div class="nm"><b>${esc(it.draft.name)}</b><span>${it.draft.kit === 6 ? '5–6' : '3–4'} 人・${c.stats.tiles} 格・${c.errors.length ? '還不能玩' : `${it.draft.vp} 分`}</span></div>`;
      const open = el('button', 'btn', it.key === key ? '編輯中' : '開啟');
      open.type = 'button';
      open.disabled = it.key === key;
      open.addEventListener('click', () => {
        key = it.key;
        draft = it.draft;
        changed();
        opts.dialogs.close(true);
      });
      const del = el('button', 'btn ghost', '刪除');
      del.type = 'button';
      del.addEventListener('click', () => {
        deleteDraft(it.key);
        if (it.key === key) {
          const rest = loadDrafts();
          key = rest[0] ? rest[0].key : newKey();
          draft = rest[0] ? rest[0].draft : normalizeDraft({ name: '新的島嶼', ...TEMPLATES[1][2]() });
          changed();
        }
        showMine();
      });
      row.append(open, del);
      box.appendChild(row);
    }
    const fresh = el('button', 'btn', '新地圖');
    fresh.type = 'button';
    fresh.addEventListener('click', () => {
      key = newKey();
      draft = normalizeDraft({ name: '新的島嶼', ...TEMPLATES[1][2]() });
      changed();
      opts.dialogs.close(true);
    });
    opts.dialogs.open({ kind: 'mine', title: '我的地圖', body: box, foot: [fresh], cls: 'ed-mine-dlg' });
  };

  // ── 3D preview ──
  const setMode = async (m) => {
    if (m === mode) return;
    if (m === 'view' && !check.def) {
      if (opts.toast) opts.toast('還不能預覽', check.errors[0] || '', 'cross');
      return;
    }
    mode = m;
    scr.classList.toggle('viewing', m === 'view');
    scr.querySelectorAll('.ed-modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (m === 'view') {
      const side = scr.querySelector('.ed-side').getBoundingClientRect();
      const head = scr.querySelector('.ed-board .modal-head').getBoundingClientRect();
      const narrow = window.innerWidth < 760;
      const area = { left: 0, top: head.bottom, right: narrow ? window.innerWidth : side.left, bottom: window.innerHeight };
      await opts.onPreview(check.def, area);
    } else if (opts.onPreviewEnd) opts.onPreviewEnd();
  };
  scr.querySelectorAll('.ed-modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  const close = (back) => {
    clearTimeout(saveTimer);
    saveDraft(key, draft);
    scr.remove();
    if (back) opts.onBack();
  };

  renderTools();
  paintGrid();
  renderSide();
  persist();
  return {
    close: () => close(false),
    get draft() {
      return draft;
    },
    get check() {
      return check;
    },
  };
}
