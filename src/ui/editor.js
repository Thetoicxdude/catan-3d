// The map workshop: draw an island on a grid of hexes — sea, land drawn at random, or a terrain picked
// hex by hex — choose how many play and the points to win, and the map is checked as it is drawn
// (custom.js). 3D 預覽 shows the island on the 3D map; 試玩 opens a campaign on it. Drafts stay on this
// device and are saved as they are drawn.
import { CELL_KINDS, LIMITS, checkDraft, normalizeDraft } from '../engine/custom.js';
import { esc } from './text.js';
import { t, tx, N_, list } from '../i18n/index.js';

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

// what can be drawn, its colour and the mark on its hex (the names and marks are keys: t())
const TOOLS = [
  ['x', N_('清除'), null, ''],
  ['s', N_('海'), '#2f6f93', ''],
  ['l', N_('隨機陸地'), '#cbb88c', '?'],
  ['f', N_('森林'), '#2f6b2f', N_('林§mark')],
  ['h', N_('丘陵'), '#b5532c', N_('丘§mark')],
  ['p', N_('牧場'), '#8fcf4f', N_('牧§mark')],
  ['w', N_('農田'), '#e8c547', N_('田§mark')],
  ['m', N_('山脈'), '#8d8d96', N_('山§mark')],
  ['d', N_('沙漠'), '#d9c48e', N_('漠§mark')],
  ['g', N_('金礦'), '#f0b62a', N_('金§mark')],
];
const TOOL = Object.fromEntries(TOOLS.map((t) => [t[0], t]));

// shapes to start from: rows of [first column, last column] of random land, from a starting row
const rowsOf = (top, rows, k = 'l') => rows.flatMap(([c0, c1], i) => Array.from({ length: c1 - c0 + 1 }, (_, j) => [c0 + j, top + i, k]));
const TEMPLATES = [
  ['blank', N_('空白'), () => ({ kit: 4, cells: [] })],
  ['standard', N_('標準島嶼的形狀'), () => ({ kit: 4, cells: rowsOf(3, [[5, 7], [4, 7], [4, 8], [4, 7], [5, 7]]) })],
  ['large', N_('大島嶼的形狀（5–6 人）'), () => ({ kit: 6, cells: rowsOf(2, [[5, 7], [4, 7], [4, 8], [3, 8], [4, 8], [4, 7], [5, 7]]) })],
  [
    'isles',
    N_('主島與小島'),
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
// in `area`, the part of the screen left free), onPreviewEnd(), dialogs (confirmations), toast; on the
// self-hosted site also onPublish(draft), published() → Promise of the player's published maps (null:
// signed out) and unpublish(code) → Promise<boolean>
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
      <div class="modal-head"><h3>${t('地圖工坊')}</h3><div class="seg ed-modes"><button type="button" data-mode="edit" class="on">${t('編輯')}</button><button type="button" data-mode="view">${t('3D 預覽')}</button></div></div>
      <div class="ed-tools" role="toolbar" aria-label="${t('畫筆')}"></div>
      <div class="ed-grid"><svg viewBox="0 0 ${VIEW_W.toFixed(1)} ${VIEW_H.toFixed(1)}" role="img" aria-label="${t('地圖格子')}"></svg></div>
      <p class="ed-hint">${t('選一種畫筆，點格子或按住拖曳連續畫。地圖外圍會自動當作海；隨機陸地每局抽一次地形。')}</p>
    </section>
    <section class="setup-card panel ed-side">
      <div class="modal-head"><h3>${t('地圖設定')}</h3></div>
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
      if (!saveDraft(key, draft) && opts.toast) opts.toast(t('無法儲存'), t('這台裝置不能儲存草稿（瀏覽器的儲存空間被關閉）'), 'cross');
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
      const b = el('button', 'ed-tool' + (k === tool ? ' on' : ''), `<i style="${color ? `background:${color}` : ''}"></i><span>${t(name)}</span>`);
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
        if (mark) out.push(`<text x="${x.toFixed(2)}" y="${(y + 3.6).toFixed(2)}" class="ed-mark${k === 'l' ? ' q' : ''}">${mark.includes('§') ? t(mark) : mark}</text>`);
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
    g.appendChild(el('label', '', t('名稱')));
    const nm = el('input');
    nm.type = 'text';
    nm.maxLength = LIMITS.name;
    // (a default name is a key: shown in the reader's language)
    nm.value = tx(draft.name);
    nm.setAttribute('aria-label', t('地圖名稱'));
    nm.addEventListener('change', () => {
      draft.name = nm.value;
      changed();
    });
    g.appendChild(nm);
    g.appendChild(el('label', '', t('人數')));
    g.appendChild(
      segOf(
        [
          [4, t('3–4 人')],
          [6, t('5–6 人')],
        ],
        draft.kit,
        (v) => {
          draft.kit = v;
          changed();
        },
      ),
    );
    g.appendChild(el('label', '', t('勝利分數')));
    const vp = el('select');
    vp.setAttribute('aria-label', t('勝利分數'));
    for (let v = LIMITS.vp[0]; v <= LIMITS.vp[1]; v++) {
      const o = el('option', '', t('{n} 分', { n: v }));
      o.value = String(v);
      if (v === draft.vp) o.selected = true;
      vp.appendChild(o);
    }
    vp.addEventListener('change', () => {
      draft.vp = Number(vp.value);
      changed();
    });
    g.appendChild(vp);
    g.appendChild(el('label', '', t('航海家規則')));
    const forced = st.islands > 1 || (check.draft.cells || []).some((x) => x[2] === 'g');
    const sh = el('label', 'ed-check', `<input type="checkbox"${st.seafarers ? ' checked' : ''}${forced ? ' disabled' : ''}> ${t('船、海盜')}${forced ? t('（好幾座島或有金礦時一定要）') : ''}`);
    sh.querySelector('input').addEventListener('change', (e) => {
      draft.ships = e.target.checked;
      changed();
    });
    g.appendChild(sh);
    if (st.seafarers) {
      g.appendChild(el('label', '', t('開局')));
      g.appendChild(
        segOf(
          [
            ['any', t('任何島')],
            ['main', t('只在最大的島')],
          ],
          draft.start,
          (v) => {
            draft.start = v;
            changed();
          },
        ),
      );
      g.appendChild(el('label', '', t('外島加分')));
      g.appendChild(
        segOf(
          [
            [0, t('沒有')],
            [1, t('+1 分')],
            [2, t('+2 分')],
          ],
          draft.bonus,
          (v) => {
            draft.bonus = v;
            changed();
          },
        ),
      );
    }
    g.appendChild(el('label', '', t('隨機陸地')));
    const ds = el('label', 'ed-check', `<input type="checkbox"${draft.desert ? ' checked' : ''}> ${t('也抽沙漠（約 19 格 1 塊）')}`);
    ds.querySelector('input').addEventListener('change', (e) => {
      draft.desert = e.target.checked;
      changed();
    });
    g.appendChild(ds);
    body.appendChild(g);

    // the map in numbers
    const pool = Object.entries(st.pool)
      .map(([kind, n]) => `${t(TOOL[Object.keys(CELL_KINDS).find((k) => CELL_KINDS[k] === kind)][1])} ${n}`);
    const poolText = list(pool);
    const facts = el(
      'div',
      'ed-facts',
      `<div><b>${st.tiles}</b><span>${t('/ {n} 格', { n: LIMITS.tiles })}</span></div><div><b>${st.land}</b><span>${t('陸地')}</span></div><div><b>${st.islands}</b><span>${t('座島')}</span></div><div><b>${st.numbered}</b><span>${t('數字牌')}</span></div><div><b>${st.harbors}</b><span>${t('港口')}</span></div>` +
        (pool.length ? `<p>${t('隨機陸地抽：{list}', { list: esc(poolText) })}</p>` : ''),
    );
    body.appendChild(facts);
    const msgs = el('ul', 'ed-msgs');
    // (the checks' words in the reader's language: check.keys)
    for (const m of check.keys.errors) msgs.appendChild(el('li', 'err', esc(t(m.key, m.params || undefined))));
    for (const m of check.keys.warnings) msgs.appendChild(el('li', 'warn', esc(t(m.key, m.params || undefined))));
    for (const m of check.keys.notes) msgs.appendChild(el('li', 'note', esc(t(m.key, m.params || undefined))));
    if (!check.errors.length && !check.warnings.length) msgs.appendChild(el('li', 'ok', t('可以玩了：{lo}–{hi} 人，{vp} 分勝利', { lo: check.def.players[0], hi: check.def.players[1], vp: draft.vp })));
    body.appendChild(msgs);

    // start again from a shape
    const tg = el('div', 'form-grid');
    tg.appendChild(el('label', '', t('重新開始')));
    const sel = el('select');
    sel.setAttribute('aria-label', t('從範本重新開始'));
    sel.appendChild(el('option', '', t('選一個範本…')));
    for (const [id, label] of TEMPLATES) {
      const o = el('option', '', t(label));
      o.value = id;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      const tpl = TEMPLATES.find((x) => x[0] === sel.value);
      if (!tpl) return;
      // a new draft: the one being drawn stays in 我的地圖
      key = newKey();
      draft = normalizeDraft({ name: t('新的島嶼'), ...tpl[2]() });
      changed();
    });
    tg.appendChild(sel);
    body.appendChild(tg);

    foot.innerHTML = '';
    const back = el('button', 'btn', t('返回'));
    back.type = 'button';
    back.addEventListener('click', () => close(true));
    const mine = el('button', 'btn', t('我的地圖'));
    mine.type = 'button';
    mine.addEventListener('click', () => showMine());
    const play = el('button', 'btn primary', t('試玩'));
    play.type = 'button';
    play.disabled = !check.def;
    play.title = check.def ? t('用這張地圖開一局單人遊戲') : check.errors[0] || '';
    play.addEventListener('click', () => {
      if (!check.def) return;
      clearTimeout(saveTimer);
      saveDraft(key, draft);
      opts.onPlay(check.def);
    });
    foot.append(back, mine);
    // publishing (the self-hosted site): the map gets a code others can open it by
    if (opts.onPublish) {
      const pub = el('button', 'btn', t('發布'));
      pub.type = 'button';
      pub.disabled = !check.def;
      pub.title = check.def ? t('發布到公開地圖列表，拿到一個代號') : check.errors[0] || '';
      pub.addEventListener('click', () => check.def && opts.onPublish(check.draft));
      foot.appendChild(pub);
    }
    foot.appendChild(play);
  };

  // ── my maps: the drafts on this device ──
  const showMine = () => {
    const list = loadDrafts();
    const box = el('div', 'ed-mine');
    if (!list.length) box.appendChild(el('p', 'lead', t('還沒有儲存的地圖。')));
    for (const it of list) {
      const c = checkDraft(it.draft);
      const row = el('div', 'ed-mine-row' + (it.key === key ? ' on' : ''));
      row.innerHTML = `<div class="nm"><b>${esc(tx(it.draft.name))}</b><span>${t('{p} 人・{n} 格・', { p: it.draft.kit === 6 ? '5–6' : '3–4', n: c.stats.tiles })}${c.errors.length ? t('還不能玩') : t('{n} 分', { n: it.draft.vp })}</span></div>`;
      const open = el('button', 'btn', it.key === key ? t('編輯中') : t('開啟'));
      open.type = 'button';
      open.disabled = it.key === key;
      open.addEventListener('click', () => {
        key = it.key;
        draft = it.draft;
        changed();
        opts.dialogs.close(true);
      });
      const del = el('button', 'btn ghost', t('刪除'));
      del.type = 'button';
      del.addEventListener('click', () => {
        deleteDraft(it.key);
        if (it.key === key) {
          const rest = loadDrafts();
          key = rest[0] ? rest[0].key : newKey();
          draft = rest[0] ? rest[0].draft : normalizeDraft({ name: t('新的島嶼'), ...TEMPLATES[1][2]() });
          changed();
        }
        showMine();
      });
      row.append(open, del);
      box.appendChild(row);
    }
    // the maps this player has published (on the site's server)
    if (opts.published) {
      const pubBox = el('div', 'ed-mine ed-pubs', t('<div class="row-label">已發布</div><p class="lead">載入中…</p>'));
      box.appendChild(pubBox);
      opts
        .published()
        .then((maps) => {
          if (!box.isConnected) return;
          pubBox.querySelector('p').remove();
          if (!maps) pubBox.appendChild(el('p', 'lead', t('登入後可以發布地圖，發布的地圖會列在這裡。')));
          else if (!maps.length) pubBox.appendChild(el('p', 'lead', t('還沒有發布過地圖。')));
          for (const m of maps || []) {
            const row = el('div', 'ed-mine-row');
            row.innerHTML = `<div class="nm"><b>${esc(tx(m.name))}</b><span>${t('代號 {code}・{n} 局・', { code: esc(m.code), n: m.plays })}${m.votes ? `★ ${m.rating.toFixed(1)} (${m.votes})` : t('還沒有評分')}</span></div>`;
            const hide = el('button', 'btn ghost', t('從列表移除'));
            hide.type = 'button';
            hide.addEventListener('click', async () => {
              hide.disabled = true;
              if (await opts.unpublish(m.code)) row.remove();
              else hide.disabled = false;
            });
            row.appendChild(hide);
            pubBox.appendChild(row);
          }
        })
        .catch(() => {
          const p = pubBox.querySelector('p');
          if (p) p.textContent = t('無法載入已發布的地圖');
        });
    }
    const fresh = el('button', 'btn', t('新地圖'));
    fresh.type = 'button';
    fresh.addEventListener('click', () => {
      key = newKey();
      draft = normalizeDraft({ name: t('新的島嶼'), ...TEMPLATES[1][2]() });
      changed();
      opts.dialogs.close(true);
    });
    opts.dialogs.open({ kind: 'mine', title: t('我的地圖'), body: box, foot: [fresh], cls: 'ed-mine-dlg' });
  };

  // ── 3D preview ──
  const setMode = async (m) => {
    if (m === mode) return;
    if (m === 'view' && !check.def) {
      if (opts.toast) opts.toast(t('還不能預覽'), check.errors[0] || '', 'cross');
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
