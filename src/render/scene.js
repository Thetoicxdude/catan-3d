// MapView: the whole 3D strategy map — renderer, lights, terrain, sea, clouds, scenery,
// pieces, territories, labels, map modes, picking and the render loop.
import * as THREE from 'three';
import { GEO, HEX_SIZE } from '../engine/geometry.js';
import { pips, TERRAIN_RES } from '../engine/board.js';
import { buildTerrain, DOMAIN } from './terrain.js';
import { buildFlora } from './flora.js';
import { loadAssets, assetStatus, onAssetProgress, holdAssetLoading } from './assets.js';
import { PostFX } from './post.js';
import { Pieces, buildHarbors } from './pieces.js';
import { Territory } from './territory.js';
import { StrategyCamera, ZOOM_MIN, ZOOM_MAX } from './camera.js';
import { Markers } from './markers.js';
import { Labels, screenWidth } from './labels.js';
import { FogCover } from './fog.js';
import { GLSL_NOISE } from './noise.js';
import { fpsMode, refreshInterval, refreshesPerFrame, pixelRatioCap, Governor } from './pace.js';
import { resCard, icon, RES_NAMES } from '../ui/icons.js';

// Map labels are sized by the province under them, as it is on screen (seen at a slant, the far
// provinces are narrower than the near ones), so they shrink with the map as it is zoomed out and the
// land always shows round them; labels too small to read fade away (labels.js: ground, px, fadePx).
const HEX_W = HEX_SIZE * 1.732; // a province, flat side to flat side
// A number token (62 px at scale 1): two fifths of its province, 48 px at most. Where provinces are
// small on screen (a phone, a big map) up to three fifths, so the number stays readable at 17 px; on
// still smaller provinces it shrinks with them and is gone below about 13 px.
export function tokenPx(hexPx) {
  let px = Math.min(48, hexPx * 0.4);
  if (px < 17) px = Math.min(17, hexPx * 0.62);
  return px;
}
const TOKEN_FIT = { ground: HEX_W, px: tokenPx, size: 62, fadePx: [12, 15] };
// the robber's badge (41 px) on a province without a token: the size of one
const ROBBER_FIT = { ground: HEX_W, px: tokenPx, size: 41, fadePx: [12, 15] };
// A harbour badge (80 px): out at sea, so it may be a little wider than a token, 66 px at most and 36 px
// while the provinces allow; gone where the coast is too small to tell the harbours apart.
const harborPx = (hexPx) => {
  let px = Math.min(66, hexPx * 0.6);
  if (px < 36) px = Math.min(36, hexPx * 1.1);
  return px;
};
const HARBOR_FIT = { ground: HEX_W, px: harborPx, size: 80, fadePx: [26, 34] };

// (Seafarers, the fog islands) the hexes nobody has explored yet, and a key that changes with every
// discovery
const hiddenFog = (board) => GEO.hexes.filter((h) => board.hexes[h.id].terrain === 'fog').map((h) => h.id);
const fogKey = (board) => (GEO.def.fog ? hiddenFog(board).join('.') : '');

const SUN = new THREE.Vector3(-0.55, 0.78, 0.42).normalize();
// (scratch vectors for the per-frame fits)
const _fitV = new THREE.Vector3();
const _fitA = new THREE.Vector3();
const _fitB = new THREE.Vector3();
const SKY_SRGB = new THREE.Color('#a9c2d2');
// the same horizon colour in display (sRGB) values, for shaders that write their colour directly
const HAZE = new THREE.Vector3(0xa9 / 255, 0xc2 / 255, 0xd2 / 255);

// Full-screen sky gradient drawn behind everything; its horizon matches the fog colour so the
// sea fades into the sky when the camera is tilted toward the horizon.
function skyMesh() {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uHaze: { value: HAZE.clone() },
        uZenith: { value: new THREE.Vector3(0.33, 0.52, 0.74) },
        uSun: { value: SUN.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vNdc;
        void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform mat4 uInvProj;
        uniform mat4 uCamWorld;
        uniform vec3 uHaze, uZenith, uSun;
        varying vec2 vNdc;
        void main() {
          vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0);
          vec3 dir = normalize(mat3(uCamWorld) * (v.xyz / v.w));
          float up = clamp(dir.y, -0.2, 1.0);
          vec3 col = mix(uHaze, uZenith, smoothstep(0.0, 0.55, up));
          col = mix(col, uHaze * 0.92, smoothstep(0.0, -0.2, up));
          float sun = max(dot(dir, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.92, 0.78) * (pow(sun, 64.0) * 0.35 + pow(sun, 6.0) * 0.06);
          gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
          #include <colorspace_fragment>
        }`,
      toneMapped: false,
    }),
  );
  m.frustumCulled = false;
  m.renderOrder = -1000;
  return m;
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function waterMaterial(terrain) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHeight: { value: terrain.heightTex },
      uDomain: { value: new THREE.Vector4(DOMAIN.min, DOMAIN.min, DOMAIN.size, DOMAIN.size) },
      uTime: { value: 0 },
      uPaper: { value: 0 },
      uCloud: { value: 0 },
      uZoom: { value: 0 },
      uSunDir: { value: SUN.clone() },
      uSky: { value: new THREE.Vector3(0.72, 0.82, 0.88) },
      uFogColor: { value: HAZE.clone() },
      uFogNear: { value: 300 },
      uFogFar: { value: 900 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uHeight;
      uniform vec4 uDomain;
      uniform float uTime, uPaper, uCloud, uZoom, uFogNear, uFogFar;
      uniform vec3 uSunDir, uSky, uFogColor;
      varying vec3 vWPos;
      ${GLSL_NOISE}
      float waveH(vec2 p, float t) {
        return vnoise(p * 0.32 + vec2(t * 0.11, t * 0.05)) * 0.6
             + vnoise(p * 0.85 - vec2(t * 0.19, -t * 0.12)) * 0.3
             + vnoise(p * 2.2 + vec2(t * 0.33, t * 0.21)) * 0.1;
      }
      void main() {
        vec2 p = vWPos.xz;
        vec2 uv = (p - uDomain.xy) / uDomain.zw;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec4 hs = texture2D(uHeight, clamp(uv, 0.002, 0.998));
        float h = mix(-12.0, hs.r * 16.0 - 12.0, inside);
        float cd = mix(40.0, (hs.g - 0.5) * 60.0, inside);
        if (inside < 0.5) cd = 30.0 + length(p) * 0.1;
        float depth = max(0.0, -h);
        vec3 shallow = vec3(0.30, 0.67, 0.68);
        vec3 mid = vec3(0.11, 0.42, 0.55);
        vec3 deep = vec3(0.04, 0.17, 0.32);
        vec3 col = mix(shallow, mid, smoothstep(0.15, 3.2, depth));
        col = mix(col, deep, smoothstep(3.2, 10.5, depth));
        float t = uTime;
        float e = 0.18;
        float amp = mix(1.0, 0.35, uZoom);
        float h0 = waveH(p, t);
        float hx = waveH(p + vec2(e, 0.0), t);
        float hz = waveH(p + vec2(0.0, e), t);
        vec3 n = normalize(vec3((h0 - hx) / e * 0.32 * amp, 1.0, (h0 - hz) / e * 0.32 * amp));
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        col = mix(col, uSky, fres * 0.5);
        vec3 L = normalize(uSunDir);
        vec3 Hh = normalize(L + V);
        float spec = pow(max(dot(n, Hh), 0.0), 160.0);
        col += vec3(1.0, 0.94, 0.82) * spec * 0.75;
        col *= 0.86 + 0.22 * max(dot(n, L), 0.0);
        float shore = 1.0 - smoothstep(0.0, 1.1, depth);
        float band = 0.5 + 0.5 * sin(depth * 8.0 - t * 1.5 + vnoise(p * 0.6) * 4.0);
        float foam = shore * (0.4 + 0.6 * band) * (0.55 + 0.45 * vnoise(p * 2.4 + t * 0.3));
        col = mix(col, vec3(0.95, 0.97, 0.98), clamp(foam, 0.0, 1.0) * 0.7 * (1.0 - uPaper));
        if (uCloud > 0.001) {
          float cs = smoothstep(0.5, 0.72, cloudField(p - uSunDir.xz * 25.0, t));
          col *= 1.0 - 0.3 * cs * uCloud;
        }
        if (uPaper > 0.001) {
          vec3 pw = mix(vec3(0.46, 0.63, 0.74), vec3(0.27, 0.43, 0.58), smoothstep(0.0, 13.0, cd));
          float lines = 0.0;
          if (cd > 0.0 && cd < 10.0) {
            float f = abs(fract(cd * 0.38) - 0.5);
            lines = (1.0 - smoothstep(0.0, 0.07, f)) * (1.0 - smoothstep(2.0, 10.0, cd));
          }
          pw = mix(pw, vec3(0.20, 0.33, 0.47), lines * 0.5);
          col = mix(col, pw, uPaper);
        }
        float dist = length(cameraPosition - vWPos);
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));
        gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}


// image-based lighting: a small sky dome (zenith blue, hazy horizon, warm sun, earthy ground bounce)
// prefiltered into a PMREM environment for every PBR material on the map
function skyEnvironment(renderer) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: SUN.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 zenith = vec3(0.16, 0.30, 0.62);
        vec3 horizon = vec3(0.70, 0.78, 0.86);
        vec3 ground = vec3(0.21, 0.20, 0.15);
        vec3 col = d.y > 0.0 ? mix(horizon, zenith, pow(d.y, 0.55)) : mix(horizon * 0.55, ground, smoothstep(0.0, 0.25, -d.y));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.9, 0.72) * (pow(s, 900.0) * 60.0 + pow(s, 24.0) * 0.6);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  mat.dispose();
  return rt.texture;
}

// How long the graphics card worked on a frame, where the browser can tell (Chromium on desktop):
// one measurement at a time, read back a few frames later.
class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = typeof gl.createQuery === 'function' ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    this.open = null;
    this.waiting = null;
  }
  begin() {
    if (!this.ext || this.open || this.waiting) return;
    this.open = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.open);
  }
  end(tag) {
    if (!this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.waiting = { q: this.open, tag };
    this.open = null;
  }
  // → { ms, tag } once for each measurement that came back whole
  poll() {
    const w = this.waiting;
    if (!w) return null;
    const gl = this.gl;
    if (!gl.getQueryParameter(w.q, gl.QUERY_RESULT_AVAILABLE)) return null;
    const broken = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    const ns = gl.getQueryParameter(w.q, gl.QUERY_RESULT);
    gl.deleteQuery(w.q);
    this.waiting = null;
    return broken ? null : { ms: ns / 1e6, tag: w.tag };
  }
}

// Let go of everything an object tree holds on the graphics card. three.js ties each geometry,
// material and texture to the renderer that drew it with a "dispose" listener; scenery shared between
// maps (the asset pack, materials kept by the scenery modules) would otherwise hold on to every
// renderer that ever drew it.
function disposeMaterial(m, seen) {
  if (!m || seen.has(m)) return;
  seen.add(m);
  for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
  if (m.uniforms)
    for (const u of Object.values(m.uniforms)) {
      const v = u && u.value;
      if (v && v.isTexture) v.dispose();
      else if (Array.isArray(v)) for (const t of v) if (t && t.isTexture) t.dispose();
    }
  m.dispose();
}
function disposeTree(root, seen = new Set()) {
  root.traverse((o) => {
    if (o.geometry && o.geometry.dispose && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) disposeMaterial(m, seen);
    disposeMaterial(o.customDepthMaterial, seen);
    disposeMaterial(o.customDistanceMaterial, seen);
    if (o.isInstancedMesh) o.dispose();
    if (o.isLight && o.shadow && o.shadow.dispose) o.shadow.dispose();
  });
}
// (the asset pack: every texture, geometry and material in it, wherever it sits)
function disposeShared(x, seen = new Set(), depth = 0) {
  if (!x || typeof x !== 'object' || seen.has(x) || depth > 6) return;
  seen.add(x);
  if (x.isTexture || x.isBufferGeometry) {
    x.dispose();
    return;
  }
  if (x.isMaterial) {
    seen.delete(x);
    disposeMaterial(x, seen);
    return;
  }
  if (x.isObject3D) {
    disposeTree(x, seen);
    return;
  }
  if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer || (typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap)) return;
  for (const v of Array.isArray(x) ? x : Object.values(x)) disposeShared(v, seen, depth + 1);
}

export class MapView {
  constructor(container, quality = 'high') {
    this.container = container;
    this.quality = quality;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    container.appendChild(this.canvas);
    // with post-processing (medium and high) SMAA smooths the edges, so the canvas itself needs no
    // multisampling; low quality draws straight to the canvas and keeps it
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality === 'low', powerPreference: 'high-performance' });
    // (the resolution is set in resize(): the ceiling depends on the window's size, pace.js)
    this.prCap = 1;
    this.governor = new Governor();
    this.gpu = new GpuTimer(this.renderer.getContext());
    // frame pacing (start()) and what the performance read-out shows
    this.fps = fpsMode('std');
    this.busyUntil = 0;
    this.attendedUntil = 0;
    this.pace = { T: 1000 / 60, gaps: [], lastTick: 0, lastFrame: 0, count: 0 };
    this.perf = { fps: 0, hz: 60, gpuMs: null, gpu: [], cpuMs: 0, calls: 0, tris: 0, frames: 0, cpu: 0, since: 0 };
    this.renderer.info.autoReset = false; // (counted per frame, over all its passes)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.overlay = new THREE.Scene(); // drawn after post-processing (placement markers)
    this.scene.background = SKY_SRGB.clone();
    this.scene.fog = new THREE.Fog(SKY_SRGB.clone(), 300, 900);
    this.camera = new StrategyCamera(this.canvas, 1);
    this.labels = new Labels(container);
    this.boardRef = null;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.mode = 'terrain';
    this.modeT = { political: 0, production: 0, resource: 0 };
    this.interaction = null;
    this.hoverId = null;
    this.markers = null;
    this.glows = [];
    this.running = false;
    this.onHexHover = null;
    this.onFrame = null;
    this.shadowDirty = 3;
    this.camera.onClick = (x, y, button, type) => this.handleClick(x, y, button, type);
    this.camera.onHover = (x, y) => this.handleHover(x, y);
    this.camera.onActivity = () => this.attend();
    this.coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.size = { w, h };
    this.prCap = pixelRatioCap(w, h, window.devicePixelRatio || 1, this.quality);
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h, this.renderer.getPixelRatio());
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.setAspect(w / h);
    this.camera.setRect(r);
    this.labels.resize(w, h);
    this.shadowSig = null; // (the view changed shape: the shadows are fitted to it again)
    this.governor.hold(performance.now(), 1500);
    this.poke();
  }

  // the resolution in use: the ceiling for this window and quality, less what the governor took off
  pixelRatio() {
    return Math.max(0.5, this.prCap * this.governor.scale);
  }
  applyPixelRatio() {
    const pr = this.pixelRatio();
    if (Math.abs(pr - this.renderer.getPixelRatio()) < 1e-3) return;
    this.renderer.setPixelRatio(pr);
    if (this.post) this.post.setSize(this.size.w, this.size.h, pr);
  }

  // Something on the map is changing: frames at the full rate from the next screen refresh, for a
  // moment. (Nothing depends on this being called: without it a change shows one idle frame later.)
  poke(ms = 250) {
    const t = performance.now() + ms;
    if (t > this.busyUntil) this.busyUntil = t;
  }
  // the player is at the map (pointer, wheel, keys), whether or not the window has the focus
  attend() {
    this.attendedUntil = performance.now() + 3000;
  }

  // the player's choices: fps ('eco' | 'std' | 'max', pace.js), stats (the performance read-out)
  setOptions({ fps, stats } = {}) {
    if (fps !== undefined) this.fps = fpsMode(fps);
    if (stats !== undefined && !!stats !== !!this.statsEl) {
      if (stats) {
        this.statsEl = document.createElement('div');
        this.statsEl.className = 'perf-info';
        this.container.appendChild(this.statsEl);
        this.perf.since = 0;
      } else {
        this.statsEl.remove();
        this.statsEl = null;
      }
    }
    this.poke();
  }

  // Compile the shaders of objects before their first frame, off the main thread where the browser
  // can. The map is drawn into the post-processing chain's buffers, and three.js builds a different
  // program for those than for the canvas, so one of them is bound meanwhile: otherwise the wrong
  // programs are built and the right ones still compile on the first frame they are needed, in the
  // middle of play (a hitch of a good part of a second on Windows, the first time each shader is met).
  async precompile(obj, scene = this.scene) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(scene === this.scene && this.post ? this.post.target() : null);
      const done = r.compileAsync(obj, this.camera.cam, scene);
      r.setRenderTarget(prev);
      await done;
    } catch {
      r.setRenderTarget(prev); // compiled on first draw instead
    }
  }

  build(state, players, quality = 'high') {
    this.players = players;
    this.quality = quality;
    this.boardRef = state.board;
    const scene = this.scene;
    const seed = state.mapSeed != null ? state.mapSeed : state.seed;

    scene.environment = skyEnvironment(this.renderer);
    scene.environmentIntensity = 0.75;
    const hemi = new THREE.HemisphereLight(0xd8e6f2, 0x5b5a3e, 0.55);
    scene.add(hemi);
    this.hemi = hemi;
    if (quality !== 'low') {
      try {
        this.post = new PostFX(this.renderer, scene, this.camera.cam, quality);
      } catch (e) {
        console.warn('post-processing unavailable', e);
        this.post = null;
      }
    }
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
    sun.position.copy(SUN).multiplyScalar(120);
    sun.castShadow = true;
    const sm = quality === 'low' ? 1024 : quality === 'medium' ? 2048 : 3072;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    // the shadow map covers the whole map when zoomed out (66 each way for the standard island)
    const gb = GEO.bounds;
    const FULL = Math.max(66, Math.ceil(Math.max(-gb.minX, gb.maxX, -gb.minZ, gb.maxZ) + 22));
    this.shadowFull = FULL;
    sc.left = -FULL;
    sc.right = FULL;
    sc.top = FULL;
    sc.bottom = -FULL;
    sc.near = 10;
    sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
    this.shadowBox = { x0: -FULL, x1: FULL, y0: -FULL, y1: FULL };

    this.terrain = buildTerrain(state.board, seed, quality);
    scene.add(this.terrain.mesh);
    this.camera.heightAt = this.terrain.heightAt;
    this.camera.setMap(GEO);
    this.sky = skyMesh();
    scene.add(this.sky);

    const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 1, 1).rotateX(-Math.PI / 2), waterMaterial(this.terrain));
    water.position.y = 0;
    water.renderOrder = -1;
    scene.add(water);
    this.water = water;


    this.floraArgs = [this.terrain, state.board, seed, quality];
    const pack = assetStatus.pack;
    this.flora = buildFlora(this.terrain, state.board, seed, quality, pack, SUN);
    scene.add(this.flora.group);
    if (pack) {
      this.terrain.setLayers(pack.terrain);
      if (pack.models) this.terrain.setRock(pack.models.rock);
    }
    else if (!assetStatus.failed) this.waitForAssets(quality);

    this.models = pack && pack.models && pack.models.houses ? pack.models : null;
    this.harbors = buildHarbors(state.board, this.terrain, this.models);
    scene.add(this.harbors.group);

    this.pieces = new Pieces(scene, this.terrain, players, this.models);
    this.territory = new Territory(players, this.terrain);
    this.terrain.uniforms.uTerritory.value = this.territory.fillTex;
    this.terrain.uniforms.uBorder.value = this.territory.borderTex;
    this.terrain.uniforms.uSunDir.value.copy(SUN);

    this.buildLabels(state);
    this.markers = new Markers(this.overlay, this.pieces, this.terrain);
    // (Seafarers, the fog islands) mist over the hexes nobody has explored
    this.fogKey = fogKey(state.board);
    if (GEO.def.fog) {
      this.fog = new FogCover(scene);
      this.fog.set(hiddenFog(state.board));
    }
    this.sync(state, [], false);
    this.camera.target.set(0, 0, 6);
    this.camera.goal.set(0, 0, 6);
    this.camera.h = 150;
    this.camera.goalH = 112;
    this.shadowDirty = 3;
    // the shaders of what the campaign will put on the map, built ahead of the first settlement
    this.precompile(this.pieces.prewarm(this.models, !!(GEO.def.rules && GEO.def.rules.seafarers)));
    this.precompile(this.markers.prewarm(), this.overlay);
  }

  // realistic asset pack: load in the background, then swap the procedural scenery for it
  waitForAssets(quality) {
    if (this.assetChip) return;
    const chip = document.createElement('div');
    chip.className = 'asset-chip';
    chip.innerHTML = '<i></i><span>載入寫實素材</span><b>0%</b>';
    this.container.appendChild(chip);
    this.assetChip = chip;
    const off = onAssetProgress((st) => {
      chip.querySelector('b').textContent = Math.round(st.progress * 100) + '%';
      chip.querySelector('i').style.width = Math.round(st.progress * 100) + '%';
    });
    loadAssets(quality).then((pack) => {
      off();
      chip.classList.add('out');
      setTimeout(() => chip.remove(), 600);
      this.assetChip = null;
      if (!pack || this.disposed) return;
      if (this.assetHold) this.heldPack = pack;
      else this.applyAssets(pack);
    });
  }

  // While an online lobby or quick match is open, the main thread is kept free for the room's
  // traffic: swapping in the asset pack (shader compiles, texture uploads, scenery rebuild) can stall
  // a slow device long enough to drop out of matchmaking. A pack that arrives meanwhile is applied
  // when the hold is released (back at the menu, or when the campaign starts).
  holdAssets(on) {
    this.assetHold = !!on;
    holdAssetLoading(on);
    if (!on && this.heldPack && !this.disposed) {
      const pack = this.heldPack;
      this.heldPack = null;
      this.applyAssets(pack);
    }
  }

  async applyAssets(pack) {
    if (!this.flora || this.flora.real || this.applying) return;
    this.applying = true;
    const flora = buildFlora(...this.floraArgs, pack, SUN);
    // compile the new materials off the main thread where the browser allows it
    await this.precompile(flora.group);
    if (this.disposed) {
      this.applying = false;
      return;
    }
    const old = this.flora.group;
    this.flora = flora;
    this.scene.remove(old);
    old.traverse((o) => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    });
    this.scene.add(this.flora.group);
    this.terrain.setLayers(pack.terrain);
    if (pack.models) this.terrain.setRock(pack.models.rock);
    // detailed buildings, harbors and ships
    if (pack.models && pack.models.houses) {
      this.models = pack.models;
      const harbors = buildHarbors(this.floraArgs[1], this.terrain, this.models);
      await this.precompile(harbors.group);
      // (and the settlements, cities and streets as the models draw them)
      await this.precompile(this.pieces.prewarm(this.models, !!(GEO.def.rules && GEO.def.rules.seafarers)));
      if (this.disposed) {
        this.applying = false;
        return;
      }
      this.scene.remove(this.harbors.group);
      this.harbors.group.traverse((o) => {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      });
      this.harbors = harbors;
      this.scene.add(harbors.group);
      this.pieces.setModels(this.models);
    }
    this.applying = false;
    this.shadowDirty = 3;
    this.governor.hold(performance.now(), 3000);
    this.poke(600);
    if (this.onAssets) this.onAssets(pack);
  }

  buildLabels(state) {
    this.tokenLabels = [];
    for (const h of GEO.hexes) {
      const H = state.board.hexes[h.id];
      const y = this.terrain.heightAt(h.x, h.z);
      if (H.number) {
        const el = document.createElement('div');
        const hot = H.number === 6 || H.number === 8;
        el.className = 'token' + (hot ? ' hot' : '');
        el.innerHTML = `<b>${H.number}</b><i>${'<u></u>'.repeat(pips(H.number))}</i>`;
        const it = this.labels.add(el, new THREE.Vector3(h.x, Math.max(y, 0.5) + 1.2, h.z), { ...TOKEN_FIT });
        this.tokenLabels.push({ hex: h.id, it });
      }
      // (no province names on the map: the board stays clean)
    }
    // the robber has no figure on the map: its badge sits on the occupied province's token,
    // or on its own over a province without one (the desert)
    const rb = document.createElement('div');
    rb.className = 'robber-badge';
    rb.innerHTML = icon('robber', 24);
    rb.title = '強盜佔領中：這裡不會產出資源';
    this.robberLabel = this.labels.add(rb, new THREE.Vector3(0, 1.7, 0), { ...ROBBER_FIT, hidden: true });
    this.robberShown = -1;
    // harbours: a token with the resource (or every colour for "any") and the rate, out at sea past the
    // pier, with a line to the coast it serves; it shrinks with the map when zoomed out
    this.harborLabels = [];
    for (const a of this.harbors.anchors) {
      const el = document.createElement('div');
      const type = a.harbor.type;
      const any = type === 'any';
      el.className = 'harbor-badge' + (any ? ' any' : ` rc-${type}`);
      el.innerHTML = `<i class="hb-tail"></i><span class="hb-ico"></span><b>${any ? '3:1' : '2:1'}</b>`;
      el.title = any ? '港口：任意 3 張相同資源換 1 張' : `港口：${RES_NAMES[type]} 2 張換 1 張任意資源`;
      const it = this.labels.add(el, a.pos, { ...HARBOR_FIT });
      this.harborLabels.push({ it, el, shore: a.shore });
    }
    this.buildNationLabels();
  }

  // each harbour badge's line runs from the badge to its shore point, in screen space
  updateHarborTails(zoomH) {
    if (!this.harborLabels) return;
    const cam = this.camera.cam;
    const { w, h } = this.size;
    const a = _fitA;
    const b = _fitB;
    for (const hl of this.harborLabels) {
      if (!hl.it.visible) continue;
      a.copy(hl.it.pos).project(cam);
      b.copy(hl.shore).project(cam);
      const dx = ((b.x - a.x) / 2) * w;
      const dy = (-(b.y - a.y) / 2) * h;
      const len = Math.hypot(dx, dy) / (hl.it.s || 1);
      const key = `${Math.round(len)}:${Math.atan2(dy, dx).toFixed(2)}`;
      if (key === hl.key) continue;
      hl.key = key;
      hl.el.style.setProperty('--tl', len.toFixed(1) + 'px');
      hl.el.style.setProperty('--ta', Math.atan2(dy, dx).toFixed(3) + 'rad');
    }
  }

  buildNationLabels() {
    if (this.nationLabels) for (const it of this.nationLabels) this.labels.remove(it);
    // nation names are not drawn on the map any more (the outliner and borders identify players)
    this.nationLabels = [];
    if (!this.showNationNames) return;
    this.nationLabels = this.players.map((p) => {
      const el = document.createElement('div');
      el.className = 'nation-name';
      el.textContent = p.name;
      const c = new THREE.Color(p.color);
      const hsl = {};
      c.getHSL(hsl);
      c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(hsl.l, 0.36));
      el.style.setProperty('--nc', '#' + c.getHexString(THREE.SRGBColorSpace));
      return this.labels.add(el, new THREE.Vector3(0, 1, 0), { hidden: true });
    });
  }

  setPlayers(state, players) {
    this.players = players;
    this.boardRef = state.board;
    this.scene.remove(this.pieces.group);
    this.pieces.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.pieces = new Pieces(this.scene, this.terrain, players, this.models);
    this.markers.setPieces(this.pieces);
    this.territory = new Territory(players, this.terrain);
    this.terrain.uniforms.uTerritory.value = this.territory.fillTex;
    this.terrain.uniforms.uBorder.value = this.territory.borderTex;
    this.buildNationLabels();
    this.setInteraction(null);
    this.sync(state, [], false);
    this.shadowDirty = 3;
  }

  // ── interaction ──
  setInteraction(spec) {
    this.poke();
    this.interaction = spec;
    this.hoverId = null;
    this.markers.clear();
    this.pieces.ghost(null);
    const hexData = this.terrain.hexData;
    const slot = this.terrain.hexSlot;
    for (const h of GEO.hexes) hexData[slot(h) + 3] = 0;
    this.terrain.uniforms.uSelect.value = 0;
    this.terrain.uniforms.uHover.value.set(99, 99, 0, 0);
    this.canvas.style.cursor = '';
    if (!spec) {
      this.terrain.hexTex.needsUpdate = true;
      return;
    }
    const color = spec.player != null && this.players[spec.player] ? this.players[spec.player].color : '#ffffff';
    this.markers.show(spec.kind, spec.ids, color);
    if (spec.kind === 'hex') {
      for (const id of spec.ids) hexData[slot(GEO.hexes[id]) + 3] = 255;
      this.terrain.uniforms.uSelect.value = 1;
    }
    this.terrain.hexTex.needsUpdate = true;
  }

  pickCandidate(cx, cy, touch) {
    const spec = this.interaction;
    if (!spec) return null;
    const r = this.camera.screenRect();
    if (spec.kind === 'hex') {
      const g = this.camera.groundAt(cx, cy);
      if (!g) return null;
      let best = null;
      let bd = 1e9;
      for (const id of spec.ids) {
        const h = GEO.hexes[id];
        const d = Math.hypot(g.x - h.x, g.z - h.z);
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      return bd < 9.2 ? best : null;
    }
    const lim = touch ? 44 : 30;
    let best = null;
    let bd = lim;
    const v = new THREE.Vector3();
    for (const id of spec.ids) {
      if (spec.kind === 'vertex') v.copy(this.pieces.vertexPos(id));
      else v.copy(this.pieces.edgeMid(id));
      v.project(this.camera.cam);
      const sx = (v.x * 0.5 + 0.5) * r.width + r.left;
      const sy = (-v.y * 0.5 + 0.5) * r.height + r.top;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.poke();
    this.hoverId = id;
    const spec = this.interaction;
    if (!spec) return;
    if (spec.kind === 'hex') {
      if (id == null) this.terrain.uniforms.uHover.value.set(99, 99, 0, 0);
      else {
        const h = GEO.hexes[id];
        this.terrain.uniforms.uHover.value.set(h.q, h.r, 1, 1);
      }
    } else if (spec.ghost) this.pieces.ghost(id == null ? null : spec.ghost, id, spec.player);
    this.markers.setHover(id);
    this.canvas.style.cursor = id == null ? '' : 'pointer';
    if (spec.onHover) spec.onHover(id);
  }

  handleHover(x, y) {
    if (this.interaction) {
      this.setHover(this.pickCandidate(x, y, false));
      return;
    }
    if (this.onHexHover) {
      const g = this.camera.groundAt(x, y);
      let hex = null;
      if (g) {
        for (const h of GEO.hexes) {
          const dx = Math.abs(g.x - h.x);
          const dz = Math.abs(g.z - h.z);
          if (Math.max(dx, 0.5 * dx + 0.866 * dz) < 8.66) {
            hex = h.id;
            break;
          }
        }
      }
      this.onHexHover(hex, x, y);
    }
  }

  handleClick(x, y, button, type) {
    if (button === 2) {
      if (this.interaction && this.interaction.onCancel) this.interaction.onCancel();
      return;
    }
    if (!this.interaction) {
      if (type === 'touch' && this.onHexHover) this.handleHover(x, y);
      return;
    }
    const id = this.pickCandidate(x, y, type === 'touch');
    if (id == null) return;
    if (type === 'touch' && this.interaction.kind !== 'hex' && this.hoverId !== id) {
      // first tap previews, second tap confirms
      this.setHover(id);
      return;
    }
    const spec = this.interaction;
    this.setHover(null);
    spec.onPick(id);
  }

  // (Seafarers, the fog islands) hexes were discovered: the ground, the sea, the scenery, the harbors,
  // the labels and the pieces are built again on the board as it is now; the camera, the map mode and
  // the interaction stay
  rebuildBoard(state) {
    const t0 = performance.now();
    const scene = this.scene;
    const seed = state.mapSeed != null ? state.mapSeed : state.seed;
    this.boardRef = state.board;
    this.fogKey = fogKey(state.board);
    const drop = (obj) => {
      scene.remove(obj);
      obj.traverse((o) => {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      });
    };
    const old = this.terrain;
    drop(old.mesh);
    old.mesh.material.dispose();
    if (old.heightTex) old.heightTex.dispose();
    if (old.hexTex) old.hexTex.dispose();
    drop(this.flora.group);
    drop(this.harbors.group);
    drop(this.pieces.group);
    this.terrain = buildTerrain(state.board, seed, this.quality);
    scene.add(this.terrain.mesh);
    this.camera.heightAt = this.terrain.heightAt;
    const water = this.water.material;
    this.water.material = waterMaterial(this.terrain);
    water.dispose();
    // the same kind of scenery as before (the asset pack's, once it has been put in)
    const pack = this.flora.real ? assetStatus.pack : null;
    this.floraArgs = [this.terrain, state.board, seed, this.quality];
    this.flora = buildFlora(this.terrain, state.board, seed, this.quality, pack, SUN);
    scene.add(this.flora.group);
    if (pack) {
      this.terrain.setLayers(pack.terrain);
      if (pack.models) this.terrain.setRock(pack.models.rock);
    }
    this.harbors = buildHarbors(state.board, this.terrain, this.models);
    scene.add(this.harbors.group);
    this.pieces = new Pieces(scene, this.terrain, this.players, this.models);
    this.markers.setPieces(this.pieces);
    this.markers.terrain = this.terrain;
    this.territory = new Territory(this.players, this.terrain);
    this.terrain.uniforms.uTerritory.value = this.territory.fillTex;
    this.terrain.uniforms.uBorder.value = this.territory.borderTex;
    this.terrain.uniforms.uSunDir.value.copy(SUN);
    for (const t of this.tokenLabels) this.labels.remove(t.it);
    if (this.robberLabel) this.labels.remove(this.robberLabel);
    for (const hl of this.harborLabels) this.labels.remove(hl.it);
    this.buildLabels(state);
    // the pieces already on the board come back without popping in
    this.pieces.sync(state, false);
    this.setInteraction(this.interaction);
    this.shadowDirty = 3;
    this.rebuilds = (this.rebuilds || 0) + 1;
    this.rebuildMs = Math.round(performance.now() - t0);
  }

  // ── state sync ──
  sync(state, events = [], animate = true) {
    this.poke();
    // (fog) the board changed under the map: build it again first
    if (this.fog) {
      if (fogKey(state.board) !== this.fogKey) this.rebuildBoard(state);
      this.fog.set(hiddenFog(state.board));
    }
    const changed = this.pieces.sync(state, animate);
    if (this.territory.update(state)) {
      for (const lbl of this.territory.labels) {
        if (!lbl) continue;
        const it = this.nationLabels[lbl.p];
        if (!it) continue;
        it.pos.set(lbl.x, 1.5, lbl.z);
        it.axis = lbl.angle;
      }
      this.nationLabels.forEach((it, p) => {
        const lbl = this.territory.labels[p];
        it.opts.hidden = !lbl;
        if (lbl) {
          const chars = this.players[p].name.length;
          it.opts.fade = (zh, paper) => Math.max(paper, this.modeT.political) * 0.92;
          it.opts.scale = (zh) => {
            // fit the name along the region's long axis (base font 30px, ~1.5em per glyph incl. spacing);
            // pixels per world unit come from the projected axis, so tilt and rotation are accounted for
            const pxPerUnit = it.ppu || this.size.h / (0.65 * zh);
            const fitLen = (lbl.length * 0.8 * pxPerUnit) / (chars * 1.5 * 30);
            const fitThick = (Math.max(3, lbl.minor) * 1.1 * pxPerUnit) / 30;
            return Math.max(0.32, Math.min(2.6, fitLen, fitThick));
          };
        }
      });
    }
    // (the robber may still be off the board: the new world)
    const rob = GEO.hexes[state.board.robber];
    if (rob) this.terrain.uniforms.uRobber.value.set(rob.q, rob.r);
    else this.terrain.uniforms.uRobber.value.set(99, 99);
    this.showRobber(state.board.robber, animate);
    if (changed) this.shadowDirty = 2;
  }

  showRobber(hex, animate) {
    if (this.robberShown === hex) return;
    this.poke();
    this.robberShown = hex;
    for (const t of this.tokenLabels) {
      const el = t.it.el;
      const on = t.hex === hex;
      el.classList.toggle('robbed', on);
      let b = el.querySelector('.rob');
      if (on && !b) {
        b = document.createElement('span');
        b.className = 'rob';
        b.innerHTML = icon('robber', 16);
        el.appendChild(b);
      } else if (!on && b) b.remove();
      if (on && animate) {
        b.classList.remove('drop');
        void b.offsetWidth;
        b.classList.add('drop');
      }
    }
    const lone = hex >= 0 && !this.tokenLabels.some((t) => t.hex === hex);
    const it = this.robberLabel;
    if (it) {
      it.opts.hidden = !lone;
      if (lone) {
        const h = GEO.hexes[hex];
        it.pos.set(h.x, Math.max(this.terrain.heightAt(h.x, h.z), 0.5) + 1.6, h.z);
        if (animate) {
          it.el.classList.remove('drop');
          void it.el.offsetWidth;
          it.el.classList.add('drop');
        }
      }
    }
  }

  // production glow on the provinces that paid out (called once the dice have landed)
  // the building at vertex v hops (delay in milliseconds)
  bumpBuilding(v, delay = 0) {
    this.poke(delay + 500);
    if (this.pieces) this.pieces.bump(v, delay / 1000);
  }

  showProduction(ev) {
    const hexes = [...new Set(ev.paid.map((c) => c.hex))];
    const all = GEO.hexes.filter((h) => this.terrainNumber(h.id) === ev.sum).map((h) => h.id);
    this.glows = all.slice(0, 2).map((id) => ({ id, t: 0 }));
    this.poke();
    return hexes;
  }

  // screen position (client px) of a world point, or null when it is behind the camera
  toScreen(v) {
    const p = v.clone().project(this.camera.cam);
    if (p.z > 1) return null;
    const r = this.camera.screenRect();
    return { x: (p.x * 0.5 + 0.5) * r.width + r.left, y: (-p.y * 0.5 + 0.5) * r.height + r.top };
  }
  hexScreen(id) {
    const h = GEO.hexes[id];
    return this.toScreen(new THREE.Vector3(h.x, Math.max(this.terrain.heightAt(h.x, h.z), 0.5) + 1.2, h.z));
  }
  vertexScreen(v) {
    return this.toScreen(this.pieces.vertexPos(v).add(new THREE.Vector3(0, 1.2, 0)));
  }

  terrainNumber(id) {
    return this.boardRef ? this.boardRef.hexes[id].number : 0;
  }

  setMapMode(mode) {
    this.mode = mode;
    this.poke();
  }

  focus(x, z, h = null) {
    this.camera.flyTo(x, z, h);
    this.poke();
  }

  // the opening view: the middle of the land from distance h, drawn back and moved over when part of
  // the land would be under the panels (`free`: the part of the screen they leave open)
  frameLand(free, h) {
    const c = GEO.center;
    // a map much wider than tall on an upright phone is turned a quarter, so it fills the screen (the
    // view then starts close and draws back until the land fits)
    const L = GEO.land;
    const turn = (this.camera.cam.aspect || 1.6) < 0.85 && L.maxX - L.minX > 1.3 * (L.maxZ - L.minZ);
    this.camera.homeYaw = turn ? Math.PI / 2 : 0;
    this.camera.resetView();
    if (turn && free) h = Math.min(h, 60);
    const f = free ? this.camera.frameBox(GEO.vertices.filter((v) => v.land > 0), free, c.x, c.z + 5, h) : null;
    if (f) this.focus(f.x, f.z, f.h);
    else this.focus(c.x, c.z + 5, h);
  }

  focusVertex(v, h = null) {
    const g = GEO.vertices[v];
    if (!this.camera.isVisible(g.x, g.z, 0.18)) this.focus(g.x, g.z, h);
  }
  focusEdge(e) {
    const g = GEO.edges[e];
    if (!this.camera.isVisible(g.x, g.z, 0.18)) this.focus(g.x, g.z);
  }
  focusHex(id) {
    const h = GEO.hexes[id];
    if (!this.camera.isVisible(h.x, h.z, 0.15)) this.focus(h.x, h.z);
  }

  // The frames a second wanted right now (pace.js): the full rate while something changes, a low one
  // when only the scenery is alive, lower still when the player is elsewhere.
  wantFps(now) {
    if (now < this.busyUntil) return this.fps.active;
    return now < this.attendedUntil || document.hasFocus() ? this.fps.idle : this.fps.away;
  }

  // The loop is called at every screen refresh and draws at only some of them: a frame is held for a
  // whole number of refreshes, so the ones that are drawn stay evenly spaced.
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.governor.hold(performance.now(), 5000);
    const P = this.pace;
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (now == null) now = performance.now();
      // the screen's refresh interval, from the gaps between these calls
      if (P.lastTick) {
        P.gaps.push(now - P.lastTick);
        if (P.gaps.length >= 48) {
          P.T = refreshInterval(P.gaps, P.T);
          P.gaps.length = 0;
        }
      }
      P.lastTick = now;
      const test = window.__mapFps; // test hook: a fixed, low rate on software GL
      const since = now - P.lastFrame;
      let want;
      if (test) {
        if (since < 1000 / test) return;
        want = 0;
      } else {
        want = refreshesPerFrame(P.T, this.wantFps(performance.now())) * P.T;
        if (since < want - P.T * 0.5) return;
      }
      P.lastFrame = now;
      this.frame(since, want);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  // gap: ms since the frame before; want: the ms between frames asked for (0: not paced, a test)
  frame(gap = 0, want = 0) {
    const cpu0 = performance.now();
    const dt = Math.min(0.1, this.clock.getDelta());
    this.time += dt;
    const t = this.time;
    const camMoved = this.camera.update(dt);
    // the camera counts as moving until it has rested for a moment: moving frames skip the costly
    // extras (AO, SMAA, shadow refits, road and yard rebuilds), which come back once it settles
    if (camMoved) this.lastMoveAt = this.time;
    const moving = this.time - (this.lastMoveAt == null ? -1 : this.lastMoveAt) < 0.2;
    // (a camera on a slow cruise of its own — the title screen — is scenery, not something happening)
    let lively = camMoved && !this.cruise;
    const H = this.camera.h;
    const EQ = this.camera.equivH();
    const MS = this.camera.scale;
    const zoom01 = Math.min(1, (EQ - ZOOM_MIN) / (ZOOM_MAX * MS - ZOOM_MIN));
    const paper = smooth(150 * MS, 205 * MS, EQ);
    const cloud = 0; // no cloud layer: it hid the board when zoomed out a little

    // map-mode transitions
    for (const k of Object.keys(this.modeT)) {
      const goal = this.mode === k ? 1 : 0;
      if (Math.abs(goal - this.modeT[k]) > 0.003) lively = true;
      this.modeT[k] += (goal - this.modeT[k]) * Math.min(1, dt * 7);
    }
    const U = this.terrain.uniforms;
    U.uTime.value = t;
    U.uPaper.value = paper;
    U.uCloud.value = cloud;
    U.uZoom.value = zoom01;
    U.uPolitical.value = this.modeT.political;
    U.uProduction.value = this.modeT.production * (1 - paper * 0.3);
    U.uResource.value = this.modeT.resource * (1 - paper * 0.3);
    const wu = this.water.material.uniforms;
    wu.uTime.value = t;
    wu.uPaper.value = paper;
    wu.uCloud.value = cloud;
    wu.uZoom.value = zoom01;
    const fogNear = H * 2.2 + 60;
    const fogFar = H * 6 + 260;
    this.scene.fog.near = fogNear;
    this.scene.fog.far = fogFar;
    wu.uFogNear.value = fogNear;
    wu.uFogFar.value = fogFar;

    // production glows
    const ga = U.uGlowA.value;
    const gb = U.uGlowB.value;
    ga.set(99, 99, 0, 0);
    gb.set(99, 99, 0, 0);
    this.glows = this.glows.filter((g, i) => {
      g.t += dt;
      const k = g.t / 2.2;
      const amt = Math.sin(Math.min(1, k) * Math.PI) * 0.85;
      const h = GEO.hexes[g.id];
      (i === 0 ? ga : gb).set(h.q, h.r, amt, 0);
      return k < 1;
    });

    const s = Math.min(2.4, Math.max(1, 1 + (H - 46) / 78));
    const rw = Math.min(2.1, Math.max(1, 1 + (H - 60) / 100));
    this.pieces.setScale(s, rw, !moving);
    const busy = this.pieces.update(t, dt);
    this.flora.update(t, dt);
    this.harbors.update(t);
    if (this.fog) this.fog.update(t, dt, paper);
    // (the robber's target rings follow the size of a token in the middle of the screen)
    const midTokenPx = tokenPx(screenWidth(this.camera.cam, this.camera.target, HEX_W, this.size.w, this.size.h));
    this.markers.update(dt, H, this.size.h, this.coarse, midTokenPx, this.camera.cam, this.size.w);
    this.alignNationLabels();
    const sk = this.sky.material.uniforms;
    sk.uInvProj.value.copy(this.camera.cam.projectionMatrixInverse);
    sk.uCamWorld.value.copy(this.camera.cam.matrixWorld);

    // the shadow map is cached; re-render it only when pieces change or animate, or when the
    // camera moves enough that the shadow frustum is refitted to the visible area
    // (the fit is looked at again only once the camera has moved since)
    if (!moving && this.camera.sig !== this.shadowSig) {
      this.shadowSig = this.camera.sig;
      this.fitShadow();
    }
    if (busy) this.shadowDirty = Math.max(this.shadowDirty, 1);
    if (this.shadowDirty > 0) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = Math.max(0, this.shadowDirty - 1);
    }
    this.labels.update(this.camera.cam, H, dt, paper);
    this.updateHarborTails(H);
    if (busy || this.glows.length || this.labels.floats.length || this.applying) lively = true;
    if (lively) this.poke();

    const info = this.renderer.info;
    info.reset();
    this.gpu.begin();
    if (this.post) {
      this.post.setZoom(paper, zoom01);
      this.post.setMotion(moving, dt);
      this.post.render(dt);
    } else this.renderer.render(this.scene, this.camera.cam);
    this.renderer.autoClear = false;
    this.renderer.render(this.overlay, this.camera.cam);
    this.renderer.autoClear = true;
    this.gpu.end(want);
    if (this.onFrame) this.onFrame(dt, camMoved);

    // the resolution governor: a card that can't keep the pace gets a smaller picture (pace.js)
    const got = this.gpu.poll();
    const pf = this.perf;
    if (got) {
      pf.gpu.push(got.ms);
      if (pf.gpu.length > 15) pf.gpu.shift();
    }
    if (want > 0) {
      if (this.governor.frame({ now: cpu0, gap, want, gpuMs: got ? got.ms : null, gpuWant: got ? got.tag : 0 }) != null) this.applyPixelRatio();
    }
    // what the performance read-out shows (setOptions({ stats: true }))
    pf.frames++;
    pf.cpu += performance.now() - cpu0;
    pf.calls = info.render.calls;
    pf.tris = info.render.triangles;
    if (cpu0 - pf.since > 500) {
      if (pf.since) {
        pf.fps = (pf.frames * 1000) / (cpu0 - pf.since);
        pf.cpuMs = pf.cpu / pf.frames;
      }
      pf.hz = 1000 / this.pace.T;
      // (the middle one of the last measurements: a frame that compiled a shader is not the rule)
      pf.gpuMs = pf.gpu.length >= 3 ? pf.gpu.slice().sort((a, b) => a - b)[pf.gpu.length >> 1] : null;
      pf.frames = 0;
      pf.cpu = 0;
      pf.since = cpu0;
      if (this.statsEl) this.showStats(moving);
    }
  }

  showStats(moving) {
    const pf = this.perf;
    const r = this.renderer;
    const w = Math.round(this.size.w * r.getPixelRatio());
    const h = Math.round(this.size.h * r.getPixelRatio());
    if (this.gpuName === undefined) {
      const gl = r.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).replace(/^ANGLE \((.*)\)$/, '$1').split(',').slice(0, 2).join(',').replace(/\s*\(0x[0-9A-Fa-f]+\)|Direct3D.*$/g, '').trim() : '';
    }
    const load = pf.gpuMs != null ? Math.min(100, Math.round((pf.gpuMs * pf.fps) / 10)) : null;
    const rows = [
      `每秒 ${pf.fps.toFixed(0)} 幀（螢幕 ${pf.hz.toFixed(0)} Hz）`,
      pf.gpuMs != null ? `顯示卡每幀 ${pf.gpuMs.toFixed(1)} ms，負載約 ${load}%` : '顯示卡時間：這個瀏覽器不提供',
      `程式每幀 ${pf.cpuMs.toFixed(1)} ms`,
      `繪製 ${w}×${h}（${Math.round(this.governor.scale * 100)}%）・${{ low: '低', medium: '中', high: '高' }[this.quality] || this.quality}畫質${moving ? '・移動中' : ''}`,
      `${pf.calls} 次繪製・${(pf.tris / 1000).toFixed(0)}k 三角形`,
    ];
    if (this.gpuName) rows.push(this.gpuName);
    this.statsEl.textContent = rows.join('\n');
  }

  // keep the sun's shadow map focused on what the camera sees: crisp shadows when zoomed in,
  // the whole island when zoomed out. Refits only when the view leaves the current box.
  fitShadow() {
    const sc = this.sun.shadow.camera;
    const inv = sc.matrixWorldInverse;
    const r = this.camera.screenRect();
    const v = _fitV;
    const FULL = this.shadowFull;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let sky = false;
    for (const [cx, cy] of [
      [r.left, r.top],
      [r.right, r.top],
      [r.right, r.bottom],
      [r.left, r.bottom],
      [(r.left + r.right) / 2, r.top],
    ]) {
      const g = this.camera.groundAt(cx, cy, 200);
      if (!g) {
        sky = true;
        break;
      }
      for (const hy of [0, 9]) {
        v.set(g.x, hy, g.z).applyMatrix4(inv);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
    }
    const m = 5;
    let box = sky
      ? { x0: -FULL, x1: FULL, y0: -FULL, y1: FULL }
      : { x0: Math.max(-FULL, x0 - m), x1: Math.min(FULL, x1 + m), y0: Math.max(-FULL, y0 - m), y1: Math.min(FULL, y1 + m) };
    if (box.x1 - box.x0 < 8 || box.y1 - box.y0 < 8) return;
    const cur = this.shadowBox;
    const inside = box.x0 >= cur.x0 && box.x1 <= cur.x1 && box.y0 >= cur.y0 && box.y1 <= cur.y1;
    const ratio = ((box.x1 - box.x0) * (box.y1 - box.y0)) / ((cur.x1 - cur.x0) * (cur.y1 - cur.y0));
    if (inside && ratio > 0.42) return;
    // a little slack so small pans don't refit every frame
    const gx = (box.x1 - box.x0) * 0.14;
    const gy = (box.y1 - box.y0) * 0.14;
    box = { x0: Math.max(-FULL, box.x0 - gx), x1: Math.min(FULL, box.x1 + gx), y0: Math.max(-FULL, box.y0 - gy), y1: Math.min(FULL, box.y1 + gy) };
    const tx = (box.x1 - box.x0) / this.sun.shadow.mapSize.x;
    const ty = (box.y1 - box.y0) / this.sun.shadow.mapSize.y;
    box.x0 = Math.floor(box.x0 / tx) * tx;
    box.x1 = Math.ceil(box.x1 / tx) * tx;
    box.y0 = Math.floor(box.y0 / ty) * ty;
    box.y1 = Math.ceil(box.y1 / ty) * ty;
    sc.left = box.x0;
    sc.right = box.x1;
    sc.bottom = box.y0;
    sc.top = box.y1;
    sc.updateProjectionMatrix();
    this.shadowBox = box;
    this.shadowDirty = Math.max(this.shadowDirty, 1);
  }

  viewportGround() {
    // ground-plane quad visible on screen (for the minimap)
    const r = this.camera.screenRect();
    const pts = [
      [r.left, r.top],
      [r.right, r.top],
      [r.right, r.bottom],
      [r.left, r.bottom],
    ].map(([x, y]) => this.camera.groundAt(x, y, 420));
    return pts;
  }

  // nation names follow their territory's long axis as it appears on screen (rotation & tilt)
  alignNationLabels() {
    if (!this.nationLabels) return;
    const a = _fitA;
    const b = _fitB;
    const W = this.size.w;
    const Hh = this.size.h;
    for (const it of this.nationLabels) {
      if (it.opts.hidden || it.axis == null) continue;
      const c = Math.cos(it.axis) * 4;
      const s = Math.sin(it.axis) * 4;
      a.set(it.pos.x - c, it.pos.y, it.pos.z - s).project(this.camera.cam);
      b.set(it.pos.x + c, it.pos.y, it.pos.z + s).project(this.camera.cam);
      const dx = ((b.x - a.x) / 2) * W;
      const dy = (-(b.y - a.y) / 2) * Hh;
      let ang = Math.atan2(dy, dx);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      it.opts.angle = ang;
      it.ppu = Math.hypot(dx, dy) / 8;
    }
  }

  // The map is done with (another island is built): everything it holds on the graphics card goes
  // now. Left to the garbage collector it stayed — the camera's key listeners and the scenery shared
  // between maps kept every old map and its WebGL context alive — and a few islands' worth of
  // textures, shadow maps and frame buffers is more than a graphics card has.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObs.disconnect();
    this.camera.dispose();
    this.onFrame = this.onHexHover = this.onAssets = null;
    if (this.fog) this.fog.dispose();
    if (this.assetChip) this.assetChip.remove();
    if (this.statsEl) this.statsEl.remove();
    try {
      const seen = new Set();
      disposeTree(this.scene, seen);
      disposeTree(this.overlay, seen);
      if (this.scene.environment) this.scene.environment.dispose();
      disposeShared(assetStatus.pack, seen);
      if (this.post) this.post.dispose();
      this.renderer.dispose();
    } catch (e) {
      console.warn('map disposal', e);
    }
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.root.remove();
  }
}

export { TERRAIN_RES };
