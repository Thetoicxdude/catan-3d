// How often the map is drawn and at what resolution (the logic only: scene.js applies it;
// test/pace.mjs tests it).
//
// The map is a board game's table. Drawn as fast as the screen refreshes, as it used to be, a 144 Hz
// or 240 Hz gaming monitor had the graphics card paint 144–240 full frames a second, nearly all of
// them the same picture but for the waves: the card ran flat out and the computer heated up for
// nothing. Frames are now paced by what is going on, and the picture is kept to a size the card
// draws with time to spare.

// Frames a second: `active` while something changes on the map (the camera moves, a piece is built,
// something under the pointer lights up), `idle` when only the scenery is alive (waves, sheep,
// smoke), `away` when the window is not the one in use. (A hidden page is not drawn at all: the
// browser stops calling.) Infinity: every screen refresh.
export const FPS_MODES = {
  eco: { active: 30, idle: 20, away: 10 },
  std: { active: 60, idle: 30, away: 15 },
  max: { active: Infinity, idle: 60, away: 15 },
};
export const fpsMode = (name) => FPS_MODES[name] || FPS_MODES.std;

// The screen's refresh interval (ms), from the recent gaps between animation-frame callbacks: the
// quick end of them (a callback that comes late — a heavy frame, a busy page — says nothing about
// the screen).
export function refreshInterval(gaps, fallback = 1000 / 60) {
  const ok = gaps.filter((d) => d > 2 && d < 100).sort((a, b) => a - b);
  if (ok.length < 8) return fallback;
  return ok[Math.floor(ok.length * 0.25)];
}

// A frame stays up for a whole number of screen refreshes, so the frames that are drawn are evenly
// spaced: every 2nd refresh of a 120 or 144 Hz screen for "60 a second", every 4th of 240 Hz.
export function refreshesPerFrame(T, fps) {
  if (!(fps > 0) || !isFinite(fps)) return 1;
  return Math.max(1, Math.round(1000 / T / fps));
}

// The most pixels the 3D picture is drawn at, by quality. Beyond it the picture is drawn smaller and
// scaled up by the browser: a 4K screen at "high" gets about 1440p (the number tokens, labels and
// the interface are not part of the 3D picture and stay sharp).
export const PIXEL_BUDGET = { low: 1.8e6, medium: 2.4e6, high: 4.2e6 };
export function pixelRatioCap(w, h, dpr, quality) {
  // (full sharpness on strong graphics, one pixel per CSS pixel on integrated ones)
  const cap = Math.min(dpr || 1, quality === 'high' ? 1.75 : 1);
  const budget = PIXEL_BUDGET[quality] || PIXEL_BUDGET.medium;
  return Math.max(0.5, Math.min(cap, Math.sqrt(budget / Math.max(1, w * h))));
}

// The resolution governor. It is told about every frame drawn: how long after the one before it
// came (against the pace asked for) and, where the browser measures it, how long the graphics card
// worked on it. The picture's size is chosen for the map at rest: a still frame must take the card
// no more than about half the time between frames at the resting pace (`budget`, ms), whatever the
// pace of the moment. (Frames while something moves come at twice the resting rate, and a card that
// can't keep up with that for the second an animation lasts draws a few fewer of them; shrinking the
// picture for that would blur the board for the whole game on integrated graphics.) A card that
// needs more gets a smaller picture, one step at a time; a card with plenty to spare gets it back.
// Late frames are evidence only where the browser can't say how long the card worked: when it can,
// a frame late while the card had time to spare was held up by the page (a turn being computed, a
// panel rebuilt), which a smaller picture wouldn't help. `scale` is the share of the allowed
// resolution in use (1: all of it).
const STEP = 0.85;
export const SCALE_MIN = 0.5;
export class Governor {
  constructor() {
    this.scale = 1;
    this.wait = 8000; // how long things must go well before trying a step up (doubles when a try fails)
    this.changedAt = -Infinity;
    this.raisedAt = -Infinity;
    this.heldUntil = -Infinity;
    this.clear();
  }

  // nothing is learnt for a while: the map has just been built, resized, or given new scenery, and
  // the frames stumble for reasons that have nothing to do with the picture's size
  hold(now, ms) {
    this.heldUntil = Math.max(this.heldUntil, now + ms);
    this.clear();
  }

  clear() {
    this.n = 0;
    this.late = 0;
    this.shares = [];
    this.t0 = null;
  }

  // gap: ms since the frame before; want: the ms between frames asked for; gpuMs: the card's time
  // for an earlier frame, when a measurement has come back; budget: the ms between frames at rest.
  // → the new scale when it changes, else null.
  frame({ now, gap, want, gpuMs = null, budget = want }) {
    // (the page was hidden, or something else held it up: nothing to learn about the card)
    if (!(gap > 0) || gap > 250) {
      this.clear();
      return null;
    }
    // (a change of size is a hitch of its own)
    if (now - this.changedAt < 600 || now < this.heldUntil) return null;
    if (this.t0 == null) this.t0 = now;
    // (only frames asked for at the resting pace or slower: at the quicker pace while something moves,
    // a frame that comes late says nothing about the resting picture)
    if (want >= budget * 0.9) {
      this.n++;
      if (gap > want * 1.35 + 2) this.late++;
    }
    if (gpuMs != null && gpuMs > 0.05) this.shares.push(gpuMs / budget);
    if (this.n + this.shares.length < 30 || now - this.t0 < 1000) return null;
    // (the middle one: a frame that compiled a shader or redrew the shadows says nothing of the rest)
    const share = this.shares.length >= 5 ? this.shares.sort((a, b) => a - b)[this.shares.length >> 1] : null;
    const late = this.n >= 20 ? this.late / this.n : null;
    this.clear();
    const slow = share != null ? share > 0.6 : late != null && late > 0.4;
    const easy = share != null ? share < 0.33 : late != null && late < 0.05;
    if (slow && this.scale > SCALE_MIN + 1e-6) {
      // (a step up that had to be taken back: wait longer before the next try)
      if (now - this.raisedAt < 15000) this.wait = Math.min(this.wait * 2, 240000);
      this.scale = Math.max(SCALE_MIN, this.scale * STEP);
      this.changedAt = now;
      return this.scale;
    }
    if (easy && this.scale < 1 - 1e-6 && now - this.changedAt > this.wait) {
      this.scale = Math.min(1, this.scale / STEP);
      this.changedAt = now;
      this.raisedAt = now;
      return this.scale;
    }
    return null;
  }
}
