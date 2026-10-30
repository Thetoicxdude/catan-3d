// Detailed buildings, piers, ships and props from the realistic asset pack. Every model is baked to
// one texture atlas: colour (_d), a data map (_m: R ambient occlusion, G roughness, B roof mask,
// A cut-out alpha) and, where it pays off, a normal map (_n).
// Sources (all CC0): medieval half-timbered houses by Daniel74 (Blend Swap); modular fort, wooden
// pier, ships and props from Poly Haven.
import * as THREE from 'three';

export const METRE = 0.16; // world units per metre for buildings (a 13 m house ≈ 2 world units)

const matCache = new Map();

// PBR material for a baked model; `tint` paints the roof (data-map blue channel) in a player colour
export function modelMaterial(model, { tint = null, alpha = false, far = null } = {}) {
  const key = `${model.name}|${tint || ''}|${alpha ? 'a' : ''}`;
  let m = matCache.get(key);
  if (m) return m;
  const { d, m: data, n } = model.maps;
  m = new THREE.MeshStandardMaterial({
    map: d,
    aoMap: data,
    aoMapIntensity: 0.85,
    roughnessMap: data,
    roughness: 1,
    metalness: 0,
    normalMap: n || null,
    side: alpha ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (n) m.normalScale.set(1, -1); // derivative tangents + glTF UV orientation (as GLTFLoader does)
  if (alpha) m.alphaTest = 0.5;
  const uTint = { value: new THREE.Color(tint || '#ffffff') };
  const uFar = far || { value: 0 };
  m.userData.tint = uTint;
  if (tint || alpha) {
    m.onBeforeCompile = (s) => {
      s.uniforms.uTint = uTint;
      s.uniforms.uFar = uFar;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint;\nuniform float uFar;');
      let inj = '';
      if (tint) {
        // painted roof: keep the shingle texture's light and shade, take the hue from the player colour
        inj += `{
          float roof = texture2D(roughnessMap, vRoughnessMapUv).b;
          float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 painted = uTint * (0.42 + 1.25 * l);
          diffuseColor.rgb = mix(diffuseColor.rgb, painted, roof * mix(0.82, 0.97, uFar));
        }`;
      }
      if (alpha) inj += 'diffuseColor.a = texture2D(roughnessMap, vRoughnessMapUv).a;';
      s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + inj);
    };
    m.customProgramCacheKey = () => `baked${tint ? 't' : ''}${alpha ? 'a' : ''}`;
  }
  matCache.set(key, m);
  return m;
}

export function clearModelMaterials() {
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}

// geometry of one part of a model (kits hold several parts: tower, walls, pier sections…)
export function part(model, name) {
  if (!name) return Object.values(model.parts)[0];
  const k = Object.keys(model.parts).find((p) => p.endsWith(name) || p.includes(name));
  return k ? model.parts[k] : null;
}

function mesh(model, partName, mat, { s = METRE, x = 0, y = 0, z = 0, ry = 0 } = {}) {
  const g = part(model, partName);
  if (!g) return null;
  const o = new THREE.Mesh(g, mat);
  o.scale.setScalar(s);
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

// a tamped-earth yard under a building, following the ground (soft-edged, multiplied onto the terrain)
let yardTex = null;
let yardMat = null;
function yardTexture() {
  if (yardTex) return yardTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2);
      const dy = (y - S / 2) / (S / 2);
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const edge = 0.78 + 0.1 * Math.sin(ang * 5 + 1.3) + 0.06 * Math.sin(ang * 11);
      const a = Math.max(0, Math.min(1, (edge - r) / 0.22));
      const n = Math.random();
      const i = (y * S + x) * 4;
      img.data[i] = 120 + n * 30;
      img.data[i + 1] = 98 + n * 24;
      img.data[i + 2] = 70 + n * 18;
      img.data[i + 3] = a * 205;
    }
  }
  g.putImageData(img, 0, 0);
  yardTex = new THREE.CanvasTexture(c);
  yardTex.colorSpace = THREE.SRGBColorSpace;
  return yardTex;
}

export function yardMesh(terrain, cx, cz, radius) {
  const N = 10;
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, N, N).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const base = terrain.heightAt(cx, cz);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setY(i, Math.max(terrain.heightAt(cx + x, cz + z), 0.02) - base + 0.04);
  }
  geo.computeVertexNormals();
  if (!yardMat) yardMat = new THREE.MeshStandardMaterial({ map: yardTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(geo, yardMat);
  m.receiveShadow = true;
  m.renderOrder = 1;
  return m;
}

// ── player pieces ──
// settlement: one half-timbered house, roofed in the player's colour
// city: a stone keep with curtain walls and two town houses
export function buildingParts(models, type, color, v, ghost = null) {
  const out = [];
  const H = models.houses;
  const house = (name, opts) => {
    const md = H[name];
    if (!md) return;
    out.push(mesh(md, null, ghost || modelMaterial(md, { tint: color }), opts));
  };
  const fort = models.fort;
  const fortMat = fort && (ghost || modelMaterial(fort));
  if (type === 'c') {
    if (fort) {
      out.push(mesh(fort, 'tower_round', fortMat, { s: METRE * 0.72, x: 0.15, z: -1.05 }));
      out.push(mesh(fort, 'wall_thin_straight_04', fortMat, { s: METRE * 0.62, x: -1.55, z: -0.95, ry: Math.PI / 2 + 0.18 }));
      out.push(mesh(fort, 'wall_thin_gate_01', fortMat, { s: METRE * 0.62, x: 1.78, z: -0.85, ry: Math.PI / 2 - 0.22 }));
    }
    house('house3', { s: METRE * 0.8, x: -0.95, z: 0.55, ry: 0.12 });
    house(H.house1 ? 'house1' : 'house2', { s: METRE * 0.74, x: 1.05, z: 0.72, ry: -0.18 });
  } else {
    house(v % 2 ? 'house4' : 'house2', { s: METRE * (v % 2 ? 0.92 : 1), ry: 0 });
  }
  return out.filter(Boolean);
}
