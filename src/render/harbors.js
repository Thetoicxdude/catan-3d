// Harbors: a pier out into the sea with a ship moored alongside, paths up to the two harbor corners
// and, at the 3:1 harbors, a stone beacon tower with a signal fire. With the realistic asset pack the
// pier is built from Poly Haven's modular wooden pier, the ships are its pinnace and Dutch galleon
// and the beacon its fort tower; until then simple stand-ins are drawn.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GEO } from '../engine/geometry.js';
import { part, merge } from './geo.js';
import { modelMaterial, part as modelPart } from './models.js';

const RES_COLORS = { wood: '#2f6b2f', brick: '#b5532c', wool: '#8fcf4f', grain: '#e8c547', ore: '#8d8d96', any: '#f3ede0' };

// the whole harbour (pier, cargo, ship, beacon) at a size that reads from the strategic view
const HS = 1.6;
const PIER_S = 0.34 * HS; // world units per metre for the pier kit
const DECK_Y = 0.36 * HS; // deck height above the sea
const SHIP_S = 0.085 * HS;
// pier sections from the land out to sea, with their deck heights (model metres)
const PIER_RUN = [
  ['section_02', 3.6],
  ['section_01', 3.2],
  ['section_02', 3.6],
  ['section_04', 3.3],
];
const SHIPS = {
  pinnace: { along: 'z', water: 3.1 },
  dutch: { along: 'x', water: 2.7 },
};

// ── a flickering signal fire (camera-facing, additive) ──
function fireMaterial(timeU) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: timeU },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
        mv.xy += position.xy * sc;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 p = vUv - vec2(0.5, 0.0);
        float n = n2(vec2(p.x * 5.0, p.y * 4.0 - uTime * 3.4)) * 0.6 + n2(vec2(p.x * 11.0, p.y * 9.0 - uTime * 6.0)) * 0.4;
        float w = 0.34 * (1.0 - p.y * 0.85);
        float flame = smoothstep(w, w * 0.2, abs(p.x + (n - 0.5) * 0.18 * p.y)) * smoothstep(0.95, 0.15, p.y + (n - 0.5) * 0.35);
        float core = flame * smoothstep(0.55, 0.0, p.y);
        vec3 col = mix(vec3(1.0, 0.32, 0.04), vec3(1.0, 0.86, 0.45), core);
        float glow = exp(-dot(p - vec2(0.0, 0.25), p - vec2(0.0, 0.25)) * 9.0) * 0.18;
        gl_FragColor = vec4(col * (flame * 1.7 + glow), 1.0);
      }`,
  });
}

// a cobbled path that follows the ground from a to b (untinted street texture)
function pathGeometry(terrain, ax, az, bx, bz, w) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const px = -dz / len;
  const pz = dx / len;
  const S = Math.max(6, Math.round(len * 1.6));
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= S; i++) {
    const t = i / S;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    for (const side of [-1, 1]) {
      const x = cx + px * w * side;
      const z = cz + pz * w * side;
      pos.push(x, Math.max(terrain.heightAt(x, z), 0.04) + 0.035, z);
      uv.push((side * w) / 0.42, (t * len) / 0.42);
    }
    if (i < S) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function placed(geo, s, x, y, z, ry = 0) {
  const g = geo.clone();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));
  g.applyMatrix4(m);
  return g;
}

export function buildHarbors(board, terrain, models = null, timeU = { value: 0 }) {
  const group = new THREE.Group();
  group.name = 'harbors';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const real = !!(models && models.pier && models.ships);
  const ships = [];
  const anchors = [];
  const pathMat = real && models.street ? new THREE.MeshStandardMaterial({ map: models.street.d, normalMap: models.street.n, roughnessMap: models.street.arm, aoMap: models.street.arm, roughness: 1, metalness: 0 }) : null;
  if (pathMat) pathMat.normalScale.set(1, -1);
  const fireMat = fireMaterial(timeU);
  board.harbors.forEach((hb, hi) => {
    const e = GEO.edges[hb.edge];
    const n = e.outward;
    // find the shoreline along the outward normal
    let s0 = 0;
    for (let s = 0; s < 12; s += 0.1) {
      if (terrain.heightAt(e.x + n.x * s, e.z + n.z * s) < 0.05) {
        s0 = s;
        break;
      }
    }
    const ang = Math.atan2(n.x, n.z);
    const L = 5.2 * HS;
    const start = s0 - 1.4;
    // local frame: +z points out to sea along the pier, +x to its side
    const local = (lx, lz) => ({ x: e.x + n.x * lz + n.z * lx, z: e.z + n.z * lz - n.x * lx });

    if (real) {
      // ── the pier: modular sections merged into one mesh ──
      const pierModel = models.pier;
      const geos = [];
      let z = start;
      PIER_RUN.forEach(([name, deck], k) => {
        const g = modelPart(pierModel, name);
        if (!g) return;
        if (!g.boundingBox) g.computeBoundingBox();
        const len = (g.boundingBox.max.z - g.boundingBox.min.z) * PIER_S;
        geos.push(placed(g, PIER_S, 0, DECK_Y - deck * PIER_S, z + len / 2, (hi + k) % 2 ? Math.PI : 0));
        z += len * 0.97;
      });
      const pierGeo = mergeGeometries(geos);
      const pier = new THREE.Mesh(pierGeo, modelMaterial(pierModel));
      pier.position.set(e.x, 0, e.z);
      pier.rotation.y = ang;
      pier.castShadow = true;
      pier.receiveShadow = true;
      group.add(pier);

      // ── cargo on the landward end ──
      if (models.props) {
        const pm = modelMaterial(models.props);
        const cargo = [];
        const crate = modelPart(models.props, 'wooden_crate_01');
        const bucket = modelPart(models.props, 'wooden_bucket_01');
        const handle = modelPart(models.props, 'bucket_01_handle');
        if (crate) cargo.push(placed(crate, PIER_S * 0.85, 0.14 * HS, DECK_Y, start + 0.55 * HS, 0.3 + hi));
        if (crate && hi % 2) cargo.push(placed(crate, PIER_S * 0.85, 0.12 * HS, DECK_Y + 0.27 * HS, start + 0.58 * HS, 1.1 + hi));
        if (bucket) cargo.push(placed(bucket, PIER_S * 0.9, -0.22 * HS, DECK_Y, start + 1.05 * HS, hi));
        if (handle) cargo.push(placed(handle, PIER_S * 0.9, -0.22 * HS, DECK_Y, start + 1.05 * HS, hi));
        if (cargo.length) {
          const c = new THREE.Mesh(mergeGeometries(cargo), pm);
          c.position.copy(pier.position);
          c.rotation.y = ang;
          c.castShadow = true;
          group.add(c);
        }
      }

      // ── the moored ship ──
      const kind = hi % 3 === 1 && models.ships.dutch ? 'dutch' : 'pinnace';
      const sm = models.ships[kind] || models.ships.pinnace;
      const spec = SHIPS[kind];
      const ship = new THREE.Group();
      const hull = new THREE.Mesh(modelPart(sm), modelMaterial(sm, { alpha: true }));
      hull.scale.setScalar(SHIP_S);
      hull.position.y = -spec.water * SHIP_S;
      // lay the hull along the pier
      if (spec.along === 'x') hull.rotation.y = Math.PI / 2;
      hull.castShadow = true;
      hull.receiveShadow = true;
      ship.add(hull);
      const side = hi % 2 ? 1 : -1;
      const sp = local(side * 1.15 * HS, start + L - 1.25 * HS);
      ship.position.set(sp.x, 0, sp.z);
      ship.rotation.y = ang + (hi % 2 ? 0.05 : -0.05);
      group.add(ship);
      ships.push({ ship, ph: hi * 1.7, roll: 0.022 });

      // ── paths from the pier up to both harbor corners ──
      if (pathMat) {
        const a = local(0, start + 0.05);
        for (const vid of e.v) {
          const V = GEO.vertices[vid];
          const dx = V.x - a.x;
          const dz = V.z - a.z;
          const len = Math.hypot(dx, dz);
          const b = { x: V.x - (dx / len) * 1.25, z: V.z - (dz / len) * 1.25 };
          const p = new THREE.Mesh(pathGeometry(terrain, a.x, a.z, b.x, b.z, 0.2), pathMat);
          p.receiveShadow = true;
          group.add(p);
        }
      }

      // ── beacon tower with a signal fire at the 3:1 harbors ──
      if (hb.type === 'any' && models.fort) {
        const bp = local(1.75 * HS, start - 0.55 * HS);
        const gy = Math.max(terrain.heightAt(bp.x, bp.z), 0.05);
        const TS = 0.085 * HS;
        const tower = new THREE.Mesh(modelPart(models.fort, 'tower_round'), modelMaterial(models.fort));
        tower.scale.setScalar(TS);
        tower.position.set(bp.x, gy - 0.08, bp.z);
        tower.castShadow = true;
        tower.receiveShadow = true;
        group.add(tower);
        const top = gy - 0.08 + 11.5 * TS;
        const pit = modelPart(models.props, 'stone_fire_pit');
        if (pit) {
          const pm = new THREE.Mesh(pit, modelMaterial(models.props));
          pm.scale.setScalar(0.32 * HS);
          pm.position.set(bp.x, top, bp.z);
          pm.castShadow = true;
          group.add(pm);
        }
        const fire = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), fireMat);
        fire.scale.set(0.5 * HS, 0.75 * HS, 1);
        fire.position.set(bp.x, top + 0.04, bp.z);
        fire.renderOrder = 3;
        fire.frustumCulled = false;
        group.add(fire);
      }
    } else {
      // ── stand-ins until the models arrive ──
      // (built at the kit's own size; the mesh is scaled up by HS about the pier's landward end)
      const L0 = L / HS;
      const parts = [];
      parts.push(part(new THREE.BoxGeometry(0.95, 0.12, L0), '#8a6a48', { z: start + L0 / 2, y: 0.34 }));
      for (let k = 0; k <= 4; k++) {
        const z = start + 0.4 + (k * (L0 - 0.6)) / 4;
        parts.push(part(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 5), '#4a3524', { x: 0.46, y: -0.25, z }));
        parts.push(part(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 5), '#4a3524', { x: -0.46, y: -0.25, z }));
      }
      parts.push(part(new THREE.BoxGeometry(0.5, 0.4, 0.5), '#9a7a55', { x: 0.2, y: 0.6, z: start + 0.6 }));
      parts.push(part(new THREE.BoxGeometry(0.36, 0.32, 0.36), RES_COLORS[hb.type], { x: -0.22, y: 0.56, z: start + 1.05 }));
      if (hb.type === 'any') {
        const lz = start - 0.4;
        const lx = 1.7;
        for (let b = 0; b < 5; b++) {
          parts.push(part(new THREE.CylinderGeometry(0.32 - b * 0.035, 0.36 - b * 0.035, 0.5, 10), b % 2 ? '#b8342a' : '#f2eee6', { x: lx, y: 0.25 + b * 0.5, z: lz }));
        }
        parts.push(part(new THREE.CylinderGeometry(0.24, 0.24, 0.32, 8), '#ffe6a0', { x: lx, y: 2.66, z: lz }));
        parts.push(part(new THREE.ConeGeometry(0.3, 0.36, 8), '#3a3a3a', { x: lx, y: 3.0, z: lz }));
      }
      const pier = new THREE.Mesh(merge(parts), mat);
      pier.position.set(e.x + n.x * start * (1 - HS), 0, e.z + n.z * start * (1 - HS));
      pier.rotation.y = ang;
      pier.scale.setScalar(HS);
      pier.castShadow = true;
      pier.receiveShadow = true;
      group.add(pier);
      for (const vid of e.v) {
        const V = GEO.vertices[vid];
        const ax = e.x + n.x * (s0 - 1.3);
        const az = e.z + n.z * (s0 - 1.3);
        const dx = V.x - ax;
        const dz = V.z - az;
        const len = Math.hypot(dx, dz);
        const ux = dx / len;
        const uz = dz / len;
        const steps = 10;
        const pos = [];
        const hw = 0.24;
        const span = len - 1.7;
        let prev = null;
        for (let k = 0; k <= steps; k++) {
          const d = (k / steps) * span;
          const x = ax + ux * d;
          const z = az + uz * d;
          const y = Math.max(0.32, terrain.heightAt(x, z) + 0.07);
          const cur = [x - uz * hw, y, z + ux * hw, x + uz * hw, y, z - ux * hw];
          if (prev) pos.push(...prev.slice(0, 3), ...cur.slice(0, 3), ...prev.slice(3), ...prev.slice(3), ...cur.slice(0, 3), ...cur.slice(3));
          prev = cur;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        const walk = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.9, side: THREE.DoubleSide }));
        walk.receiveShadow = true;
        group.add(walk);
      }
      const sx = e.x + n.x * (start + L + 1.4);
      const sz = e.z + n.z * (start + L + 1.4);
      const ship = new THREE.Group();
      const hull = new THREE.Mesh(
        merge([
          part(new THREE.BoxGeometry(0.9, 0.42, 2.2), '#5e4230', { y: 0.12 }),
          part(new THREE.ConeGeometry(0.45, 0.8, 4), '#5e4230', { y: 0.12, z: 1.45, rx: Math.PI / 2, ry: Math.PI / 4, sy: 1 }),
          part(new THREE.CylinderGeometry(0.04, 0.05, 2.3, 5), '#3b2a1c', { y: 1.35 }),
          part(new THREE.BoxGeometry(0.95, 0.06, 2.0), '#8a6a48', { y: 0.34 }),
        ]),
        mat,
      );
      const sail = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.25),
        new THREE.MeshStandardMaterial({ color: hb.type === 'any' ? 0xf3ede0 : new THREE.Color(RES_COLORS[hb.type]).lerp(new THREE.Color('#f3ede0'), 0.35), side: THREE.DoubleSide, roughness: 0.85 }),
      );
      sail.position.set(0, 1.5, 0.05);
      ship.add(hull, sail);
      ship.position.set(sx + n.z * 1.2 * HS, 0, sz - n.x * 1.2 * HS);
      ship.rotation.y = ang;
      ship.scale.setScalar(HS);
      group.add(ship);
      ships.push({ ship, ph: Math.random() * 6, roll: 0.04 });
    }
    // the badge floats out at sea past the pier and its ship (so it never hides them), with a line
    // back to the stretch of coast the harbour serves
    anchors.push({
      harbor: hb,
      pos: new THREE.Vector3(e.x + n.x * (start + L + 4.4), 1.2, e.z + n.z * (start + L + 4.4)),
      shore: new THREE.Vector3(e.x + n.x * s0, 0.5, e.z + n.z * s0),
    });
  });
  function update(t) {
    timeU.value = t;
    for (const s of ships) {
      s.ship.position.y = Math.sin(t * 1.4 + s.ph) * 0.05;
      s.ship.rotation.z = Math.sin(t * 1.1 + s.ph) * s.roll;
      s.ship.rotation.x = Math.sin(t * 0.8 + s.ph * 1.3) * s.roll * 0.4;
    }
  }
  return { group, update, anchors };
}
