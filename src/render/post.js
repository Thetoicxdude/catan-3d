// Post-processing for the strategy map: ambient occlusion (N8AO) for contact shadows under every
// tree, rock and house, filmic tone mapping with a light colour grade, and SMAA edge smoothing.
// Overlays (placement markers) are drawn afterwards, untouched by the grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';

// resolution of the moving-camera frames, relative to the still ones
const MOTION_SCALE = 0.65;

// The colour grade, applied in the output pass right after tone mapping and the sRGB conversion
// (one full-screen pass less than a pass of its own, with the same result): a little more
// saturation and contrast, a gentle S-curve, warm sunlit highlights and slightly cool shade.
const GRADE_GLSL = /* glsl */ `
  {
    vec3 col = clamp(gl_FragColor.rgb, 0.0, 1.0);
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, 1.06);
    col = clamp((col - 0.5) * 1.05 + 0.5, 0.0, 1.0);
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
    col += vec3(0.018, 0.008, -0.012) * smoothstep(0.45, 1.0, l) + vec3(-0.01, 0.0, 0.014) * (1.0 - smoothstep(0.0, 0.45, l));
    gl_FragColor.rgb = col;
  }
`;
function gradedOutput() {
  const pass = new OutputPass();
  const fs = pass.material.fragmentShader;
  const end = fs.lastIndexOf('}');
  pass.material.fragmentShader = fs.slice(0, end) + GRADE_GLSL + fs.slice(end);
  return pass;
}

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.quality = quality;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    // While the camera moves, frames go through a lighter chain instead: the scene at reduced
    // resolution (scaled up on the way to the screen), no AO, no SMAA. Moving frames are the ones that
    // must be quick, and the eye can't pick out contact shadows or edge steps in motion.
    this.motion = new EffectComposer(renderer);
    this.motion.setPixelRatio(pr * MOTION_SCALE);
    this.motion.setSize(size.x, size.y);
    this.motion.addPass(new RenderPass(scene, camera));
    this.motion.addPass(gradedOutput());
    // Still frames: the scene with ambient occlusion. When the occlusion is too faint to see (the far,
    // paper-map zoom levels) a plain render of the scene stands in for it and its passes are skipped.
    this.plain = new RenderPass(scene, camera);
    this.plain.enabled = false;
    this.composer.addPass(this.plain);
    this.ao = new N8AOPass(scene, camera, size.x * pr, size.y * pr);
    // (no second and third render of the see-through things — smoke, previews — each frame to keep the
    // occlusion off them: under a wisp of smoke it doesn't show, and the extra renders cost more than
    // the occlusion itself on integrated graphics)
    this.ao.autoDetectTransparency = false;
    const cfg = this.ao.configuration;
    cfg.transparencyAware = false;
    cfg.gammaCorrection = false;
    cfg.aoRadius = 1.2;
    cfg.distanceFalloff = 1.0;
    cfg.intensity = 2.2;
    cfg.color = new THREE.Color(0.06, 0.07, 0.1);
    // (computed at half size and scaled up along the depth edges: a quarter of the work, and under
    // trees and houses seen from a strategy camera the difference doesn't show)
    cfg.halfRes = true;
    this.ao.setQualityMode(quality === 'high' ? 'Medium' : 'Low');
    this.composer.addPass(this.ao);
    this.output = gradedOutput();
    this.composer.addPass(this.output);
    this.smaa = new SMAAPass(size.x * pr, size.y * pr);
    this.composer.addPass(this.smaa);
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.motion.setPixelRatio(pr * MOTION_SCALE);
    this.motion.setSize(w, h);
  }

  // AO fades out on the far, paper-map zoom levels, and fades back in after the camera stops
  setZoom(paper, zoom01) {
    this.aoTarget = 2.2 * (1 - paper) * (1 - 0.35 * zoom01);
  }

  setMotion(moving, dt) {
    if (moving !== this.moving) {
      this.moving = moving;
      if (!moving) this.aoFade = 0;
    }
    if (!moving) this.aoFade = Math.min(1, (this.aoFade == null ? 1 : this.aoFade) + dt / 0.3);
    const k = Math.max(0.0001, (this.aoTarget == null ? 2.2 : this.aoTarget) * (this.aoFade == null ? 1 : this.aoFade));
    this.ao.configuration.intensity = k;
    const on = k > 0.01;
    if (on !== this.ao.enabled) {
      this.ao.enabled = on;
      this.plain.enabled = !on;
    }
  }

  render(dt) {
    (this.moving ? this.motion : this.composer).render(dt);
  }

  // Draw one frame through each chain, when the map is built: the passes' shaders (ambient occlusion,
  // anti-aliasing, the grade) are compiled here, under the loading screen, and not on the first frame
  // the camera comes to rest in the middle of the opening.
  warm() {
    this.composer.render(0.016);
    this.motion.render(0.016);
  }

  // one of the buffers the map is drawn into (shaders are compiled for these: MapView.precompile)
  target() {
    return this.composer.renderTarget1;
  }

  dispose() {
    for (const c of [this.composer, this.motion]) {
      for (const pass of c.passes) if (pass.dispose) pass.dispose();
      c.dispose();
    }
  }
}
