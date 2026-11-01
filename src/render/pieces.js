// Player pieces on the 3D map: settlements, cities, roads and harbors, plus ghost previews and
// placement animations. (The robber is a badge on the map overlay, not a model: no clipping.)
// With the realistic asset pack loaded, settlements are detailed half-timbered houses roofed in the
// player's colour, cities a stone keep with walls and town houses, and roads cobbled streets with
// kerbs painted in the player's colour; until then simple stand-ins are drawn.
import * as THREE from 'three';
import { GEO } from '../engine/geometry.js';
import { part, merge, roofGeometry, shade } from './geo.js';
import { flagCanvas } from '../ui/flags.js';
import { buildingParts, yardMesh, modelMaterial, METRE, part as modelPart } from './models.js';

const WALL = '#efe6d2';
const STONE = '#d6ccb8';
const WOOD = '#6b4a33';
export const RES_COLORS = { wood: '#2f6b2f', brick: '#b5532c', wool: '#8fcf4f', grain: '#e8c547', ore: '#8d8d96', any: '#f3ede0' };

function houseParts(color, x, z, ry, w, d, h, roofH = 0.42) {
  return [
    part(new THREE.BoxGeometry(w, h, d), WALL, { x, y: h / 2, z, ry }),
    part(roofGeometry(w + 0.14, d + 0.16, roofH), shade(color, 0.92), { x, y: h, z, ry }),
    part(new THREE.BoxGeometry(0.16, 0.26, 0.02), WOOD, { x: x + Math.sin(ry) * (d / 2 + 0.01), y: 0.13, z: z + Math.cos(ry) * (d / 2 + 0.01), ry }),
  ];
}

function settlementGeometry(color) {
  const parts = [part(new THREE.CylinderGeometry(1.3, 1.42, 0.14, 18), '#857457', { y: 0.03 })];
  parts.push(...houseParts(color, -0.52, 0.3, 0.35, 0.78, 0.6, 0.55));
  parts.push(...houseParts(color, 0.55, 0.36, -0.45, 0.7, 0.55, 0.5));
  parts.push(...houseParts(color, 0.02, -0.5, 1.25, 0.86, 0.62, 0.64, 0.48));
  parts.push(part(new THREE.CylinderGeometry(0.025, 0.03, 1.75, 5), '#3b2c20', { x: -0.95, y: 0.88, z: -0.55 }));
  return merge(parts);
}

function cityGeometry(color) {
  const parts = [part(new THREE.CylinderGeometry(1.95, 2.08, 0.16, 22), '#7d6e55', { y: 0.03 })];
  parts.push(part(new THREE.BoxGeometry(1.0, 1.9, 1.0), STONE, { y: 0.95 }));
  for (const [cx, cz] of [
    [-0.42, -0.42],
    [0.42, -0.42],
    [-0.42, 0.42],
    [0.42, 0.42],
  ]) {
    parts.push(part(new THREE.BoxGeometry(0.2, 0.22, 0.2), STONE, { x: cx, y: 2.0, z: cz }));
  }
  parts.push(part(new THREE.ConeGeometry(0.8, 1.15, 4), shade(color, 0.95), { y: 2.62, ry: Math.PI / 4 }));
  parts.push(...houseParts(color, -0.95, 0.75, 0.25, 0.7, 0.55, 0.55));
  parts.push(...houseParts(color, 0.95, 0.8, -0.35, 0.72, 0.55, 0.5));
  parts.push(...houseParts(color, 1.0, -0.55, 1.3, 0.62, 0.5, 0.48));
  parts.push(...houseParts(color, -1.05, -0.5, 1.5, 0.6, 0.5, 0.5));
  const segs = 16;
  for (let i = 0; i < segs; i++) {
    if (i === 4) continue;
    const a = (i / segs) * Math.PI * 2;
    parts.push(part(new THREE.BoxGeometry(0.72, 0.4, 0.16), STONE, { x: Math.cos(a) * 1.72, y: 0.2, z: Math.sin(a) * 1.72, ry: -a + Math.PI / 2 }));
  }
  for (const a of [0.9, 2.6, 4.2, 5.6]) {
    const x = Math.cos(a) * 1.72;
    const z = Math.sin(a) * 1.72;
    parts.push(part(new THREE.CylinderGeometry(0.2, 0.22, 0.72, 8), STONE, { x, y: 0.36, z }));
    parts.push(part(new THREE.ConeGeometry(0.26, 0.4, 8), shade(color, 0.85), { x, y: 0.92, z }));
  }
  parts.push(part(new THREE.CylinderGeometry(0.025, 0.03, 1.3, 5), '#3b2c20', { x: 0, y: 3.4, z: 0 }));
  return merge(parts);
}

// (Seafarers) a ship: dark hull along +x (bow at +x), a mast, the sail in the player's colour.
// The pirate's is all black.
function shipGeometry(color, pirate = false) {
  const hull = pirate ? '#1c1714' : WOOD;
  const sail = pirate ? '#26211d' : color;
  const trim = pirate ? '#8a1c14' : shade(color, 0.6);
  return merge([
    part(new THREE.BoxGeometry(2.0, 0.42, 0.78), hull, { y: 0.16 }),
    part(new THREE.CylinderGeometry(0.02, 0.39, 0.62, 4, 1), hull, { x: 1.28, y: 0.16, rz: -Math.PI / 2, ry: Math.PI / 4, sz: 1, sy: 1 }),
    part(new THREE.BoxGeometry(0.62, 0.26, 0.8), hull, { x: -0.86, y: 0.49 }),
    part(new THREE.BoxGeometry(2.06, 0.07, 0.84), trim, { y: 0.39 }),
    part(new THREE.CylinderGeometry(0.035, 0.045, 2.1, 6), '#3b2a1c', { x: 0.12, y: 1.32 }),
    part(new THREE.CylinderGeometry(0.025, 0.025, 1.18, 5), '#3b2a1c', { x: 0.12, y: 1.92, rx: Math.PI / 2 }),
    part(new THREE.BoxGeometry(0.04, 1.02, 1.12), sail, { x: 0.2, y: 1.38 }),
    part(new THREE.BoxGeometry(0.04, 0.42, 0.58), sail, { x: 0.12, y: 2.24 }),
    part(new THREE.ConeGeometry(0.36, 0.78, 3, 1), sail, { x: 0.86, y: 1.0, rx: Math.PI / 2, rz: Math.PI / 2, sz: 0.06 }),
  ]);
}

function waveFlagMaterial(tex, timeU) {
  const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = timeU;
    s.vertexShader =
      'uniform float uTime;\n' +
      s.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float fx = uv.x;
         transformed.z += sin(fx * 7.0 - uTime * 5.0 + position.y * 2.0) * 0.07 * fx;
         transformed.y -= fx * fx * 0.06;`,
      );
  };
  m.customProgramCacheKey = () => 'flag';
  return m;
}

const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// a stable pseudo-random value per vertex/edge id
const hash01 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// cobbled street cross-section (lateral offset in half-widths, height in road thickness units, kerb flag)
const PROFILE = [
  [-1.0, -0.9, 1],
  [-1.0, 1.0, 1],
  [-0.8, 1.0, 1],
  [-0.77, 0.45, 0],
  [0, 0.78, 0],
  [0.77, 0.45, 0],
  [0.8, 1.0, 1],
  [1.0, 1.0, 1],
  [1.0, -0.9, 1],
];

export class Pieces {
  constructor(scene, terrain, players, models = null) {
    this.scene = scene;
    this.terrain = terrain;
    this.players = players;
    this.models = models;
    this.group = new THREE.Group();
    this.group.name = 'pieces';
    scene.add(this.group);
    this.timeU = { value: 0 };
    this.farU = { value: 0 };
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
    this.roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
    this.roadMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vRW;
float rh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float cobble(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float md = 8.0, md2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + vec2(rh(i + o), rh(i + o + 7.7)) * 0.8 + 0.1 - f;
    float d = dot(r, r);
    if (d < md) { md2 = md; md = d; } else if (d < md2) md2 = d;
  }
  return smoothstep(0.0, 0.12, sqrt(md2) - sqrt(md));
}`,
        )
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 0.8 + 0.22 * cobble(vRW.xz * 2.6);');
    };
    this.roadMat.customProgramCacheKey = () => 'road-cobble';
    this.geo = players.map((p) => ({ s: settlementGeometry(p.color), c: cityGeometry(p.color), ship: shipGeometry(p.color) }));
    this.flagMats = players.map((p, i) => {
      const t = new THREE.CanvasTexture(flagCanvas(p.color, i));
      t.colorSpace = THREE.SRGBColorSpace;
      return waveFlagMaterial(t, this.timeU);
    });
    this.flagGeo = new THREE.PlaneGeometry(0.62, 0.4, 8, 3);
    this.flagGeo.translate(0.31, 0, 0);
    this.poleGeo = new THREE.CylinderGeometry(0.022, 0.03, 1, 6).translate(0, 0.5, 0);
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0x3b2c20, roughness: 0.8 });
    this.streetMats = [];
    this.buildings = new Map(); // vertex → {mesh, yard, type, p}
    this.roads = new Map(); // edge → {mesh, p}
    this.ships = new Map(); // edge → {mesh, p} (Seafarers)
    this.pirate = null; // the pirate's ship and the hex it is on
    this.anims = [];
    this.scale = 1;
    this.yardScale = 1;
    this.roadWidth = 1;
    this.ghostObj = null;
    this.dust = [];
  }

  // the realistic models arrived: rebuild every piece on the map with them
  setModels(models) {
    this.models = models;
    this.streetMats = [];
    for (const [v, b] of this.buildings) {
      this.group.remove(b.mesh);
      if (b.yard) this.group.remove(b.yard);
      const mesh = this.makeBuilding(v, b.p, b.type);
      mesh.scale.setScalar(this.scale);
      this.group.add(mesh);
      b.mesh = mesh;
      b.anim = false;
      b.yard = this.makeYard(v, b.type);
      if (b.yard) this.group.add(b.yard);
    }
    for (const [e, r] of this.roads) {
      this.group.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh = this.makeRoad(e, r.p, this.roadWidth);
      r.anim = false;
      this.group.add(r.mesh);
    }
    this.anims = [];
  }

  // (never below the water: Seafarers has paths and intersections out at sea)
  vertexPos(v) {
    const g = GEO.vertices[v];
    return new THREE.Vector3(g.x, Math.max(0, this.terrain.heightAt(g.x, g.z)), g.z);
  }
  edgeMid(e) {
    const g = GEO.edges[e];
    return new THREE.Vector3(g.x, Math.max(0, this.terrain.heightAt(g.x, g.z)), g.z);
  }
  setScale(s, roadW, settled = true) {
    this.scale = s;
    this.farU.value = Math.min(1, Math.max(0, (s - 1.2) / 1.1));
    for (const b of this.buildings.values()) if (!b.anim) b.mesh.scale.setScalar(s);
    // yards follow the ground, so they are rebuilt (not scaled) when the zoom changes a lot
    if (!settled) return;
    if (this.models && Math.abs(s - this.yardScale) > 0.12) {
      this.yardScale = s;
      for (const [v, b] of this.buildings) {
        if (b.yard) {
          this.group.remove(b.yard);
          b.yard.geometry.dispose();
        }
        b.yard = this.makeYard(v, b.type);
        if (b.yard) this.group.add(b.yard);
      }
    }
    if (Math.abs(roadW - this.roadWidth) > 0.08) {
      this.roadWidth = roadW;
      for (const [e, r] of this.roads) {
        if (r.anim) continue;
        r.mesh.geometry.dispose();
        r.mesh.geometry = this.roadGeometry(e, this.players[r.p].color, roadW);
      }
    }
  }

  roadGeometry(e, color, wmul = 1, shorten = 1.15) {
    return this.models && this.models.street ? this.streetGeometry(e, wmul, shorten) : this.plainRoadGeometry(e, color, wmul, shorten);
  }

  plainRoadGeometry(e, color, wmul = 1, shorten = 1.15) {
    const ge = GEO.edges[e];
    const A = GEO.vertices[ge.v[0]];
    const B = GEO.vertices[ge.v[1]];
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const S = 14;
    const hw = 0.46 * wmul;
    const th = 0.12 * Math.min(wmul, 1.6);
    const side = new THREE.Color(shade(color, 0.72));
    const top = new THREE.Color(color);
    const center = new THREE.Color(color).lerp(new THREE.Color('#f6eedb'), 0.35);
    const pos = [];
    const col = [];
    const ring = [];
    for (let i = 0; i <= S; i++) {
      const t = shorten / len + (i / S) * (1 - (2 * shorten) / len);
      const cx = A.x + dx * t;
      const cz = A.z + dz * t;
      const y = this.terrain.heightAt(cx, cz) + 0.08;
      ring.push([
        [cx + px * hw, y - th, cz + pz * hw, side],
        [cx + px * hw, y + th, cz + pz * hw, top],
        [cx, y + th * 1.25, cz, center],
        [cx - px * hw, y + th, cz - pz * hw, top],
        [cx - px * hw, y - th, cz - pz * hw, side],
      ]);
    }
    const push = (v) => {
      pos.push(v[0], v[1], v[2]);
      col.push(v[3].r, v[3].g, v[3].b);
    };
    for (let i = 0; i < S; i++) {
      for (let k = 0; k < 4; k++) {
        const a = ring[i][k];
        const b = ring[i][k + 1];
        const c = ring[i + 1][k];
        const d = ring[i + 1][k + 1];
        push(a);
        push(c);
        push(b);
        push(b);
        push(c);
        push(d);
      }
    }
    for (const i of [0, S]) {
      const r = ring[i];
      for (let k = 1; k < 4; k++) {
        if (i === 0) {
          push(r[0]);
          push(r[k]);
          push(r[k + 1]);
        } else {
          push(r[0]);
          push(r[k + 1]);
          push(r[k]);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }

  // cobbled street with kerbs: textured strips that follow the ground, crisp creases at the kerbs
  streetGeometry(e, wmul = 1, shorten = 1.15) {
    const ge = GEO.edges[e];
    const A = GEO.vertices[ge.v[0]];
    const B = GEO.vertices[ge.v[1]];
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const S = 16;
    const hw = 0.34 * wmul;
    const th = 0.07 * Math.min(wmul, 1.7);
    const TILE = 0.42; // world units per texture repeat
    const rings = [];
    for (let i = 0; i <= S; i++) {
      const t = shorten / len + (i / S) * (1 - (2 * shorten) / len);
      const cx = A.x + dx * t;
      const cz = A.z + dz * t;
      // follow the ground across the street's width too, never dipping into the sea
      const yPos = Math.max(this.terrain.heightAt(cx + px * hw, cz + pz * hw), 0.05);
      const yNeg = Math.max(this.terrain.heightAt(cx - px * hw, cz - pz * hw), 0.05);
      const yc = Math.max(this.terrain.heightAt(cx, cz), 0.05);
      rings.push({ cx, cz, yPos, yNeg, yc, along: t * len });
    }
    const pos = [];
    const uv = [];
    const kerb = [];
    const idx = [];
    const vert = (r, k) => {
      const [lx, ly] = PROFILE[k];
      const base = lx < 0 ? r.yc + (r.yNeg - r.yc) * -lx : r.yc + (r.yPos - r.yc) * lx;
      return [r.cx + px * hw * lx, base + 0.045 + th * ly, r.cz + pz * hw * lx];
    };
    // one strip per profile segment, so every kerb edge stays sharp
    for (let k = 0; k < PROFILE.length - 1; k++) {
      const isKerb = PROFILE[k][2] && PROFILE[k + 1][2] ? 1 : 0;
      const start = pos.length / 3;
      for (let i = 0; i <= S; i++) {
        const r = rings[i];
        for (const kk of [k, k + 1]) {
          const p = vert(r, kk);
          pos.push(p[0], p[1], p[2]);
          // lateral texture coordinate runs along the profile (so kerb faces get texture too)
          let lat = 0;
          for (let j = 0; j < kk; j++) lat += Math.hypot((PROFILE[j + 1][0] - PROFILE[j][0]) * hw, (PROFILE[j + 1][1] - PROFILE[j][1]) * th);
          uv.push(lat / TILE, r.along / TILE);
          kerb.push(isKerb);
        }
      }
      for (let i = 0; i < S; i++) {
        const a = start + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    // end caps
    for (const end of [0, S]) {
      const r = rings[end];
      const start = pos.length / 3;
      const c = vert(r, 4);
      pos.push(c[0], r.yc - 0.02, c[2]);
      uv.push(0, 0);
      kerb.push(1);
      for (let k = 0; k < PROFILE.length; k++) {
        const p = vert(r, k);
        pos.push(p[0], p[1], p[2]);
        uv.push(PROFILE[k][0] * hw / TILE, p[1] / TILE);
        kerb.push(1);
      }
      for (let k = 0; k < PROFILE.length - 1; k++) {
        if (end === 0) idx.push(start, start + 1 + k + 1, start + 1 + k);
        else idx.push(start, start + 1 + k, start + 1 + k + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('kerb', new THREE.Float32BufferAttribute(kerb, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  streetMaterial(p) {
    if (this.streetMats[p]) return this.streetMats[p];
    const t = this.models.street;
    const m = new THREE.MeshStandardMaterial({ map: t.d, normalMap: t.n, aoMap: t.arm, roughnessMap: t.arm, roughness: 1, metalness: 0 });
    m.normalScale.set(1, -1);
    const uTint = { value: new THREE.Color(this.players[p].color) };
    const uFar = this.farU;
    m.onBeforeCompile = (s) => {
      s.uniforms.uTint = uTint;
      s.uniforms.uFar = uFar;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float kerb;\nvarying float vKerb;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKerb = kerb;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint;\nuniform float uFar;\nvarying float vKerb;').replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          // kerbs painted in the player's colour; the cobbles take a little of it too, more when far away
          float w = clamp(vKerb * 0.92 + 0.16 + uFar * 0.5, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uTint * (0.38 + 1.25 * l), w);
        }`,
      );
    };
    m.customProgramCacheKey = () => 'street';
    this.streetMats[p] = m;
    return m;
  }

  makeRoad(e, p, wmul) {
    const color = this.players[p].color;
    const mesh = new THREE.Mesh(this.roadGeometry(e, color, wmul), this.models && this.models.street ? this.streetMaterial(p) : this.roadMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  makeBuilding(v, p, type, ghost = null) {
    const g = new THREE.Group();
    const color = this.players[p].color;
    if (this.models && this.models.houses) {
      for (const m of buildingParts(this.models, type, color, v, ghost)) g.add(m);
      const pole = new THREE.Mesh(this.poleGeo, ghost || this.poleMat);
      const flag = new THREE.Mesh(this.flagGeo, ghost || this.flagMats[p]);
      if (type === 'c') {
        pole.position.set(0.15, 1.52, -1.05);
        pole.scale.set(1, 1.05, 1);
        flag.position.set(0.15, 2.38, -1.05);
      } else {
        pole.position.set(-1.28, 0, 0.7);
        pole.scale.set(1, 1.9, 1);
        flag.position.set(-1.28, 1.72, 0.7);
      }
      pole.castShadow = true;
      flag.castShadow = true;
      g.add(pole, flag);
      g.rotation.y = (hash01(v) - 0.5) * 0.9;
    } else {
      const mesh = new THREE.Mesh(type === 'c' ? this.geo[p].c : this.geo[p].s, ghost || this.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      const flag = new THREE.Mesh(this.flagGeo, ghost || this.flagMats[p]);
      if (type === 'c') flag.position.set(0, 3.82, 0);
      else flag.position.set(-0.95, 1.55, -0.55);
      flag.castShadow = true;
      g.add(flag);
      g.rotation.y = ((v * 73) % 360) * (Math.PI / 180) * 0.25;
    }
    const pos = this.vertexPos(v);
    g.position.copy(pos);
    if (this.models) g.position.y -= 0.06; // stone footings sit a little into the ground
    return g;
  }

  // (Seafarers) a ship on a path: afloat at the path's middle, along it
  makeShip(e, p, ghost = null) {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(this.geo[p].ship, ghost || this.mat);
    mesh.castShadow = !ghost;
    g.add(mesh);
    const E = GEO.edges[e];
    const A = GEO.vertices[E.v[0]];
    const B = GEO.vertices[E.v[1]];
    g.position.set(E.x, 0.04, E.z);
    g.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x) + (hash01(e) > 0.5 ? Math.PI : 0);
    g.userData.phase = hash01(e * 7 + 1) * 6.28;
    return g;
  }

  // (Seafarers) the pirate's black ship, in the middle of its sea hex
  setPirate(hex) {
    if (hex == null || hex < 0) {
      if (this.pirate) this.group.remove(this.pirate.mesh);
      this.pirate = null;
      return;
    }
    if (this.pirate && this.pirate.hex === hex) return;
    if (!this.pirate) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(shipGeometry('#000', true), this.mat);
      m.castShadow = true;
      g.add(m);
      g.scale.setScalar(1.25);
      this.group.add(g);
      this.pirate = { mesh: g, hex };
    }
    const h = GEO.hexes[hex];
    this.pirate.hex = hex;
    this.pirate.mesh.position.set(h.x - 2.2, 0.04, h.z + 1.4);
    this.pirate.mesh.rotation.y = 0.5;
  }

  makeYard(v, type) {
    if (!this.models) return null;
    const V = GEO.vertices[v];
    return yardMesh(this.terrain, V.x, V.z, (type === 'c' ? 2.5 : 1.55) * this.scale);
  }

  spawnDust(pos, size = 1) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xf2e6c8, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));
    this.group.add(m);
    this.dust.push({ m, t: 0, size });
  }

  sync(st, animate = true) {
    let changed = false;
    st.vertices.forEach((b, v) => {
      const cur = this.buildings.get(v);
      if (!b) {
        if (cur) {
          this.group.remove(cur.mesh);
          if (cur.yard) this.group.remove(cur.yard);
          this.buildings.delete(v);
          changed = true;
        }
        return;
      }
      if (cur && cur.type === b.t && cur.p === b.p) return;
      if (cur) {
        this.group.remove(cur.mesh);
        if (cur.yard) this.group.remove(cur.yard);
      }
      const mesh = this.makeBuilding(v, b.p, b.t);
      this.group.add(mesh);
      const yard = this.makeYard(v, b.t);
      if (yard) this.group.add(yard);
      const rec = { mesh, yard, type: b.t, p: b.p, anim: animate };
      this.buildings.set(v, rec);
      if (animate) {
        mesh.scale.setScalar(0.01);
        this.anims.push({ kind: 'pop', rec, t: 0, dur: 0.55 });
        this.spawnDust(mesh.position, b.t === 'c' ? 1.5 : 1.1);
      } else mesh.scale.setScalar(this.scale);
      changed = true;
    });
    st.edges.forEach((p, e) => {
      const cur = this.roads.get(e);
      if (p < 0) {
        if (cur) {
          this.group.remove(cur.mesh);
          this.roads.delete(e);
          changed = true;
        }
        return;
      }
      if (cur && cur.p === p) return;
      if (cur) this.group.remove(cur.mesh);
      const mesh = this.makeRoad(e, p, this.roadWidth);
      this.group.add(mesh);
      const rec = { mesh, p };
      this.roads.set(e, rec);
      if (animate) {
        const mid = this.edgeMid(e);
        mesh.position.set(mid.x, 0, mid.z);
        mesh.geometry.translate(-mid.x, 0, -mid.z);
        rec.offset = mid;
        rec.anim = true;
        mesh.scale.set(0.01, 1, 0.01);
        this.anims.push({ kind: 'road', rec, t: 0, dur: 0.45 });
        this.spawnDust(mid, 0.9);
      }
      changed = true;
    });
    // (Seafarers) ships and the pirate
    if (st.ships) {
      st.ships.forEach((p, e) => {
        const cur = this.ships.get(e);
        if (p < 0) {
          if (cur) {
            this.group.remove(cur.mesh);
            this.ships.delete(e);
            changed = true;
          }
          return;
        }
        if (cur && cur.p === p) return;
        if (cur) this.group.remove(cur.mesh);
        const mesh = this.makeShip(e, p);
        mesh.scale.setScalar(animate ? 0.01 : this.scale);
        this.group.add(mesh);
        const rec = { mesh, p, anim: animate };
        this.ships.set(e, rec);
        if (animate) {
          this.anims.push({ kind: 'pop', rec, t: 0, dur: 0.5 });
          this.spawnDust(mesh.position, 0.9);
        }
        changed = true;
      });
      this.setPirate(st.board.pirate);
    }
    return changed;
  }

  ghost(kind, id, p) {
    if (this.ghostObj) {
      this.group.remove(this.ghostObj);
      this.ghostObj = null;
    }
    if (kind == null || id == null || id < 0) return;
    const mat = new THREE.MeshBasicMaterial({ color: this.players[p].color, transparent: true, opacity: 0.55, depthWrite: false });
    let obj;
    if (kind === 'road') {
      obj = new THREE.Mesh(this.roadGeometry(id, this.players[p].color, this.roadWidth * 1.05), mat);
    } else if (kind === 'ship') {
      obj = this.makeShip(id, p, mat);
      obj.scale.setScalar(this.scale);
    } else {
      obj = this.makeBuilding(id, p, kind === 'city' ? 'c' : 's', mat);
      obj.scale.setScalar(this.scale);
      obj.traverse((o) => {
        o.castShadow = false;
      });
    }
    obj.renderOrder = 5;
    this.ghostObj = obj;
    this.group.add(obj);
  }

  // a building that just earned resources gives a little squash-and-stretch hop
  bump(v, delay = 0) {
    const rec = this.buildings.get(v);
    if (!rec || this.anims.some((a) => a.rec === rec && a.kind === 'pop')) return;
    rec.anim = true;
    this.anims.push({ kind: 'bump', rec, t: -delay, dur: 0.42 });
  }

  update(t, dt) {
    this.timeU.value = t;
    let busy = false;
    // ships ride the swell
    for (const r of this.ships.values()) {
      const ph = r.mesh.userData.phase || 0;
      r.mesh.position.y = 0.04 + Math.sin(t * 1.5 + ph) * 0.05;
      r.mesh.rotation.x = Math.sin(t * 1.2 + ph) * 0.04;
      if (!r.anim && r.mesh.scale.x !== this.scale) r.mesh.scale.setScalar(this.scale);
    }
    if (this.pirate) {
      this.pirate.mesh.position.y = 0.04 + Math.sin(t * 1.3) * 0.06;
      this.pirate.mesh.rotation.z = Math.sin(t * 1.1) * 0.04;
      // (larger when far away, like the ships and buildings)
      if (this.pirate.mesh.scale.x !== 1.25 * this.scale) this.pirate.mesh.scale.setScalar(1.25 * this.scale);
    }
    this.anims = this.anims.filter((a) => {
      a.t += dt;
      if (a.t < 0) return true;
      const k = Math.min(1, a.t / a.dur);
      busy = true;
      if (a.kind === 'bump') {
        const b = Math.sin(Math.PI * k) * (1 - 0.35 * k);
        const sq = Math.sin(Math.PI * Math.min(1, k * 1.6)) * 0.07 * (1 - k);
        a.rec.mesh.scale.set(this.scale * (1 - 0.06 * b + sq), this.scale * (1 + 0.2 * b - sq), this.scale * (1 - 0.06 * b + sq));
        if (k >= 1) {
          a.rec.mesh.scale.setScalar(this.scale);
          if (!this.anims.some((o) => o !== a && o.rec === a.rec && o.t < o.dur)) a.rec.anim = false;
        }
      } else if (a.kind === 'pop') {
        a.rec.mesh.scale.setScalar(Math.max(0.01, easeOutBack(k)) * this.scale);
        if (k >= 1) a.rec.anim = false;
      } else if (a.kind === 'road') {
        const e = easeOutBack(k);
        a.rec.mesh.scale.set(Math.max(0.01, e), 1, Math.max(0.01, e));
        if (k >= 1) {
          a.rec.mesh.geometry.translate(a.rec.offset.x, 0, a.rec.offset.z);
          a.rec.mesh.position.set(0, 0, 0);
          a.rec.mesh.scale.set(1, 1, 1);
          a.rec.anim = false;
        }
      }
      return k < 1;
    });
    this.dust = this.dust.filter((d) => {
      d.t += dt;
      const k = d.t / 0.7;
      d.m.scale.setScalar((1 + k * 2.2) * d.size * this.scale);
      d.m.material.opacity = 0.7 * (1 - k);
      if (k >= 1) {
        this.group.remove(d.m);
        d.m.geometry.dispose();
        d.m.material.dispose();
      }
      return k < 1;
    });
    return busy;
  }
}

// ───────────────────────── harbors ─────────────────────────
// (the moored ships, piers and props; detailed models replace the stand-ins once loaded)
export { buildHarbors } from './harbors.js';
export { modelPart, modelMaterial, METRE };
