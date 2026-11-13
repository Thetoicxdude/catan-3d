// DOM overlay anchored to world positions: number tokens, harbor badges, province names,
// nation names (political/paper map) and floating "+2 wood" texts.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _right = new THREE.Vector3();

// The width on screen, in pixels, of `len` world units lying across the view at `pos` (on a big map
// seen at a slant, the far provinces are much narrower on screen than the near ones).
export function screenWidth(camera, pos, len, w, h) {
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _a.copy(pos).addScaledVector(_right, -len / 2).project(camera);
  _b.copy(pos).addScaledVector(_right, len / 2).project(camera);
  return Math.hypot((_b.x - _a.x) * 0.5 * w, (_b.y - _a.y) * 0.5 * h);
}

export class Labels {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.className = 'map-labels';
    container.appendChild(this.root);
    this.items = [];
    this.floats = [];
    this.w = 1;
    this.h = 1;
  }

  // Each label lives in its own wrapper: the wrapper carries the projected position (inline transform),
  // the element inside is free to animate (a token's pulse uses `scale`, the robber's drop `translate`).
  // Those individual transform properties are applied on top of `transform`, so on the positioned element
  // itself they would scale its screen position too and fling it away from its province.
  add(el, pos, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'ml';
    wrap.appendChild(el);
    this.root.appendChild(wrap);
    const item = { el, wrap, pos: pos.clone(), opts, visible: true };
    this.items.push(item);
    return item;
  }

  remove(item) {
    item.wrap.remove();
    this.items = this.items.filter((i) => i !== item);
  }

  float(html, pos, cls = '') {
    const el = document.createElement('div');
    el.className = 'ml float ' + cls;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.floats.push({ el, pos: pos.clone(), t: 0 });
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
  }

  update(camera, zoomH, dt, paper) {
    const w = this.w;
    const h = this.h;
    for (const it of this.items) {
      const o = it.opts;
      let show = true;
      if (o.minH != null && zoomH < o.minH) show = false;
      if (o.maxH != null && zoomH > o.maxH) show = false;
      if (o.hidden) show = false;
      let alpha = 1;
      if (o.fade) alpha = o.fade(zoomH, paper);
      if (alpha <= 0.01) show = false;
      const box = it.wrap;
      if (!show) {
        if (it.visible) {
          box.style.display = 'none';
          it.visible = false;
        }
        continue;
      }
      _v.copy(it.pos).project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) {
        if (it.visible) {
          box.style.display = 'none';
          it.visible = false;
        }
        continue;
      }
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * h;
      let s = o.scale ? o.scale(zoomH) : 1;
      // a label sized by the ground under it (a number token by its province): o.px gives its width in
      // pixels from the width on screen of `ground` world units there, `size` being its width at
      // scale 1; below fadePx it fades away
      if (o.ground) {
        const px = o.px(screenWidth(camera, it.pos, o.ground, w, h));
        s = px / o.size;
        if (o.fadePx) {
          const [lo, hi] = o.fadePx;
          const k = Math.min(1, Math.max(0, (px - lo) / (hi - lo)));
          alpha *= k * k * (3 - 2 * k);
          if (alpha <= 0.01) {
            if (it.visible) {
              box.style.display = 'none';
              it.visible = false;
            }
            continue;
          }
        }
      }
      it.s = s;
      // (the page is only touched when the label really moved: with the camera at rest nothing here
      // changes from one frame to the next)
      const kx = Math.round(x * 10);
      const ky = Math.round(y * 10);
      const ks = Math.round(s * 1000);
      const ka = Math.round(alpha * 1000);
      const kr = o.angle || 0;
      if (kx !== it.kx || ky !== it.ky || ks !== it.ks || kr !== it.kr) {
        it.kx = kx;
        it.ky = ky;
        it.ks = ks;
        it.kr = kr;
        const rot = kr ? ` rotate(${kr}rad)` : '';
        box.style.transform = `translate3d(${kx / 10}px, ${ky / 10}px, 0) translate(-50%, -50%) scale(${ks / 1000})${rot}`;
      }
      if (ka !== it.ka) {
        it.ka = ka;
        box.style.opacity = String(ka / 1000);
      }
      if (!it.visible) {
        box.style.display = '';
        it.visible = true;
      }
    }
    this.floats = this.floats.filter((f) => {
      f.t += dt;
      const k = f.t / 1.8;
      _v.copy(f.pos);
      _v.y += k * 4;
      _v.project(camera);
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * h;
      f.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      f.el.style.opacity = String(k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4));
      if (k >= 1) f.el.remove();
      return k < 1;
    });
  }
}
