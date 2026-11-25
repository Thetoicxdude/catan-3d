// The map from afar: over every settlement, city, ship and wonder a badge (ui/badges.js) in its
// owner's colour, the shape saying what it is, your own with a gold rim (2026-11-25, the user: zoomed
// out nobody could tell whose building stood where, nor find their own). A settlement's or city's
// special buildings (the development mode) are small diamonds under its badge; a wonder's badge
// (north of its desert's middle, clear of the robber's) shows its stages as dots until it is done;
// the pirate has a badge of its own.
// The badges are map labels (labels.js), sized by the province under them like the number tokens,
// and only seen when the provinces are small on screen: they come in as the 3D pieces become hard to
// make out and are gone close up, where the models speak for themselves.
import * as THREE from 'three';
import { GEO, HEX_SIZE } from '../engine/geometry.js';
import { annexAt } from '../engine/develop.js';
import { badgeSvg, BADGE } from '../ui/badges.js';
import { buildingGlyph } from '../ui/icons.js';

// A settlement's badge is a third of its province on screen, 20–30 px (where provinces are tiny, a phone
// seeing a whole big map, half a province: down there they are spots of colour); the others in
// proportion, and your own a tenth bigger.
export const badgePx = (hexPx) => Math.min(30, Math.max(hexPx * 0.32, Math.min(20, hexPx * 0.5)));
const MINE = 1.1;
const MULT = { s: 1, c: 1.24, ship: 0.84, wonder: 1.3, pirate: 0.95 };
// Seen when a province is under 150 px wide on screen, fully under 118 (the standard island seen from
// as far as the camera goes on a desktop is about 112 px a province; a phone's map, smaller).
export const FAR_HEX = [118, 150];

export class MapBadges {
  // fit(mult): the label options (scene.js: sized by the ground under the label)
  constructor(labels, heightAt, fit) {
    this.labels = labels;
    this.heightAt = heightAt;
    this.fit = fit;
    this.items = new Map(); // key → { it, el, sig }
    this.players = [];
    this.me = -1;
  }

  setPlayers(players) {
    this.players = players;
    // (the colours may have changed: everything is drawn again on the next sync)
    for (const x of this.items.values()) x.sig = null;
  }

  setMe(p) {
    if (p === this.me) return;
    this.me = p;
    for (const x of this.items.values()) x.sig = null;
  }

  color(p) {
    return (this.players[p] && this.players[p].color) || '#888';
  }

  // a label at (x, y, z), its badge drawn by `html` when `sig` changes
  put(want, key, x, y, z, mult, sig, html) {
    want.add(key);
    let cur = this.items.get(key);
    if (!cur) {
      const el = document.createElement('div');
      el.className = 'mbadge';
      const it = this.labels.add(el, new THREE.Vector3(x, y, z), this.fit(mult));
      cur = { it, el, sig: null, mult };
      this.items.set(key, cur);
    } else {
      // (the pirate moves; a settlement becomes a city, a little bigger)
      cur.it.pos.set(x, y, z);
      if (cur.mult !== mult) {
        cur.mult = mult;
        Object.assign(cur.it.opts, this.fit(mult));
      }
    }
    if (cur.sig !== sig) {
      cur.sig = sig;
      cur.el.innerHTML = html();
      cur.el.classList.toggle('mine', sig.startsWith('m'));
    }
  }

  sync(state) {
    if (typeof document === 'undefined') return;
    const want = new Set();
    const me = this.me;
    const y = (x, z) => Math.max(0, this.heightAt(x, z));
    state.vertices.forEach((b, v) => {
      if (!b) return;
      const V = GEO.vertices[v];
      const mine = b.p === me;
      const ks = state.rules && state.rules.develop ? annexAt(state, v) : [];
      const col = this.color(b.p);
      const [shape, glyph] = BADGE[b.t === 'c' ? 'city' : 'settlement'];
      this.put(want, 'v' + v, V.x, y(V.x, V.z) + 1.6, V.z, MULT[b.t === 'c' ? 'c' : 's'] * (mine ? MINE : 1), `${mine ? 'm' : 'o'}|${b.t}|${col}|${ks.join(',')}`, () => {
        let html = badgeSvg(shape, glyph, col, { mine });
        // the special buildings beside it: small diamonds along its lower edge
        if (ks.length) html += `<span class="mb-ann">${ks.map((k) => `<span class="mb-an">${badgeSvg('diamond', buildingGlyph(k), col, { mine })}</span>`).join('')}</span>`;
        return html;
      });
    });
    if (state.ships) {
      state.ships.forEach((p, e) => {
        if (p < 0) return;
        const E = GEO.edges[e];
        const mine = p === me;
        const col = this.color(p);
        this.put(want, 'e' + e, E.x, 1.2, E.z, MULT.ship * (mine ? MINE : 1), `${mine ? 'm' : 'o'}|${col}`, () => badgeSvg(...BADGE.ship, col, { mine }));
      });
    }
    for (const w of state.wonders || []) {
      const g = GEO.hexes[w.h];
      if (!g) continue;
      const mine = w.p === me;
      const col = this.color(w.p);
      const done = !!w.done;
      const stages = done ? 3 : Math.max(0, Math.min(3, w.s || 0));
      this.put(want, 'w' + w.h, g.x, y(g.x, g.z) + 3, g.z - HEX_SIZE * 0.42, MULT.wonder * (mine ? MINE : 1), `${mine ? 'm' : 'o'}|${w.k}|${stages}|${done}|${col}`, () =>
        badgeSvg('rosette', buildingGlyph(w.k), col, { mine, gold: true, pips: done ? null : [stages, 3] }),
      );
    }
    // (Seafarers) the pirate's black ship
    const pir = state.board && state.board.pirate;
    if (pir != null && pir >= 0 && GEO.hexes[pir]) {
      const g = GEO.hexes[pir];
      this.put(want, 'pirate', g.x - 2.2, 1.6, g.z + 1.4, MULT.pirate, 'o|pirate', () => badgeSvg(...BADGE.pirate, '#2b2622'));
    }
    for (const [key, cur] of this.items) {
      if (want.has(key)) continue;
      this.labels.remove(cur.it);
      this.items.delete(key);
    }
  }

  dispose() {
    for (const cur of this.items.values()) this.labels.remove(cur.it);
    this.items.clear();
  }
}
