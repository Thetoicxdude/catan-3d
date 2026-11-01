// Placement markers that read on any terrain and from any camera angle: white rings with a dark
// outline (settlement/city spots), outlined stripes with a centre dot (road spots) and target rings
// around number tokens (robber). Drawn on top of everything at a constant on-screen size.
import * as THREE from 'three';
import { GEO } from '../engine/geometry.js';

const INK = 'rgba(12,10,8,0.92)';

function canvasTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const TEX = {};
function textures() {
  if (TEX.spot) return TEX;
  TEX.spot = canvasTex((g) => {
    g.beginPath();
    g.arc(64, 64, 45, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.34)';
    g.fill();
    g.lineWidth = 21;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 12;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.beginPath();
    g.arc(64, 64, 13, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = INK;
    g.stroke();
  });
  TEX.dot = canvasTex((g) => {
    g.beginPath();
    g.arc(64, 64, 36, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 16;
    g.strokeStyle = INK;
    g.stroke();
  });
  TEX.target = canvasTex((g) => {
    g.beginPath();
    g.arc(64, 64, 55, 0, Math.PI * 2);
    g.lineWidth = 12;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 6;
    g.strokeStyle = '#ffffff';
    g.stroke();
    // four inward ticks: reads as "aim here"
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 - Math.PI / 2;
      const x0 = 64 + Math.cos(a) * 60;
      const y0 = 64 + Math.sin(a) * 60;
      const x1 = 64 + Math.cos(a) * 44;
      const y1 = 64 + Math.sin(a) * 44;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.lineWidth = 11;
      g.strokeStyle = INK;
      g.stroke();
      g.lineWidth = 5;
      g.strokeStyle = '#ffffff';
      g.stroke();
    }
  });
  return TEX;
}

const RIBBON_VERT = /* glsl */ `
  attribute vec2 aPerp;
  attribute float aSide;
  attribute float aAlong;
  uniform float uWidth;
  varying float vSide;
  varying float vAlong;
  void main() {
    vSide = aSide;
    vAlong = aAlong;
    vec3 p = position;
    p.xz += aPerp * aSide * uWidth * 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uAlpha;
  varying float vSide;
  varying float vAlong;
  void main() {
    float s = abs(vSide);
    float core = 1.0 - smoothstep(0.40, 0.52, s);
    vec3 col = mix(vec3(0.047, 0.039, 0.031), uColor, core);
    float dash = step(0.5, fract(vAlong * 2.5 - uTime * 0.9));
    col = mix(col, col * 0.78, dash * core);
    float ends = smoothstep(0.0, 0.06, vAlong) * smoothstep(1.0, 0.94, vAlong);
    gl_FragColor = vec4(col, uAlpha * ends);
  }`;

export class Markers {
  constructor(scene, pieces, terrain) {
    this.pieces = pieces;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'markers';
    scene.add(this.group);
    this.items = new Map();
    this.kind = null;
    this.hover = null;
    this.hoverColor = new THREE.Color(1, 1, 1);
    this.time = 0;
    textures();
  }

  setPieces(pieces) {
    this.pieces = pieces;
  }

  sprite(tex, order = 40) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false });
    const s = new THREE.Sprite(m);
    s.renderOrder = order;
    s.frustumCulled = false;
    this.group.add(s);
    return s;
  }

  ribbon(e) {
    const ge = GEO.edges[e];
    const A = GEO.vertices[ge.v[0]];
    const B = GEO.vertices[ge.v[1]];
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    const px = -dz / len;
    const pz = dx / len;
    const S = 10;
    const pos = [];
    const perp = [];
    const side = [];
    const along = [];
    const idx = [];
    for (let i = 0; i <= S; i++) {
      const t = 0.2 + (i / S) * 0.6;
      const x = A.x + dx * t;
      const z = A.z + dz * t;
      const y = Math.max(0, this.terrain.heightAt(x, z)) + 0.45; // (at sea: on the water)
      for (const sd of [-1, 1]) {
        pos.push(x, y, z);
        perp.push(px, pz);
        side.push(sd);
        along.push(i / S);
      }
      if (i < S) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aPerp', new THREE.Float32BufferAttribute(perp, 2));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 }, uWidth: { value: 1 }, uAlpha: { value: 0.92 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 38;
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  clear() {
    for (const it of this.items.values()) {
      for (const o of it.objs) {
        if (o.geometry && !o.isSprite) o.geometry.dispose();
        o.material.dispose();
      }
    }
    this.group.clear();
    this.items.clear();
    this.kind = null;
    this.hover = null;
  }

  show(kind, ids, color) {
    this.clear();
    this.kind = kind;
    // hover tint: the acting player's colour, lifted so dark colours still read on dark ground
    const c = new THREE.Color(color || '#ffffff');
    const hsl = {};
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.max(0.5, hsl.l));
    this.hoverColor = c;
    const T = textures();
    for (const id of ids) {
      if (kind === 'vertex') {
        const s = this.sprite(T.spot);
        s.position.copy(this.pieces.vertexPos(id)).add(new THREE.Vector3(0, 0.6, 0));
        this.items.set(id, { objs: [s], spot: s, base: 36 });
      } else if (kind === 'edge') {
        const r = this.ribbon(id);
        const d = this.sprite(T.dot, 41);
        d.position.copy(this.pieces.edgeMid(id)).add(new THREE.Vector3(0, 0.7, 0));
        this.items.set(id, { objs: [r, d], ribbon: r, spot: d, base: 18 });
      } else if (kind === 'hex') {
        const h = GEO.hexes[id];
        const y = this.terrain.heightAt(h.x, h.z);
        const s = this.sprite(T.target);
        s.position.set(h.x, Math.max(y, 0.5) + 1.2, h.z);
        this.items.set(id, { objs: [s], spot: s, base: 0, hex: true });
      }
    }
  }

  setHover(id) {
    this.hover = id;
    for (const [k, it] of this.items) {
      const hot = k === id;
      if (it.spot) it.spot.material.color.copy(hot ? this.hoverColor : new THREE.Color(1, 1, 1));
      if (it.ribbon) {
        const u = it.ribbon.material.uniforms.uColor.value;
        if (hot) u.copy(this.hoverColor).convertLinearToSRGB();
        else u.setRGB(1, 1, 1);
      }
    }
  }

  // camDist: camera distance; vh: viewport height in CSS px; touch: coarse pointer
  update(dt, camDist, vh, touch, tokenScale) {
    if (!this.items.size) return;
    this.time += dt;
    const t = this.time;
    const pulse = 1 + Math.sin(t * 4.2) * 0.07;
    const k = 0.65 / Math.max(1, vh); // sprite scale per screen pixel (fov 36°)
    for (const [id, it] of this.items) {
      const hot = id === this.hover;
      let px;
      if (it.hex) px = 44 * tokenScale * 1.95 + 6;
      else px = it.base * (touch ? 1.3 : 1);
      px *= hot ? 1.3 : pulse;
      it.spot.scale.setScalar(px * k);
      it.spot.material.opacity = hot ? 1 : 0.88 + 0.12 * Math.sin(t * 4.2);
      if (it.ribbon) {
        const u = it.ribbon.material.uniforms;
        u.uTime.value = t;
        u.uWidth.value = ((hot ? 17 : 13) * (touch ? 1.2 : 1) * 0.65 * camDist) / Math.max(1, vh);
      }
    }
  }
}
