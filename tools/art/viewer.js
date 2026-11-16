// A light stage for the development mode's models (src/render/devmodels.js): the asset pack's materials,
// the map's sun and sky, a patch of ground, the models in a row at the map's camera angle.
//   node build.mjs tools/art/viewer.js dist/viewer.html
//   then dist/viewer.test.html?show=b:granary,b:market,w:gardens:1&h=14&color=%23c0392b (tools/art/viewshot.py)
import * as THREE from 'three';
import { loadAssets } from '../../src/render/assets.js';
import { devGroup } from '../../src/render/devmesh.js';
import { buildingParts } from '../../src/render/models.js';
import { impostorMesh } from '../../src/render/impostors.js';

const q = new URLSearchParams(location.search);
const SUN = new THREE.Vector3(-0.55, 0.78, 0.42).normalize();
const W = innerWidth;
const H = innerHeight;
document.body.style.margin = '0';
document.body.style.background = '#222';
const app = document.getElementById('app') || document.body;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fb9cf');

function sky() {
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSun: { value: SUN.clone() } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uSun; varying vec3 vDir; void main() { vec3 d = normalize(vDir);
      vec3 zenith = vec3(0.16, 0.30, 0.62); vec3 horizon = vec3(0.70, 0.78, 0.86); vec3 ground = vec3(0.21, 0.20, 0.15);
      vec3 col = d.y > 0.0 ? mix(horizon, zenith, pow(d.y, 0.55)) : mix(horizon * 0.55, ground, smoothstep(0.0, 0.25, -d.y));
      float k = max(dot(d, normalize(uSun)), 0.0); col += vec3(1.0, 0.9, 0.72) * (pow(k, 900.0) * 60.0 + pow(k, 24.0) * 0.6);
      gl_FragColor = vec4(col, 1.0); }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02);
  return rt.texture;
}
scene.environment = sky();
scene.environmentIntensity = 0.75;
scene.add(new THREE.HemisphereLight(0xd8e6f2, 0x5b5a3e, 0.55));
const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
sun.position.copy(SUN).multiplyScalar(60);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -30;
sc.right = 30;
sc.top = 30;
sc.bottom = -30;
sc.near = 5;
sc.far = 160;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

(async () => {
  const pack = await loadAssets(q.get('quality') || 'high');
  const models = pack && pack.models ? pack.models : null;
  const color = q.get('color') || '#c0392b';
  const ground = q.get('ground') || '#7d8f4e';
  const g = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: ground, roughness: 1 }));
  g.receiveShadow = true;
  scene.add(g);
  const items = (q.get('show') || 'b:granary').split(',');
  const gap = +(q.get('gap') || 2.4);
  const labels = [];
  let x = (-(items.length - 1) * gap) / 2;
  for (const it of items) {
    const [kind, k, extra] = it.split(':');
    let o;
    if (kind === 's' || kind === 'c') {
      // a village or a city of the pack, to compare sizes
      o = new THREE.Group();
      for (const m of buildingParts(models, kind, color, 0)) o.add(m);
    } else o = devGroup(models, kind, k, kind === 'b' ? null : extra === undefined ? 1 : isNaN(+extra) ? extra : +extra, color, { impostors: kind === 'w' && !!pack.imp });
    // (a wonder's plants: the map's own photographed ones)
    const local = (o.userData && o.userData.plants) || [];
    if (local.length) {
      const by = {};
      for (const p of local) {
        const def = pack.imp[p.sp];
        if (!def) continue;
        (by[p.sp] = by[p.sp] || []).push({ x: p.x + x, y: p.y, z: p.z, yaw: Math.random() * 6.28, s: p.h / def.meta.h, ph: Math.random() * 100, tint: Math.random() });
      }
      for (const [sp, pts] of Object.entries(by)) scene.add(impostorMesh(pack.imp[sp], pts, { time: { value: 0 }, sunDir: { value: SUN.clone() } }, sp));
    }
    o.position.x = x;
    o.rotation.y = +(q.get('ry') || 0);
    scene.add(o);
    labels.push({ x, text: it });
    x += gap;
  }
  const cam = new THREE.PerspectiveCamera(36, W / H, 0.1, 500);
  const h = +(q.get('h') || 9);
  const pitch = (+(q.get('pitch') || 50) * Math.PI) / 180;
  const yaw = +(q.get('yaw') || 0);
  const ty = +(q.get('ty') || 0.5);
  const tz = +(q.get('tz') || 0);
  cam.position.set(Math.sin(yaw) * Math.sin(pitch) * h, ty + Math.cos(pitch) * h, tz + Math.cos(yaw) * Math.sin(pitch) * h);
  cam.lookAt(0, ty, tz);
  renderer.render(scene, cam);
  window.__info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  // names under each
  for (const l of labels) {
    const v = new THREE.Vector3(l.x, 0, 1.2).project(cam);
    const d = document.createElement('div');
    d.textContent = l.text;
    Object.assign(d.style, { position: 'fixed', left: ((v.x + 1) / 2) * W + 'px', top: ((1 - v.y) / 2) * H + 'px', transform: 'translate(-50%,0)', font: '13px sans-serif', color: '#fff', textShadow: '0 1px 2px #000' });
    document.body.appendChild(d);
  }
  window.__ready = true;
})();
