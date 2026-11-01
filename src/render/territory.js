// Nation territories (HOI4-style political map): every settlement, city and road projects
// influence; each pixel belongs to the nearest influence. Baked on the CPU into two textures
// (fill colour + border mask) whenever the board changes. Also yields label anchors.
import * as THREE from 'three';
import { GEO } from '../engine/geometry.js';
import { DOMAIN } from './terrain.js';

// texture size: 320 for the standard island's 128-unit domain, more for bigger maps
const resFor = (size) => Math.min(512, Math.round((320 * size) / 128));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Territory {
  constructor(players, terrain) {
    const RES = (this.res = resFor(DOMAIN.size));
    this.players = players;
    this.terrain = terrain;
    this.fill = new Uint8Array(RES * RES * 4);
    this.border = new Uint8Array(RES * RES);
    this.owner = new Int8Array(RES * RES);
    this.best = new Float32Array(RES * RES);
    this.raw = new Float32Array(RES * RES);
    this.comp = new Int32Array(RES * RES);
    this.stack = new Int32Array(RES * RES);
    this.fillTex = new THREE.DataTexture(this.fill, RES, RES, THREE.RGBAFormat);
    this.fillTex.magFilter = this.fillTex.minFilter = THREE.LinearFilter;
    this.fillTex.needsUpdate = true;
    this.borderTex = new THREE.DataTexture(this.border, RES, RES, THREE.RedFormat);
    this.borderTex.magFilter = this.borderTex.minFilter = THREE.LinearFilter;
    this.borderTex.needsUpdate = true;
    this.colors = players.map((p) => hexToRgb(p.color));
    // land mask so territory stops at the shore
    this.land = new Uint8Array(RES * RES);
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const x = DOMAIN.min + ((i + 0.5) / RES) * DOMAIN.size;
        const z = DOMAIN.min + ((j + 0.5) / RES) * DOMAIN.size;
        this.land[j * RES + i] = terrain.heightAt(x, z) > 0.02 ? 1 : 0;
      }
    }
    this.labels = [];
    this.key = '';
  }

  update(st) {
    const RES = this.res;
    const key = st.vertices.map((b) => (b ? b.p + b.t : '-')).join('') + st.edges.join(',');
    if (key === this.key) return false;
    this.key = key;
    const { best, owner, land, fill, border, colors, raw, comp, stack } = this;
    best.fill(1e9);
    owner.fill(-1);
    const px = DOMAIN.size / RES;
    const toPix = (x) => (x - DOMAIN.min) / px - 0.5;

    const stamp = (cx, cz, radius, p, segB) => {
      let minx = cx;
      let maxx = cx;
      let minz = cz;
      let maxz = cz;
      if (segB) {
        minx = Math.min(cx, segB[0]);
        maxx = Math.max(cx, segB[0]);
        minz = Math.min(cz, segB[1]);
        maxz = Math.max(cz, segB[1]);
      }
      const i0 = Math.max(0, Math.floor(toPix(minx - radius)));
      const i1 = Math.min(RES - 1, Math.ceil(toPix(maxx + radius)));
      const j0 = Math.max(0, Math.floor(toPix(minz - radius)));
      const j1 = Math.min(RES - 1, Math.ceil(toPix(maxz + radius)));
      const vx = segB ? segB[0] - cx : 0;
      const vz = segB ? segB[1] - cz : 0;
      const vv = vx * vx + vz * vz;
      for (let j = j0; j <= j1; j++) {
        const z = DOMAIN.min + (j + 0.5) * px;
        for (let i = i0; i <= i1; i++) {
          const x = DOMAIN.min + (i + 0.5) * px;
          let dx = x - cx;
          let dz = z - cz;
          if (vv > 0) {
            const t = Math.max(0, Math.min(1, (dx * vx + dz * vz) / vv));
            dx -= vx * t;
            dz -= vz * t;
          }
          const d = Math.sqrt(dx * dx + dz * dz) - radius;
          if (d < 0) {
            const k = j * RES + i;
            if (d < best[k]) {
              best[k] = d;
              owner[k] = p;
            }
          }
        }
      }
    };

    st.vertices.forEach((b, v) => {
      if (!b) return;
      const g = GEO.vertices[v];
      stamp(g.x, g.z, b.t === 'c' ? 9.5 : 7.5, b.p);
    });
    st.edges.forEach((p, e) => {
      if (p < 0) return;
      const g = GEO.edges[e];
      const A = GEO.vertices[g.v[0]];
      const B = GEO.vertices[g.v[1]];
      stamp(A.x, A.z, 3.6, p, [B.x, B.z]);
    });

    for (let k = 0; k < RES * RES; k++) {
      const o = land[k] ? owner[k] : -1;
      owner[k] = o;
      if (o >= 0) {
        const c = colors[o];
        fill[k * 4] = c[0];
        fill[k * 4 + 1] = c[1];
        fill[k * 4 + 2] = c[2];
        fill[k * 4 + 3] = 255;
      } else fill[k * 4 + 3] = 0;
    }
    // bleed colour into transparent neighbours so linear filtering doesn't darken edges
    for (let k = RES; k < RES * RES - RES; k++) {
      if (owner[k] >= 0) continue;
      const q = owner[k - 1] >= 0 ? k - 1 : owner[k + 1] >= 0 ? k + 1 : owner[k - RES] >= 0 ? k - RES : owner[k + RES] >= 0 ? k + RES : -1;
      if (q >= 0) {
        const c = colors[owner[q]];
        fill[k * 4] = c[0];
        fill[k * 4 + 1] = c[1];
        fill[k * 4 + 2] = c[2];
      }
    }

    // borders where ownership changes (2px band, softened); faint line along the shore
    raw.fill(0);
    for (let j = 1; j < RES - 1; j++) {
      for (let i = 1; i < RES - 1; i++) {
        const k = j * RES + i;
        const o = owner[k];
        if (o < 0) continue;
        let diff = false;
        let coast = false;
        for (let dj = -1; dj <= 1 && !diff; dj++) {
          for (let di = -1; di <= 1; di++) {
            const q = k + dj * RES + di;
            if (!land[q]) coast = true;
            else if (owner[q] !== o) {
              diff = true;
              break;
            }
          }
        }
        if (diff) raw[k] = 1;
        else if (coast) raw[k] = 0.35;
      }
    }
    border.fill(0);
    for (let j = 1; j < RES - 1; j++) {
      for (let i = 1; i < RES - 1; i++) {
        const k = j * RES + i;
        const v = raw[k] * 0.4 + (raw[k - 1] + raw[k + 1] + raw[k - RES] + raw[k + RES]) * 0.15;
        border[k] = Math.min(255, Math.round(v * 255));
      }
    }
    this.fillTex.needsUpdate = true;
    this.borderTex.needsUpdate = true;

    // label anchors: largest connected region of each nation → centroid + principal axis
    comp.fill(-1);
    const bestComp = this.players.map(() => null);
    let cid = 0;
    for (let k0 = 0; k0 < RES * RES; k0++) {
      const o = owner[k0];
      if (o < 0 || comp[k0] >= 0) continue;
      let sp = 0;
      stack[sp++] = k0;
      comp[k0] = cid;
      let n = 0;
      let sx = 0;
      let sz = 0;
      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      while (sp) {
        const k = stack[--sp];
        const i = k % RES;
        const j = (k / RES) | 0;
        const x = DOMAIN.min + (i + 0.5) * px;
        const z = DOMAIN.min + (j + 0.5) * px;
        n++;
        sx += x;
        sz += z;
        sxx += x * x;
        szz += z * z;
        sxz += x * z;
        if (i > 0 && owner[k - 1] === o && comp[k - 1] < 0) {
          comp[k - 1] = cid;
          stack[sp++] = k - 1;
        }
        if (i < RES - 1 && owner[k + 1] === o && comp[k + 1] < 0) {
          comp[k + 1] = cid;
          stack[sp++] = k + 1;
        }
        if (j > 0 && owner[k - RES] === o && comp[k - RES] < 0) {
          comp[k - RES] = cid;
          stack[sp++] = k - RES;
        }
        if (j < RES - 1 && owner[k + RES] === o && comp[k + RES] < 0) {
          comp[k + RES] = cid;
          stack[sp++] = k + RES;
        }
      }
      cid++;
      if (!bestComp[o] || n > bestComp[o].n) bestComp[o] = { n, sx, sz, sxx, szz, sxz };
    }
    const pxArea = px * px;
    this.labels = bestComp.map((a, p) => {
      if (!a || a.n < 60) return null;
      const mx = a.sx / a.n;
      const mz = a.sz / a.n;
      const cxx = a.sxx / a.n - mx * mx;
      const czz = a.szz / a.n - mz * mz;
      const cxz = a.sxz / a.n - mx * mz;
      let ang = 0.5 * Math.atan2(2 * cxz, cxx - czz);
      const tr = cxx + czz;
      const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (cxx * czz - cxz * cxz)));
      let major = Math.sqrt(Math.max(1e-6, tr / 2 + disc)) * 3.2;
      const minor = Math.sqrt(Math.max(0, tr / 2 - disc)) * 3.2;
      // keep text readable: steep regions get gentle or horizontal text sized to their width
      if (Math.abs(ang) > 0.6) {
        ang = Math.abs(ang) > 1.2 ? 0 : Math.sign(ang) * 0.35;
        major = Math.sqrt(Math.max(1e-6, cxx)) * 3.2;
      }
      return { p, x: mx, z: mz, angle: ang, area: a.n * pxArea, length: major, minor };
    });
    return true;
  }
}
