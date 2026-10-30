// Loads the realistic asset pack published next to the page (assets/…): photo-scanned plant
// impostors, terrain texture layers, rocks/cliffs and animated farm animals (all CC0).
// One shared promise per page; resolves to null when the pack is missing so the procedural
// scenery simply stays.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bakeAnimal } from './animals.js';
import { rockParts } from './rocks.js';

// give the page a breath between heavy steps (keeps input and networking responsive)
const breathe = () => new Promise((r) => setTimeout(r, 0));

// The loader can be held (online lobbies and quick match): it finishes the step it is on, then
// waits, so decoding and baking never stall the page while it is talking to a room.
let held = false;
let waiters = [];
export function holdAssetLoading(on) {
  held = !!on;
  if (!held) {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  }
}
const gate = () => (held ? new Promise((r) => waiters.push(r)) : Promise.resolve());
const ANIMAL_SIZE = { sheep: 0.62, cow: 0.92, horse: 0.98, pig: 0.56 };
// cliffs and boulders are toned towards the island's grey-brown rock so they sit in the terrain
const ROCK_TONE = { rock_face_01: [0.78, 0.76, 0.74], rock_face_02: [0.8, 0.78, 0.76], namaqualand_boulder_02: [0.95, 0.9, 0.86] };

const BASE = 'assets/';
let promise = null;
const listeners = new Set();
export const assetStatus = { progress: 0, done: false, failed: false, pack: null };

export function onAssetProgress(fn) {
  listeners.add(fn);
  fn(assetStatus);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn(assetStatus);
}

async function bitmap(buf, type, half = false) {
  const blob = new Blob([buf], { type });
  try {
    const opts = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
    if (half) {
      const full = await createImageBitmap(blob, opts);
      if (full.width < 1024) return full;
      const small = await createImageBitmap(full, { ...opts, resizeWidth: full.width / 2, resizeHeight: full.height / 2, resizeQuality: 'high' });
      full.close();
      return small;
    }
    return await createImageBitmap(blob, opts);
  } catch {
    // older engines: fall back to an <img>
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

// quantized or interleaved glTF attributes (normalized integers + a dequantizing node transform) → plain floats
function floatAttr(attr) {
  if (!attr || (!attr.isInterleavedBufferAttribute && attr.array instanceof Float32Array && !attr.normalized)) return attr;
  const n = attr.count;
  const k = attr.itemSize;
  const out = new Float32Array(n * k);
  const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = get[c].call(attr, i);
  return new THREE.BufferAttribute(out, k);
}

function texture2D(img, srgb) {
  const t = new THREE.Texture(img);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

let scratch = null;
function pixels(img, size) {
  if (!scratch) {
    scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
  }
  scratch.width = size;
  scratch.height = size;
  const g = scratch.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, size, size);
  g.drawImage(img, 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

async function arrayTexture(imgs, size) {
  const data = new Uint8Array(size * size * 4 * imgs.length);
  for (let i = 0; i < imgs.length; i++) {
    await gate();
    data.set(pixels(imgs[i], size), i * size * size * 4);
    if (i % 3 === 2) await breathe();
  }
  const t = new THREE.DataArrayTexture(data, size, size, imgs.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.NoColorSpace; // sampled as stored (sRGB-ish values), mixed with the procedural palette
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function loadAssets(quality = 'high') {
  if (promise) return promise;
  promise = (async () => {
    if (typeof window !== 'undefined' && window.__noAssets) throw new Error('disabled for this test run');
    const man = await fetch(BASE + 'manifest.json').then((r) => {
      if (!r.ok) throw new Error('no asset manifest');
      return r.json();
    });
    const sizes = new Map(man.files.map((f) => [f.path, f.bytes]));
    const total = man.files.reduce((s, f) => s + f.bytes, 0) || 1;
    let done = 0;
    const get = async (path) => {
      const r = await fetch(BASE + path);
      if (!r.ok) throw new Error('asset ' + path + ' ' + r.status);
      const b = await r.arrayBuffer();
      done += sizes.get(path) || b.byteLength;
      assetStatus.progress = Math.min(0.99, done / total);
      emit();
      return b;
    };
    // the glTFs carry no embedded images and no meshopt data: nothing here needs blob: URLs or WebAssembly
    const loader = new GLTFLoader();
    // binary glTF arrives base64-wrapped in JSON (the page host serves web types only)
    const glb = async (path) => {
      const raw = await get(path);
      await gate();
      const { glb: b64 } = JSON.parse(new TextDecoder().decode(raw));
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return loader.parseAsync(bytes.buffer, BASE + path.replace(/[^/]*$/, ''));
    };
    const tex = async (path, srgb) => {
      const raw = await get(path);
      await gate();
      return texture2D(await bitmap(raw, 'image/webp'), srgb);
    };

    // plants
    const impJobs = Object.entries(man.impostors).map(async ([name, meta]) => {
      const [c, n] = await Promise.all([get(`imp/${name}.webp`), get(`imp/${name}_n.webp`)]);
      // phones get half-resolution plant atlases
      const half = quality === 'low';
      const [ci, ni] = await Promise.all([bitmap(c, 'image/webp', half), bitmap(n, 'image/webp', half)]);
      return [name, { name, meta: { ...meta, size: ci.width || meta.size }, color: texture2D(ci, true), normal: texture2D(ni, false) }];
    });
    // terrain layers
    const layers = man.terrain.layers;
    const tsize = quality === 'low' ? 256 : quality === 'medium' ? 512 : 1024;
    const nsize = quality === 'low' ? 128 : quality === 'medium' ? 256 : 512;
    const terrJob = (async () => {
      const imgs = await Promise.all(
        layers.map(async (l) => {
          const [a, n] = await Promise.all([get(`terrain/${l.name}.webp`), get(`terrain/${l.name}_n.webp`)]);
          return Promise.all([bitmap(a, 'image/webp'), bitmap(n, 'image/webp')]);
        }),
      );
      const albedo = await arrayTexture(
        imgs.map((p) => p[0]),
        tsize,
      );
      const normal = await arrayTexture(
        imgs.map((p) => p[1]),
        nsize,
      );
      return { albedo, normal, layers: layers.map((l, i) => ({ ...l, index: i })) };
    })();
    const rockJobs = man.rocks.map(async (r) => {
      const [gltf, d, n, mr] = await Promise.all([
        glb(`rocks/${r.slug}.json`),
        r.tex.d ? tex(`rocks/${r.tex.d}`, true) : null,
        r.tex.n ? tex(`rocks/${r.tex.n}`, false) : null,
        r.tex.mr ? tex(`rocks/${r.tex.mr}`, false) : null,
      ]);
      return [r.slug, { ...r, gltf, maps: { d, n, mr } }];
    });
    const animalJobs = man.animals.map(async (a) => [a.name, { ...a, gltf: await glb(`animals/${a.name}.json`) }]);
    // buildings, harbor kit, ships, props: geometry parts by node name + baked atlas maps
    const half = quality === 'low';
    const map = async (path, srgb) => {
      const raw = await get(path);
      await gate();
      return texture2D(await bitmap(raw, 'image/webp', half), srgb);
    };
    const modelJobs = (man.models || []).map(async (md) => {
      const [gltf, d, m, n] = await Promise.all([
        glb(`models/${md.name}.json`),
        map(`models/${md.maps.d}`, true),
        map(`models/${md.maps.m}`, false),
        md.maps.n ? map(`models/${md.maps.n}`, false) : null,
      ]);
      const parts = {};
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry;
        for (const a of ['position', 'normal', 'uv']) if (g.attributes[a]) g.setAttribute(a, floatAttr(g.attributes[a]));
        if (!o.matrixWorld.equals(new THREE.Matrix4())) g.applyMatrix4(o.matrixWorld);
        g.computeBoundingBox();
        g.computeBoundingSphere();
        parts[o.name] = g;
      });
      return { ...md, parts, maps: { d, m, n } };
    });
    const tileJobs = (man.tiles || []).map(async (t) => {
      const out = { name: t.name };
      await Promise.all(
        Object.entries(t.maps).map(async ([k, f]) => {
          const tx = await map(`tex/${f}`, k === 'd');
          tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
          tx.anisotropy = 8;
          out[k] = tx;
        }),
      );
      return out;
    });

    const [imp, terrain, rocks, animals, modelList, tileList] = await Promise.all([
      Promise.all(impJobs),
      terrJob,
      Promise.all(rockJobs),
      Promise.all(animalJobs),
      Promise.all(modelJobs),
      Promise.all(tileJobs),
    ]);
    const models = { houses: {}, ships: {} };
    for (const md of modelList) {
      if (md.group) models[md.group][md.name] = md;
      else models[md.name] = md;
    }
    for (const t of tileList) models[t.name] = t;
    if (!Object.keys(models.houses).length) models.houses = null;
    if (!Object.keys(models.ships).length) models.ships = null;
    const pack = {
      imp: Object.fromEntries(imp),
      terrain,
      rocks: Object.fromEntries(rocks),
      animals: Object.fromEntries(animals),
      models,
      credits: man.credits,
      parts: {},
      baked: {},
    };
    // ready-to-instance rock meshes and vertex-animation bakes, one at a time
    for (const [slug, r] of Object.entries(pack.rocks)) {
      await gate();
      pack.parts[slug] = rockParts(r.gltf, ROCK_TONE[slug] ? new THREE.Color().setRGB(...ROCK_TONE[slug]) : null, r.maps);
      await breathe();
    }
    for (const [name, a] of Object.entries(pack.animals)) {
      await gate();
      try {
        pack.baked[name] = bakeAnimal(name, a.gltf, { length: ANIMAL_SIZE[name] || 0.7 });
      } catch (e) {
        console.warn('[assets] could not bake', name, e);
      }
      await breathe();
    }
    assetStatus.pack = pack;
    assetStatus.progress = 1;
    assetStatus.done = true;
    emit();
    return pack;
  })().catch((e) => {
    console.warn('[assets] realistic asset pack unavailable, keeping procedural scenery:', e && e.message);
    assetStatus.failed = true;
    assetStatus.done = true;
    emit();
    return null;
  });
  return promise;
}
