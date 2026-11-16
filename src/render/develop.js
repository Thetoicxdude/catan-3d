// (the development mode) what the mode adds to the map, as models (devmodels.js and devwonders.js, made
// into meshes by devmesh.js; the design: Claude Docs「卡坦島：發展模式美術設計」):
//   a development: its facility on the hex, north-west of the number token, in its developer's colour,
//     with a small badge of the resource each level brings (that is worth reading at a glance)
//   the buildings beside a settlement: each in a corner of the settlement, towards a land hex, facing
//     out (a shipyard on the shore, its slipway into the water); they grow with the settlements when the
//     map is zoomed out (setScale)
//   a wonder: on its desert, at its stage (going up in scaffolding) or complete; a wonder destroyed
//     collapses in a cloud of dust and leaves its ruins there until another is begun on that desert
//     (state.ruins)
// Whatever of the scenery stands under a model (trees, haystacks, the desert's old fort) is cleared
// (clear(x, z, r): the map's flora). New models rise out of the ground; a wonder that goes up a stage
// settles into its new shape in a puff of dust. Chimneys, kilns and fires smoke. Under the pointer a
// model names itself (pick: the map's hover).
import * as THREE from 'three';
import { GEO, HEX_SIZE } from '../engine/geometry.js';
import { annexAt } from '../engine/develop.js';
import { resIcon } from '../ui/icons.js';
import { t } from '../i18n/index.js';
import { reduced } from '../ui/motion.js';
import { devGroup } from './devmesh.js';

const HEX_W = HEX_SIZE * 1.732;
// as wide as a number token and a little less
const badgePx = (hexPx) => {
  let px = Math.min(34, hexPx * 0.27);
  if (px < 14) px = Math.min(14, hexPx * 0.45);
  return px;
};
const FIT = { ground: HEX_W, px: badgePx, size: 44, fadePx: [11, 14] };
// a development's facility: towards the hex's north-west side, clear of the token and the corners
const FAC_A = (240 * Math.PI) / 180;
const FAC_R = 4.6;
// how far a building stands from its settlement's corner (a city is wider)
const ANNEX_D = { s: 2.35, c: 2.95 };
// how much of the scenery each kind of thing clears
const CLEAR = { annex: 1.05, plot1: 1.6, plot2: 2.4, wonder: 4.4 };
// how long things take (s)
const RISE = { annex: 0.45, plot: 0.45, wonder: 0.6 };
const SETTLE = 0.32;
const COLLAPSE = 0.8;

const ease = (k) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
const smooth = (k) => k * k * (3 - 2 * k);

// a soft round puff (smoke, dust)
let puffTex = null;
function puffTexture() {
  if (puffTex || typeof document === 'undefined') return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}
const puff = (color, opacity) => new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color, transparent: true, depthWrite: false, opacity }));

export class DevelopLayer {
  // labels: the map's label layer; heightAt(x, z): the ground's height; coastAt(x, z): how far into the
  // sea (negative inland); scene: where the models go; models: the asset pack's models (null: plain
  // colours); clear(x, z, r): clear the scenery there; plants: { real(), make(points) } the map's own
  // photographed plants (the flora), for the wonders' gardens
  constructor(labels, heightAt, { scene = null, models = null, clear = null, plants = null, coastAt = null } = {}) {
    this.labels = labels;
    this.plants = plants;
    this.heightAt = heightAt;
    this.coastAt = coastAt;
    this.models = models;
    this.clear = clear;
    this.group = new THREE.Group();
    this.group.name = 'develop';
    if (scene) scene.add(this.group);
    this.scene = scene;
    this.items = new Map();
    this.cleared = [];
    this.scale = 1;
    this.last = null;
    this.time = 0;
    // things on their way out (a wonder collapsing) and clouds of dust
    this.leaving = [];
    this.dust = [];
  }

  // the pack arrived: the same models in its materials
  setModels(models) {
    this.models = models;
    for (const it of this.items.values()) this.drop(it);
    this.items.clear();
    if (this.last) this.sync(this.last.state, this.last.players, false);
  }

  // the scenery was built again (the pack arrived): clear it again where the models stand
  reclear() {
    if (this.clear) for (const c of this.cleared) this.clear(c.x, c.z, c.r);
  }

  // Bring the models in line with the state: those that went away are removed, new ones added, the
  // others touched only when what they show changed. Returns whether anything changed.
  sync(state, players, animate = true) {
    this.last = { state, players };
    const want = new Map();
    const color = (p) => (players[p] ? players[p].color : '#888888');
    const land = (h) => {
      const H = state.board.hexes[h];
      return H && H.terrain !== 'sea' && H.terrain !== 'fog';
    };
    // developments
    (state.plots || []).forEach((pt, h) => {
      if (!pt) return;
      const g = GEO.hexes[h];
      const x = g.x + Math.cos(FAC_A) * FAC_R;
      const z = g.z + Math.sin(FAC_A) * FAC_R;
      const lv = pt.r.length;
      const terrain = state.board.hexes[h].terrain;
      want.set('p' + h, {
        kind: 'plot',
        info: { kind: 'plot', h },
        sig: `${terrain}|${lv}|${color(pt.p)}|${pt.r.join('')}`,
        make: () => devGroup(this.models, 'f', terrain, lv, color(pt.p)),
        x,
        z,
        ry: Math.atan2(g.x - x, g.z - z),
        clear: lv > 1 ? CLEAR.plot2 : CLEAR.plot1,
        badge: {
          html: `<span class="dvb-res">${pt.r.map((r) => resIcon(r, 14)).join('')}</span>`,
          title: t('{lv}開發（{who}）', { lv: lv > 1 ? t('二級') : t('一級'), who: players[pt.p] ? players[pt.p].name : '' }),
          color: color(pt.p),
          cls: 'dv-badge plot lv' + lv,
        },
      });
    });
    // the buildings beside each settlement
    state.vertices.forEach((b, v) => {
      if (!b) return;
      const ks = annexAt(state, v);
      if (!ks.length) return;
      const spots = annexSpots(state, v, ks, land, this.coastAt);
      ks.forEach((k, i) => {
        const s = spots[i];
        if (!s) return;
        want.set(`b${v}:${k}`, {
          kind: 'annex',
          info: { kind: 'annex', k, p: b.p, v },
          sig: `${k}|${b.t}|${color(b.p)}`,
          make: () => devGroup(this.models, 'b', k, null, color(b.p)),
          x: s.x,
          z: s.z,
          ax: GEO.vertices[v].x,
          az: GEO.vertices[v].z,
          ry: s.ry,
          clear: CLEAR.annex,
          shore: s.shore,
        });
      });
    });
    // wonders, and the ruins of those destroyed
    const busy = new Set();
    for (const w of state.wonders || []) {
      const g = GEO.hexes[w.h];
      busy.add(w.h);
      const stage = w.done ? 'done' : w.s;
      want.set('w' + w.h, {
        kind: 'wonder',
        info: { kind: 'wonder', h: w.h },
        sig: `${w.k}|${stage}|${color(w.p)}`,
        make: (impostors) => devGroup(this.models, 'w', w.k, stage, color(w.p), { impostors }),
        x: g.x,
        z: g.z - 0.6,
        ry: 0,
        clear: CLEAR.wonder,
      });
    }
    for (const r of state.ruins || []) {
      if (busy.has(r.h)) continue;
      const g = GEO.hexes[r.h];
      want.set('w' + r.h, { kind: 'wonder', info: { kind: 'wonder', h: r.h }, sig: `${r.k}|ruin`, make: (impostors) => devGroup(this.models, 'w', r.k, 'ruin', '#7a6a58', { impostors }), x: g.x, z: g.z - 0.6, ry: 0, clear: CLEAR.wonder });
    }

    const motion = animate && !reduced();
    let changed = false;
    // (how each replaced model goes, by its key: the new one comes in to match)
    const how = new Map();
    for (const [key, it] of this.items) {
      const w = want.get(key);
      if (w && w.sig === it.sig) continue;
      this.items.delete(key);
      changed = true;
      if (motion && w && it.kind === 'wonder' && w.sig.endsWith('|ruin') && !it.sig.endsWith('|ruin')) {
        // destroyed: it falls in on itself in a cloud of dust, the ruin shows through as it settles
        this.collapse(it);
        how.set(key, 'ruin');
      } else if (motion && w && it.kind === 'wonder' && !it.sig.endsWith('|ruin') && it.sig.split('|')[0] === w.sig.split('|')[0]) {
        // the next stage: the new shape settles in
        this.drop(it);
        this.dustAt(it, 10, 0.8);
        how.set(key, 'settle');
      } else {
        if (motion && it.kind === 'wonder') this.dustAt(it, 8, 0.7);
        this.drop(it);
      }
    }
    for (const [key, w] of want) {
      if (this.items.has(key)) continue;
      const it = this.place(w, motion ? how.get(key) || 'rise' : null);
      this.items.set(key, it);
      changed = true;
    }
    return changed;
  }

  // a model on the map (and its badge); anim: 'rise' (out of the ground), 'settle', 'ruin' or null
  place(w, anim) {
    // (a wonder's gardens are the map's own plants, where the pack has them: they stand in world
    // coordinates, so only on things that do not grow with the zoom)
    const imp = w.kind === 'wonder' && !!this.plants && this.plants.real();
    const obj = w.make(imp);
    // (stand it on the lowest ground under it: it may sink a little into a slope, never float; a
    // shipyard on the shore stands at the height of its own spot, its slipway out over the water)
    const r = w.clear * 0.6;
    let y = this.heightAt(w.x, w.z);
    if (w.kind === 'wonder') {
      // (a wonder is wide: it stands at the middle height of the sand under it, its foundations reaching
      // down into the dunes)
      const hs = [y];
      for (let a = 0; a < 8; a++) hs.push(this.heightAt(w.x + Math.cos((a * Math.PI) / 4) * r, w.z + Math.sin((a * Math.PI) / 4) * r));
      hs.sort((p, q) => p - q);
      y = hs[Math.floor(hs.length / 2)];
    } else if (!w.shore) for (let a = 0; a < 6; a++) y = Math.min(y, this.heightAt(w.x + Math.cos(a) * r, w.z + Math.sin(a) * r));
    y = Math.max(y, 0.05) - 0.03;
    // (a building beside a settlement hangs from the settlement's corner, so that the two grow
    // together when the map is zoomed out)
    const ax = w.ax != null ? w.ax : w.x;
    const az = w.az != null ? w.az : w.z;
    const ay = w.ax != null ? Math.max(this.heightAt(ax, az), 0.05) : y;
    const anchor = new THREE.Group();
    anchor.position.set(ax, ay, az);
    obj.position.set(w.x - ax, y - ay, w.z - az);
    obj.rotation.y = w.ry;
    anchor.add(obj);
    this.group.add(anchor);
    const box = obj.userData.box;
    const size = box ? { r: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2, h: box.max.y } : { r: 1, h: 1 };
    const it = { sig: w.sig, kind: w.kind, info: w.info, anchor, obj, size, label: null, flora: null, smoke: [], anim: null };
    if (anim) {
      const dur = anim === 'rise' ? RISE[w.kind] : anim === 'settle' ? SETTLE : 0.55;
      it.anim = { mode: anim, t: anim === 'ruin' ? -COLLAPSE * 0.45 : 0, dur };
    }
    const local = obj.userData.plants || [];
    if (imp && local.length) {
      const c = Math.cos(w.ry);
      const sn = Math.sin(w.ry);
      const pts = local.map((p) => ({ sp: p.sp, h: p.h, x: anchor.position.x + obj.position.x + c * p.x + sn * p.z, y: anchor.position.y + obj.position.y + p.y, z: anchor.position.z + obj.position.z - sn * p.x + c * p.z }));
      it.flora = this.plants.make(pts);
      it.flora.visible = !it.anim;
      this.group.add(it.flora);
    }
    // smoke from its chimneys, kilns and fires: puffs drifting up (in the model's own space, so they
    // grow with it)
    for (const s of obj.userData.smoke || []) {
      for (let k = 0; k < 4; k++) {
        const sp = puff(0xd9d4cc, 0);
        sp.userData = { base: new THREE.Vector3(s.x, s.y, s.z), s: s.s || 1, ph: k / 4 + Math.random() * 0.05 };
        sp.visible = !it.anim;
        obj.add(sp);
        it.smoke.push(sp);
      }
    }
    this.applyScale(it);
    this.applyAnim(it);
    if (this.clear) {
      // (as far as the model reaches: a building wider than most clears a little more)
      const cr = w.kind === 'annex' ? Math.max(w.clear, size.r * 1.1) : w.clear;
      this.clear(w.x, w.z, cr);
      this.cleared.push({ x: w.x, z: w.z, r: cr });
    }
    if (w.badge) {
      const el = document.createElement('div');
      el.className = w.badge.cls;
      el.innerHTML = w.badge.html;
      el.title = w.badge.title;
      el.style.setProperty('--pc', w.badge.color);
      it.label = this.labels.add(el, new THREE.Vector3(w.x, anchor.position.y + 2.6, w.z), { ...FIT });
    }
    return it;
  }

  drop(it) {
    this.group.remove(it.anchor);
    if (it.flora) this.group.remove(it.flora);
    if (it.label) this.labels.remove(it.label);
  }

  // a wonder destroyed: it stays a moment, sinking and leaning as it falls in, then goes
  collapse(it) {
    if (it.label) this.labels.remove(it.label);
    it.label = null;
    if (it.flora) this.group.remove(it.flora);
    it.flora = null;
    for (const sp of it.smoke) sp.visible = false;
    it.fall = { t: 0, dur: COLLAPSE, lean: (Math.random() < 0.5 ? -1 : 1) * 0.06 };
    this.leaving.push(it);
    this.dustAt(it, 16, 1.25);
  }

  // a cloud of dust round the foot of a model: puffs that spread out and up and fade
  dustAt(it, n, size) {
    const r = it.size.r * 0.8;
    const p = it.anchor.position.clone().add(it.obj.position.clone().multiplyScalar(it.anchor.scale.x));
    const sprites = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = puff(0xcdb894, 0);
      const d = r * (0.45 + Math.random() * 0.5);
      sp.userData = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, y: p.y + 0.2, dx: Math.cos(a), dz: Math.sin(a), s: size * (0.8 + Math.random() * 0.5), delay: Math.random() * 0.15 };
      sp.position.set(sp.userData.x, sp.userData.y, sp.userData.z);
      this.group.add(sp);
      sprites.push(sp);
    }
    this.dust.push({ sprites, t: 0, dur: 1.5, spread: r * 0.6 });
  }

  // the map zoomed out: buildings beside the settlements grow with them, developments a little
  setScale(s) {
    if (Math.abs(s - this.scale) < 0.002) return;
    this.scale = s;
    for (const it of this.items.values()) this.applyScale(it);
  }
  applyScale(it) {
    const s = it.kind === 'annex' ? this.scale : it.kind === 'plot' ? Math.min(this.scale, 1.7) : 1;
    it.anchor.scale.setScalar(s);
  }

  // where an animation coming in has got to
  applyAnim(it) {
    const a = it.anim;
    if (!a) return;
    const k = Math.max(0, Math.min(1, a.t / a.dur));
    if (a.mode === 'rise') it.obj.scale.set(1, Math.max(0.001, ease(k)), 1);
    else if (a.mode === 'settle') it.obj.scale.set(1, 0.93 + 0.07 * ease(k), 1);
    else it.obj.scale.set(1, Math.max(0.001, 0.55 + 0.45 * smooth(k)), 1);
    it.obj.visible = a.t >= 0;
  }

  // the models rising, falling and smoking, the dust; true while anything is changing shape
  update(dt) {
    this.time += dt;
    let busy = false;
    for (const it of this.items.values()) {
      if (it.anim) {
        it.anim.t += dt;
        if (it.anim.t >= it.anim.dur) {
          it.obj.scale.setScalar(1);
          it.obj.visible = true;
          it.anim = null;
          if (it.flora) it.flora.visible = true;
          for (const sp of it.smoke) sp.visible = true;
        } else {
          this.applyAnim(it);
          busy = true;
        }
      }
      // (the same drift as the countryside's kilns)
      for (const sp of it.smoke) {
        if (!sp.visible) continue;
        const u = sp.userData;
        const f = (this.time * 0.2 + u.ph) % 1;
        sp.position.set(u.base.x + f * 0.5 * u.s, u.base.y + f * 1.6 * u.s, u.base.z + f * 0.2 * u.s);
        sp.scale.setScalar((0.22 + f * 0.8) * u.s);
        sp.material.opacity = 0.4 * (1 - f) * Math.min(1, f * 6);
      }
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const it = this.leaving[i];
      it.fall.t += dt;
      const k = Math.min(1, it.fall.t / it.fall.dur);
      const e = k * k;
      it.obj.scale.set(1 + 0.04 * e, Math.max(0.001, 1 - 0.85 * e), 1 + 0.04 * e);
      it.obj.rotation.z = it.fall.lean * e;
      if (k >= 1) {
        this.drop(it);
        this.leaving.splice(i, 1);
      } else busy = true;
    }
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.t += dt;
      for (const sp of d.sprites) {
        const u = sp.userData;
        const k = Math.max(0, Math.min(1, (d.t - u.delay) / (d.dur - u.delay)));
        const out = 1 - Math.pow(1 - k, 2);
        sp.position.set(u.x + u.dx * d.spread * out, u.y + out * 0.9 * u.s, u.z + u.dz * d.spread * out);
        sp.scale.setScalar(u.s * (0.6 + out * 1.6));
        sp.material.opacity = 0.55 * Math.min(1, k * 5) * (1 - k);
      }
      if (d.t >= d.dur) {
        for (const sp of d.sprites) {
          this.group.remove(sp);
          sp.material.dispose();
        }
        this.dust.splice(i, 1);
      } else busy = true;
    }
    return busy;
  }

  // What is under the pointer at (cx, cy) (client pixels): the model nearest the camera whose outline
  // there takes in the point, as { kind: 'annex', k, p, v } or { kind: 'plot' | 'wonder', h }, or null.
  pick(cx, cy, camera) {
    const r = camera.screenRect();
    const cam = camera.cam;
    // (the camera may have moved since it was last drawn)
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    const e = new THREE.Vector3();
    let best = null;
    let bd = Infinity;
    for (const it of this.items.values()) {
      if (it.anim && it.anim.t < 0) continue;
      const s = it.anchor.scale.x;
      v.copy(it.obj.position).multiplyScalar(s).add(it.anchor.position);
      v.y += it.size.h * s * 0.45;
      e.copy(v);
      e.x += it.size.r * s;
      v.project(cam);
      e.project(cam);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * r.width + r.left;
      const py = (-v.y * 0.5 + 0.5) * r.height + r.top;
      const rad = Math.hypot((e.x - v.x) * 0.5 * r.width, (e.y - v.y) * 0.5 * r.height) * 0.85;
      const d = Math.hypot(px - cx, (py - cy) * 1.15);
      if (d > rad) continue;
      // (the nearest to the camera first: a building in front of a wonder)
      if (v.z < bd) {
        bd = v.z;
        best = it.info;
      }
    }
    return best;
  }

  dispose() {
    for (const it of this.items.values()) this.drop(it);
    for (const it of this.leaving) this.drop(it);
    for (const d of this.dust) for (const sp of d.sprites) this.group.remove(sp);
    this.items.clear();
    this.leaving = [];
    this.dust = [];
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

// Where the buildings ks beside the settlement at v go: in its corners towards land hexes (towards the
// camera first), facing out; more buildings than such corners share the best one. A shipyard goes to
// the shore instead, facing the sea (coastAt: how far into the sea a point is, negative inland).
export function annexSpots(state, v, ks, land, coastAt) {
  const g = GEO.vertices[v];
  const b = state.vertices[v];
  const d = ANNEX_D[b && b.t === 'c' ? 'c' : 's'];
  const wonderHexes = new Set((state.wonders || []).map((w) => w.h));
  const dirs = [];
  const sea = [];
  for (const h of g.hexes) {
    const c = GEO.hexes[h];
    const dx = c.x - g.x;
    const dz = c.z - g.z;
    const L = Math.hypot(dx, dz) || 1;
    // (towards the camera, which looks from the south; away from a wonder's desert)
    if (land(h)) dirs.push({ a: Math.atan2(dz, dx), score: dz / L - (wonderHexes.has(h) ? 0.6 : 0) });
    else sea.push({ a: Math.atan2(dz, dx), score: dz / L });
  }
  // (the hexes round a corner lie a third of a turn apart; where the board has none, it is sea)
  const known = [...dirs, ...sea].map((x) => x.a);
  if (known.length && known.length < 3) {
    for (const k of [0, 1, 2]) {
      const a = known[0] + (k * 2 * Math.PI) / 3;
      const near = known.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.3);
      if (!near) sea.push({ a, score: Math.sin(a) });
    }
  }
  dirs.sort((p, q) => q.score - p.score);
  sea.sort((p, q) => q.score - p.score);
  const out = new Array(ks.length).fill(null);
  const rest = [];
  ks.forEach((k, i) => {
    if (k === 'shipyard' && sea.length) out[i] = shoreSpot(g, sea[0].a, d, coastAt);
    else rest.push(i);
  });
  const angles = dirs.map((x) => x.a);
  if (!angles.length) angles.push(Math.PI / 2);
  // (a coast with one land corner: two buildings share it, a little apart)
  if (rest.length > angles.length) {
    const a = angles[0];
    angles.splice(0, 1, a - 0.45, a + 0.45);
  }
  rest.forEach((i, n) => {
    const a = angles[n];
    if (a == null) return;
    out[i] = { x: g.x + Math.cos(a) * d, z: g.z + Math.sin(a) * d, ry: Math.atan2(Math.cos(a), Math.sin(a)) };
  });
  return out;
}

// a shipyard's place: along the direction a from the settlement to the sea, at the water's edge (its
// middle a little inland, so the slipway runs out over the water)
function shoreSpot(g, a, d, coastAt) {
  let r = d * 0.7;
  if (coastAt) {
    for (let k = 0.8; k <= d * 1.3; k += 0.1) {
      if (coastAt(g.x + Math.cos(a) * k, g.z + Math.sin(a) * k) > -0.7) {
        r = Math.max(1.0, k);
        break;
      }
    }
  }
  return { x: g.x + Math.cos(a) * r, z: g.z + Math.sin(a) * r, ry: Math.atan2(Math.cos(a), Math.sin(a)), shore: true };
}
