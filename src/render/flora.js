// Scenery: forests, sheep, windmills & haystacks, brick kilns with smoke, rocks, desert ruins,
// mines, and sailing boats around the island. Purely decorative; placed from the terrain.
import * as THREE from 'three';
import { GEO } from '../engine/geometry.js';
import { makeRng } from '../engine/rng.js';
import { part, merge, roofGeometry } from './geo.js';
import { impostorMesh } from './impostors.js';
import { rockMeshes } from './rocks.js';
import { buildHerds } from './animals.js';
import { windmill, haystackGeometry, hayMaterial, kiln, mine, ruins } from './props.js';
import { modelMaterial, part as modelPart } from './models.js';

function distToSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  const dx = px - (ax + vx * t);
  const dz = pz - (az + vz * t);
  return Math.hypot(dx, dz);
}

export function clearance(x, z) {
  // distance to the nearest intersection and nearest path (keeps building & road spots clear)
  let dv = 1e9;
  for (const v of GEO.vertices) {
    const dx = x - v.x;
    const dz = z - v.z;
    if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
    dv = Math.min(dv, Math.hypot(dx, dz));
  }
  let de = 1e9;
  for (const e of GEO.edges) {
    if (Math.abs(x - e.x) > 8 || Math.abs(z - e.z) > 8) continue;
    const a = GEO.vertices[e.v[0]];
    const b = GEO.vertices[e.v[1]];
    de = Math.min(de, distToSeg(x, z, a.x, a.z, b.x, b.z));
  }
  let dc = 1e9;
  for (const h of GEO.hexes) {
    const dx = x - h.x;
    const dz = z - h.z;
    if (Math.abs(dx) > 10 || Math.abs(dz) > 10) continue;
    dc = Math.min(dc, Math.hypot(dx, dz));
  }
  return { dv, de, dc };
}

const SWAY_VERT = `
#include <begin_vertex>
{
  vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sw = sin(uTime * 1.3 + ip.x * 0.37 + ip.z * 0.29) * 0.045 * max(transformed.y - 0.35, 0.0);
  transformed.x += sw;
  transformed.z += sw * 0.6;
}`;

function swayMaterial(timeUniform) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = timeUniform;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', SWAY_VERT);
  };
  m.customProgramCacheKey = () => 'sway';
  return m;
}

const FIRS = ['fir_a', 'fir_b', 'fir_c'];
const BROADS = ['broad_a', 'broad_b']; // Poly Haven island tree and small tree (broadleaf)
// per-species albedo lift (the scanned rooibos is very dark against the sand)
const PLANT_TINT = { rooibos_a: [1.9, 1.75, 1.45], rooibos_b: [1.9, 1.75, 1.45], fern_b: [1.08, 1.1, 1.0], fern_c: [1.08, 1.1, 1.0] };

// pack: realistic asset pack (assets.js) or null → procedural stand-ins
export function buildFlora(terrain, board, seed, quality, pack = null, sunDir = null) {
  // each section draws from its own stream, so buildings sit in the same spots whether or not the
  // realistic pack is used (the scenery is rebuilt in place when the pack arrives mid-game)
  let rnd = makeRng(seed ^ 0x51ed);
  const group = new THREE.Group();
  group.name = 'flora';
  const timeU = { value: 0 };
  const density = quality === 'low' ? 0.55 : quality === 'medium' ? 0.8 : 1;
  const real = !!(pack && pack.imp && pack.imp.fir_a);
  // tiling materials + baked models for the countryside buildings (windmills, kilns, mines, ruins, ships)
  const M = real && pack.models && pack.models.stone && pack.models.thatch ? pack.models : null;
  const shared = { time: timeU, sunDir: { value: (sunDir || new THREE.Vector3(0.5, 0.8, 0.3)).clone().normalize() } };
  const plants = {}; // species → impostor instances
  const addPlant = (sp, p) => (plants[sp] = plants[sp] || []).push(p);
  const plantAt = (sp, x, z, height, extra = {}) => {
    const m = pack.imp[sp].meta;
    addPlant(sp, { x, y: terrain.heightAt(x, z) - 0.04, z, yaw: rnd() * Math.PI * 2, s: height / m.h, ph: rnd() * 100, tint: rnd(), ...extra });
  };

  // ── trees ──
  const conifer = merge([
    part(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 5), '#5b3f27', { y: 0.25 }),
    part(new THREE.ConeGeometry(0.52, 0.85, 7), '#2d5a2a', { y: 0.78 }),
    part(new THREE.ConeGeometry(0.4, 0.72, 7), '#356a30', { y: 1.15 }),
    part(new THREE.ConeGeometry(0.26, 0.56, 7), '#3f7636', { y: 1.5 }),
  ]);
  const broad = merge([
    part(new THREE.CylinderGeometry(0.07, 0.11, 0.6, 5), '#5f4329', { y: 0.3 }),
    part(new THREE.IcosahedronGeometry(0.55, 0), '#4b7a30', { y: 0.95, sy: 0.85 }),
    part(new THREE.IcosahedronGeometry(0.36, 0), '#5a8a36', { x: 0.25, y: 1.2, z: 0.1, sy: 0.85 }),
  ]);
  const treePts = { conifer: [], broad: [] };
  const spacing = 0.78 / Math.sqrt(density);
  for (let z = -48; z <= 48; z += spacing) {
    for (let x = -52; x <= 52; x += spacing) {
      const px = x + (rnd() - 0.5) * spacing * 0.9;
      const pz = z + (rnd() - 0.5) * spacing * 0.9;
      const cd = terrain.coastAt(px, pz);
      if (cd > -1.8) continue;
      const h = terrain.heightAt(px, pz);
      if (h < 0.3) continue;
      const w = terrain.weightsAt(px, pz);
      let prob = w.forest > 0.5 ? 0.92 * w.forest : 0;
      prob += w.pasture * 0.025 + w.hills * 0.05 + w.fields * 0.006;
      if (w.mountains > 0.4 && h < 3.6) prob += 0.14 * w.mountains;
      if (prob <= 0 || rnd() > prob) continue;
      const c = clearance(px, pz);
      if (c.dv < 2.7 || c.de < 1.3) continue;
      if (w.forest > 0.5 && c.dc < 3.6) continue;
      if (w.forest <= 0.5 && c.dc < 3.0) continue;
      if (terrain.slopeAt(px, pz) > 1.2) continue;
      const isCon = w.mountains > 0.3 || rnd() < 0.62;
      (isCon ? treePts.conifer : treePts.broad).push({ x: px, y: h - 0.05, z: pz, s: 0.75 + rnd() * 0.6 });
    }
  }
  const tmat = swayMaterial(timeU);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  if (real) {
    // photo-scanned firs, mixed with broadleaf trees where the pack has them; height ~1.4–3
    const broads = BROADS.filter((b) => pack.imp[b]);
    for (const p of treePts.conifer) {
      const sp = FIRS[Math.floor(rnd() * FIRS.length)];
      plantAt(sp, p.x, p.z, 1.85 * p.s, { y: p.y });
    }
    for (const p of treePts.broad) {
      const r = rnd(); // one draw per tree, as before
      if (broads.length) plantAt(broads[Math.floor(r * broads.length)], p.x, p.z, 2.25 * p.s, { y: p.y });
      else plantAt(FIRS[Math.floor(r * FIRS.length)], p.x, p.z, 1.85 * p.s, { y: p.y });
    }
    treePts.conifer.length = 0;
    treePts.broad.length = 0;
    addRealPlants();
  }
  for (const [kind, geo] of [
    ['conifer', conifer],
    ['broad', broad],
  ]) {
    const pts = treePts[kind];
    if (!pts.length) continue;
    const im = new THREE.InstancedMesh(geo, tmat, pts.length);
    pts.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
      dummy.scale.set(p.s, p.s * (0.85 + rnd() * 0.35), p.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      const v = 0.78 + rnd() * 0.4;
      col.setRGB(v * (0.92 + rnd() * 0.12), v, v * (0.85 + rnd() * 0.2));
      im.setColorAt(i, col);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.name = 'trees-' + kind;
    group.add(im);
  }

  function addRealPlants() {
    // forest floor ferns
    const fs = 0.95 / Math.sqrt(density);
    for (let z = -48; z <= 48; z += fs) {
      for (let x = -52; x <= 52; x += fs) {
        const px = x + (rnd() - 0.5) * fs;
        const pz = z + (rnd() - 0.5) * fs;
        const w = terrain.weightsAt(px, pz);
        if (w.forest < 0.55 || rnd() > 0.5 * w.forest) continue;
        if (terrain.coastAt(px, pz) > -1.6) continue;
        const c = clearance(px, pz);
        if (c.dv < 2.3 || c.de < 1.0 || c.dc < 2.8) continue;
        plantAt(rnd() < 0.5 ? 'fern_b' : 'fern_c', px, pz, 0.38 + rnd() * 0.22);
      }
    }
    // desert: quiver trees and rooibos scrub; hills: low scrub dotted over the red earth
    GEO.hexes.forEach((h) => {
      const t = board.hexes[h.id].terrain;
      if (t !== 'desert' && t !== 'hills') return;
      const n = t === 'desert' ? Math.round(46 * density) : Math.round(54 * density);
      for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 8.4;
        const x = h.x + Math.cos(a) * r;
        const z = h.z + Math.sin(a) * r;
        if (terrain.coastAt(x, z) > -1.4 || terrain.slopeAt(x, z) > 1.0) continue;
        const c = clearance(x, z);
        if (c.dv < 2.4 || c.de < 1.0 || c.dc < 3.0) continue;
        if (t === 'desert' && Math.hypot(x - h.x, z - (h.z + 3.2)) < 3.6) continue; // the ruins
        k++;
        if (t === 'desert' && k % 3 === 0) {
          const q = rnd() < 0.55 ? 'quiver2' : 'quiver1';
          plantAt(q, x, z, q === 'quiver1' ? 2.1 + rnd() * 0.7 : 1.3 + rnd() * 0.5);
        } else {
          plantAt(rnd() < 0.5 ? 'rooibos_a' : 'rooibos_b', x, z, t === 'hills' ? 0.3 + rnd() * 0.28 : 0.42 + rnd() * 0.3);
        }
      }
    });
    for (const [sp, pts] of Object.entries(plants)) {
      if (!pack.imp[sp] || !pts.length) continue;
      const def = PLANT_TINT[sp] ? { ...pack.imp[sp], tint: new THREE.Color().setRGB(...PLANT_TINT[sp]) } : pack.imp[sp];
      group.add(impostorMesh(def, pts, shared, 'plants-' + sp));
    }
  }

  // ── sheep ──
  const sheepGeo = merge([
    part(new THREE.IcosahedronGeometry(0.2, 1), '#f1eee6', { y: 0.2, sx: 1.35, sy: 0.95, sz: 0.95 }),
    part(new THREE.BoxGeometry(0.14, 0.14, 0.13), '#2b2622', { x: 0.29, y: 0.27 }),
    part(new THREE.BoxGeometry(0.05, 0.14, 0.05), '#2b2622', { x: 0.14, y: 0.06, z: 0.09 }),
    part(new THREE.BoxGeometry(0.05, 0.14, 0.05), '#2b2622', { x: -0.14, y: 0.06, z: -0.09 }),
  ]);
  const sheep = [];
  const realAnimals = real && pack.baked && pack.baked.sheep;
  GEO.hexes.forEach((h) => {
    if (realAnimals) return;
    if (board.hexes[h.id].terrain !== 'pasture') return;
    const herds = 3;
    for (let k = 0; k < herds; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 4.2 + rnd() * 2.6;
      const cx = h.x + Math.cos(a) * r;
      const cz = h.z + Math.sin(a) * r;
      for (let s = 0; s < Math.round(9 * density); s++) {
        const x = cx + (rnd() - 0.5) * 3;
        const z = cz + (rnd() - 0.5) * 3;
        const c = clearance(x, z);
        if (c.dv < 2.4 || c.de < 1.0 || terrain.coastAt(x, z) > -1.5) continue;
        sheep.push({ x, z, a: rnd() * Math.PI * 2, ph: rnd() * 100, sp: 0.15 + rnd() * 0.25 });
      }
    }
  });
  let sheepMesh = null;
  if (sheep.length) {
    sheepMesh = new THREE.InstancedMesh(sheepGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), sheep.length);
    sheepMesh.castShadow = false; // moving: keep the cached shadow map static
    sheepMesh.name = 'sheep';
    group.add(sheepMesh);
  }

  // ── fields: windmills & haystacks ──
  rnd = makeRng(seed ^ 0x2b7d);
  const millBody = merge([
    part(new THREE.CylinderGeometry(0.34, 0.55, 1.9, 8), '#e9e2d0', { y: 0.95 }),
    part(new THREE.ConeGeometry(0.5, 0.6, 8), '#6a3d2a', { y: 2.2 }),
    part(new THREE.BoxGeometry(0.22, 0.36, 0.05), '#4a3020', { y: 0.2, z: 0.5 }),
  ]);
  const bladeGeo = merge([
    part(new THREE.BoxGeometry(0.11, 1.6, 0.06), '#7a5b3c', { y: 0.8 }),
    part(new THREE.BoxGeometry(0.44, 1.25, 0.03), '#efe7d6', { x: 0.22, y: 0.95 }),
  ]);
  const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const mills = [];
  const hay = [];
  GEO.hexes.forEach((h) => {
    if (board.hexes[h.id].terrain !== 'fields') return;
    for (let tries = 0; tries < 30; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = 3.8 + rnd() * 2.8;
      const x = h.x + Math.cos(a) * r;
      const z = h.z + Math.sin(a) * r;
      const c = clearance(x, z);
      if (c.dv < 3 || c.de < 1.6 || terrain.coastAt(x, z) > -2) continue;
      let g;
      let hub;
      if (M) {
        ({ group: g, hub } = windmill(M));
        hub.rotation.z = (x * 7.3 + z * 3.1) % 6.28; // no draw from the stream: placements stay put
      } else {
        g = new THREE.Group();
        const body = new THREE.Mesh(millBody, vmat);
        body.castShadow = true;
        g.add(body);
        hub = new THREE.Group();
        hub.position.set(0, 1.85, 0.5);
        for (let b = 0; b < 4; b++) {
          const bl = new THREE.Mesh(bladeGeo, vmat);
          bl.rotation.z = (b * Math.PI) / 2;
          hub.add(bl);
        }
        g.add(hub);
      }
      g.position.set(x, terrain.heightAt(x, z) - 0.05, z);
      g.rotation.y = (rnd() - 0.5) * 1.1; // sails face the (southern) camera
      group.add(g);
      mills.push({ hub, sp: 0.6 + rnd() * 0.5 });
      break;
    }
    for (let k = 0; k < Math.round(10 * density); k++) {
      const a = rnd() * Math.PI * 2;
      const r = 3 + rnd() * 4.5;
      const x = h.x + Math.cos(a) * r;
      const z = h.z + Math.sin(a) * r;
      const c = clearance(x, z);
      if (c.dv < 2.4 || c.de < 1.1 || terrain.coastAt(x, z) > -1.5) continue;
      hay.push({ x, z, y: terrain.heightAt(x, z), s: 0.7 + rnd() * 0.5 });
    }
  });
  if (hay.length) {
    const hayGeo = merge([
      part(new THREE.CylinderGeometry(0.32, 0.36, 0.38, 8), '#d8b14a', { y: 0.19 }),
      part(new THREE.ConeGeometry(0.34, 0.34, 8), '#c99f3c', { y: 0.55 }),
    ]);
    const im = M ? new THREE.InstancedMesh(haystackGeometry(), hayMaterial(M), hay.length) : new THREE.InstancedMesh(hayGeo, vmat, hay.length);
    hay.forEach((p, i) => {
      dummy.position.set(p.x, p.y - 0.03, p.z);
      dummy.rotation.set(0, rnd() * 6, 0);
      dummy.scale.setScalar(M ? p.s * 0.82 : p.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.castShadow = true;
    im.receiveShadow = !!M;
    group.add(im);
  }

  // ── hills: brick kilns with smoke ──
  const kilnGeo = merge([
    part(new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#8f4a2e', { y: 0 }),
    part(new THREE.CylinderGeometry(0.11, 0.14, 1.0, 6), '#7a3b25', { x: 0.3, y: 0.6 }),
    part(new THREE.BoxGeometry(0.9, 0.42, 0.62), '#a8826a', { x: -0.95, y: 0.21 }),
    part(roofGeometry(1.0, 0.72, 0.3), '#6b4a36', { x: -0.95, y: 0.42 }),
    part(new THREE.BoxGeometry(0.5, 0.18, 0.3), '#b35a36', { x: 0.2, y: 0.09, z: 0.75 }),
  ]);
  const smokeSprites = [];
  const smokeTex = softDot();
  GEO.hexes.forEach((h) => {
    if (board.hexes[h.id].terrain !== 'hills') return;
    let placed = 0;
    for (let tries = 0; tries < 40 && placed < 2; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = 3.6 + rnd() * 3;
      const x = h.x + Math.cos(a) * r;
      const z = h.z + Math.sin(a) * r;
      const c = clearance(x, z);
      if (c.dv < 3 || c.de < 1.7 || terrain.coastAt(x, z) > -2) continue;
      if (terrain.slopeAt(x, z) > 0.8) continue;
      let m;
      let chimLocal = new THREE.Vector3(0.3, 1.1, 0);
      if (M) {
        const k = kiln(M);
        m = k.group;
        chimLocal = k.chimney;
      } else {
        m = new THREE.Mesh(kilnGeo, vmat);
        m.castShadow = true;
      }
      const y = terrain.heightAt(x, z) - 0.05;
      m.position.set(x, y, z);
      m.rotation.y = rnd() * 6.28;
      group.add(m);
      const chim = chimLocal.clone().applyEuler(m.rotation).add(m.position);
      for (let s = 0; s < 5; s++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xd9d4cc, transparent: true, depthWrite: false, opacity: 0.5 }));
        sp.userData = { base: chim.clone(), ph: s / 5 + rnd() * 0.05 };
        group.add(sp);
        smokeSprites.push(sp);
      }
      placed++;
    }
  });

  // ── mountains: mines; rocks everywhere ──
  const mineGeo = merge([
    part(new THREE.BoxGeometry(0.9, 0.75, 0.25), '#5a4632', { y: 0.37 }),
    part(new THREE.BoxGeometry(0.55, 0.52, 0.27), '#141210', { y: 0.27, z: 0.01 }),
    part(new THREE.BoxGeometry(1.2, 0.08, 0.5), '#3d3328', { y: 0.04, z: 0.5 }),
    part(new THREE.BoxGeometry(0.42, 0.28, 0.32), '#6b6158', { x: 0.75, y: 0.14, z: 0.7 }),
  ]);
  GEO.hexes.forEach((h) => {
    if (board.hexes[h.id].terrain !== 'mountains') return;
    for (let tries = 0; tries < 40; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = 4.5 + rnd() * 2;
      const x = h.x + Math.cos(a) * r;
      const z = h.z + Math.sin(a) * r;
      const c = clearance(x, z);
      if (c.dv < 2.8 || c.de < 1.5 || terrain.coastAt(x, z) > -2) continue;
      const m = M ? mine(M, M) : new THREE.Mesh(mineGeo, vmat);
      m.position.set(x, terrain.heightAt(x, z) - 0.05, z);
      m.rotation.y = Math.atan2(x - h.x, z - h.z);
      m.castShadow = true;
      group.add(m);
      break;
    }
  });
  rnd = makeRng(seed ^ 0x6c3a);
  const rocks = [];
  if (real && pack.rocks) group.add(realRocks());
  for (let k = 0; k < (real && pack.rocks ? 0 : 900 * density); k++) {
    const x = (rnd() - 0.5) * 104;
    const z = (rnd() - 0.5) * 96;
    const cd = terrain.coastAt(x, z);
    const w = terrain.weightsAt(x, z);
    const h = terrain.heightAt(x, z);
    let p = 0;
    if (w.mountains > 0.4 && h > 1.5) p = 0.55;
    if (w.desert > 0.5) p = 0.25;
    if (w.hills > 0.5) p = 0.08;
    if (cd > -1.2 && cd < 0.3 && h > -0.1) p = 0.35;
    if (rnd() > p) continue;
    const c = clearance(x, z);
    if (c.dv < 2.2 || c.de < 1.0) continue;
    rocks.push({ x, z, y: h, s: 0.25 + rnd() * 0.55, desert: w.desert > 0.5 });
  }
  if (rocks.length) {
    const rockGeo = part(new THREE.DodecahedronGeometry(0.6, 0), '#8a8580', { sy: 0.7 });
    const im = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), rocks.length);
    rocks.forEach((p, i) => {
      dummy.position.set(p.x, p.y - 0.1, p.z);
      dummy.rotation.set(rnd() * 3, rnd() * 6, rnd() * 3);
      dummy.scale.set(p.s * (0.8 + rnd() * 0.5), p.s, p.s * (0.8 + rnd() * 0.5));
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (p.desert) col.setRGB(1.05, 0.82, 0.6);
      else col.setRGB(0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2);
      im.setColorAt(i, col);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  }

  // ── desert: ruins (the robber's lair) ──
  rnd = makeRng(seed ^ 0x1d95);
  const desert = GEO.hexes.find((h) => board.hexes[h.id].terrain === 'desert');
  if (desert && M && M.fort) {
    const r = ruins(M, rnd);
    r.position.set(desert.x, terrain.heightAt(desert.x, desert.z + 3.2) - 0.05, desert.z + 3.2);
    group.add(r);
  } else if (desert) {
    const parts = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * 2.6;
      const z = Math.sin(a) * 2.6 + 3.2;
      const hgt = i % 3 === 0 ? 0.5 : 1.0 + rnd() * 0.9;
      parts.push(part(new THREE.CylinderGeometry(0.2, 0.24, hgt, 8), '#d7c7a2', { x, y: hgt / 2, z }));
      if (i % 2 === 0) parts.push(part(new THREE.BoxGeometry(0.55, 0.12, 0.55), '#cdbb93', { x, y: hgt + 0.06, z }));
    }
    parts.push(part(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 8), '#cdbb93', { x: 0.6, y: 0.2, z: 5.4, rz: Math.PI / 2, ry: 0.6 }));
    const ruins = new THREE.Mesh(merge(parts), vmat);
    const x = desert.x;
    const z = desert.z;
    ruins.position.set(x, terrain.heightAt(x, z + 3.2) - 0.1, z);
    ruins.castShadow = true;
    group.add(ruins);
  }

  function realRocks() {
    const P = pack.parts;
    const pick = (slugs) => {
      const all = slugs.flatMap((sl) => P[sl] || []);
      return all.length ? all[Math.floor(rnd() * all.length)] : null;
    };
    const SETS = {
      cliff: { slugs: ['rock_face_01', 'rock_face_02'], size: [2.0, 3.3], sink: 0.34, tilt: 0.05 },
      boulder: { slugs: ['namaqualand_boulder_02', 'namaqualand_boulders_01'], size: [1.0, 2.2], sink: 0.16, tilt: 0.12 },
      rock: { slugs: ['rock_07', 'rock_09', 'stone_01'], size: [0.5, 1.15], sink: 0.15, tilt: 0.25 },
      stones: { slugs: ['namaqualand_stones_01'], size: [0.25, 0.55], sink: 0.12, tilt: 0.2 },
      moss: { slugs: ['rock_moss_set_01'], size: [0.5, 1.05], sink: 0.15, tilt: 0.2 },
      stump: { slugs: ['tree_stump_01'], size: [0.45, 0.7], sink: 0.08, tilt: 0.04 },
      trunk: { slugs: ['dead_quiver_trunk'], size: [1.3, 1.9], sink: 0.04, tilt: 0.06 },
    };
    const items = [];
    const put = (set, x, z, yaw) => {
      const S = SETS[set];
      const pt = pick(S.slugs);
      if (!pt) return;
      const dim = Math.max(pt.size.x, pt.size.y, pt.size.z);
      const sc = (S.size[0] + rnd() * (S.size[1] - S.size[0])) / dim;
      items.push({
        part: pt,
        x,
        z,
        y: terrain.heightAt(x, z) - pt.size.y * sc * S.sink,
        yaw: yaw != null ? yaw : rnd() * Math.PI * 2,
        s: sc,
        tiltX: (rnd() - 0.5) * 2 * S.tilt,
        tiltZ: (rnd() - 0.5) * 2 * S.tilt,
      });
    };
    for (let k = 0; k < 2600 * density; k++) {
      const x = (rnd() - 0.5) * 104;
      const z = (rnd() - 0.5) * 96;
      const cd = terrain.coastAt(x, z);
      const h = terrain.heightAt(x, z);
      if (cd > 0.3 || h < -0.1) continue;
      const w = terrain.weightsAt(x, z);
      const sl = terrain.slopeAt(x, z);
      const r = rnd();
      let set = null;
      if (cd > -1.2) set = r < 0.09 ? 'stones' : r < 0.11 ? 'rock' : null;
      else if (w.mountains > 0.5) {
        if (sl > 0.9 && h > 2.2 && h < 6.2) set = r < 0.05 ? 'cliff' : r < 0.09 ? 'boulder' : null;
        else if (h > 1.4) set = r < 0.035 ? 'boulder' : r < 0.11 ? 'rock' : r < 0.14 ? 'stones' : null;
      } else if (w.desert > 0.5) set = r < 0.035 ? 'boulder' : r < 0.07 ? 'stones' : r < 0.078 ? 'trunk' : null;
      else if (w.hills > 0.5) set = r < 0.012 ? 'boulder' : r < 0.03 ? 'rock' : r < 0.05 ? 'stones' : null;
      else if (w.forest > 0.5) set = r < 0.02 ? 'moss' : r < 0.032 ? 'stump' : null;
      else if (w.pasture > 0.5) set = r < 0.008 ? 'moss' : null;
      else if (w.fields > 0.5) set = r < 0.004 ? 'stones' : null;
      if (!set) continue;
      const c = clearance(x, z);
      if (c.dv < (set === 'cliff' ? 3.2 : 2.2) || c.de < (set === 'cliff' ? 2.0 : 1.0) || c.dc < (set === 'cliff' ? 3.6 : 2.6)) continue;
      let yaw = null;
      if (set === 'cliff') {
        // the scanned face looks along +Z: turn it downhill
        const e = 0.6;
        const gx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
        const gz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
        yaw = Math.atan2(-gx, -gz) + (rnd() - 0.5) * 0.5;
      }
      put(set, x, z, yaw);
    }
    // lumber camps: stumps at the forest edges near the token
    GEO.hexes.forEach((h) => {
      if (board.hexes[h.id].terrain !== 'forest') return;
      for (let k = 0, tries = 0; k < 4 && tries < 40; tries++) {
        const a = rnd() * Math.PI * 2;
        const r = 3.2 + rnd() * 2.2;
        const x = h.x + Math.cos(a) * r;
        const z = h.z + Math.sin(a) * r;
        const c = clearance(x, z);
        if (c.dv < 2.3 || c.de < 1.0 || terrain.coastAt(x, z) > -1.5) continue;
        put('stump', x, z);
        k++;
      }
    });
    return rockMeshes(items);
  }

  function realHerds() {
    const spots = [];
    const free = (x, z, type) => {
      if (terrain.coastAt(x, z) > -1.6 || terrain.slopeAt(x, z) > 0.9) return false;
      const c = clearance(x, z);
      if (c.dv < 2.2 || c.de < 0.9 || c.dc < 2.2) return false;
      const w = terrain.weightsAt(x, z);
      return type === 'pig' ? w.fields > 0.4 : w.pasture + w.fields > 0.45;
    };
    const herd = (type, h, n, spread, rmin, rmax) => {
      for (let tries = 0; tries < 30; tries++) {
        const a = rnd() * Math.PI * 2;
        const r = rmin + rnd() * (rmax - rmin);
        const cx = h.x + Math.cos(a) * r;
        const cz = h.z + Math.sin(a) * r;
        if (!free(cx, cz, type)) continue;
        let placed = 0;
        for (let k = 0; k < n * 4 && placed < n; k++) {
          const x = cx + (rnd() - 0.5) * spread;
          const z = cz + (rnd() - 0.5) * spread;
          if (!free(x, z, type)) continue;
          spots.push({ type, x, z, yaw: rnd() * Math.PI * 2, s: 0.88 + rnd() * 0.24, home: { x: cx, z: cz, r: spread * 0.9 + 0.6 } });
          placed++;
        }
        return;
      }
    };
    GEO.hexes.forEach((h) => {
      const t = board.hexes[h.id].terrain;
      if (t === 'pasture') {
        for (let k = 0; k < 3; k++) herd('sheep', h, Math.round(7 * density), 2.6, 3.6, 6.8);
        if (rnd() < 0.7) herd('horse', h, 2, 2.2, 4.5, 6.8);
        if (rnd() < 0.5) herd('cow', h, 2 + Math.round(rnd()), 2.4, 4, 6.8);
      } else if (t === 'fields') {
        if (rnd() < 0.8) herd('pig', h, 2 + Math.round(rnd() * 2), 1.4, 3.6, 6.4);
        if (rnd() < 0.45) herd('cow', h, 2, 2.4, 4, 6.8);
      }
    });
    const ok = (x, z) => {
      if (terrain.coastAt(x, z) > -1.5 || terrain.slopeAt(x, z) > 1.0) return false;
      const c = clearance(x, z);
      return c.dv > 2.0 && c.de > 0.8 && c.dc > 2.0;
    };
    return buildHerds(pack.baked, spots, terrain, ok, rnd);
  }
  rnd = makeRng(seed ^ 0x48e1);
  const herds = realAnimals ? realHerds() : null;
  if (herds) group.add(herds.group);

  // ── boats sailing around the island ──
  rnd = makeRng(seed ^ 0x7f03);
  const boatGeo = merge([
    part(new THREE.BoxGeometry(1.4, 0.32, 0.5), '#6b4b33', { y: 0.12 }),
    part(new THREE.ConeGeometry(0.25, 0.5, 4), '#6b4b33', { x: 0.88, y: 0.12, rz: -Math.PI / 2, ry: Math.PI / 4 }),
    part(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4), '#3b2a1c', { y: 0.9 }),
  ]);
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0.35, 0, 0, 1.65, 0, 0.9, 0.35, 0]), 3));
  sailGeo.computeVertexNormals();
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xf3ede0, side: THREE.DoubleSide, roughness: 0.8 });
  const boats = [];
  const boatC = GEO.center; // they sail round the middle of the land
  for (let b = 0; b < 4; b++) {
    const g = new THREE.Group();
    if (M && M.ships) {
      // galleons under sail (bow along +x, waterline at y = 0)
      const kind = b % 2 && M.ships.pinnace ? 'pinnace' : M.ships.dutch ? 'dutch' : 'pinnace';
      const sm = M.ships[kind];
      const hull = new THREE.Mesh(modelPart(sm), modelMaterial(sm, { alpha: true }));
      const S = 0.095;
      hull.scale.setScalar(S);
      hull.position.y = -(kind === 'pinnace' ? 3.1 : 2.7) * S;
      if (kind === 'pinnace') hull.rotation.y = Math.PI / 2;
      hull.castShadow = true;
      g.add(hull);
    } else {
      const hull = new THREE.Mesh(boatGeo, vmat);
      const sail = new THREE.Mesh(sailGeo, sailMat);
      g.add(hull, sail);
      g.scale.setScalar(1.1);
    }
    group.add(g);
    boats.push({ g, r: (54 + rnd() * 6) * GEO.scale, ph: rnd() * Math.PI * 2, sp: (0.006 + rnd() * 0.006) * (b % 2 ? 1 : -1) });
  }

  function update(t, dt) {
    timeU.value = t;
    if (herds) herds.update(t, dt);
    for (const m of mills) m.hub.rotation.z -= dt * m.sp;
    if (sheepMesh) {
      sheep.forEach((s, i) => {
        const wob = Math.sin(t * s.sp + s.ph);
        const x = s.x + Math.cos(s.a) * wob * 0.45;
        const z = s.z + Math.sin(s.a) * wob * 0.45;
        dummy.position.set(x, terrain.heightAt(x, z) - 0.02, z);
        dummy.rotation.set(0, -s.a + (Math.cos(t * s.sp + s.ph) > 0 ? 0 : Math.PI), 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        sheepMesh.setMatrixAt(i, dummy.matrix);
      });
      sheepMesh.instanceMatrix.needsUpdate = true;
    }
    for (const sp of smokeSprites) {
      const f = (t * 0.18 + sp.userData.ph) % 1;
      sp.position.set(sp.userData.base.x + f * 0.9, sp.userData.base.y + f * 2.6, sp.userData.base.z + f * 0.3);
      sp.scale.setScalar(0.35 + f * 1.3);
      sp.material.opacity = 0.42 * (1 - f) * Math.min(1, f * 6);
    }
    for (const b of boats) {
      const a = b.ph + t * b.sp;
      const x = boatC.x + Math.cos(a) * b.r;
      const z = boatC.z + Math.sin(a) * b.r * 0.88;
      b.g.position.set(x, 0.05 + Math.sin(t * 1.6 + b.ph) * 0.06, z);
      b.g.rotation.set(Math.sin(t * 1.3 + b.ph) * 0.05, -a + (b.sp > 0 ? -Math.PI / 2 : Math.PI / 2), 0);
    }
  }

  const plantCount = Object.values(plants).reduce((n, l) => n + l.length, 0);
  return {
    group,
    update,
    real,
    counts: { trees: treePts.conifer.length + treePts.broad.length, plants: plantCount, sheep: sheep.length, animals: herds ? herds.count : 0, rocks: rocks.length },
  };
}

export function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
