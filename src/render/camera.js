// Strategy camera: orbits a ground target with free rotation (yaw) and an adjustable tilt (pitch).
// Wheel zooms toward the cursor, left-drag pans, right/middle-drag rotates (horizontal) and tilts
// (vertical), Q/E rotate, Z/X tilt, Home resets. Touch: one finger pans, two fingers pinch + twist.
// Zoom `h` is the distance from the camera to its target. Far zoom eases toward a map-like view.
import * as THREE from 'three';

export const ZOOM_MIN = 17;
export const ZOOM_MAX = 235;
export const PITCH_MIN = 5; // degrees from straight down
export const PITCH_MAX = 68;
export const PITCH_DEFAULT = 50;
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class StrategyCamera {
  constructor(canvas, aspect) {
    this.canvas = canvas;
    this.cam = new THREE.PerspectiveCamera(36, aspect, 0.5, 2400);
    this.target = new THREE.Vector3(0, 0, 4);
    this.goal = this.target.clone();
    this.h = 120;
    this.goalH = 120;
    this.yaw = 0;
    this.goalYaw = 0;
    this.pitch = PITCH_DEFAULT;
    this.goalPitch = PITCH_DEFAULT;
    this.liftY = 0;
    this.heightAt = null; // set by the map: terrain height for collision
    this.keys = new Set();
    this.drag = null;
    this.orbit = null;
    this.moved = false;
    this.onClick = null;
    this.onHover = null;
    this.pointers = new Map();
    this.pinch = null;
    this.bounds = { minX: -58, maxX: 58, minZ: -54, maxZ: 60 };
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
    this.sig = 0;
    this.attach();
    this.apply();
  }

  // effective tilt (radians from vertical) for a distance and user tilt
  effPitch(d = this.h, p = this.pitch) {
    const far = smooth(150, 235, d * this.aspectFactor());
    const near = 1 - smooth(ZOOM_MIN, 55, d);
    let ph = p + near * 8;
    ph = ph * (1 - far) + Math.min(ph, 16) * far;
    return clamp(ph, PITCH_MIN, 74) * D2R;
  }

  aspectFactor() {
    return (this.cam.aspect || 1.6) / 1.6;
  }

  pose(target, d, yaw, pitchDeg) {
    const ph = this.effPitch(d, pitchDeg);
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const ty = target.y || 0;
    const p = this.cam.position;
    p.set(target.x + Math.sin(yaw) * s * d, ty + c * d, target.z + Math.cos(yaw) * s * d);
    if (this.heightAt) {
      const ground = this.heightAt(p.x, p.z);
      if (p.y < ground + 2.2) p.y = ground + 2.2;
    }
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(target.x, ty, target.z);
    this.cam.near = Math.max(0.3, d * 0.02);
    this.cam.far = d * 16 + 700;
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld(true);
  }

  apply() {
    this.pose({ x: this.target.x, y: this.liftY, z: this.target.z }, this.h, this.yaw, this.pitch);
  }

  // run fn with the camera temporarily posed at the goal state (used to keep the cursor anchored)
  withGoalPose(newH, fn) {
    const saveT = this.target.clone();
    const saveH = this.h;
    const saveYaw = this.yaw;
    const saveP = this.pitch;
    this.target.copy(this.goal);
    this.h = newH;
    this.yaw = this.goalYaw;
    this.pitch = this.goalPitch;
    this.apply();
    const out = fn();
    this.target.copy(saveT);
    this.h = saveH;
    this.yaw = saveYaw;
    this.pitch = saveP;
    this.apply();
    return out;
  }

  groundAt(clientX, clientY, clampFar = 0) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.cam);
    const p = new THREE.Vector3();
    const hit = this.ray.ray.intersectPlane(this.plane, p);
    if (!clampFar) return hit ? p : null;
    if (!hit || p.distanceTo(this.ray.ray.origin) > clampFar) {
      this.ray.ray.at(clampFar, p);
      p.y = 0;
    }
    return p;
  }

  // narrow (portrait) screens need more distance to take in the whole island
  zoomMax() {
    const a = this.cam.aspect || 1.6;
    return a >= 1.6 ? ZOOM_MAX : Math.min(560, (ZOOM_MAX * 1.6) / Math.max(0.45, a));
  }
  // desktop-equivalent zoom: thresholds (paper map, clouds) follow how much ground is visible
  equivH() {
    return this.h * this.aspectFactor();
  }
  fitIsland(margin = 1) {
    const a = this.cam.aspect || 1.6;
    return Math.min(this.zoomMax(), Math.max(110, (118 * margin) / (0.65 * Math.min(a, 1.75))));
  }

  clampGoal() {
    const b = this.bounds;
    this.goal.x = clamp(this.goal.x, b.minX, b.maxX);
    this.goal.z = clamp(this.goal.z, b.minZ, b.maxZ);
    this.goalH = clamp(this.goalH, ZOOM_MIN, this.zoomMax());
    this.goalPitch = clamp(this.goalPitch, PITCH_MIN, PITCH_MAX);
  }

  zoomAt(factor, clientX, clientY) {
    const before = clientX != null ? this.groundAt(clientX, clientY) : null;
    const newH = clamp(this.goalH * factor, ZOOM_MIN, this.zoomMax());
    if (before) {
      const after = this.withGoalPose(newH, () => this.groundAt(clientX, clientY));
      if (after) {
        this.goal.x += before.x - after.x;
        this.goal.z += before.z - after.z;
      }
    }
    this.goalH = newH;
    this.clampGoal();
  }

  rotateBy(rad) {
    this.goalYaw += rad;
  }
  tiltBy(deg) {
    this.goalPitch = clamp(this.goalPitch + deg, PITCH_MIN, PITCH_MAX);
  }
  setTilt(deg) {
    this.goalPitch = clamp(deg, PITCH_MIN, PITCH_MAX);
  }
  resetView() {
    // turn back to north the short way round and restore the default tilt
    const turns = Math.round(this.goalYaw / (Math.PI * 2));
    this.goalYaw = turns * Math.PI * 2;
    this.goalPitch = PITCH_DEFAULT;
  }

  flyTo(x, z, h = null) {
    this.goal.set(x, 0, z);
    if (h != null) this.goalH = h;
    this.clampGoal();
  }

  isVisible(x, z, margin = 0.12) {
    const v = new THREE.Vector3(x, 1, z).project(this.cam);
    return Math.abs(v.x) < 1 - margin && Math.abs(v.y) < 1 - margin && v.z < 1;
  }

  attach() {
    const c = this.canvas;
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
        if (e.shiftKey) this.tiltBy(-dy * 0.05);
        else this.zoomAt(Math.pow(1.0018, dy), e.clientX, e.clientY);
      },
      { passive: false },
    );
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = {
          d: Math.hypot(a.x - b.x, a.y - b.y),
          h: this.goalH,
          mx: (a.x + b.x) / 2,
          my: (a.y + b.y) / 2,
          ang: Math.atan2(b.y - a.y, b.x - a.x),
        };
        this.drag = null;
        this.orbit = null;
        return;
      }
      if (e.button === 1 || e.button === 2) {
        this.orbit = { x: e.clientX, y: e.clientY, yaw: this.goalYaw, pitch: this.goalPitch, button: e.button, moved: false };
        return;
      }
      const g = this.groundAt(e.clientX, e.clientY);
      this.drag = { x: e.clientX, y: e.clientY, ground: g, button: e.button };
      this.moved = false;
    });
    c.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        let da = ang - this.pinch.ang;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.pinch.ang = ang;
        this.goalYaw += da;
        this.yaw += da;
        const before = this.groundAt(this.pinch.mx, this.pinch.my);
        this.apply();
        const after = this.groundAt(mx, my);
        if (before && after) {
          this.goal.x += before.x - after.x;
          this.goal.z += before.z - after.z;
        }
        this.pinch.mx = mx;
        this.pinch.my = my;
        this.goalH = this.pinch.h * (this.pinch.d / Math.max(20, d));
        this.clampGoal();
        this.moved = true;
        return;
      }
      if (this.orbit) {
        const dx = e.clientX - this.orbit.x;
        const dy = e.clientY - this.orbit.y;
        if (!this.orbit.moved && Math.hypot(dx, dy) > 4) this.orbit.moved = true;
        if (this.orbit.moved) {
          this.goalYaw = this.orbit.yaw + dx * 0.0085;
          this.yaw = this.goalYaw;
          this.goalPitch = clamp(this.orbit.pitch - dy * 0.22, PITCH_MIN, PITCH_MAX);
          this.pitch = this.goalPitch;
          this.apply();
        }
        return;
      }
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (!this.moved && Math.hypot(dx, dy) > 6) this.moved = true;
        if (this.moved && this.drag.ground) {
          // pan so the grabbed ground point follows the cursor
          const g = this.groundAt(e.clientX, e.clientY);
          if (g) {
            this.goal.x += this.drag.ground.x - g.x;
            this.goal.z += this.drag.ground.z - g.z;
            this.target.x += this.drag.ground.x - g.x;
            this.target.z += this.drag.ground.z - g.z;
            this.clampGoal();
            this.apply();
          }
        }
        return;
      }
      if (this.onHover && e.pointerType !== 'touch') this.onHover(e.clientX, e.clientY);
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        this.drag = null;
        return;
      }
      if (this.orbit) {
        const o = this.orbit;
        this.orbit = null;
        if (!o.moved && o.button === 2 && this.onClick) this.onClick(e.clientX, e.clientY, 2, e.pointerType);
        return;
      }
      if (this.drag && !this.moved && this.onClick) this.onClick(e.clientX, e.clientY, this.drag.button, e.pointerType);
      this.drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.drag = null;
      this.pinch = null;
      this.orbit = null;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    const KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '=', '+', '-', '_', 'q', 'e', 'z', 'x', 'pageup', 'pagedown'];
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'home') {
        this.resetView();
        return;
      }
      if (KEYS.includes(k)) this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(dt) {
    const k = this.keys;
    if (k.size) {
      const sp = this.goalH * 1.1 * dt;
      // move relative to where the camera faces
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      let mx = 0;
      let mz = 0;
      if (k.has('w') || k.has('arrowup')) (mx += fx), (mz += fz);
      if (k.has('s') || k.has('arrowdown')) (mx -= fx), (mz -= fz);
      if (k.has('d') || k.has('arrowright')) (mx -= fz), (mz += fx);
      if (k.has('a') || k.has('arrowleft')) (mx += fz), (mz -= fx);
      this.goal.x += mx * sp;
      this.goal.z += mz * sp;
      if (k.has('=') || k.has('+')) this.goalH *= Math.pow(0.35, dt);
      if (k.has('-') || k.has('_')) this.goalH *= Math.pow(2.6, dt);
      if (k.has('q')) this.goalYaw -= 1.5 * dt;
      if (k.has('e')) this.goalYaw += 1.5 * dt;
      if (k.has('z') || k.has('pagedown')) this.goalPitch -= 40 * dt;
      if (k.has('x') || k.has('pageup')) this.goalPitch += 40 * dt;
      this.clampGoal();
    }
    const a = 1 - Math.pow(0.0009, dt);
    this.target.lerp(this.goal, a);
    this.h += (this.goalH - this.h) * a;
    this.yaw += (this.goalYaw - this.yaw) * a;
    this.pitch += (this.goalPitch - this.pitch) * a;
    // close-ups orbit around the terrain surface instead of sea level
    let lift = 0;
    if (this.heightAt && this.h < 60) lift = Math.max(0, this.heightAt(this.target.x, this.target.z)) * 0.7 * (1 - smooth(25, 60, this.h));
    this.liftY += (lift - this.liftY) * a;
    this.apply();
    const sig = this.target.x * 1.7 + this.target.z * 3.1 + this.h * 7.3 + this.yaw * 131 + this.pitch * 5.9 + this.liftY;
    const moved = Math.abs(sig - this.sig) > 1e-4;
    this.sig = sig;
    return moved;
  }

  setAspect(a) {
    this.cam.aspect = a;
    this.cam.updateProjectionMatrix();
  }
}
