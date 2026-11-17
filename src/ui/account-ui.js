// The player's own page (pages.js: Profile): the nation (its name, colour and flag), the building cards
// collected so far, and the account (signing in with Google, a dialog; the record of finished
// campaigns, on the page itself).
import { accountsAvailable, currentUser, onUser, loadUser, renderSignIn, signOut, forgetMe } from '../net/account.js';
import { PALETTE, NAME_MAX } from './menu.js';
import { flagURL } from './flags.js';
import { cardFace, rarityTag } from './cards-ui.js';
import { blueprintName } from './develop-ui.js';
import { cards as collection, onCards } from '../meta/store.js';
import { MISSIONS, RARITIES, ALL_CARDS, rarityOf, owns, missionState, ownedBlueprint } from '../meta/collection.js';
import { BLUEPRINT_SIZE } from '../engine/develop.js';
import { emblemSvg } from './emblems.js';
import { fadeIn } from './motion.js';
import { esc } from './text.js';
import { t, tx, names, isZh, terr } from '../i18n/index.js';

const MODES = names({ single: '單人', hotseat: '同機', online: '線上房間', official: '官方房間' });

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

function day(at) {
  try {
    return new Date(at).toLocaleDateString(isZh() ? 'zh-TW' : 'en-US', isZh() ? { month: 'numeric', day: 'numeric' } : { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function openSignIn(dialogs, onSigned) {
  const body = el('div', 'ac-signin');
  body.innerHTML = `<p class="lead">${t('登入後，每一場打完的戰役都會記進你的戰績：場數、勝場、分數，以及最近幾場的結果。')}</p>
    <ul class="ac-facts"><li>${t('只保存 Google 帳號編號、名稱與頭像，<b>不保存 email</b>。')}</li><li>${t('隨時可以登出，或在戰績裡刪除全部資料。')}</li></ul>
    <div class="gsi-slot"><span class="spinner"></span><span>${t('正在載入 Google 登入…')}</span></div><p class="ac-err" hidden></p>`;
  dialogs.open({ kind: 'signin', title: t('登入'), body, cls: 'narrow account' });
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
      fail(e && e.message ? terr(e) : t('無法載入 Google 登入'));
    });
}

// the record so far: who, the numbers, the last campaigns
function recordHtml(u) {
  const recent = (u.recent || [])
    .map(
      (r) =>
        `<li class="${r.won ? 'won' : ''}"><span class="d">${esc(day(r.at))}</span><span class="m">${esc(MODES[r.mode] || '')}</span><b class="r">${r.won ? t('勝利') : t('第 {n} 名', { n: r.place })}</b><span class="v">${t('<b class="num">{vp}</b> 分 · {n} 國 · {turns} 回合', { vp: r.vp, n: r.n, turns: r.turns })}</span></li>`,
    )
    .join('');
  return `
    <div class="ac-who">${avatar(u, 56)}<div><b class="nm">${esc(tx(u.name))}</b><small>${u.since ? t('{day} 起的戰績', { day: esc(day(u.since)) }) : ''}</small></div></div>
    <div class="ac-stats">
      <div><b class="num">${u.games}</b><span>${t('場數')}</span></div>
      <div><b class="num">${u.wins}</b><span>${t('勝場')}</span></div>
      <div><b class="num">${pct(u.wins, u.games)}</b><span>${t('勝率')}</span></div>
      <div><b class="num">${u.best || 0}</b><span>${t('最高分')}</span></div>
      <div><b class="num">${u.games ? (u.vp / u.games).toFixed(1) : '—'}</b><span>${t('平均分數')}</span></div>
      <div><b class="num">${u.onlineWins || 0}<small>/${u.online || 0}</small></b><span>${t('線上勝場')}</span></div>
    </div>
    <div class="row-label">${t('最近的戰役')}</div>
    ${recent ? `<ul class="ac-recent">${recent}</ul>` : t('<p class="lead">還沒有記錄。打完一場戰役（單人或線上）就會出現在這裡。</p>')}`;
}

// The Profile page. host: the page shell (pages.js); opts: settings, onChange(settings) (the name and
// the colour, kept at once), dialogs() (signing in), go(page) (to the Cards and Missions pages). Under
// the nation, the collection and the record: the blueprint the nation takes into its next game.
export function profilePage(host, { settings, onChange, dialogs }) {
  let closed = false;
  const body = el('div', 'profile-page');
  body.innerHTML = `
    <section class="pf-nation pg-sheet panel">
      <h4 class="pg-h">${t('你的國家')}</h4>
      <div class="pf-banner">
        <span class="pf-flag"><img alt=""></span>
        <div class="pf-id">
          <label class="hm-name pf-name"><span class="sr-only">${t('你的國家名稱')}</span><input id="menu-name" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false"></label>
          <div class="hm-gems pf-gems" role="group" aria-label="${t('國家顏色')}"></div>
        </div>
      </div>
      <p class="pf-note">${t('在對局和官方房間裡，大家看到的就是這面旗、這個名字和顏色。')}</p>
    </section>
    <section class="pf-coll pg-sheet panel"></section>
    ${accountsAvailable() ? '<section class="pf-record pg-sheet panel"></section>' : ''}
    <section class="pf-deck pg-sheet panel"></section>`;

  // ── the nation: its flag, name and colour ──
  const flag = body.querySelector('.pf-flag img');
  const name = body.querySelector('#menu-name');
  const gems = body.querySelector('.pf-gems');
  const paintId = () => {
    flag.src = flagURL(settings.color, 0, 240, 160);
    gems.innerHTML = '';
    for (const p of PALETTE) {
      const b = el('button', 'gem' + (settings.color === p.hex ? ' on' : ''));
      b.type = 'button';
      b.style.setProperty('--c', p.hex);
      b.title = t(p.name);
      b.setAttribute('aria-label', t('{c}色', { c: t(p.name) }));
      b.setAttribute('aria-pressed', String(settings.color === p.hex));
      b.addEventListener('click', () => {
        if (settings.color === p.hex) return;
        settings.color = p.hex;
        onChange(settings);
        paintId();
        // (the new colour hoisted)
        fadeIn(flag, { y: -10, ms: 220 });
      });
      gems.appendChild(b);
    }
  };
  name.value = settings.name;
  name.addEventListener('input', () => {
    settings.name = name.value;
    onChange(settings);
  });
  paintId();

  // ── the building cards collected so far (and of each rarity) ──
  const coll = body.querySelector('.pf-coll');
  const paintColl = () => {
    const c = collection();
    const all = ALL_CARDS.length;
    const have = ALL_CARDS.filter((k) => owns(c, k)).length;
    const rars = RARITIES.map((r) => {
      const ks = ALL_CARDS.filter((k) => rarityOf(k) === r);
      const n = ks.filter((k) => owns(c, k)).length;
      return `<span class="pf-rar${n === ks.length ? ' full' : ''}">${rarityTag(r)}<b class="num">${n}<small>/${ks.length}</small></b></span>`;
    }).join('');
    const done = MISSIONS.filter((m) => missionState(c, m.id).got).length;
    coll.innerHTML = `
      <h4 class="pg-h">${t('收藏')}</h4>
      <div class="pf-tally">
        <div class="pf-meter"><span class="pf-big num">${have}<small>/${all}</small></span><span class="pf-what">${t('建築卡')}</span><span class="pf-bar" aria-hidden="true"><i style="translate:${Math.round((100 * have) / all) - 100}% 0"></i></span></div>
        <div class="pf-meter"><span class="pf-big num">${done}<small>/${MISSIONS.length}</small></span><span class="pf-what">${t('完成的任務')}</span><span class="pf-bar" aria-hidden="true"><i style="translate:${Math.round((100 * done) / MISSIONS.length) - 100}% 0"></i></span></div>
      </div>
      <div class="pf-rars">${rars}</div>
      <div class="pf-links"></div>`;
    const links = coll.querySelector('.pf-links');
    if (host.go) {
      links.appendChild(btn(`${emblemSvg('cards', 22)}<span>${esc(t('卡牌'))}</span>`, 'ghost', () => host.go('cards')));
      links.appendChild(btn(`${emblemSvg('missions', 22)}<span>${esc(t('任務'))}</span>`, 'ghost', () => host.go('missions')));
    }
  };
  // ── the blueprint in use: its cards, its name, where it is changed ──
  const deck = body.querySelector('.pf-deck');
  const paintDeck = () => {
    const i = [0, 1, 2].includes(settings.bpCur) ? settings.bpCur : 0;
    const bp = ownedBlueprint(collection(), settings.bps && settings.bps[i]);
    deck.innerHTML = `<h4 class="pg-h">${t('使用中的藍圖')}</h4>
      <div class="pf-deckrow">
        <div class="pf-cards">${bp.map((k) => cardFace(k, { small: true })).join('')}${'<span class="pf-empty" aria-hidden="true"></span>'.repeat(Math.max(0, BLUEPRINT_SIZE - bp.length))}</div>
        <div class="pf-deckinfo"><b>${esc(t('藍圖 {n}', { n: i + 1 }))}</b><small class="num">${bp.length}/${BLUEPRINT_SIZE}${bp.length >= BLUEPRINT_SIZE ? ' · ' + esc(blueprintName(bp)) : ''}</small></div>
      </div>`;
    if (host.go) deck.querySelector('.pf-deckinfo').appendChild(btn(esc(t('在「卡牌」更換')), 'ghost', () => host.go('cards')));
  };
  paintColl();
  paintDeck();
  const unCards = onCards(() => {
    if (closed) return;
    paintColl();
    paintDeck();
  });

  // ── the account: signing in, or the record so far ──
  const rec = body.querySelector('.pf-record');
  let unUser = null;
  if (rec) {
    const paintRec = (u) => {
      if (closed) return;
      if (!u) {
        rec.className = 'pf-record pg-sheet panel out';
        rec.innerHTML = `<h4 class="pg-h">${t('戰績')}</h4>
          <p class="lead">${t('登入後，每一場打完的戰役都會記進你的戰績：場數、勝場、分數，以及最近幾場的結果。')}</p>
          <ul class="ac-facts"><li>${t('只保存 Google 帳號編號、名稱與頭像，<b>不保存 email</b>。')}</li><li>${t('隨時可以登出，或在戰績裡刪除全部資料。')}</li></ul>`;
        rec.appendChild(btn(`<span class="ac-face ac-none" style="--s:26px">${KEY}</span><span>${esc(t('用 Google 帳號登入'))}</span>`, 'primary pf-signin', () => openSignIn(dialogs())));
        return;
      }
      rec.className = 'pf-record pg-sheet panel in';
      rec.innerHTML = `<h4 class="pg-h">${t('戰績')}</h4>${recordHtml(u)}`;
      const acts = el('div', 'pf-acts');
      const forget = btn(t('刪除我的資料'), 'ghost danger', async () => {
        if (!forget.classList.contains('armed')) {
          forget.classList.add('armed');
          forget.textContent = t('確定刪除全部戰績？');
          return;
        }
        forget.disabled = true;
        try {
          await forgetMe();
        } catch (e) {
          forget.disabled = false;
          forget.textContent = t('刪除失敗，再試一次');
        }
      });
      const out = btn(t('登出'), '', async () => {
        out.disabled = true;
        try {
          await signOut();
        } finally {
          out.disabled = false;
        }
      });
      acts.append(forget, out);
      rec.appendChild(acts);
    };
    paintRec(currentUser());
    unUser = onUser((u) => paintRec(u));
    // (the latest numbers: painted again as they come)
    loadUser(true);
  }

  host.mount(body);
  return {
    close() {
      closed = true;
      unCards();
      if (unUser) unUser();
    },
  };
}
