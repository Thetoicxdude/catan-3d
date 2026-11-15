// The interface's small motions (the design of record: Claude Docs「卡坦島：互動與動畫設計」,
// https://claude.ai/artifact/75edUnM1A6RTPtdR1G5AVa):
//   installPress  every control pressed shrinks a little at once and springs back when let go
//   shake         what cannot be done shakes its head (the reason is said elsewhere)
//   pop, stamp    a confirmation: a little bounce, a mark set down like a seal
//   fadeIn        new content in a panel arriving
//   count         a number going to its new value
//   fly, burst    a card, a coin, a shard going from where it comes from to where it goes
//   whenShown     run something once an element is on the page
// They move only translate, scale and rotate (the individual transform properties, so an element's own
// transform is left alone) and opacity, with Web Animations that end by themselves: safe over the map.
// With "reduce motion" set in the system nothing travels, bounces or shakes: things only fade.
import { sfx } from './sfx.js';

export const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// the curves (the design's table: decelerate in, accelerate out, overshoot, travel)
export const EASE = { out: 'cubic-bezier(.2,.8,.2,1)', in: 'cubic-bezier(.5,0,.9,.4)', pop: 'cubic-bezier(.3,1.5,.5,1)', move: 'cubic-bezier(.4,.05,.3,1)' };

const can = (el) => !!(el && el.animate);

// ── press ──

// what shrinks when pressed: buttons and the cards that act like them; not the home screen's game
// cards (their own lift), the map editor's grid, fields, or anything disabled or shut (.off: it shakes)
const PRESSABLE = 'button, [role="button"], .cc';
const SKIP = '.hm-card, .ed-board, [data-nopress]';
export function installPress(root = document) {
  let cur = null;
  const release = () => {
    if (!cur) return;
    const { el, a, s } = cur;
    cur = null;
    a.cancel();
    if (el.isConnected && !reduced()) el.animate([{ scale: s }, { scale: 1 + (1 - s) * 0.4, offset: 0.55 }, { scale: 1 }], { duration: 200, easing: 'ease-out' });
  };
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || reduced() || !e.target.closest) return;
      const el = e.target.closest(PRESSABLE);
      if (!can(el) || el.disabled || el.classList.contains('off') || el.closest(SKIP)) return;
      release();
      // (a large thing shrinks by a few pixels, not by a twenty-fifth of its size)
      const big = Math.max(el.offsetWidth, el.offsetHeight) || 40;
      const s = Math.min(0.99, Math.max(0.96, 1 - 5 / big));
      cur = { el, s, a: el.animate([{ scale: 1 }, { scale: s }], { duration: 80, easing: 'ease-out', fill: 'forwards' }) };
    },
    { passive: true, capture: true },
  );
  for (const k of ['pointerup', 'pointercancel', 'dragstart']) window.addEventListener(k, release, { passive: true, capture: true });
  // (the window losing the focus mid-press; not an element's blur, which comes with every press)
  window.addEventListener('blur', release);
}

// ── confirmations and refusals ──

export function shake(el, { sound = true } = {}) {
  if (!can(el)) return;
  if (sound) sfx.deny();
  if (reduced()) {
    el.animate([{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], { duration: 240 });
    return;
  }
  el.animate([{ translate: '0 0' }, { translate: '-4px 0' }, { translate: '4px 0' }, { translate: '-3px 0' }, { translate: '2px 0' }, { translate: '0 0' }], { duration: 260, easing: 'linear' });
}

export function pop(el, { scale = 1.12, ms = 240, delay = 0 } = {}) {
  if (!can(el) || reduced()) return;
  el.animate([{ scale: 1 }, { scale, offset: 0.4 }, { scale: 1 }], { duration: ms, delay, easing: 'ease-out' });
}

export function stamp(el, { sound = true, delay = 0 } = {}) {
  if (!can(el)) return;
  if (sound) setTimeout(() => sfx.stamp(), delay + 150);
  if (reduced()) return fadeIn(el, { delay });
  el.animate(
    [
      { scale: 1.9, rotate: '-9deg', opacity: 0 },
      { scale: 0.93, rotate: '0deg', opacity: 1, offset: 0.6 },
      { scale: 1, rotate: '0deg', opacity: 1 },
    ],
    { duration: 320, delay, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'backwards' },
  );
}

export function fadeIn(el, { y = 6, ms = 140, delay = 0 } = {}) {
  if (!can(el)) return;
  const k = reduced() || !y ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: `0 ${y}px` }, { opacity: 1, translate: '0 0' }];
  el.animate(k, { duration: Math.min(ms, reduced() ? 120 : ms), delay, easing: EASE.out, fill: 'backwards' });
}

// ── numbers ──

// el's text goes from `from` to `to` (fmt writes a number); a newer count on the same element takes over
const counting = new WeakMap();
export function count(el, from, to, { ms = 450, delay = 0, fmt = String, onDone = null } = {}) {
  if (!el) return;
  const run = {};
  counting.set(el, run);
  if (reduced() || from === to || ms <= 0) {
    el.textContent = fmt(to);
    if (onDone) onDone();
    return;
  }
  el.textContent = fmt(from);
  const t0 = performance.now() + delay;
  const step = (now) => {
    if (counting.get(el) !== run || !el.isConnected) return;
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
    else {
      if (to > from) pop(el, { scale: 1.2 });
      if (onDone) onDone();
    }
  };
  requestAnimationFrame(step);
}

// ── things in flight ──

// a layer above everything, dialogs included, for what is on its way
let layer = null;
function flyLayer() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'm-fly';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}
const rectOf = (x) => (x && x.getBoundingClientRect ? x.getBoundingClientRect() : x);

// A copy of `what` (an element, copied, or html) goes from the rectangle `from` (an element or a rect)
// to `to`, along an arc, ending at to's size (or endScale); onArrive when it lands. Nothing travels
// with reduced motion: onArrive at once.
export function fly(what, from, to, { ms = 0, delay = 0, arc = 60, endScale = null, onArrive = null, cls = '', fade = false } = {}) {
  const a = rectOf(from);
  const b = rectOf(to);
  if (!a || !b || !a.width || reduced() || typeof document === 'undefined') {
    if (onArrive) setTimeout(onArrive, reduced() ? 0 : delay);
    return null;
  }
  const box = document.createElement('div');
  box.className = 'm-flyer' + (cls ? ' ' + cls : '');
  if (typeof what === 'string') box.innerHTML = what;
  else {
    const copy = what.cloneNode(true);
    copy.removeAttribute('id');
    box.appendChild(copy);
  }
  Object.assign(box.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
  flyLayer().appendChild(box);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const s = endScale != null ? endScale : Math.min(b.width / a.width, b.height / a.height) || 1;
  const dur = ms || Math.min(820, 380 + Math.hypot(dx, dy) * 0.45);
  // (fade: it goes away rather than arriving somewhere)
  const anim = box.animate(
    [
      { translate: '0 0', scale: 1, opacity: 1 },
      { translate: `${dx * 0.5}px ${dy * 0.5 - arc}px`, scale: ((1 + s) / 2) * 1.06, opacity: 1, offset: 0.5 },
      { translate: `${dx}px ${dy}px`, scale: s, opacity: fade ? 0 : 1 },
    ],
    { duration: dur, delay, easing: EASE.move, fill: 'both' },
  );
  let done = false;
  const land = () => {
    if (done) return;
    done = true;
    box.remove();
    if (onArrive) onArrive();
  };
  anim.onfinish = land;
  // (never left behind: a page in the background holds its animations)
  setTimeout(land, delay + dur + 600);
  return anim;
}

// n small things (html: a coin, a shard) go one after another from `from` to `to`; onEach(i) as each lands
export function burst(html, from, to, n, { gap = 55, onEach = null, onDone = null, size = 22, cls = '' } = {}) {
  const a = rectOf(from);
  if (!a) return;
  let left = n;
  for (let i = 0; i < n; i++) {
    // (from a little spread around the start)
    const jx = (Math.random() - 0.5) * Math.min(40, a.width);
    const jy = (Math.random() - 0.5) * Math.min(16, a.height);
    const start = { left: a.left + a.width / 2 - size / 2 + jx, top: a.top + a.height / 2 - size / 2 + jy, width: size, height: size };
    fly(html, start, to, {
      delay: i * gap,
      ms: 520,
      arc: 46 + Math.random() * 30,
      endScale: 0.8,
      cls: 'm-coin' + (cls ? ' ' + cls : ''),
      onArrive: () => {
        if (onEach) onEach(i);
        if (--left === 0 && onDone) onDone();
      },
    });
  }
}

// fn() once el is on the page (a few frames at most), for things built before they are shown
export function whenShown(el, fn, tries = 90) {
  if (!el) return;
  if (el.isConnected) return void requestAnimationFrame(() => fn());
  if (tries > 0) requestAnimationFrame(() => whenShown(el, fn, tries - 1));
}
