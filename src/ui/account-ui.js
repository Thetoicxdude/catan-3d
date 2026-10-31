// The player's account on the home screen: a plate under the nation (sign in, or the record so far)
// and the two dialogs it opens: signing in with Google, and the record of finished campaigns.
import { accountsAvailable, currentUser, onUser, loadUser, renderSignIn, signOut, forgetMe } from '../net/account.js';
import { esc } from './text.js';

const MODES = { single: '單人', hotseat: '同機', online: '線上房間', official: '官方房間' };

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

// the player's picture, or their initial on a bronze disc when there is none (or it won't load)
function avatar(u, size) {
  const initial = esc(String((u && u.name) || '?').trim().charAt(0) || '?');
  const img = u && u.pic ? `<img src="${esc(u.pic)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="ac-face" style="--s:${size}px"><b>${initial}</b>${img}</span>`;
}

const KEY = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8.2" r="4" fill="currentColor"/><path d="M4.5 20.5c.6-4.2 3.6-6.7 7.5-6.7s6.9 2.5 7.5 6.7z" fill="currentColor"/></svg>`;

function pct(a, b) {
  return b ? Math.round((a / b) * 100) + '%' : '—';
}

function day(t) {
  try {
    return new Date(t).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
  } catch {
    return '';
  }
}

export function openSignIn(dialogs, onSigned) {
  const body = el('div', 'ac-signin');
  body.innerHTML = `<p class="lead">登入後，每一場打完的戰役都會記進你的戰績：場數、勝場、分數，以及最近幾場的結果。</p>
    <ul class="ac-facts"><li>只保存 Google 帳號編號、名稱與頭像，<b>不保存 email</b>。</li><li>隨時可以登出，或在戰績裡刪除全部資料。</li></ul>
    <div class="gsi-slot"><span class="spinner"></span><span>正在載入 Google 登入…</span></div><p class="ac-err" hidden></p>`;
  dialogs.open({ kind: 'signin', title: '登入', body, cls: 'narrow account' });
  const slot = body.querySelector('.gsi-slot');
  const err = body.querySelector('.ac-err');
  const fail = (m) => {
    err.hidden = false;
    err.textContent = m;
  };
  renderSignIn(slot, {
    width: Math.min(300, Math.max(200, slot.clientWidth || 260)),
    onDone: (u) => {
      dialogs.close(true);
      if (onSigned) onSigned(u);
    },
    onError: fail,
  })
    .then(() => {
      const sp = slot.querySelector('.spinner');
      if (sp) sp.remove();
      const t = slot.querySelector(':scope > span');
      if (t) t.remove();
    })
    .catch((e) => {
      slot.innerHTML = '';
      fail(e.message || '無法載入 Google 登入');
    });
}

export function openRecord(dialogs) {
  const u = currentUser();
  if (!u) return;
  const body = el('div', 'ac-record');
  const paint = (u) => {
    if (!u) return;
    const recent = (u.recent || [])
      .map(
        (r) =>
          `<li class="${r.won ? 'won' : ''}"><span class="d">${esc(day(r.at))}</span><span class="m">${esc(MODES[r.mode] || '')}</span><b class="r">${r.won ? '勝利' : `第 ${r.place} 名`}</b><span class="v"><b class="num">${r.vp}</b> 分 · ${r.n} 國 · ${r.turns} 回合</span></li>`,
      )
      .join('');
    body.innerHTML = `
      <div class="ac-who">${avatar(u, 56)}<div><b class="nm"></b><small>${u.since ? `${esc(day(u.since))} 起的戰績` : ''}</small></div></div>
      <div class="ac-stats">
        <div><b class="num">${u.games}</b><span>場數</span></div>
        <div><b class="num">${u.wins}</b><span>勝場</span></div>
        <div><b class="num">${pct(u.wins, u.games)}</b><span>勝率</span></div>
        <div><b class="num">${u.best || 0}</b><span>最高分</span></div>
        <div><b class="num">${u.games ? (u.vp / u.games).toFixed(1) : '—'}</b><span>平均分數</span></div>
        <div><b class="num">${u.onlineWins || 0}<small>/${u.online || 0}</small></b><span>線上勝場</span></div>
      </div>
      <div class="row-label">最近的戰役</div>
      ${recent ? `<ul class="ac-recent">${recent}</ul>` : '<p class="lead">還沒有記錄。打完一場戰役（單人或線上）就會出現在這裡。</p>'}`;
    body.querySelector('.ac-who .nm').textContent = u.name;
  };
  paint(u);
  const forget = btn('刪除我的資料', 'ghost danger', async () => {
    if (!forget.classList.contains('armed')) {
      forget.classList.add('armed');
      forget.textContent = '確定刪除全部戰績？';
      return;
    }
    forget.disabled = true;
    try {
      await forgetMe();
      dialogs.close(true);
    } catch (e) {
      forget.disabled = false;
      forget.textContent = '刪除失敗，再試一次';
    }
  });
  const out = btn('登出', '', async () => {
    out.disabled = true;
    try {
      await signOut();
    } finally {
      dialogs.close(true);
    }
  });
  const done = btn('關閉', 'primary', () => dialogs.close());
  dialogs.open({ kind: 'record', title: '戰績', body, foot: [forget, out, done], cls: 'account' });
  // the latest numbers
  loadUser(true).then((v) => v && body.isConnected && paint(v));
}

// the plate on the home screen; getDialogs() gives the dialogs over the menus
export function mountAccount(host, getDialogs) {
  if (!accountsAvailable() || !host) return null;
  const plate = el('button', 'hm-account');
  plate.type = 'button';
  host.appendChild(plate);
  const paint = (u) => {
    plate.classList.toggle('in', !!u);
    if (!u) {
      plate.innerHTML = `<span class="ac-face ac-none" style="--s:30px">${KEY}</span><span class="ac-t"><b>登入</b><small>用 Google 帳號記錄戰績</small></span>`;
      plate.setAttribute('aria-label', '登入：用 Google 帳號記錄戰績');
    } else {
      plate.innerHTML = `${avatar(u, 30)}<span class="ac-t"><b></b><small>${u.games} 場 · ${u.wins} 勝</small></span><i class="ac-chev" aria-hidden="true">›</i>`;
      plate.querySelector('.ac-t b').textContent = u.name;
      plate.setAttribute('aria-label', `${u.name} 的戰績：${u.games} 場、${u.wins} 勝`);
    }
  };
  paint(currentUser());
  const off = onUser(paint);
  loadUser();
  plate.addEventListener('click', () => {
    const d = getDialogs();
    if (currentUser()) openRecord(d);
    else openSignIn(d);
  });
  return {
    el: plate,
    close() {
      off();
      plate.remove();
    },
  };
}
