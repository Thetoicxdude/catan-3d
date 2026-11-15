// (the development mode) what the mode adds to the map, shown as badges until it has models of its own:
//   a development: a mill on its hex, beside the number token, in its developer's colour, with the
//     resource each level brings
//   the buildings beside a settlement: their figures floating over it, in the owner's colour
//   a wonder: on its desert, scaffolding with its stages until it is complete, then the wonder's figure
// The badges are labels (labels.js), sized by the province under them like the number tokens.
import * as THREE from 'three';
import { GEO, HEX_SIZE } from '../engine/geometry.js';
import { BUILDINGS, BUILDING_NAMES, annexAt } from '../engine/develop.js';
import { buildingIcon, icon, resIcon } from '../ui/icons.js';
import { t, list } from '../i18n/index.js';
import { DIR_COLOR } from '../ui/develop-ui.js';

const HEX_W = HEX_SIZE * 1.732;
// as wide as a number token and a little less
const badgePx = (hexPx) => {
  let px = Math.min(40, hexPx * 0.32);
  if (px < 15) px = Math.min(15, hexPx * 0.5);
  return px;
};
const FIT = { ground: HEX_W, px: badgePx, size: 44, fadePx: [11, 14] };

export class DevelopLayer {
  // heightAt(x, z): the ground's height
  constructor(labels, heightAt) {
    this.labels = labels;
    this.heightAt = heightAt;
    this.items = new Map();
  }

  // Bring the badges in line with the state: those that went away are removed, new ones added, the
  // others touched only when what they show changed.
  sync(state, players) {
    const want = new Map();
    const color = (p) => (players[p] ? players[p].color : '#fff');
    const ground = (x, z) => Math.max(this.heightAt(x, z), 0.5);
    // developments: north of the hex's middle (the token keeps the middle)
    (state.plots || []).forEach((pt, h) => {
      if (!pt) return;
      const g = GEO.hexes[h];
      const html = `<span class="dvb-fig">${icon('develop', 22)}</span><span class="dvb-res">${pt.r.map((r) => resIcon(r, 14)).join('')}</span>`;
      const title = t('{lv}開發（{who}）', { lv: pt.r.length > 1 ? t('二級') : t('一級'), who: players[pt.p] ? players[pt.p].name : '' });
      want.set('p' + h, { pos: [g.x, ground(g.x, g.z - 4.6) + 1.4, g.z - 4.6], cls: 'dv-badge plot lv' + pt.r.length, html, color: color(pt.p), title });
    });
    // the buildings beside each settlement, over it
    state.vertices.forEach((b, v) => {
      if (!b) return;
      const ks = annexAt(state, v);
      if (!ks.length) return;
      const g = GEO.vertices[v];
      const html = ks.map((k) => `<span class="dvb-b" style="--dc:${dirColor(k)}">${buildingIcon(k, 18)}</span>`).join('');
      want.set('v' + v, { pos: [g.x, ground(g.x, g.z) + 5.2, g.z], cls: 'dv-badge annex', html, color: color(b.p), title: list(ks.map((k) => t(BUILDING_NAMES[k]))) });
    });
    // wonders on their deserts (a little north of the middle: the robber's badge keeps the middle)
    for (const w of state.wonders || []) {
      const g = GEO.hexes[w.h];
      const html = w.done ? `<span class="dvb-fig">${buildingIcon(w.k, 30)}</span>` : `<span class="dvb-fig">${icon('scaffold', 26)}</span><b class="dvb-stage">${w.s}/3</b>`;
      const title = `${t(BUILDING_NAMES[w.k])}${w.done ? t('（完工）') : t('（施工中 {s}/3）', { s: w.s })}`;
      want.set('w' + w.h, { pos: [g.x, ground(g.x, g.z - 2.2) + 1.8, g.z - 2.2], cls: 'dv-badge wonder' + (w.done ? ' done' : ''), html, color: color(w.p), title });
    }
    for (const [key, it] of this.items) {
      if (want.has(key)) continue;
      this.labels.remove(it.label);
      this.items.delete(key);
    }
    for (const [key, w] of want) {
      const sig = w.cls + '|' + w.html + '|' + w.color + '|' + w.title;
      const cur = this.items.get(key);
      if (cur && cur.sig === sig) continue;
      if (cur) {
        cur.label.el.className = w.cls;
        cur.label.el.innerHTML = w.html;
        cur.label.el.style.setProperty('--pc', w.color);
        cur.label.el.title = w.title;
        cur.label.pos.set(...w.pos);
        cur.sig = sig;
        continue;
      }
      const el = document.createElement('div');
      el.className = w.cls;
      el.innerHTML = w.html;
      el.title = w.title;
      el.style.setProperty('--pc', w.color);
      const label = this.labels.add(el, new THREE.Vector3(...w.pos), { ...FIT });
      this.items.set(key, { label, sig });
    }
  }

  dispose() {
    for (const it of this.items.values()) this.labels.remove(it.label);
    this.items.clear();
  }
}

const dirColor = (k) => DIR_COLOR[BUILDINGS[k].dir] || '#888';
