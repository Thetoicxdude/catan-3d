// (Seafarers, the fog islands) The mist over the hexes nobody has explored yet: a few layers of soft,
// drifting cloud over each hidden hex, which thin out and vanish when the hex is discovered.
import * as THREE from 'three';
import { GEO, HEX_SIZE } from '../engine/geometry.js';
import { GLSL_NOISE } from './noise.js';

const LAYERS = [1.6, 3.4, 5.4]; // heights of the cloud layers above the sea
const FADE = 1.6; // seconds a discovered hex's mist takes to clear

const VERT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vWorld;
void main() {
  vLocal = position.xy / ${(HEX_SIZE * 1.18).toFixed(3)};
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlive;
uniform float uLayer;
uniform float uPaper;
varying vec2 vLocal;
varying vec2 vWorld;
${GLSL_NOISE}
void main() {
  // soft hexagon-ish edge (a little past the hex, so neighbouring hidden hexes merge)
  float r = length(vLocal);
  float edge = 1.0 - smoothstep(0.5 + 0.08 * uLayer, 1.0, r);
  vec2 drift = vec2(uTime * (0.32 + 0.12 * uLayer), uTime * (0.15 - 0.05 * uLayer));
  vec2 p = (vWorld + drift) * (0.085 + 0.035 * uLayer) + uLayer * 7.31;
  float n = fbm4(p);
  float puff = smoothstep(0.3, 0.78, n);
  // clearing: the mist breaks up from the thin parts first
  float clear = smoothstep(1.0 - uAlive, 1.0 - uAlive + 0.35, n * 0.75 + 0.25);
  float a = edge * (0.42 + 0.58 * puff) * (0.92 - 0.2 * uLayer) * clear * uAlive;
  // on the paper map: flat grey hatching instead of cloud
  a = mix(a, edge * 0.78 * uAlive, uPaper);
  vec3 lit = mix(vec3(0.74, 0.78, 0.83), vec3(0.98, 0.99, 1.0), puff);
  vec3 col = mix(lit, vec3(0.62, 0.62, 0.6) + 0.08 * step(0.5, fract((vWorld.x + vWorld.y) * 0.35)), uPaper);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

export class FogCover {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.renderOrder = 3;
    scene.add(this.group);
    this.time = { value: 0 };
    this.paper = { value: 0 };
    // a pointy-top hexagon a little larger than a hex, flat on the ground
    this.geometry = new THREE.CircleGeometry(HEX_SIZE * 1.18, 6, Math.PI / 6);
    this.hexes = new Map(); // hex id → { meshes, alive: { value }, fading }
  }

  // the hexes hidden now: new ones get mist, the ones discovered since start clearing
  set(ids) {
    const want = new Set(ids);
    for (const [id, rec] of this.hexes) if (!want.has(id) && !rec.fading) rec.fading = true;
    for (const id of want) {
      if (this.hexes.has(id)) continue;
      const h = GEO.hexes[id];
      const alive = { value: 1 };
      const meshes = LAYERS.map((y, i) => {
        const m = new THREE.Mesh(
          this.geometry,
          new THREE.ShaderMaterial({
            uniforms: { uTime: this.time, uAlive: alive, uLayer: { value: i }, uPaper: this.paper },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            fog: false,
          }),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(h.x, y, h.z);
        m.renderOrder = 3 + i;
        this.group.add(m);
        return m;
      });
      this.hexes.set(id, { meshes, alive, fading: false });
    }
  }

  // true while something is moving (the mist drifts all the time; clearing is a short animation)
  update(t, dt, paper = 0) {
    this.time.value = t;
    this.paper.value = paper;
    for (const [id, rec] of this.hexes) {
      if (!rec.fading) continue;
      rec.alive.value = Math.max(0, rec.alive.value - dt / FADE);
      if (rec.alive.value > 0) continue;
      for (const m of rec.meshes) {
        this.group.remove(m);
        m.material.dispose();
      }
      this.hexes.delete(id);
    }
    return this.hexes.size > 0;
  }

  dispose() {
    for (const rec of this.hexes.values()) for (const m of rec.meshes) m.material.dispose();
    this.hexes.clear();
    this.scene.remove(this.group);
    this.geometry.dispose();
  }
}
