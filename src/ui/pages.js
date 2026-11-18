// The pages the side bar opens, each the whole screen: Cards, Draw & Shop, Missions, Profile and
// Settings. A page takes the home screen's place (the home is closed, not kept underneath), and one
// page another's: the rail on the left (a phone: the bar along the bottom) goes from page to page, and
// the crest at its top (a phone: the header's corner) back to the home screen. Matchmaking in the
// official room goes on meanwhile: the header shows it, and leads back to the board on the home screen.
// The side bar's items and their marks (new cards, rewards waiting, the coins) are drawn here for the
// home screen's tabs as well (navHtml, paintNav).
import { emblemSvg, crest } from './emblems.js';
import { cardsPage, shopPage, missionsPage, homeMarks, onCards, coinHtml, shardHtml } from './cards-ui.js';
import { profilePage } from './account-ui.js';
import { settingsForm } from './dialogs.js';
import { pop, fadeIn, reduced, leaveScreen } from './motion.js';
import { esc, creditsHtml } from './text.js';
import { comingSoon, soonText } from './soon.js';
import { pageOpen, developOpen } from '../meta/features.js';
import { t, N_ } from '../i18n/index.js';

// the side bar, in order: each page's short name (the rail, the tabs), its title and what it is for
export const NAV = [
  { k: 'cards', label: N_('卡牌'), title: N_('卡牌'), sub: N_('建築卡與藍圖（發展模式）') },
  { k: 'shop', label: N_('商店'), title: N_('抽卡・商店'), sub: N_('用金幣抽建築卡，用碎片換指定的卡') },
  { k: 'missions', label: N_('任務'), title: N_('任務'), sub: N_('完成任務，領金幣和建築卡') },
  { k: 'profile', label: N_('個人'), title: N_('個人檔案'), sub: N_('你的國家、收藏和戰績') },
  { k: 'settings', label: N_('設定'), title: N_('設定'), sub: N_('語言、對局、畫面和聲音') },
];
export const PAGES = NAV.map((n) => n.k);

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

// The side bar's items as buttons (data-k: the page): cls the buttons' class, cur the page shown,
// purse: the coins under the shop's name (the home screen's tabs). A page not open yet (features.js:
// the development mode's) is greyed (.soon) and says "Coming soon" when clicked (navClick).
export function navHtml({ cls, cur = null, size = 34, purse = false } = {}) {
  return NAV.map((n) => {
    const on = n.k === cur;
    const soon = !pageOpen(n.k);
    const name = esc(t(n.title));
    const title = soon ? `${name}・${esc(soonText())}` : name;
    return `<button class="${cls}${on ? ' on' : ''}${soon ? ' soon' : ''}" type="button" data-k="${n.k}"${on ? ' aria-current="page"' : ''}${soon ? ' aria-disabled="true"' : ''} title="${title}" aria-label="${title}">${emblemSvg(n.k, size)}<span class="lbl">${esc(t(n.label))}</span>${purse && n.k === 'shop' && !soon ? '<span class="nav-purse num"></span>' : ''}<i class="hm-badge" hidden></i></button>`;
  }).join('');
}
// a side bar item clicked: its page, or "Coming soon" for one not open yet (true: go on to the page)
export function navClick(b) {
  if (!b.classList.contains('soon')) return true;
  comingSoon(b);
  return false;
}

// the new cards and the rewards waiting as the side bar last showed them (this visit to the page): a
// badge whose number went up since then bounces
const seenMarks = { fresh: null, claim: null };
export function paintNav(root) {
  // (the development mode closed: no marks for its pages)
  if (!developOpen()) return;
  const m = homeMarks();
  const rose = (k) => seenMarks[k] != null && m[k] > seenMarks[k];
  const bounce = (b) => !b.hidden && pop(b, { scale: 1.55, ms: 380, delay: 200 });
  const popFresh = rose('fresh');
  const popClaim = rose('claim');
  seenMarks.fresh = m.fresh;
  seenMarks.claim = m.claim;
  root.querySelectorAll('[data-k="cards"] .hm-badge').forEach((b) => {
    b.hidden = !m.fresh;
    b.textContent = m.fresh ? t('新') : '';
    b.title = m.fresh ? t('{n} 張新卡', { n: m.fresh }) : '';
    if (popFresh) bounce(b);
  });
  root.querySelectorAll('[data-k="missions"] .hm-badge').forEach((b) => {
    b.hidden = !m.claim;
    b.textContent = m.claim ? String(m.claim) : '';
    b.title = m.claim ? t('{n} 個任務獎勵可以領取', { n: m.claim }) : '';
    if (popClaim) bounce(b);
  });
  root.querySelectorAll('.nav-purse').forEach((p) => (p.textContent = m.coins.toLocaleString('en-US')));
}

const BACK = `<svg class="pg-arrow" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// The Settings page: the same rows as the in-game dialog, in sections, each with what it does. At its
// foot, small and out of the way: where the art and the icons come from (the rules' last section says
// it too), and the version.
function settingsPage(host, { settings, onSettings, version }) {
  const page = el('div', 'set-page');
  page.appendChild(settingsForm({ ...settings }, (s, key) => onSettings(s, key), { paged: true }));
  page.appendChild(el('footer', 'set-foot', `<h5>${esc(t('素材來源'))}</h5>${creditsHtml()}${version ? `<p class="set-ver num">${esc(version)}</p>` : ''}`));
  host.mount(page);
}

// page: the one to open (PAGES). opts: settings, save(settings) (the blueprints, a card kept),
// onChange(settings) (the name and colour), onSettings(settings, key) (a setting chosen), dialogs()
// (signing in), onHome() (the crest; with back: back where the page was opened from, back.label its
// name), onMatch() (the matchmaking in the header: to the home screen's board), onPage(page) (each
// page shown), tab (the Draw & Shop page's tab to open on), version (the Settings page's foot).
// Returns { el, page, go(page, opts), setMatch(state), close() }.
export function showPage(app, page, opts) {
  const { settings, back = null } = opts;
  const scr = el('div', 'menu-screen page');
  const homeLabel = back ? esc(back.label) : esc(t('主頁'));
  const homeTitle = back ? esc(t('回到{name}', { name: back.label })) : esc(t('回主畫面'));
  const homeIcon = back ? BACK : `<span class="pg-crest">${crest()}</span>`;
  scr.innerHTML = `
    <div class="pg-art" aria-hidden="true"></div>
    <nav class="pg-rail" aria-label="${esc(t('頁面'))}">
      <button class="pg-home" type="button" data-go="home" title="${homeTitle}" aria-label="${homeTitle}">${homeIcon}<span class="lbl">${homeLabel}</span></button>
      <div class="pg-items">${navHtml({ cls: 'pg-item', cur: page })}</div>
    </nav>
    <header class="pg-head">
      <button class="pg-corner" type="button" data-go="home" title="${homeTitle}" aria-label="${homeTitle}">${back ? BACK : `<span class="pg-crest">${crest()}</span>`}</button>
      <div class="pg-title"><h1></h1><p></p></div>
      <button class="pg-match" type="button" hidden title="${esc(t('官方房間配對中：回主畫面看'))}"><i class="pg-dot" aria-hidden="true"></i><b>${esc(t('配對中'))}</b><span class="pg-seats num"></span><span class="pg-clock num"></span></button>
      <div class="pg-bals sp-bals"></div>
    </header>
    <main class="pg-main"></main>`;
  app.appendChild(scr);
  if (back) scr.classList.add('has-back');

  const art = scr.querySelector('.pg-art');
  const rail = scr.querySelector('.pg-rail');
  const main = scr.querySelector('.pg-main');
  const bals = scr.querySelector('.pg-bals');
  const titleEl = scr.querySelector('.pg-title h1');
  const subEl = scr.querySelector('.pg-title p');
  let cur = null;
  let body = null; // the page's own part of the screen
  let built = null; // what the page gave back (a close() to call when it goes)
  let closed = false;

  const host = {
    mount(node) {
      body.appendChild(node);
    },
    bals: () => bals,
    go: (k, o) => go(k, o),
  };
  const BUILD = {
    cards: () => cardsPage(host, settings, opts.save),
    shop: (o) => shopPage(host, { tab: o.tab, settings, save: opts.save }),
    missions: () => missionsPage(host, { settings, save: opts.save }),
    profile: () => profilePage(host, { settings, onChange: opts.onChange, dialogs: opts.dialogs }),
    settings: () => settingsPage(host, { settings, onSettings: opts.onSettings, version: opts.version }),
  };

  // the backdrop: each page's picture fades in over the last one
  const paintArt = (k, first) => {
    const pic = el('i', 'pg-pic');
    pic.dataset.p = k;
    art.appendChild(pic);
    const olds = [...art.children].slice(0, -1);
    if (first || reduced() || !pic.animate) return olds.forEach((o) => o.remove());
    const a = pic.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    a.onfinish = () => olds.forEach((o) => o.remove());
    setTimeout(() => olds.forEach((o) => o.remove()), 900);
  };

  const open = (k, o = {}, first = false) => {
    const n = NAV.find((x) => x.k === k);
    if (built && built.close) built.close();
    built = null;
    cur = k;
    scr.dataset.page = k;
    rail.querySelectorAll('.pg-item').forEach((b) => {
      const on = b.dataset.k === k;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    titleEl.textContent = t(n.title);
    subEl.textContent = t(n.sub);
    paintArt(k, first);
    // the coins and shards as they are now (the page that spends or earns them counts them from there;
    // none while the development mode, whose they are, is closed)
    const m = homeMarks();
    bals.innerHTML = developOpen() ? coinHtml(m.coins) + shardHtml(m.shards) : '';
    // the page before goes at once; this one comes in
    if (body) body.remove();
    body = el('div', `pg-body pg-${k}`);
    main.appendChild(body);
    main.scrollTop = 0;
    built = BUILD[k](o) || null;
    if (!first) fadeIn(body, { y: 10, ms: 200 });
    if (!first && !reduced()) fadeIn(scr.querySelector('.pg-title'), { y: 0, ms: 160 });
    if (opts.onPage) opts.onPage(k);
  };

  const go = (k, o = {}) => {
    if (closed) return;
    if (k === 'home') return opts.onHome();
    if (!PAGES.includes(k)) return;
    if (!pageOpen(k)) return comingSoon(rail.querySelector(`.pg-item[data-k="${k}"]`));
    if (k === cur && o.tab == null) return;
    open(k, o);
  };

  scr.querySelectorAll('[data-go="home"]').forEach((b) => b.addEventListener('click', () => go('home')));
  rail.querySelectorAll('.pg-item').forEach((b) => b.addEventListener('click', () => navClick(b) && go(b.dataset.k)));
  // Escape: home (a dialog open over the page closes first; a field being typed in keeps it)
  const onKey = (e) => {
    if (e.key !== 'Escape' || closed || e.defaultPrevented) return;
    if (document.querySelector('.modal-layer:not([hidden]):not(.leaving) .modal')) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    go('home');
  };
  window.addEventListener('keydown', onKey, true);

  // ── the side bar's marks ──
  paintNav(rail);
  const unCards = onCards(() => !closed && paintNav(rail));

  // ── matchmaking in the official room, going on ──
  const chip = scr.querySelector('.pg-match');
  const seatsEl = chip.querySelector('.pg-seats');
  const clockEl = chip.querySelector('.pg-clock');
  chip.addEventListener('click', () => opts.onMatch && opts.onMatch());
  let match = null;
  let timer = null;
  const tick = () => {
    if (!match) return;
    const left = match.rem != null ? Math.max(0, match.rem - (Date.now() - match.at)) : null;
    const s = left == null ? '' : String(Math.ceil(left / 1000));
    clockEl.textContent = s ? t('{n} 秒', { n: s }) : '';
    clockEl.hidden = !s;
    chip.classList.toggle('final', left != null && left > 0 && left <= 3000);
  };
  const setMatch = (st) => {
    if (closed) return;
    const was = !!match;
    match = st ? { ...st, at: Date.now() } : null;
    chip.hidden = !match;
    scr.classList.toggle('matching', !!match);
    if (!match) {
      clearInterval(timer);
      timer = null;
      return;
    }
    const n = match.seats ? match.seats.length : 4;
    const have = match.seats ? Math.max(1, match.seats.filter((s) => s.kind !== 'open').length) : 1;
    seatsEl.textContent = `${have}/${n}`;
    tick();
    if (!timer) timer = setInterval(tick, 250);
    if (!was) fadeIn(chip, { y: -6, ms: 200 });
  };

  open(page, { tab: opts.tab }, true);
  // (from the keyboard: on to the page's place in the rail, the home screen's tab being gone)
  setTimeout(() => {
    if (!closed && !scr.contains(document.activeElement)) {
      const on = rail.querySelector('.pg-item.on');
      if (on && on.offsetParent) on.focus({ preventScroll: true });
    }
  }, 0);

  return {
    el: scr,
    get page() {
      return cur;
    },
    go,
    setMatch,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      window.removeEventListener('keydown', onKey, true);
      unCards();
      if (built && built.close) built.close();
      leaveScreen(scr);
    },
  };
}
