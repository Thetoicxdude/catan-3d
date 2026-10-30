// Screen-space game feel: tumbling 3D dice, resource cards arcing from the island into the hand,
// victory-point medals and big announcements. Pure DOM + Web Animations; sounds from sfx.js.
import { icon, devCard, RES_EN } from './icons.js';
import { sfx } from './sfx.js';

// cube rotation that brings each face to the front (face n sits where the CSS below puts it)
const FINAL = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
// pip cells on a 3×3 grid (1 = top-left … 9 = bottom-right)
const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function dieEl() {
  const d = el('div', 'die3d');
  for (let f = 1; f <= 6; f++) {
    const face = el('div', `face f${f}`);
    for (let c = 1; c <= 9; c++) face.appendChild(el('i', PIPS[f].includes(c) ? 'pip' : ''));
    d.appendChild(face);
  }
  return d;
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Fx {
  constructor(root) {
    this.root = root;
    this.layer = el('div', 'fx-layer');
    root.appendChild(this.layer);
    this.diceBox = null;
  }

  // Two big dice are thrown up into the middle of the screen and land on the rolled faces; the sum
  // stays up for a beat (1 s at normal speed) before the turn carries on.
  // Returns the milliseconds until that beat is over (when production should start).
  roll(dice, { big = true, fast = false } = {}) {
    if (this.diceBox) this.diceBox.remove();
    if (this.diceDim) this.diceDim.remove();
    const sum = dice[0] + dice[1];
    const dim = el('div', 'fx-dim');
    this.layer.appendChild(dim);
    this.diceDim = dim;
    const box = el('div', 'fx-dice' + (big ? '' : ' small'));
    const tray = el('div', 'fx-tray');
    box.appendChild(tray);
    this.layer.appendChild(box);
    this.diceBox = box;
    const land = reduced() ? 120 : fast ? 560 : 900;
    const hold = reduced() ? 400 : fast ? 600 : 1000;
    dice.forEach((v, i) => {
      // the slot carries the flight (position, scale, fade); the die inside only rotates, so its
      // 3D faces are never flattened by the fade (opacity forces flattening in browsers)
      const slot = el('div', 'die-slot');
      const d = dieEl();
      slot.appendChild(d);
      tray.appendChild(slot);
      const [fx, fy] = FINAL[v];
      const rz = (Math.random() - 0.5) * 22;
      const spin = (n) => (Math.random() < 0.5 ? -1 : 1) * (2 + Math.floor(Math.random() * 2)) * 360 + n;
      const sx = spin(fx);
      const sy = spin(fy);
      const side = i === 0 ? -1 : 1;
      const x0 = 180 * side + (Math.random() - 0.5) * 80;
      const y0 = Math.max(380, window.innerHeight * 0.55) + Math.random() * 60;
      const opts = { duration: land, easing: 'cubic-bezier(.22,.75,.35,1)', fill: 'forwards' };
      // thrown up from below, a high arc, then a bounce and a little skid as they settle
      slot.animate(
        [
          { transform: `translate(${x0}px, ${y0}px) scale(0.55)`, opacity: 0 },
          { offset: 0.08, opacity: 1 },
          { offset: 0.5, transform: `translate(${-30 * side}px, -90px) scale(1.12)` },
          { offset: 0.72, transform: `translate(${10 * side}px, 10px) scale(0.96)` },
          { offset: 0.86, transform: `translate(${-4 * side}px, -12px) scale(1.02)` },
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        ],
        opts,
      );
      // rotateZ is outermost so the resting tilt happens in the screen plane
      const rot = (z, k) => `rotateZ(${z}deg) rotateX(${fx + (sx - fx) * k}deg) rotateY(${fy + (sy - fy) * k}deg)`;
      d.animate([{ transform: rot(rz + 160 * side, 1) }, { offset: 0.6, transform: rot(rz + 24 * side, 0.16) }, { offset: 0.8, transform: rot(rz - 4 * side, -0.025) }, { transform: rot(rz, 0) }], opts);
    });
    sfx.dice(land / 1000 - 0.08);
    this.rollLand = land;
    setTimeout(() => {
      if (this.diceBox !== box) return;
      const tag = sum === 7 ? '<span>強盜出動</span>' : sum === 6 || sum === 8 ? '<span>豐收</span>' : '';
      const s = el('div', 'fx-sum' + (sum === 7 ? ' seven' : sum === 6 || sum === 8 ? ' hot' : ''), `<b class="num">${sum}</b>${tag}`);
      box.appendChild(s);
      box.classList.add('landed');
    }, land);
    setTimeout(() => {
      box.classList.add('out');
      dim.classList.add('out');
    }, land + hold);
    setTimeout(() => {
      box.remove();
      dim.remove();
      if (this.diceBox === box) this.diceBox = null;
      if (this.diceDim === dim) this.diceDim = null;
    }, land + hold + 450);
    return land + hold;
  }

  // Resource cards fly from points on the map into their destinations.
  // list: [{res, from:{x,y}, to:{x,y}, delay, small, onArrive}]
  cards(list) {
    for (const c of list) {
      const card = el('div', `fx-card rcard rc-${c.res}${c.small ? ' small' : ''}`, `${c.small ? '' : `<span class="nm">${RES_EN[c.res] || ''}</span>`}<i class="shine"></i>`);
      card.style.setProperty('--n', String(Math.max(4, (RES_EN[c.res] || '').length)));
      card.style.left = c.from.x + 'px';
      card.style.top = c.from.y + 'px';
      this.layer.appendChild(card);
      const dx = c.to.x - c.from.x;
      const dy = c.to.y - c.from.y;
      const lift = Math.min(170, 70 + Math.hypot(dx, dy) * 0.22);
      const rot = (Math.random() - 0.5) * 50;
      // land at the size of the hand's cards (42px) or a nation row's flag
      const dur = reduced() ? 200 : c.small ? 700 : 820;
      const a = card.animate(
        [
          { transform: `translate(-50%, -50%) translate(0px, 8px) scale(0.15) rotate(${rot}deg)`, opacity: 0 },
          { offset: 0.14, transform: `translate(-50%, -50%) translate(${dx * 0.02}px, -46px) scale(1.25) rotate(${rot * 0.7}deg)`, opacity: 1 },
          { offset: 0.24, transform: `translate(-50%, -50%) translate(${dx * 0.05}px, -52px) scale(1.12) rotate(${rot * 0.5}deg)`, opacity: 1 },
          { offset: 0.62, transform: `translate(-50%, -50%) translate(${dx * 0.55}px, ${dy * 0.55 - lift}px) scale(0.95) rotate(${rot * 0.15}deg)`, opacity: 1 },
          { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${c.end != null ? c.end : c.small ? 0.8 : 0.7}) rotate(0deg)`, opacity: 0.9 },
        ],
        { duration: dur, delay: c.delay || 0, easing: 'cubic-bezier(.4,.05,.3,1)', fill: 'both' },
      );
      if (!c.small) setTimeout(() => sfx.whoosh(), (c.delay || 0) + 40);
      a.onfinish = () => {
        card.remove();
        if (c.onArrive) c.onArrive();
      };
    }
  }

  // A bought development card flips over in the middle of the screen, says when it can be
  // played, then shrinks into `target` (the hand's development-card counter).
  devReveal({ type, name, desc, note }, target) {
    const box = el('div', 'fx-dev');
    box.innerHTML = `<div class="flip"><div class="face back">${devCard('back', '發展卡', { lg: true })}</div><div class="face front">${devCard(type, name, { lg: true })}</div></div><div class="cap"><h4></h4><p></p><div class="when"></div></div>`;
    box.querySelector('.back .nm').textContent = 'Development';
    box.querySelector('h4').textContent = name;
    box.querySelector('p').textContent = desc;
    box.querySelector('.when').textContent = note;
    this.layer.appendChild(box);
    const flip = box.querySelector('.flip');
    const slow = !reduced();
    flip.animate(
      [{ transform: 'rotateY(180deg) scale(0.6)' }, { offset: 0.55, transform: 'rotateY(-12deg) scale(1.05)' }, { transform: 'rotateY(0deg) scale(1)' }],
      { duration: slow ? 650 : 1, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
    );
    box.querySelector('.cap').animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
      duration: slow ? 320 : 1,
      delay: slow ? 420 : 0,
      easing: 'ease-out',
      fill: 'both',
    });
    sfx.whoosh();
    const hold = slow ? 2200 : 1200;
    setTimeout(() => {
      const r = target && target.getBoundingClientRect();
      const tx = r && r.width ? r.left + r.width / 2 - window.innerWidth / 2 : 0;
      const ty = r && r.width ? r.top + r.height / 2 - window.innerHeight * 0.42 : -window.innerHeight * 0.4;
      box.animate(
        [{ transform: 'translate(-50%, -50%)', opacity: 1 }, { transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(0.12)`, opacity: 0.4 }],
        { duration: slow ? 520 : 1, easing: 'cubic-bezier(.5,0,.7,.4)', fill: 'forwards' },
      ).onfinish = () => {
        box.remove();
        if (target) {
          target.classList.remove('vp-hit');
          void target.offsetWidth;
          target.classList.add('vp-hit');
        }
      };
    }, hold);
  }

  // a small "+n" that rises and fades at a screen point
  plus(x, y, text, cls = '') {
    const p = el('div', 'fx-plus ' + cls, text);
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    this.layer.appendChild(p);
    p.animate(
      [
        { transform: 'translate(-50%, -50%) translateY(0) scale(0.6)', opacity: 0 },
        { offset: 0.2, transform: 'translate(-50%, -50%) translateY(-10px) scale(1.15)', opacity: 1 },
        { transform: 'translate(-50%, -50%) translateY(-34px) scale(1)', opacity: 0 },
      ],
      { duration: 900, easing: 'ease-out', fill: 'forwards' },
    ).onfinish = () => p.remove();
  }

  // victory-point medal bursting out of a HUD element
  medal(target, text, big = false) {
    if (!target) return;
    const r = target.getBoundingClientRect();
    const m = el('div', 'fx-medal' + (big ? ' big' : ''), `${icon('vp', big ? 26 : 18)}<b class="num">${text}</b>`);
    m.style.left = r.left + r.width / 2 + 'px';
    m.style.top = r.top + r.height / 2 + 'px';
    this.layer.appendChild(m);
    m.animate(
      [
        { transform: 'translate(-50%, -50%) translateY(14px) scale(0.3) rotate(-18deg)', opacity: 0 },
        { offset: 0.25, transform: 'translate(-50%, -50%) translateY(32px) scale(1.25) rotate(6deg)', opacity: 1 },
        { offset: 0.7, transform: 'translate(-50%, -50%) translateY(40px) scale(1) rotate(0deg)', opacity: 1 },
        { transform: 'translate(-50%, -50%) translateY(10px) scale(0.6)', opacity: 0 },
      ],
      { duration: big ? 1900 : 1500, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' },
    ).onfinish = () => m.remove();
    target.classList.remove('vp-hit');
    void target.offsetWidth;
    target.classList.add('vp-hit');
  }

  // a big centred announcement (longest road, largest army, the robber, victory)
  announce(title, sub, ic = 'vp', tone = '') {
    const a = el('div', 'fx-announce ' + tone, `<div class="ic">${icon(ic, 34)}</div><div><h3></h3><p></p></div>`);
    a.querySelector('h3').textContent = title;
    a.querySelector('p').textContent = sub || '';
    this.layer.appendChild(a);
    a.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0, filter: 'blur(6px)' },
        { offset: 0.12, transform: 'translate(-50%, -50%) scale(1.04)', opacity: 1, filter: 'blur(0px)' },
        { offset: 0.2, transform: 'translate(-50%, -50%) scale(1)', opacity: 1, filter: 'blur(0px)' },
        { offset: 0.85, transform: 'translate(-50%, -50%) scale(1)', opacity: 1, filter: 'blur(0px)' },
        { transform: 'translate(-50%, -54%) scale(0.98)', opacity: 0, filter: 'blur(2px)' },
      ],
      { duration: 2600, easing: 'ease-out', fill: 'forwards' },
    ).onfinish = () => a.remove();
  }
}
