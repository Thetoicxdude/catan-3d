// Hemi-octahedral impostors for the photo-scanned trees and bushes.
// Each species is an atlas of G×G orthographic views over the upper hemisphere (colour + coverage,
// plus tree-space normals). Every plant is one camera-facing quad that picks the four nearest views,
// re-projects them through the view ray (so the parallax stays right while the camera orbits) and
// blends them. Lit by the scene's lights and shadows like any standard material; casts proper
// silhouette shadows through a matching depth material.
import * as THREE from 'three';

const VERT_PARS = /* glsl */ `
uniform float uG;
uniform float uR;
uniform float uCy;
uniform float uTime;
uniform float uWind;
uniform vec3 uSunDir;
attribute vec4 aInst;  // base x, y, z, yaw
attribute vec4 aInst2; // scale, phase, tint, -
varying vec4 vUvA;
varying vec4 vUvB;
varying vec4 vCell;
varying vec2 vFw;
varying vec3 vYawTint;
vec2 octEnc(vec3 d) {
  d.y = max(d.y, 0.0);
  vec2 o = d.xz / (abs(d.x) + abs(d.y) + abs(d.z));
  return vec2(o.x + o.y, o.x - o.y);
}
vec3 octDec(vec2 g) {
  vec2 uv = (g + 0.5) / uG * 2.0 - 1.0;
  vec2 o = vec2(uv.x + uv.y, uv.x - uv.y) * 0.5;
  return normalize(vec3(o.x, 1.0 - abs(o.x) - abs(o.y), o.y));
}
// where the view ray through tree-space point p meets the image plane of view d (frame uv, 0..1)
vec2 frameUv(vec3 p, vec3 r, vec3 d) {
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), d));
  vec3 up = cross(d, rt);
  float t = -dot(p, d) / min(dot(r, d), -0.05);
  vec3 q = p + r * t;
  return vec2(dot(q, rt), dot(q, up)) / (2.0 * uR) + 0.5;
}
`;

// shared by the colour and the depth pass: builds the quad and the four view lookups
const VERT_MAIN = /* glsl */ `
  vec3 bbBase = aInst.xyz;
  float bbS = aInst2.x;
  vec3 bbC = bbBase + vec3(0.0, uCy * bbS, 0.0);
  bool bbOrtho = projectionMatrix[3][3] > 0.5;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camB = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 bbP = bbC + (camR * position.x + camU * position.y) * (uR * bbS * 1.08);
  vec3 bbDv = bbOrtho ? camB : normalize(cameraPosition - bbC);
  vec3 bbRay = bbOrtho ? -camB : normalize(bbP - cameraPosition);
  float bbCos = cos(aInst.w);
  float bbSin = sin(aInst.w);
  mat3 toLocal = mat3(bbCos, 0.0, bbSin, 0.0, 1.0, 0.0, -bbSin, 0.0, bbCos);
  vec3 dl = toLocal * bbDv;
  vec2 g = clamp((octEnc(dl) * 0.5 + 0.5) * uG - 0.5, vec2(0.0), vec2(uG - 1.0));
  vec2 g0 = floor(g);
  vec2 g1 = min(g0 + 1.0, vec2(uG - 1.0));
  vFw = g - g0;
  vCell = vec4(g0, g1);
  vec3 pl = toLocal * (bbP - bbC) / bbS;
  vec3 rl = toLocal * bbRay;
  vUvA = vec4(frameUv(pl, rl, octDec(g0)), frameUv(pl, rl, octDec(vec2(g1.x, g0.y))));
  vUvB = vec4(frameUv(pl, rl, octDec(vec2(g0.x, g1.y))), frameUv(pl, rl, octDec(g1)));
  vYawTint = vec3(bbCos, bbSin, aInst2.z);
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uAtlas;
uniform sampler2D uAtlasN;
uniform float uG;
uniform float uAtlasSize;
varying vec4 vUvA;
varying vec4 vUvB;
varying vec4 vCell;
varying vec2 vFw;
varying vec3 vYawTint;
vec2 atlasUv(vec2 cell, vec2 uv) {
  uv = clamp(uv, 0.003, 0.997);
  return vec2(cell.x + uv.x, cell.y + 1.0 - uv.y) / uG;
}
`;

const FRAG_SAMPLE = /* glsl */ `
  vec2 a00 = atlasUv(vCell.xy, vUvA.xy);
  vec2 a10 = atlasUv(vCell.zy, vUvA.zw);
  vec2 a01 = atlasUv(vCell.xw, vUvB.xy);
  vec2 a11 = atlasUv(vCell.zw, vUvB.zw);
  float w00 = (1.0 - vFw.x) * (1.0 - vFw.y);
  float w10 = vFw.x * (1.0 - vFw.y);
  float w01 = (1.0 - vFw.x) * vFw.y;
  float w11 = vFw.x * vFw.y;
  vec4 c00 = texture2D(uAtlas, a00);
  vec4 c10 = texture2D(uAtlas, a10);
  vec4 c01 = texture2D(uAtlas, a01);
  vec4 c11 = texture2D(uAtlas, a11);
  float impA = w00 * c00.a + w10 * c10.a + w01 * c01.a + w11 * c11.a;
  // keep the canopy from thinning out in the small mips
  float impLod = max(0.0, log2(max(fwidth(a00.x), fwidth(a00.y)) * uAtlasSize));
  impA = min(1.0, impA * (1.0 + 0.22 * impLod));
`;

export function impostorMaterial(sp, shared) {
  const uniforms = {
    uAtlas: { value: sp.color },
    uAtlasN: { value: sp.normal },
    uG: { value: sp.meta.G },
    uR: { value: sp.meta.R },
    uCy: { value: sp.meta.Cy },
    uAtlasSize: { value: sp.meta.size },
    uTime: shared.time,
    uWind: { value: sp.wind != null ? sp.wind : 0.035 },
    uSunDir: shared.sunDir,
  };
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, alphaTest: 0.5 });
  if (sp.tint) m.color.copy(sp.tint);
  m.alphaToCoverage = true;
  m.shadowSide = THREE.DoubleSide;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace(
        '#include <beginnormal_vertex>',
        VERT_MAIN +
          `
  // wind: the crown sways, the base stays put
  float bbH = clamp((bbP.y - bbBase.y) / max(2.0 * uCy * bbS, 0.01), 0.0, 1.2);
  bbP.xz += vec2(sin(uTime * 1.3 + aInst2.y), cos(uTime * 1.07 + aInst2.y * 1.7)) * (uWind * bbS * bbH * bbH);
  // pull the quad towards the camera (along the ray) so the ground behind the trunk can't clip it
  if (!bbOrtho) bbP -= bbRay * (uR * bbS * 0.8);
  vec3 objectNormal = bbDv;`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = bbP;')
      .replace(
        '#include <worldpos_vertex>',
        `vec4 worldPosition = vec4(transformed, 1.0);
  // shadow lookups from in front of the plant's own (light-facing) caster: no self-shadow blotches
  worldPosition.xyz += uSunDir * (uR * bbS * 1.1);`,
      );
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace(
        '#include <map_fragment>',
        FRAG_SAMPLE +
          `
  vec3 impCol = (w00 * c00.a * c00.rgb + w10 * c10.a * c10.rgb + w01 * c01.a * c01.rgb + w11 * c11.a * c11.rgb) / max(w00 * c00.a + w10 * c10.a + w01 * c01.a + w11 * c11.a, 1e-4);
  vec3 impN = w00 * c00.a * (texture2D(uAtlasN, a00).rgb * 2.0 - 1.0) + w10 * c10.a * (texture2D(uAtlasN, a10).rgb * 2.0 - 1.0)
            + w01 * c01.a * (texture2D(uAtlasN, a01).rgb * 2.0 - 1.0) + w11 * c11.a * (texture2D(uAtlasN, a11).rgb * 2.0 - 1.0);
  impN = normalize(impN + vec3(0.0, 1e-4, 0.0));
  impN = vec3(vYawTint.x * impN.x - vYawTint.y * impN.z, impN.y, vYawTint.y * impN.x + vYawTint.x * impN.z);
  impCol *= mix(vec3(0.84, 0.88, 0.8), vec3(1.1, 1.06, 1.0), vYawTint.z);
  diffuseColor.rgb *= impCol;
  diffuseColor.a = impA;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  normal = normalize((viewMatrix * vec4(impN, 0.0)).xyz);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * 0.07; // light scattering through the needles`,
      );
  };
  m.customProgramCacheKey = () => 'impostor-v1';
  return m;
}

export function impostorDepthMaterial(sp) {
  const uniforms = {
    uAtlas: { value: sp.color },
    uG: { value: sp.meta.G },
    uR: { value: sp.meta.R },
    uCy: { value: sp.meta.Cy },
    uAtlasSize: { value: sp.meta.size },
    uTime: { value: 0 },
    uWind: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  };
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5 });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', VERT_MAIN + '\n  vec3 transformed = bbP;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS).replace(
      '#include <map_fragment>',
      FRAG_SAMPLE + '\n  diffuseColor.a = impA;',
    );
  };
  m.customProgramCacheKey = () => 'impostor-depth-v1';
  return m;
}

const QUAD = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
})();

// pts: [{x, y, z, yaw, s, ph, tint}] ; sp: {color, normal, meta}
export function impostorMesh(sp, pts, shared, name) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = QUAD.index;
  g.setAttribute('position', QUAD.getAttribute('position'));
  g.setAttribute('normal', QUAD.getAttribute('normal'));
  const a = new Float32Array(pts.length * 4);
  const b = new Float32Array(pts.length * 4);
  pts.forEach((p, i) => {
    a.set([p.x, p.y, p.z, p.yaw], i * 4);
    b.set([p.s, p.ph, p.tint, 0], i * 4);
  });
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(a, 4));
  g.setAttribute('aInst2', new THREE.InstancedBufferAttribute(b, 4));
  g.instanceCount = pts.length;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 120);
  const mesh = new THREE.Mesh(g, impostorMaterial(sp, shared));
  mesh.customDepthMaterial = impostorDepthMaterial(sp);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = name || 'impostors';
  return mesh;
}
