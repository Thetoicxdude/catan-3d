// DOM overlay anchored to world positions: number tokens, harbor badges, province names,
// nation names (political/paper map) and floating "+2 wood" texts.
import * as THREE from 'three';

const _v = new THREE.Vector3();

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
      const s = o.scale ? o.scale(zoomH) : 1;
      const rot = o.angle ? ` rotate(${o.angle}rad)` : '';
      box.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)})${rot}`;
      box.style.opacity = alpha.toFixed(3);
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
