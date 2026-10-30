// Runs in headless Chromium. Bakes hemi-octahedral impostor atlases (albedo + normals) from the
// photo-scanned foliage, and converts the animated FBX animals to GLB.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);

// direction (y up) for an octahedral grid coordinate in [-1, 1]^2 — must match the game shader
export function hemiOctDecode(u, v) {
  const ox = (u + v) * 0.5;
  const oz = (u - v) * 0.5;
  return new THREE.Vector3(ox, 1 - Math.abs(ox) - Math.abs(oz), oz).normalize();
}

const NORMAL_VS = /* glsl */ `
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const NORMAL_FS = /* glsl */ `
  uniform sampler2D map;
  uniform float useMap;
  uniform float alphaTest;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    float a = useMap > 0.5 ? texture2D(map, vUv).a : 1.0;
    if (a < alphaTest) discard;
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
  }`;
// albedo with a rotation-invariant sky term: surfaces facing down (inside the crown) read darker
const ALBEDO_FS = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D aoMap;
  uniform float useMap;
  uniform float useAo;
  uniform vec3 color;
  uniform float alphaTest;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vec4 t = useMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
    if (t.a < alphaTest) discard;
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    float ao = useAo > 0.5 ? texture2D(aoMap, vUv).r : 1.0;
    float sky = 0.62 + 0.38 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 c = t.rgb * color * mix(1.0, ao, 0.85) * sky;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

function loadGLTF(url) {
  return new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
}

function passMaterials(obj, pass, override) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.userData.srcMat || o.material;
    o.userData.srcMat = src;
    const cut = src.alphaTest > 0 || src.transparent;
    let alphaTest = src.alphaTest > 0 ? src.alphaTest : src.transparent ? 0.3 : 0;
    let map = src.map || null;
    if (override && cut) {
      map = override;
      alphaTest = 0.5;
    }
    const uniforms = {
      map: { value: map },
      aoMap: { value: src.aoMap || null },
      useMap: { value: map ? 1 : 0 },
      useAo: { value: src.aoMap ? 1 : 0 },
      color: { value: src.color ? src.color.clone() : new THREE.Color(1, 1, 1) },
      alphaTest: { value: alphaTest },
    };
    o.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: NORMAL_VS,
      fragmentShader: pass === 'normal' ? NORMAL_FS : ALBEDO_FS,
      side: THREE.DoubleSide,
    });
  });
}

window.bakeImpostor = async ({ url, node, G = 8, F = 128, SS = 2, mapOverride = null }) => {
  const gltf = await loadGLTF(url);
  let override = null;
  if (mapOverride) {
    override = await new THREE.TextureLoader().loadAsync(mapOverride);
    override.flipY = false;
    override.colorSpace = THREE.SRGBColorSpace;
  }
  let src = node ? gltf.scene.getObjectByName(node) : gltf.scene;
  if (!src) throw new Error('node not found: ' + node);
  const obj = src.clone(true);
  obj.position.set(0, 0, 0);
  const holder = new THREE.Group();
  holder.add(obj);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  holder.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(holder);
  // tight bounding sphere around the vertices, centred on the box centre
  const C = b2.getCenter(new THREE.Vector3());
  let R = 0;
  const v = new THREE.Vector3();
  holder.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      R = Math.max(R, v.distanceTo(C));
    }
  });
  R *= 1.02;
  const scene = new THREE.Scene();
  scene.add(holder);
  const size = G * F * SS;
  renderer.setSize(size, size, false);
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, R * 6);
  const out = {};
  for (const pass of ['albedo', 'normal']) {
    passMaterials(holder, pass, override);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.setScissorTest(true);
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const d = hemiOctDecode(((i + 0.5) / G) * 2 - 1, ((j + 0.5) / G) * 2 - 1);
        cam.position.copy(C).addScaledVector(d, R * 3);
        cam.up.set(0, 1, 0);
        cam.lookAt(C);
        cam.updateMatrixWorld(true);
        const x0 = i * F * SS;
        const y0 = size - (j + 1) * F * SS; // frame (i, j) sits at row j from the top of the image
        renderer.setViewport(x0, y0, F * SS, F * SS);
        renderer.setScissor(x0, y0, F * SS, F * SS);
        renderer.render(scene, cam);
      }
    }
    out[pass] = renderer.domElement.toDataURL('image/png');
  }
  return { color: out.albedo, normal: out.normal, R, C: [C.x, C.y, C.z], height: b2.max.y, width: Math.max(b2.max.x - b2.min.x, b2.max.z - b2.min.z), G, F };
};

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

window.fbxToGlb = async (url) => {
  const obj = await new FBXLoader().loadAsync(url);
  const box = new THREE.Box3().setFromObject(obj);
  const anims = obj.animations.map((a) => ({ name: a.name, duration: +a.duration.toFixed(2), tracks: a.tracks.length }));
  let mats = new Set();
  let tris = 0;
  obj.traverse((o) => {
    if (o.isMesh) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m.type + ':' + (m.color ? m.color.getHexString() : '')));
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    }
  });
  const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: obj.animations });
  return { glb: toB64(glb), anims, size: box.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(2)), mats: [...mats], tris };
};

window.__bakeReady = true;
