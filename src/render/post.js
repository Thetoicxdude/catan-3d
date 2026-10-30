// Post-processing for the strategy map: ambient occlusion (N8AO) for contact shadows under every
// tree, rock and house, filmic tone mapping, a light colour grade and SMAA edge smoothing.
// Overlays (placement markers) are drawn afterwards, untouched by the grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.06 },
    uContrast: { value: 1.05 },
    uWarm: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat, uContrast, uWarm;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      // gentle S-curve around mid grey
      col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      // split toning: warm sunlit highlights, slightly cool shade
      col += uWarm * (vec3(0.018, 0.008, -0.012) * smoothstep(0.45, 1.0, l) + vec3(-0.01, 0.0, 0.014) * (1.0 - smoothstep(0.0, 0.45, l)));
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.quality = quality;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    this.ao = new N8AOPass(scene, camera, size.x * pr, size.y * pr);
    const cfg = this.ao.configuration;
    cfg.gammaCorrection = false;
    cfg.aoRadius = 1.2;
    cfg.distanceFalloff = 1.0;
    cfg.intensity = 2.2;
    cfg.color = new THREE.Color(0.06, 0.07, 0.1);
    cfg.halfRes = quality !== 'high';
    this.ao.setQualityMode(quality === 'high' ? 'Medium' : 'Low');
    this.composer.addPass(this.ao);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.smaa = new SMAAPass(size.x * pr, size.y * pr);
    this.composer.addPass(this.smaa);
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  // AO fades out on the far, paper-map zoom levels (the pass also renders the scene: keep it on)
  setZoom(paper, zoom01) {
    this.ao.configuration.intensity = Math.max(0.0001, 2.2 * (1 - paper) * (1 - 0.35 * zoom01));
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
