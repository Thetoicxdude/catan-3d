// Continuous island terrain: a heightfield built from the map's land hexes (each hex shapes its own
// landform), an organic coastline, flattened plateaus at every intersection, and a custom
// shaded MeshStandardMaterial (procedural albedo, province lines, map modes, paper map).
import * as THREE from 'three';
import { GEO, HEX_SIZE, worldToAxial, AXIAL_DIRS, axialToWorld } from '../engine/geometry.js';
import { pips } from '../engine/board.js';
import { seaInfo } from '../engine/seafarers.js';
import { makeNoise, GLSL_NOISE } from './noise.js';

// The square of the world the terrain covers (centred on the origin): the standard island's is
// −64…64; larger maps widen it (fitDomain, when the terrain is built).
export const DOMAIN = { min: -64, size: 128 };
export const TERRAIN_IDS = { forest: 1, hills: 2, pasture: 3, fields: 4, mountains: 5, desert: 6, gold: 7 };
const TYPES = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'];
const APOTHEM = HEX_SIZE * 0.8660254;

export function fitDomain(geo = GEO) {
  const b = geo.bounds;
  const half = Math.max(64, Math.ceil(Math.max(-b.minX, b.maxX, -b.minZ, b.maxZ) + 20.6));
  DOMAIN.min = -half;
  DOMAIN.size = 2 * half;
  return DOMAIN;
}

// The hex lookup window (axial coordinates, one hex of margin round the map) for the hex data texture.
export function hexWindow(geo = GEO) {
  const b = geo.bounds;
  return { q0: b.minQ - 1, r0: b.minR - 1, w: b.maxQ - b.minQ + 3, h: b.maxR - b.minR + 3 };
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
function hexNorm(dx, dz) {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  return Math.max(ax, 0.5 * ax + 0.8660254 * az) / APOTHEM; // 0 centre … 1 edge … 1.155 corner
}

export function buildTerrain(board, seed, quality = 'high') {
  fitDomain(GEO);
  // the same ground resolution on every map (bigger maps get more grid points, within reason)
  const base = quality === 'low' ? 256 : quality === 'medium' ? 368 : 448;
  const N = Math.min(Math.round(base * 1.6), Math.round(((base - 1) * DOMAIN.size) / 128) + 1);
  const nz = makeNoise(seed);
  // land as the board lays it out (Seafarers: sea inside the map, some of it drawn from the pools)
  const sea = seaInfo(board);
  const landHexes = GEO.hexes.filter((h) => sea.land[h.id]).map((h) => ({ x: h.x, z: h.z, q: h.q, r: h.r, type: board.hexes[h.id].terrain }));
  const hexByQR = new Map(landHexes.map((h, i) => [h.q + ',' + h.r, i]));
  const coastVerts = GEO.vertices.filter((v) => sea.coast[v.id]);

  function coastDist(x, z) {
    let s = 1e9;
    for (const h of landHexes) {
      const dx = x - h.x;
      const dz = z - h.z;
      if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
      const ax = Math.abs(dx);
      const d = Math.max(ax, 0.5 * ax + 0.8660254 * Math.abs(dz)) - APOTHEM;
      if (d < s) s = d;
    }
    const wobble = 2.15 + 1.3 * nz.fbm(x * 0.065 + 3.3, z * 0.065 - 1.7, 3) + 0.35 * nz.noise(x * 0.31, z * 0.31);
    let cd = s - wobble;
    for (const v of coastVerts) {
      const dx = x - v.x;
      const dz = z - v.z;
      if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue;
      const d = Math.hypot(dx, dz) - 3.1;
      if (d < cd) cd = d;
    }
    return cd;
  }

  // per-hex landform; m = interior mask (1 centre → 0 border)
  function shape(type, x, z, m) {
    switch (type) {
      case 'forest':
        return 0.3 + 1.15 * (0.5 + 0.5 * nz.fbm(x * 0.11, z * 0.11, 3)) * Math.pow(m, 0.6);
      case 'hills': {
        // rounded red knolls, cut by small eroded gullies that drain off them
        const b = 0.5 + 0.5 * nz.fbm(x * 0.12 + 5.1, z * 0.12 + 5.1, 4);
        const g = nz.ridged(x * 0.26 + 2.7, z * 0.26 - 1.9, 3);
        const gully = Math.pow(g, 4) * smooth(0.2, 0.55, b);
        return 0.25 + 3.9 * Math.pow(b, 1.4) * m + 0.2 * nz.noise(x * 0.5, z * 0.5) * m - 0.6 * gully * m;
      }
      case 'pasture':
        return 0.22 + 0.85 * (0.5 + 0.5 * nz.fbm(x * 0.07 + 11.0, z * 0.07 + 11.0, 3)) * Math.pow(m, 0.5);
      case 'fields':
        return 0.14 + 0.22 * (0.5 + 0.5 * nz.fbm(x * 0.05 + 3.0, z * 0.05 + 3.0, 2));
      case 'mountains': {
        // domain-warped ridges, then finer crags and a hint of strata so the massif is not a cone
        const wx = x + 2.4 * nz.fbm(x * 0.055 + 1.7, z * 0.055 - 3.1, 2);
        const wz = z + 2.4 * nz.fbm(x * 0.055 - 4.2, z * 0.055 + 2.3, 2);
        const r = nz.ridged(wx * 0.085 + 7.0, wz * 0.085 + 7.0, 5);
        const r2 = nz.ridged(wx * 0.23 + 1.3, wz * 0.23 - 2.1, 3);
        const mm = Math.pow(m, 1.15);
        let hm = 0.3 + mm * (1.2 + 6.3 * r * (0.55 + 0.45 * mm)) + mm * mm * 0.95 * (r2 - 0.45);
        hm += 0.1 * Math.sin(hm * 4.1) * mm; // strata ledges
        return hm;
      }
      case 'desert': {
        const d = 0.5 + 0.5 * Math.sin((x * 0.8 + z * 0.6) * 0.55 + 2.2 * nz.fbm(x * 0.08, z * 0.08, 2));
        return 0.28 + 0.6 * d * Math.pow(m, 0.4);
      }
      case 'gold': {
        // (Seafarers) a gold field: low rocky knolls round a dry riverbed
        const b = 0.5 + 0.5 * nz.fbm(x * 0.1 + 9.1, z * 0.1 - 4.4, 3);
        return 0.25 + 1.6 * Math.pow(b, 1.6) * m;
      }
    }
    return 0.2;
  }

  const weights = new Float32Array(6);
  function sample(x, z, out) {
    // terrain weights from nearby land hexes
    const a = worldToAxial(x, z);
    const cands = [];
    const tryHex = (q, r) => {
      const id = hexByQR.get(q + ',' + r);
      if (id === undefined) return;
      const h = landHexes[id];
      cands.push({ h, d: Math.hypot(x - h.x, z - h.z) });
    };
    tryHex(a.q, a.r);
    for (const [dq, dr] of AXIAL_DIRS) tryHex(a.q + dq, a.r + dr);
    weights.fill(0);
    let landH = 0.35 * (0.5 + 0.5 * nz.fbm(x * 0.025, z * 0.025, 2));
    let mountW = 0;
    if (cands.length) {
      let dmin = 1e9;
      for (const c of cands) dmin = Math.min(dmin, c.d);
      let sw = 0;
      for (const c of cands) {
        c.w = Math.exp(-(c.d - dmin) / 1.05);
        if (c.w < 0.004) c.w = 0;
        sw += c.w;
      }
      let hsum = 0;
      for (const c of cands) {
        if (!c.w) continue;
        const w = c.w / sw;
        const m = smooth(1.0, 0.22, hexNorm(x - c.h.x, z - c.h.z));
        hsum += w * shape(c.h.type, x, z, m);
        // (a gold field paints over the desert's sand, see the shader)
        weights[c.h.type === 'gold' ? 5 : TYPES.indexOf(c.h.type)] += w;
      }
      landH += hsum;
      mountW = weights[4];
    }
    out.landH = landH;
    out.mountW = mountW;
    return out;
  }

  // plateau heights at every intersection (settlements sit on flat ground)
  const tmp = {};
  const plateau = GEO.vertices.map((v) => sample(v.x, v.z, tmp).landH);

  const count = N * N;
  const pos = new Float32Array(count * 3);
  const w0 = new Float32Array(count * 3);
  const w1 = new Float32Array(count * 3);
  const coast = new Float32Array(count);
  const H = new Float32Array(count);
  const step = DOMAIN.size / (N - 1);

  for (let j = 0; j < N; j++) {
    const z = DOMAIN.min + j * step;
    for (let i = 0; i < N; i++) {
      const x = DOMAIN.min + i * step;
      const k = j * N + i;
      const cd = coastDist(x, z);
      let h;
      if (cd < 6) {
        sample(x, z, tmp);
        let landH = tmp.landH;
        // flatten around intersections
        for (let v = 0; v < GEO.vertices.length; v++) {
          const gv = GEO.vertices[v];
          const dx = x - gv.x;
          const dz = z - gv.z;
          if (Math.abs(dx) > 3.6 || Math.abs(dz) > 3.6) continue;
          const d = Math.hypot(dx, dz);
          const f = 1 - smooth(1.6, 3.5, d);
          if (f > 0) landH = landH * (1 - f) + (plateau[v] + 0.04) * f;
        }
        if (cd < 0) {
          const bw = 2.6 * (1 - 0.65 * tmp.mountW) + 0.4;
          h = 0.24 + (landH - 0.24) * smooth(0, bw, -cd);
        } else {
          h = 0.24 - 0.95 * smooth(0, 1.6, cd) - 7.5 * smooth(1.2, 16, cd) - 3.8 * smooth(13, 24, cd);
        }
        w0[k * 3] = weights[0];
        w0[k * 3 + 1] = weights[1];
        w0[k * 3 + 2] = weights[2];
        w1[k * 3] = weights[3];
        w1[k * 3 + 1] = weights[4];
        w1[k * 3 + 2] = weights[5];
      } else {
        h = 0.24 - 0.95 - 7.5 * smooth(1.2, 16, cd) - 3.8 * smooth(13, 24, cd) - 0.8 * (0.5 + 0.5 * nz.fbm(x * 0.05, z * 0.05, 2)) * smooth(6, 14, cd) * (1 - smooth(16, 24, cd));
      }
      H[k] = h;
      coast[k] = cd;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
    }
  }

  // ambient occlusion from local height relief (separable box blur)
  const R = Math.max(3, Math.round(1.8 / step));
  const tmpA = new Float32Array(count);
  const blur = new Float32Array(count);
  for (let j = 0; j < N; j++) {
    let acc = 0;
    for (let i = -R; i <= R; i++) acc += H[j * N + Math.min(N - 1, Math.max(0, i))];
    for (let i = 0; i < N; i++) {
      tmpA[j * N + i] = acc / (2 * R + 1);
      acc += H[j * N + Math.min(N - 1, i + R + 1)] - H[j * N + Math.max(0, i - R)];
    }
  }
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = -R; j <= R; j++) acc += tmpA[Math.min(N - 1, Math.max(0, j)) * N + i];
    for (let j = 0; j < N; j++) {
      blur[j * N + i] = acc / (2 * R + 1);
      acc += tmpA[Math.min(N - 1, j + R + 1) * N + i] - tmpA[Math.max(0, j - R) * N + i];
    }
  }
  const ao = new Float32Array(count);
  for (let k = 0; k < count; k++) ao[k] = Math.min(1.12, Math.max(0.55, 1 + (H[k] - blur[k]) * 0.32));

  // normals
  const nrm = new Float32Array(count * 3);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const hl = H[j * N + Math.max(0, i - 1)];
      const hr = H[j * N + Math.min(N - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * N + i];
      const hu = H[Math.min(N - 1, j + 1) * N + i];
      const nx = (hl - hr) / (2 * step);
      const nzv = (hd - hu) / (2 * step);
      const len = Math.hypot(nx, 1, nzv);
      const k = (j * N + i) * 3;
      nrm[k] = nx / len;
      nrm[k + 1] = 1 / len;
      nrm[k + 2] = nzv / len;
    }
  }

  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let t = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      idx[t++] = a;
      idx[t++] = c;
      idx[t++] = b;
      idx[t++] = b;
      idx[t++] = c;
      idx[t++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aW0', new THREE.BufferAttribute(w0, 3));
  geo.setAttribute('aW1', new THREE.BufferAttribute(w1, 3));
  geo.setAttribute('aCoast', new THREE.BufferAttribute(coast, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  // height / coast texture for the water shader
  const tex = new Uint8Array(count * 4);
  for (let k = 0; k < count; k++) {
    tex[k * 4] = Math.round(255 * Math.min(1, Math.max(0, (H[k] + 12) / 16)));
    tex[k * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + coast[k] / 60)));
    tex[k * 4 + 2] = 0;
    tex[k * 4 + 3] = 255;
  }
  const heightTex = new THREE.DataTexture(tex, N, N, THREE.RGBAFormat);
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  function gridSample(arr, x, z) {
    const fx = (x - DOMAIN.min) / step;
    const fz = (z - DOMAIN.min) / step;
    const i = Math.max(0, Math.min(N - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(N - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const a = arr[j * N + i];
    const b = arr[j * N + i + 1];
    const c = arr[(j + 1) * N + i];
    const d = arr[(j + 1) * N + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  const heightAt = (x, z) => gridSample(H, x, z);
  const coastAt = (x, z) => gridSample(coast, x, z);
  function weightsAt(x, z) {
    const i = Math.max(0, Math.min(N - 1, Math.round((x - DOMAIN.min) / step)));
    const j = Math.max(0, Math.min(N - 1, Math.round((z - DOMAIN.min) / step)));
    const k = j * N + i;
    return {
      forest: w0[k * 3],
      hills: w0[k * 3 + 1],
      pasture: w0[k * 3 + 2],
      fields: w1[k * 3],
      mountains: w1[k * 3 + 1],
      desert: w1[k * 3 + 2],
    };
  }
  function slopeAt(x, z) {
    const e = 0.5;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  // hex data texture (an axial window round the map): terrain id, pips, land flag, selectable flag
  const win = hexWindow(GEO);
  const hexSlot = (h) => ((h.r - win.r0) * win.w + (h.q - win.q0)) * 4;
  const hexData = new Uint8Array(win.w * win.h * 4);
  for (const h of GEO.hexes) {
    const k = hexSlot(h);
    const H2 = board.hexes[h.id];
    hexData[k] = (TERRAIN_IDS[H2.terrain] || 0) * 32;
    hexData[k + 1] = Math.round((pips(H2.number) / 5) * 255);
    hexData[k + 2] = sea.land[h.id] ? 255 : 0;
    hexData[k + 3] = 0;
  }
  const hexTex = new THREE.DataTexture(hexData, win.w, win.h, THREE.RGBAFormat);
  hexTex.magFilter = THREE.NearestFilter;
  hexTex.minFilter = THREE.NearestFilter;
  hexTex.needsUpdate = true;

  const uniforms = {
    uTime: { value: 0 },
    uPaper: { value: 0 },
    uPolitical: { value: 0 },
    uProduction: { value: 0 },
    uResource: { value: 0 },
    uCloud: { value: 0 },
    uZoom: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uTerritory: { value: null },
    uBorder: { value: null },
    uHexTex: { value: hexTex },
    uHexWin: { value: new THREE.Vector4(win.q0, win.r0, win.w, win.h) },
    uDomain: { value: new THREE.Vector4(DOMAIN.min, DOMAIN.min, DOMAIN.size, DOMAIN.size) },
    uRobber: { value: new THREE.Vector2(99, 99) },
    uHover: { value: new THREE.Vector4(99, 99, 0, 0) },
    uGlowA: { value: new THREE.Vector4(99, 99, 0, 0) },
    uGlowB: { value: new THREE.Vector4(99, 99, 0, 0) },
    uSelect: { value: 0 },
    // photo texture layers (realistic asset pack); off until the pack arrives
    uTexOn: { value: 0 },
    uLayers: { value: placeholderLayers() },
    uLayersN: { value: placeholderLayers(true) },
    uLayerMean: { value: Array.from({ length: LAYER_COUNT }, () => new THREE.Vector3(0.5, 0.5, 0.5)) },
    // high-resolution rock (triplanar on steep mountain and hill faces)
    uRockOn: { value: 0 },
    uRock: { value: placeholder2D() },
    uRockN: { value: placeholder2D(true) },
  };

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aW0; attribute vec3 aW1; attribute float aCoast; attribute float aAO;
varying vec3 vW0; varying vec3 vW1; varying float vCoast; varying float vAO; varying vec3 vWPos; varying vec3 vWNrm;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vW0 = aW0; vW1 = aW1; vCoast = aCoast; vAO = aAO;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = terrainAlbedo();')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  if (uTexOn > 0.5 && (gDetailK > 0.001 || gRockK > 0.001)) {
    vec3 wn = normalize(vWNrm);
    vec3 nW = wn;
    if (gDetailK > 0.001) {
      vec3 tn = texture(uLayersN, vec3(vWPos.xz * gDetailS, gDetailL)).xyz * 2.0 - 1.0;
      nW = normalize(wn + vec3(tn.x, 0.0, -tn.y) * gDetailK);
    }
    if (gRockK > 0.001) nW = normalize(mix(nW, rockTriN(vWPos, wn, ROCK_S), gRockK));
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }`,
      )
      .replace('#include <fog_fragment>', TERRAIN_FRAG_POST + '\n#include <fog_fragment>');
  };
  mat.customProgramCacheKey = () => 'catan-terrain-v6';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';

  function setRock(t) {
    if (!t || !t.d || !t.n) return;
    uniforms.uRock.value = t.d;
    uniforms.uRockN.value = t.n;
    uniforms.uRockOn.value = 1;
  }

  function setLayers(tex) {
    if (!tex) {
      uniforms.uTexOn.value = 0;
      return;
    }
    uniforms.uLayers.value = tex.albedo;
    uniforms.uLayersN.value = tex.normal;
    tex.layers.forEach((l, i) => {
      if (i < LAYER_COUNT) uniforms.uLayerMean.value[i].set(l.mean[0], l.mean[1], l.mean[2]);
    });
    uniforms.uTexOn.value = 1;
  }

  return { mesh, uniforms, heightAt, coastAt, weightsAt, slopeAt, heightTex, hexTex, hexData, hexSlot, N, step, setLayers, setRock };
}

// layer order must match the asset pack's terrain manifest
export const LAYER_COUNT = 13;
function placeholder2D(normal) {
  const t = new THREE.DataTexture(normal ? new Uint8Array([128, 128, 255, 255]) : new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}
function placeholderLayers(normal) {
  const d = normal ? new Uint8Array([128, 128, 255, 255]) : new Uint8Array([128, 128, 128, 255]);
  const t = new THREE.DataArrayTexture(d, 1, 1, 1);
  t.needsUpdate = true;
  return t;
}

export function hexCenterWorld(id) {
  const h = GEO.hexes[id];
  return axialToWorld(h.q, h.r);
}

const TERRAIN_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uPaper;
uniform float uPolitical;
uniform float uProduction;
uniform float uResource;
uniform float uCloud;
uniform float uZoom;
uniform vec3 uSunDir;
uniform sampler2D uTerritory;
uniform sampler2D uBorder;
uniform sampler2D uHexTex;
uniform vec4 uHexWin;
uniform vec4 uDomain;
uniform vec2 uRobber;
uniform vec4 uHover;
uniform vec4 uGlowA;
uniform vec4 uGlowB;
uniform float uSelect;
uniform float uTexOn;
uniform mediump sampler2DArray uLayers;
uniform mediump sampler2DArray uLayersN;
uniform vec3 uLayerMean[${LAYER_COUNT}];
varying vec3 vW0;
varying vec3 vW1;
varying float vCoast;
varying float vAO;
varying vec3 vWPos;
varying vec3 vWNrm;
${GLSL_NOISE}
const float HS = 10.0;
const float SQ3 = 1.7320508;
vec2 axialOf(vec2 p) {
  float qf = (SQ3 / 3.0 * p.x - p.y / 3.0) / HS;
  float rf = (2.0 / 3.0 * p.y) / HS;
  vec3 c = vec3(qf, -qf - rf, rf);
  vec3 rc = floor(c + 0.5);
  vec3 d = abs(rc - c);
  if (d.x > d.y && d.x > d.z) rc.x = -rc.y - rc.z;
  else if (d.y > d.z) rc.y = -rc.x - rc.z;
  else rc.z = -rc.x - rc.y;
  return vec2(rc.x, rc.z);
}
vec2 hexCenter(vec2 qr) { return vec2(HS * SQ3 * (qr.x + qr.y * 0.5), HS * 1.5 * qr.y); }
float hexInner(vec2 d) { vec2 a = abs(d); return HS * 0.8660254 - max(a.x, 0.5 * a.x + 0.8660254 * a.y); }
vec4 hexData(vec2 qr) {
  ivec2 c = ivec2(int(qr.x) - int(uHexWin.x), int(qr.y) - int(uHexWin.y));
  if (c.x < 0 || c.y < 0 || c.x >= int(uHexWin.z) || c.y >= int(uHexWin.w)) return vec4(0.0);
  return texelFetch(uHexTex, c, 0);
}
bool sameHex(vec2 a, vec2 b) { return abs(a.x - b.x) < 0.5 && abs(a.y - b.y) < 0.5; }
vec3 toLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// ── photo layers ──
const float L_LEAVES = 0.0;
const float L_FGROUND = 1.0;
const float L_LATERITE = 2.0;
const float L_LEAFY = 3.0;
const float L_SPARSE = 4.0;
const float L_MUD = 5.0;
const float L_DIRT = 6.0;
const float L_ROCKFACE = 7.0;
const float L_SCREE = 8.0;
const float L_SAND = 9.0;
const float L_COAST = 10.0;
const float L_MOSSGRASS = 11.0;
const float L_CLIFF = 12.0;
// strongest layer of this pixel drives the detail normal
float gDetailL = 0.0;
float gDetailS = 0.3;
float gDetailK = 0.0;
float gDetailW = 0.0;
void detailFrom(float L, float s, float k, float w) {
  if (w > gDetailW) { gDetailW = w; gDetailL = L; gDetailS = s; gDetailK = k; }
}
// ── triplanar rock (sRGB texture sampled as linear: brought back to the palette's space) ──
uniform float uRockOn;
uniform sampler2D uRock;
uniform sampler2D uRockN;
const float ROCK_S = 0.17;
const vec3 ROCK_MEAN = vec3(0.513, 0.412, 0.315);
float gRockK = 0.0;
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec3 rockTri(vec3 p, vec3 n, float s) {
  vec3 w = triW(n);
  vec3 c = texture2D(uRock, p.zy * s).rgb * w.x + texture2D(uRock, p.xz * s).rgb * w.y + texture2D(uRock, p.xy * s).rgb * w.z;
  // a second, rotated and larger projection breaks up the repeats
  vec3 q = vec3(p.x * 0.8 - p.z * 0.6, p.y, p.x * 0.6 + p.z * 0.8) * 0.37 + 0.21;
  vec3 c2 = texture2D(uRock, q.zy * s).rgb * w.x + texture2D(uRock, q.xz * s).rgb * w.y + texture2D(uRock, q.xy * s).rgb * w.z;
  c *= mix(1.0, dot(c2, vec3(0.333)) / 0.2, 0.55);
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}
// whiteout-blended triplanar normal (world space)
vec3 rockTriN(vec3 p, vec3 n, float s) {
  vec3 w = triW(n);
  vec3 tx = texture2D(uRockN, p.zy * s).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(uRockN, p.xz * s).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(uRockN, p.xy * s).xyz * 2.0 - 1.0;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}

// two rotated scales: the fine one carries the detail, the coarse one breaks up the tiling
vec3 tex2(float L, vec2 p, float s) {
  vec3 a = texture(uLayers, vec3(p * s, L)).rgb;
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * (s * 0.29) + 0.37;
  vec3 b = texture(uLayers, vec3(q, L)).rgb;
  vec3 m = uLayerMean[int(L)];
  return a * mix(1.0, dot(b, vec3(0.333)) / max(dot(m, vec3(0.333)), 0.04), 0.6);
}
// pull a photo layer towards the board's palette colour (k = how far) but keep its detail
vec3 tintTo(vec3 c, float L, vec3 target, float k) {
  return c * mix(vec3(1.0), target / max(uLayerMean[int(L)], vec3(0.03)), k);
}

vec3 forestCol(vec2 p, float n1, float w) {
  vec3 c = mix(vec3(0.15, 0.24, 0.10), vec3(0.24, 0.33, 0.14), n1);
  float moss = smoothstep(0.55, 0.8, fbm2(p * 0.7));
  c = mix(c, vec3(0.30, 0.29, 0.15), moss * 0.35);
  if (uTexOn > 0.5) {
    float f = smoothstep(0.3, 0.7, fbm2(p * 0.12 + 4.0));
    vec3 t = mix(tintTo(tex2(L_LEAVES, p, 0.34), L_LEAVES, c, 0.78), tintTo(tex2(L_FGROUND, p, 0.3), L_FGROUND, c * 1.08, 0.72), f);
    c = t;
    detailFrom(f > 0.5 ? L_FGROUND : L_LEAVES, f > 0.5 ? 0.3 : 0.34, 0.55, w);
  }
  return c;
}
vec3 pastureCol(vec2 p, float n1, float w) {
  vec3 c = mix(vec3(0.38, 0.57, 0.24), vec3(0.52, 0.69, 0.30), n1);
  float pt = smoothstep(0.45, 0.78, fbm2(p * 0.22 + 3.1));
  c = mix(c, vec3(0.32, 0.50, 0.21), pt * 0.55);
  if (uTexOn > 0.5) {
    vec3 a = tintTo(tex2(L_LEAFY, p, 0.38), L_LEAFY, c, 0.72);
    vec3 b = tintTo(tex2(L_SPARSE, p, 0.42), L_SPARSE, c * 0.92, 0.7);
    c = mix(a, b, pt * 0.7);
    detailFrom(L_LEAFY, 0.38, 0.45, w);
  }
  return c;
}
vec3 fieldsCol(vec2 p, vec2 hc, float hseed, float w) {
  float ang = hseed * 3.14159;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = mat2(ca, -sa, sa, ca) * (p - hc);
  vec2 cs = vec2(4.4, 3.1);
  vec2 cell = floor(q / cs);
  vec2 f = fract(q / cs);
  float h = hash12(cell + hseed * 17.0);
  vec3 c;
  if (h < 0.32) c = vec3(0.86, 0.71, 0.30);
  else if (h < 0.58) c = vec3(0.77, 0.60, 0.23);
  else if (h < 0.76) c = vec3(0.60, 0.64, 0.27);
  else if (h < 0.88) c = vec3(0.52, 0.40, 0.24);
  else c = vec3(0.91, 0.80, 0.42);
  float dir = step(0.5, hash12(cell + 3.7));
  float sv = dir > 0.5 ? f.x * cs.x : f.y * cs.y;
  float stripe = 0.5 + 0.5 * sin(sv * 10.0);
  vec3 hedgeC = vec3(0.30, 0.40, 0.17);
  if (uTexOn > 0.5) {
    // crops: grass stubble tinted gold/green; ploughed patches show the soil
    float L = h < 0.76 ? (h < 0.58 ? L_SPARSE : L_LEAFY) : (h < 0.88 ? L_MUD : L_DIRT);
    float k = h < 0.76 ? 0.9 : 0.55;
    c = tintTo(tex2(L, p, 0.45), L, c, k);
    hedgeC = tintTo(tex2(L_MOSSGRASS, p, 0.5), L_MOSSGRASS, hedgeC, 0.6);
    detailFrom(L, 0.45, 0.35, w);
  }
  c *= 0.93 + 0.12 * stripe * (1.0 - uZoom);
  float edge = min(min(f.x, 1.0 - f.x) * cs.x, min(f.y, 1.0 - f.y) * cs.y);
  edge += (fbm2(p * 2.3) - 0.5) * 0.09;
  float hedge = 1.0 - smoothstep(0.03, 0.11 + uZoom * 0.16, edge);
  return mix(c, hedgeC * 1.15, hedge * 0.62);
}
vec3 hillsCol(vec2 p, float h, float slope, float n1, float w) {
  // red laterite country: rusty orange earth, darker and wetter in the hollows and gullies,
  // stony and sun-bleached on the crests, rills running down the slopes, patchy dry grass,
  // and raw red rock where the ground steepens
  float crest = smoothstep(0.99, 1.07, vAO);
  float hollow = smoothstep(0.97, 0.86, vAO);
  float big = fbm2(p * 0.11 + 2.3);
  vec3 c = mix(vec3(0.46, 0.17, 0.065), vec3(0.64, 0.29, 0.1), big);
  c = mix(c, vec3(0.7, 0.42, 0.21), crest * 0.5);
  c = mix(c, vec3(0.3, 0.1, 0.045), hollow * 0.55);
  float dry = smoothstep(0.57, 0.7, fbm2(p * 0.65 + 7.0) + 0.22 * hollow - 0.25 * crest);
  float stony = smoothstep(0.45, 0.62, fbm2(p * 0.42 + 3.3) + 0.3 * crest - 0.2 * hollow);
  float st = smoothstep(0.26, 0.52, slope);
  if (uTexOn > 0.5) {
    vec3 soilA = tintTo(tex2(L_LATERITE, p, 0.5), L_LATERITE, c, 0.4);
    vec3 soilB = tintTo(tex2(L_LATERITE, p * 0.31 + 1.7, 0.5), L_LATERITE, c * 0.88, 0.4);
    vec3 soil = mix(soilA, soilB, smoothstep(0.3, 0.7, fbm2(p * 0.23 + 5.3)) * 0.55);
    // gravel: the grey scree photo stained red reads as stones at board scale
    vec3 gravel = tintTo(tex2(L_SCREE, p, 0.26), L_SCREE, c * 1.08, 0.82);
    soil = mix(soil, gravel, stony * 0.62);
    vec3 cliff;
    if (uRockOn > 0.5) {
      cliff = rockTri(vWPos, normalize(vWNrm), ROCK_S) * mix(vec3(1.0), vec3(0.52, 0.24, 0.12) / ROCK_MEAN, 0.75);
      gRockK = max(gRockK, st * w * 0.9);
    } else {
      cliff = tintTo(tex2(L_CLIFF, p + vec2(0.0, h * 2.0), 0.3), L_CLIFF, vec3(0.5, 0.23, 0.12), 0.5);
    }
    c = mix(soil, cliff, st);
    vec3 grass = tintTo(tex2(L_SPARSE, p, 0.5), L_SPARSE, vec3(0.4, 0.36, 0.15), 0.6);
    c = mix(c, grass, dry * 0.7 * (1.0 - st));
    detailFrom(st > 0.5 ? L_CLIFF : (stony > 0.5 ? L_SCREE : (dry > 0.5 ? L_SPARSE : L_LATERITE)), st > 0.5 ? 0.3 : (stony > 0.5 ? 0.26 : 0.5), 0.95, w);
  } else {
    c = mix(c, vec3(0.38, 0.36, 0.17), dry * 0.6);
  }
  // rills: thin runnels down the fall line of the slopes
  vec2 fall = vWNrm.xz / max(length(vWNrm.xz), 1e-4);
  float rl = sin(dot(p, vec2(-fall.y, fall.x)) * 7.0 + fbm2(p * 0.9) * 7.0);
  float rill = smoothstep(0.8, 0.99, rl) * smoothstep(0.1, 0.3, slope) * (1.0 - st) * (1.0 - dry * 0.7);
  c *= 1.0 - 0.32 * rill;
  // bedding lines only where rock is bared
  float tr = abs(fract(h * 1.4) - 0.5);
  c *= mix(1.0, 0.86 + 0.14 * smoothstep(0.0, 0.15, tr), st);
  // clay diggings: ragged patches of fresh, wetter clay on the gentler ground
  float dig = smoothstep(0.66, 0.74, fbm2(p * 0.16 + 13.0) + 0.08 * fbm2(p * 1.3));
  float gentle = 1.0 - smoothstep(0.2, 0.45, slope);
  c = mix(c, c * vec3(1.15, 0.82, 0.66), dig * gentle * 0.7);
  c *= 1.0 - 0.18 * (smoothstep(0.62, 0.66, fbm2(p * 0.16 + 13.0) + 0.08 * fbm2(p * 1.3)) - dig) * gentle;
  return c;
}
vec3 mountainCol(vec2 p, float h, float slope, float n1, float w) {
  vec3 rock = mix(vec3(0.35, 0.34, 0.33), vec3(0.53, 0.51, 0.48), n1);
  float strata = 0.5 + 0.5 * sin(h * 2.6 + fbm2(p * 0.3) * 3.0);
  rock *= 0.84 + 0.2 * strata;
  vec3 low = vec3(0.33, 0.42, 0.22);
  float up = smoothstep(1.1, 3.0, h + n1 * 0.8);
  float st = smoothstep(0.3, 0.68, slope);
  if (uTexOn > 0.5) {
    vec3 scree = tintTo(tex2(L_SCREE, p, 0.36), L_SCREE, rock * 1.05, 0.45);
    vec3 face;
    if (uRockOn > 0.5) {
      face = rockTri(vWPos, normalize(vWNrm), ROCK_S) * mix(vec3(1.0), rock * 0.95 / ROCK_MEAN, 0.72);
      gRockK = max(gRockK, mix(0.35, 1.0, st) * up * w);
    } else {
      face = tintTo(tex2(L_ROCKFACE, vec2(p.x + p.y * 0.3, h * 1.3 + p.y * 0.2), 0.28), L_ROCKFACE, rock * 0.92, 0.55);
    }
    rock = mix(scree, face, max(st, 0.35 * uRockOn));
    low = tintTo(tex2(L_MOSSGRASS, p, 0.42), L_MOSSGRASS, low, 0.55);
    detailFrom(up < 0.5 ? L_MOSSGRASS : L_SCREE, 0.36, 0.75 * (1.0 - st), w);
  }
  vec3 c = mix(low, rock, up);
  // snow settles on ledges and gentle slopes high up; bare rock shows on the steep faces
  float snowLine = smoothstep(4.7, 5.9, h + (n1 - 0.5) * 1.6);
  float snow = snowLine * (1.0 - smoothstep(0.42, 0.72, slope + (fbm2(p * 1.7) - 0.5) * 0.25));
  return mix(c, vec3(0.87, 0.89, 0.93), snow);
}
vec3 desertCol(vec2 p, float n1, float w) {
  vec3 c = mix(vec3(0.79, 0.66, 0.44), vec3(0.88, 0.77, 0.53), n1);
  float rip = 0.5 + 0.5 * sin(dot(p, vec2(0.8, 0.6)) * 3.2 + fbm2(p * 0.25) * 5.0);
  float rocks = smoothstep(0.64, 0.72, fbm2(p * 0.4 + 2.0));
  vec3 rc = vec3(0.60, 0.46, 0.31);
  if (uTexOn > 0.5) {
    c = tintTo(tex2(L_SAND, p, 0.4), L_SAND, c, 0.6);
    rc = tintTo(tex2(L_CLIFF, p, 0.35), L_CLIFF, rc, 0.4);
    detailFrom(rocks > 0.5 ? L_CLIFF : L_SAND, 0.4, 0.5, w);
  }
  c *= 0.94 + 0.08 * rip * (1.0 - uZoom);
  return mix(c, rc, rocks * 0.5);
}

vec3 terrainAlbedo() {
  vec2 p = vWPos.xz;
  float h = vWPos.y;
  float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
  float n1 = fbm4(p * 0.09);
  vec2 qr = axialOf(p);
  vec2 hc = hexCenter(qr);
  float hseed = hash12(qr + 7.31);
  vec3 col = vec3(0.0);
  float ws = 0.0;
  if (vW0.x > 0.004) { col += vW0.x * forestCol(p, n1, vW0.x); ws += vW0.x; }
  if (vW0.y > 0.004) { col += vW0.y * hillsCol(p, h, slope, n1, vW0.y); ws += vW0.y; }
  if (vW0.z > 0.004) { col += vW0.z * pastureCol(p, n1, vW0.z); ws += vW0.z; }
  if (vW1.x > 0.004) { col += vW1.x * fieldsCol(p, hc, hseed, vW1.x); ws += vW1.x; }
  if (vW1.y > 0.004) { col += vW1.y * mountainCol(p, h, slope, n1, vW1.y); ws += vW1.y; }
  if (vW1.z > 0.004) { col += vW1.z * desertCol(p, n1, vW1.z); ws += vW1.z; }
  col = ws > 0.0 ? col / ws : vec3(0.76, 0.70, 0.52);

  // (Seafarers) gold fields: golden gravel with glittering veins
  if (abs(hexData(qr).r * 255.0 / 32.0 - 7.0) < 0.5) {
    float gm = smoothstep(0.0, 2.2, hexInner(p - hc));
    float vein = smoothstep(0.6, 0.78, fbm2(p * 0.9 + 3.0));
    vec3 gc = mix(vec3(0.66, 0.5, 0.2), vec3(0.93, 0.78, 0.33), fbm2(p * 0.35 + 1.7));
    gc = mix(gc, vec3(1.0, 0.92, 0.55), vein * 0.85);
    gc *= 0.86 + 0.2 * smoothstep(0.3, 0.9, fbm2(p * 2.4));
    col = mix(col, gc, gm * 0.9);
  }

  // beaches & seabed
  float beach = smoothstep(0.6, 0.32, h) * smoothstep(-6.0, -1.4, vCoast);
  vec3 sand = mix(vec3(0.86, 0.79, 0.58), vec3(0.93, 0.87, 0.68), fbm2(p * 0.8));
  if (uTexOn > 0.5) {
    sand = tintTo(tex2(L_COAST, p, 0.42), L_COAST, sand, 0.62);
    detailFrom(L_COAST, 0.42, 0.5, beach * 1.5);
  }
  col = mix(col, sand, clamp(beach, 0.0, 1.0));
  gDetailK *= (1.0 - uZoom) * step(0.0, h);
  float wet = smoothstep(0.22, 0.05, h) * smoothstep(-4.5, -0.6, vCoast);
  col = mix(col, vec3(0.62, 0.56, 0.40), wet * 0.6);
  if (h < 0.0) col = mix(vec3(0.62, 0.58, 0.42), vec3(0.20, 0.30, 0.32), smoothstep(0.0, -6.0, h));

  col *= mix(1.0, vAO, 0.85);

  // province (hex) borders
  float ed = hexInner(p - hc);
  float bl = 1.0 - smoothstep(0.0, 0.16 + uZoom * 0.35, ed);
  col = mix(col, col * 0.6, bl * 0.5 * (1.0 - uPaper) * step(0.0, h));

  // robber occupation hatching
  if (sameHex(qr, uRobber)) {
    float hatch = step(0.5, fract((p.x - p.y) * 0.32));
    float inner = smoothstep(0.0, 1.2, ed);
    float g = dot(col, vec3(0.333));
    col = mix(col, vec3(g) * vec3(0.78, 0.66, 0.62), inner * 0.55);
    col = mix(col, vec3(0.18, 0.08, 0.06), inner * hatch * 0.22);
  }
  // production glow
  if (sameHex(qr, uGlowA.xy) && uGlowA.z > 0.0) {
    float ring = 1.0 - smoothstep(0.0, 2.6, ed);
    col += vec3(1.0, 0.80, 0.42) * uGlowA.z * (0.18 + ring * 0.9);
  }
  if (sameHex(qr, uGlowB.xy) && uGlowB.z > 0.0) {
    float ring = 1.0 - smoothstep(0.0, 2.6, ed);
    col += vec3(1.0, 0.80, 0.42) * uGlowB.z * (0.18 + ring * 0.9);
  }
  // robber target selection
  vec4 hd = hexData(qr);
  if (uSelect > 0.0 && hd.a > 0.5) {
    // selectable hex: crisp white rim with a dark inner line, readable on fields and sand alike
    float rim = 1.0 - smoothstep(0.0, 0.9, ed);
    float inner = (1.0 - smoothstep(0.9, 1.5, ed)) * smoothstep(0.75, 0.95, ed);
    float pulse = 0.65 + 0.35 * sin(uTime * 4.0);
    col = mix(col, vec3(0.98, 0.97, 0.94), rim * uSelect * pulse);
    col = mix(col, vec3(0.06, 0.05, 0.04), inner * uSelect * 0.7);
  }
  if (sameHex(qr, uHover.xy) && uHover.z > 0.0) {
    float ring = 1.0 - smoothstep(0.0, 1.8, ed);
    col = mix(col * (1.0 + 0.22 * uHover.z), vec3(1.0, 0.92, 0.6), ring * uHover.z * 0.9);
  }

  // drifting cloud shadows
  if (uCloud > 0.001) {
    float cs = smoothstep(0.5, 0.72, cloudField(p - uSunDir.xz * 25.0, uTime));
    col *= 1.0 - 0.32 * cs * uCloud;
  }
  return toLin(col);
}
`;

const TERRAIN_FRAG_POST = /* glsl */ `
{
  vec2 p = vWPos.xz;
  vec2 tuv = (p - uDomain.xy) / uDomain.zw;
  vec4 terr = texture2D(uTerritory, tuv);
  float bord = texture2D(uBorder, tuv).r;
  float land = smoothstep(0.02, 0.14, vWPos.y);
  vec3 c = gl_FragColor.rgb;
  vec2 qr = axialOf(p);
  vec4 hd = hexData(qr);
  float ed = hexInner(p - hexCenter(qr));
  float isLand = step(0.5, hd.b);

  if (uPaper > 0.001) {
    float lam = clamp(dot(normalize(vWNrm), normalize(uSunDir)), 0.0, 1.0);
    float shade = 0.64 + 0.38 * lam;
    float grain = 0.93 + 0.07 * fbm2(p * 0.55);
    vec3 parch = toLin(vec3(0.84, 0.78, 0.64)) * grain;
    // a strategy-map colour per terrain, strong enough to tell every province apart from far away:
    // forest deep green, hills terracotta, pasture fresh green, fields wheat gold, mountains slate, desert sand
    vec3 tint = vW0.x * vec3(0.27, 0.45, 0.25) + vW0.y * vec3(0.80, 0.45, 0.28) + vW0.z * vec3(0.58, 0.79, 0.36)
              + vW1.x * vec3(0.95, 0.78, 0.30) + vW1.y * vec3(0.55, 0.57, 0.63) + vW1.z * vec3(0.91, 0.83, 0.62);
    float tw = vW0.x + vW0.y + vW0.z + vW1.x + vW1.y + vW1.z;
    // (picked as display colours: this pass works in linear light)
    tint = tw > 0.01 ? toLin(tint / tw) * grain : parch;
    if (abs(hd.r * 255.0 / 32.0 - 7.0) < 0.5) tint = toLin(vec3(0.96, 0.78, 0.28)) * grain;
    vec3 paper = mix(parch, tint, 0.94) * shade;
    float stip = step(0.86, hash12(floor(p * 1.7))) * vW0.x;
    paper = mix(paper, vec3(0.30, 0.38, 0.24), stip * 0.45);
    float pl = 1.0 - smoothstep(0.0, 0.32, ed);
    paper = mix(paper, vec3(0.43, 0.32, 0.21), pl * 0.6 * isLand);
    c = mix(c, paper, uPaper * land);
  }

  float pol = max(uPolitical, uPaper * 0.4);
  float fillA = terr.a * land * (0.10 + 0.48 * pol);
  c = mix(c, terr.rgb, fillA);
  float bw = smoothstep(mix(0.5, 0.28, uZoom), mix(0.9, 0.62, uZoom), bord);
  float bA = bw * land * mix(0.5, 0.92, max(pol, uZoom));
  c = mix(c, mix(terr.rgb, terr.rgb * 0.42, 0.45 + 0.55 * max(pol, uPaper)), bA);

  if (uProduction > 0.001) {
    float pp = hd.g * 5.0;
    vec3 heat = pp < 0.5 ? vec3(0.42, 0.40, 0.36) : mix(vec3(0.20, 0.45, 0.80), vec3(0.96, 0.30, 0.12), clamp((pp - 1.0) / 4.0, 0.0, 1.0));
    if (pp > 4.5) heat = vec3(0.86, 0.12, 0.10);
    float g = dot(c, vec3(0.333));
    vec3 m = mix(vec3(g), heat, 0.78);
    m = mix(m, vec3(0.10), (1.0 - smoothstep(0.0, 0.35, ed)) * 0.8);
    c = mix(c, m, uProduction * land * isLand);
  }
  if (uResource > 0.001) {
    float tid = floor(hd.r * 255.0 / 32.0 + 0.5);
    vec3 rc = vec3(0.6);
    if (tid == 1.0) rc = vec3(0.17, 0.43, 0.20);
    else if (tid == 2.0) rc = vec3(0.74, 0.34, 0.18);
    else if (tid == 3.0) rc = vec3(0.58, 0.80, 0.33);
    else if (tid == 4.0) rc = vec3(0.92, 0.76, 0.26);
    else if (tid == 5.0) rc = vec3(0.52, 0.53, 0.56);
    else if (tid == 6.0) rc = vec3(0.86, 0.77, 0.55);
    else if (tid == 7.0) rc = vec3(0.98, 0.8, 0.2);
    float g = dot(c, vec3(0.333));
    vec3 m = mix(vec3(g), rc, 0.8) * (0.85 + 0.3 * g);
    m = mix(m, vec3(0.10), (1.0 - smoothstep(0.0, 0.35, ed)) * 0.8);
    c = mix(c, m, uResource * land * isLand);
  }
  gl_FragColor.rgb = c;
}
`;
