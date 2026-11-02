// Published maps in the interface: the list to choose from (newest, best rated, most played, or a
// code typed in), what publishing gives (the code and a link to share), and rating a map.
import { listMaps, loadPublished, cleanCode, CODE_RE, mapLink, rateMap } from '../net/maps.js';
import { esc } from './text.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function btn(label, cls, fn) {
  const b = el('button', 'btn ' + (cls || ''), label);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}
const stars = (r, n) => (n ? `★ ${r.toFixed(1)}<small>（${n}）</small>` : '<small>還沒有評分</small>');

// The public list. onPick(def) gets the chosen map, fetched and known to the page.
export function openMapBrowser(dialogs, { onPick, toast, kit = 0 }) {
  const box = el('div', 'mb');
  let sort = 'new';
  let page = 0;
  let rows = [];
  let done = false;
  const pick = async (code) => {
    try {
      const def = await loadPublished(code);
      dialogs.close(true);
      onPick(def);
    } catch (e) {
      if (toast) toast('打不開這張地圖', e.message, 'cross');
    }
  };
  // a code typed in
  const codeRow = el('div', 'mb-code');
  const inp = el('input');
  inp.type = 'text';
  inp.placeholder = '輸入地圖代號';
  inp.maxLength = 8;
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.setAttribute('aria-label', '地圖代號');
  const go = btn('開啟', '', () => {
    const c = cleanCode(inp.value);
    if (!CODE_RE.test(c)) {
      if (toast) toast('代號不對', '地圖代號是 6 個英文字母或數字', 'cross');
      return;
    }
    pick(c);
  });
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  codeRow.append(inp, go);
  const tabs = el('div', 'seg');
  const list = el('div', 'mb-list');
  const more = btn('更多地圖', 'ghost', () => load());
  const render = () => {
    tabs.innerHTML = '';
    for (const [k, label] of [
      ['new', '最新'],
      ['top', '評分最高'],
      ['played', '最多人玩'],
    ]) {
      const b = el('button', k === sort ? 'on' : '', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (k === sort) return;
        sort = k;
        page = 0;
        rows = [];
        done = false;
        load();
      });
      tabs.appendChild(b);
    }
    list.innerHTML = '';
    const shown = kit ? rows.filter((m) => m.kit === kit) : rows;
    if (!shown.length) list.appendChild(el('p', 'lead', done ? '還沒有人發布地圖。' : '載入中…'));
    for (const m of shown) {
      const row = el('div', 'mb-row');
      row.innerHTML = `<div class="nm"><b>${esc(m.name)}</b><span>${esc(m.author)}・${m.kit === 6 ? '5–6' : '3–4'} 人・${m.tiles} 格・${m.plays} 局</span></div><div class="mb-stars">${stars(m.rating, m.votes)}</div><code>${esc(m.code)}</code>`;
      row.appendChild(btn('選擇', '', () => pick(m.code)));
      list.appendChild(row);
    }
    more.hidden = done;
  };
  const load = async () => {
    render();
    try {
      const d = await listMaps(sort, page);
      rows = rows.concat(d.maps || []);
      page++;
      done = !d.maps || d.maps.length < (d.size || 24);
    } catch (e) {
      done = true;
      if (toast) toast('無法載入地圖列表', e.message, 'cross');
    }
    render();
  };
  box.append(codeRow, tabs, list, more);
  dialogs.open({ kind: 'maps', title: '公開地圖', body: box, cls: 'mb-dlg' });
  load();
}

// What publishing gave: the map's code and the link that opens it.
export function showPublished(dialogs, code, again, toast) {
  const link = mapLink(code);
  const body = el(
    'div',
    'mb-pub',
    `<p class="lead">${again ? '這張地圖之前就發布過了，代號一樣：' : '地圖已經發布到公開列表。朋友可以用代號或連結打開它，建房間時也能選它：'}</p><div class="code-box"><span class="lbl">地圖代號</span><b class="num">${esc(code)}</b></div><p class="mb-link">${esc(link)}</p>`,
  );
  const copy = (text, what) => {
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(
        () => toast && toast('已複製', what, 'check'),
        () => toast && toast('無法複製', text, 'cards'),
      );
    else if (toast) toast(what, text, 'cards');
  };
  dialogs.open({ kind: 'published', title: '發布完成', body, foot: [btn('複製代號', '', () => copy(code, '地圖代號 ' + code)), btn('複製連結', 'primary', () => copy(link, '連結已複製，傳給朋友就能打開這張地圖'))] });
}

// Five stars for a published map (the game-over dialog): rated once, changeable.
export function ratingStars(code, toast) {
  const box = el('div', 'mb-rate', '<span>為這張地圖評分</span>');
  const row = el('div', 'mb-rate-stars');
  let mine = 0;
  const paint = () => row.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i < mine));
  for (let i = 1; i <= 5; i++) {
    const b = el('button', '', '★');
    b.type = 'button';
    b.setAttribute('aria-label', `${i} 顆星`);
    b.addEventListener('click', async () => {
      try {
        const r = await rateMap(code, i);
        mine = r.mine;
        paint();
        if (toast) toast('謝謝評分', `平均 ${r.rating.toFixed(1)} 顆星（${r.votes} 人）`, 'check');
      } catch (e) {
        if (toast) toast('無法評分', e.message, 'cross');
      }
    });
    row.appendChild(b);
  }
  box.appendChild(row);
  return box;
}
