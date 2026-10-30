// Sound effects synthesised with WebAudio (no audio files): dice rattle, card whoosh and chime,
// building thunk, victory-point fanfare, robber drum. Quiet by default, switchable in settings.
let ctx = null;
let master = null;
let noise = null;
let enabled = true;
let volume = 0.5;

export function setSfx(on, vol) {
  enabled = !!on;
  if (vol != null) volume = vol;
  if (master) master.gain.value = enabled ? volume : 0;
}
export function sfxOn() {
  return enabled;
}

function ac() {
  if (!enabled || typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(ctx.destination);
      const len = ctx.sampleRate;
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}
// browsers only allow audio after a gesture: wake the context on the first one
if (typeof window !== 'undefined') {
  const wake = () => {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  };
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function burst(c, t, { f = 2400, q = 3, gain = 0.4, dur = 0.05, type = 'bandpass' } = {}) {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const flt = c.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = c.createGain();
  env(g, t, 0.002, gain, dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(c, t, { f = 440, type = 'sine', gain = 0.2, a = 0.004, d = 0.3, to = null } = {}) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
  const g = c.createGain();
  env(g, t, a, gain, d);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + a + d + 0.05);
}

const RES_NOTE = { wood: 523.25, brick: 587.33, wool: 659.25, grain: 783.99, ore: 880 };

export const sfx = {
  // wooden dice tumbling on a table, then settling
  dice(dur = 0.85) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + 0.02;
    let t = t0;
    while (t < t0 + dur - 0.12) {
      burst(c, t, { f: 1600 + Math.random() * 2600, q: 2.5 + Math.random() * 3, gain: 0.18 + Math.random() * 0.22, dur: 0.03 + Math.random() * 0.03 });
      t += 0.035 + Math.random() * 0.09 * (1 + (t - t0) / dur);
    }
    // the two final knocks
    for (const k of [0, 0.07]) {
      burst(c, t0 + dur + k, { f: 900, q: 1.2, gain: 0.5, dur: 0.07, type: 'lowpass' });
      tone(c, t0 + dur + k, { f: 190, to: 120, gain: 0.18, d: 0.09 });
    }
  },
  // a card leaving the board
  whoosh(delay = 0) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = noise;
    const flt = c.createBiquadFilter();
    flt.type = 'bandpass';
    flt.Q.value = 1.4;
    flt.frequency.setValueAtTime(500, t);
    flt.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
    const g = c.createGain();
    env(g, t, 0.05, 0.12, 0.2);
    src.connect(flt);
    flt.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.4, 0.3);
  },
  // a card landing in the hand: bright two-partial chime, rising with each card in a haul
  chime(res, step = 0, delay = 0) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + delay;
    const f = (RES_NOTE[res] || 660) * Math.pow(2, Math.min(step, 7) / 12);
    tone(c, t, { f, gain: 0.16, d: 0.42 });
    tone(c, t, { f: f * 2.01, gain: 0.06, d: 0.22 });
    tone(c, t, { f: f * 3, type: 'triangle', gain: 0.03, d: 0.12 });
  },
  // timber and stone set down
  build(kind = 'settlement') {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.01;
    tone(c, t, { f: 140, to: 62, gain: 0.32, d: 0.2 });
    burst(c, t, { f: 700, q: 0.8, gain: 0.35, dur: 0.09, type: 'lowpass' });
    if (kind !== 'road') burst(c, t + 0.09, { f: 520, q: 0.8, gain: 0.25, dur: 0.08, type: 'lowpass' });
    if (kind === 'city') [392, 523.25, 659.25].forEach((f, i) => tone(c, t + 0.16 + i * 0.07, { f, gain: 0.1, d: 0.5 }));
  },
  // victory point: a short ascending fanfare
  fanfare(big = false) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.02;
    const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      tone(c, t + i * 0.085, { f, type: 'triangle', gain: 0.14, d: 0.5 });
      tone(c, t + i * 0.085, { f: f * 2, gain: 0.04, d: 0.25 });
    });
    burst(c, t + notes.length * 0.085, { f: 7000, q: 0.7, gain: 0.06, dur: 0.5, type: 'highpass' });
  },
  // the robber: low drum and a falling horn
  robber() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.02;
    tone(c, t, { f: 96, to: 48, gain: 0.45, d: 0.45 });
    burst(c, t, { f: 300, q: 0.7, gain: 0.3, dur: 0.18, type: 'lowpass' });
    tone(c, t + 0.12, { f: 220, to: 146, type: 'sawtooth', gain: 0.05, a: 0.04, d: 0.7 });
  },
  // a card taken away
  steal() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.01;
    tone(c, t, { f: 520, to: 260, type: 'triangle', gain: 0.12, d: 0.28 });
    sfx.whoosh(0.02);
  },
  // your turn
  turn() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.02;
    tone(c, t, { f: 587.33, type: 'triangle', gain: 0.1, d: 0.3 });
    tone(c, t + 0.11, { f: 880, type: 'triangle', gain: 0.1, d: 0.45 });
  },
};
