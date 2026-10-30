// Animated farm animals (Quaternius, CC0). Each skinned glTF is baked once into a vertex-animation
// texture (one row per frame, one column per vertex), so a whole herd is a single instanced draw:
// the vertex shader plays each animal's clip from the texture. A tiny state machine per animal
// grazes, wanders and hops; soft blob shadows keep them on the ground.
import * as THREE from 'three';

const _v = new THREE.Vector3();

// palette tweaks per glTF material name (linear RGB); unknown names keep their own colour
const PALETTE = {
  sheep: { White: [0.86, 0.83, 0.76], Black: [0.05, 0.045, 0.04] },
  cow: { White: [0.88, 0.86, 0.8], Black: [0.04, 0.035, 0.03], Pink: [0.7, 0.33, 0.33] },
  horse: {},
  pig: {},
};

export function bakeAnimal(name, gltf, { length, fps = 12 }) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh) meshes.push(o);
  });
  const pal = PALETTE[name] || {};
  // unique vertices (flat-shaded models: position + colour identify a vertex)
  const verts = [];
  const ids = new Map();
  const index = [];
  meshes.forEach((m) => {
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const c = pal[mat.name] ? new THREE.Color().setRGB(...pal[mat.name]) : mat.color.clone();
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k++) {
      const vi = idx ? idx.getX(k) : k;
      const key = `${pos.getX(vi).toFixed(3)},${pos.getY(vi).toFixed(3)},${pos.getZ(vi).toFixed(3)}|${c.getHexString()}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = verts.length;
        ids.set(key, id);
        verts.push({ m, vi, c });
      }
      index.push(id);
    }
  });
  const nv = verts.length;
  const mixer = new THREE.AnimationMixer(root);
  const clips = [];
  const frames = [];
  for (const clip of gltf.animations) {
    const count = Math.max(2, Math.round(clip.duration * fps));
    clips.push({ name: clip.name, row: frames.length, frames: count, fps: count / clip.duration, duration: clip.duration });
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    for (let f = 0; f < count; f++) {
      mixer.setTime((f / count) * clip.duration);
      root.updateMatrixWorld(true);
      const row = new Float32Array(nv * 3);
      for (let i = 0; i < nv; i++) {
        const { m, vi } = verts[i];
        _v.fromBufferAttribute(m.geometry.attributes.position, vi);
        m.applyBoneTransform(vi, _v);
        _v.applyMatrix4(m.matrixWorld);
        row[i * 3] = _v.x;
        row[i * 3 + 1] = _v.y;
        row[i * 3 + 2] = _v.z;
      }
      frames.push(row);
    }
  }
  mixer.stopAllAction();
  // normalise on the first frame of the idle clip: centred, feet on y = 0, body `length` long (+Z ahead)
  const idle = clips.find((c) => /idle/i.test(c.name)) || clips[0];
  const ref = frames[idle.row];
  const box = new THREE.Box3();
  for (let i = 0; i < nv; i++) box.expandByPoint(_v.set(ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]));
  const s = length / Math.max(1e-6, box.max.z - box.min.z);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const data = new Float32Array(nv * frames.length * 4);
  frames.forEach((row, r) => {
    for (let i = 0; i < nv; i++) {
      const o = (r * nv + i) * 4;
      data[o] = (row[i * 3] - cx) * s;
      data[o + 1] = (row[i * 3 + 1] - box.min.y) * s;
      data[o + 2] = (row[i * 3 + 2] - cz) * s;
      data[o + 3] = 1;
    }
  });
  const vat = new THREE.DataTexture(data, nv, frames.length, THREE.RGBAFormat, THREE.FloatType);
  vat.minFilter = vat.magFilter = THREE.NearestFilter;
  vat.needsUpdate = true;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    pos.set(data.subarray((idle.row * nv + i) * 4, (idle.row * nv + i) * 4 + 3), i * 3);
    col.set([verts[i].c.r, verts[i].c.g, verts[i].c.b], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return { name, geo, vat, clips, length, height: (box.max.y - box.min.y) * s, width: (box.max.x - box.min.x) * s };
}

function vatMaterial(baked, timeU) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uVat = { value: baked.vat };
    s.uniforms.uTime = timeU;
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uVat;
uniform float uTime;
attribute vec4 aAnim; // first row, frame count, fps, start time`,
      )
      .replace(
        '#include <begin_vertex>',
        `float fr = max(uTime - aAnim.w, 0.0) * aAnim.z;
  float f0 = mod(floor(fr), aAnim.y);
  float f1 = mod(f0 + 1.0, aAnim.y);
  vec3 p0 = texelFetch(uVat, ivec2(gl_VertexID, int(aAnim.x + f0)), 0).xyz;
  vec3 p1 = texelFetch(uVat, ivec2(gl_VertexID, int(aAnim.x + f1)), 0).xyz;
  vec3 transformed = mix(p0, p1, fract(fr));`,
      );
  };
  m.customProgramCacheKey = () => 'vat-animal-v1';
  return m;
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// behaviour per species: walking clip, speed (units/s), idle range (s), walk range (s)
const BEHAVIOUR = {
  sheep: { walk: null, hop: 'Jump', hopDist: 0.32, idle: [5, 16] },
  pig: { walk: null, hop: 'Jump', hopDist: 0.26, idle: [5, 14] },
  cow: { walk: 'WalkSlow', speed: 0.16, idle: [4, 14], walkFor: [2.5, 7] },
  horse: { walk: 'WalkSlow', speed: 0.2, idle: [4, 12], walkFor: [2.5, 8], run: 'Walk' },
};

// spots: [{type, x, z, yaw, home:{x, z, r}}]; ok(x, z) → may stand there
export function buildHerds(baked, spots, terrain, ok, rnd) {
  const group = new THREE.Group();
  group.name = 'animals';
  const timeU = { value: 0 };
  const dummy = new THREE.Object3D();
  const kinds = {};
  for (const sp of spots) (kinds[sp.type] = kinds[sp.type] || []).push(sp);
  const blobTex = blobTexture();
  const herds = [];
  let blobCount = 0;
  for (const [type, list] of Object.entries(kinds)) {
    const b = baked[type];
    if (!b) continue;
    const anim = new Float32Array(list.length * 4);
    const attr = new THREE.InstancedBufferAttribute(anim, 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    const geo = b.geo.clone();
    geo.setAttribute('aAnim', attr);
    const im = new THREE.InstancedMesh(geo, vatMaterial(b, timeU), list.length);
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = true;
    im.name = 'herd-' + type;
    group.add(im);
    const clip = (n) => b.clips.find((c) => c.name === n) || b.clips[0];
    const idleClip = clip('Idle');
    const beh = BEHAVIOUR[type] || BEHAVIOUR.sheep;
    const animals = list.map((sp, i) => {
      const a = { ...sp, i, state: 'idle', until: null, t0: 0, turn: 0, goal: sp.yaw };
      setClip(a, idleClip, -rnd() * 6); // desynchronised idles
      return a;
    });
    function setClip(a, c, start) {
      anim.set([c.row, c.frames, c.fps, start], a.i * 4);
      attr.needsUpdate = true;
      a.clip = c;
      a.t0 = start;
    }
    herds.push({ type, im, animals, beh, clip, setClip, idleClip, b, blob0: blobCount });
    blobCount += list.length;
  }
  const blobs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }),
    Math.max(1, blobCount),
  );
  blobs.count = blobCount;
  blobs.frustumCulled = false;
  blobs.renderOrder = 1;
  group.add(blobs);

  function place(h, a) {
    const y = terrain.heightAt(a.x, a.z);
    dummy.position.set(a.x, y - 0.01, a.z);
    dummy.rotation.set(0, a.yaw, 0);
    dummy.scale.setScalar(a.s || 1);
    dummy.updateMatrix();
    h.im.setMatrixAt(a.i, dummy.matrix);
    dummy.position.y = y + 0.015;
    dummy.rotation.set(0, a.yaw, 0);
    dummy.scale.set(h.b.width * 1.5 * (a.s || 1), 1, h.b.length * 1.05 * (a.s || 1));
    dummy.updateMatrix();
    blobs.setMatrixAt(h.blob0 + a.i, dummy.matrix);
  }
  for (const h of herds) for (const a of h.animals) place(h, a);

  function update(t, dt) {
    timeU.value = t;
    for (const h of herds) {
      const { beh } = h;
      for (const a of h.animals) {
        // first frame: stagger everyone's first activity from now (the herd may arrive mid-game)
        if (a.until === null) a.until = t + 1 + rnd() * beh.idle[1];
        if (t >= a.until) {
          // next activity
          if (a.state === 'idle') {
            if (beh.walk) {
              const ang = a.yaw + (rnd() - 0.5) * 2.4;
              a.goal = ang;
              a.state = 'walk';
              a.until = t + beh.walkFor[0] + rnd() * (beh.walkFor[1] - beh.walkFor[0]);
              h.setClip(a, h.clip(beh.walk), t);
            } else {
              const c = h.clip(beh.hop);
              a.goal = a.yaw + (rnd() - 0.5) * 1.6;
              a.state = 'hop';
              a.until = t + c.duration;
              h.setClip(a, c, t);
            }
          } else {
            a.state = 'idle';
            a.until = t + beh.idle[0] + rnd() * (beh.idle[1] - beh.idle[0]);
            h.setClip(a, h.idleClip, t);
          }
        }
        if (a.state === 'idle') continue;
        // head home when straying
        const hx = a.home.x - a.x;
        const hz = a.home.z - a.z;
        if (hx * hx + hz * hz > a.home.r * a.home.r) a.goal = Math.atan2(hx, hz);
        let d = a.goal - a.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        a.yaw += Math.max(-1.2 * dt, Math.min(1.2 * dt, d));
        const ph = Math.min(1, Math.max(0, (t - a.t0) / a.clip.duration));
        const sp = a.state === 'walk' ? beh.speed : (beh.hopDist / a.clip.duration) * 1.5 * Math.sin(Math.PI * ph);
        const nx = a.x + Math.sin(a.yaw) * sp * dt * (a.s || 1);
        const nz = a.z + Math.cos(a.yaw) * sp * dt * (a.s || 1);
        if (ok(nx, nz)) {
          a.x = nx;
          a.z = nz;
        } else {
          a.goal = a.yaw + Math.PI * (0.6 + rnd() * 0.8);
        }
        place(h, a);
      }
      h.im.instanceMatrix.needsUpdate = true;
    }
    blobs.instanceMatrix.needsUpdate = true;
  }

  return { group, update, count: blobCount };
}
