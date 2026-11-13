// How often the map is drawn and at what size (src/render/pace.js): the frame rates on common
// screens, the pixel budget, the resolution governor.
//   node test/pace.mjs
import assert from 'node:assert/strict';
import { FPS_MODES, fpsMode, refreshInterval, refreshesPerFrame, pixelRatioCap, PIXEL_BUDGET, Governor, SCALE_MIN } from '../src/render/pace.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
};

test('frames are held for whole screen refreshes', () => {
  const rate = (hz, fps) => hz / refreshesPerFrame(1000 / hz, fps);
  // the standard pace: about 60 while something happens, about 30 at rest, about 15 in the background
  for (const hz of [60, 120, 240, 360]) {
    assert.equal(rate(hz, 60), 60);
    assert.equal(rate(hz, 30), 30);
    assert.equal(rate(hz, 15), 15);
  }
  assert.equal(rate(144, 60), 72);
  assert.equal(Math.round(rate(144, 30)), 29);
  assert.equal(rate(165, 60), 55);
  assert.equal(rate(75, 60), 75);
  // never faster than the screen, never less than one frame per refresh asked "as fast as it goes"
  for (const hz of [50, 60, 75, 90, 100, 120, 144, 165, 240]) {
    assert.equal(refreshesPerFrame(1000 / hz, Infinity), 1);
    for (const fps of [10, 15, 20, 30, 60]) {
      const r = rate(hz, fps);
      assert.ok(r <= hz + 1e-9 && r >= fps * 0.6 && r <= fps * 1.5, `${hz} Hz, ${fps} wanted: ${r}`);
    }
  }
  assert.equal(fpsMode('nonsense'), FPS_MODES.std);
  assert.ok(FPS_MODES.eco.active <= 30 && FPS_MODES.std.idle === 30 && FPS_MODES.max.active === Infinity);
});

test("the screen's refresh interval from the gaps between callbacks", () => {
  const T = 1000 / 144;
  // steady, with every other callback late (a frame was drawn) and a stall now and then
  const gaps = [];
  for (let i = 0; i < 48; i++) gaps.push(i % 12 === 5 ? 180 : i % 2 ? T * 1.6 : T + (i % 3) * 0.05);
  assert.ok(Math.abs(refreshInterval(gaps) - T) < 0.3, String(refreshInterval(gaps)));
  // too little to go on: what was known before
  assert.equal(refreshInterval([16, 17, 0.5, 400], 8.3), 8.3);
  // a card that can't keep up at all: the callbacks come as fast as it draws, and that is the pace
  assert.ok(Math.abs(refreshInterval(new Array(48).fill(40)) - 40) < 1e-9);
});

test('the pixel budget', () => {
  const px = (w, h, dpr, q) => w * h * pixelRatioCap(w, h, dpr, q) ** 2;
  // 1080p and 1440p screens are drawn at their own size at high quality
  assert.equal(pixelRatioCap(1920, 1080, 1, 'high'), 1);
  assert.equal(pixelRatioCap(2560, 1440, 1, 'high'), 1);
  assert.equal(pixelRatioCap(1536, 864, 1.25, 'high'), 1.25);
  // a 4K screen, whatever its scaling, is drawn within the budget
  for (const [w, h, dpr] of [[3840, 2160, 1], [2560, 1440, 1.5], [1920, 1080, 2]]) {
    assert.ok(px(w, h, dpr, 'high') <= PIXEL_BUDGET.high * 1.001, `${w}x${h}@${dpr}`);
    assert.ok(px(w, h, dpr, 'high') >= PIXEL_BUDGET.high * 0.999);
    assert.ok(px(w, h, dpr, 'medium') <= PIXEL_BUDGET.medium * 1.001);
  }
  // medium and low never go above one pixel per CSS pixel; nothing goes below half
  assert.equal(pixelRatioCap(800, 600, 2, 'medium'), 1);
  assert.equal(pixelRatioCap(800, 600, 3, 'low'), 1);
  assert.equal(pixelRatioCap(7680, 4320, 1, 'low'), 0.5);
});

// feed the governor `seconds` of frames at a pace; → its scale changes
// (budget: the ms between frames at rest, 30 a second unless said otherwise)
function run(g, t0, seconds, { want, gap = want, gpuMs = null, budget = 1000 / 30 }) {
  const out = [];
  let now = t0;
  const end = t0 + seconds * 1000;
  while (now < end) {
    now += gap;
    const s = g.frame({ now, gap, want, gpuMs, budget });
    if (s != null) out.push([Math.round(now - t0), +s.toFixed(3)]);
  }
  return { out, now };
}
const REST = 1000 / 30;
const BUSY = 1000 / 60;

test("the governor, where the card's time is not measured: late frames at rest shrink the picture, and it comes back when they stop", () => {
  const g = new Governor();
  // on time, no measurement: nothing to do
  let r = run(g, 0, 20, { want: REST });
  assert.deepEqual(r.out, []);
  assert.equal(g.scale, 1);
  // 18 frames a second when 30 were asked for: down, a step at a time, never below the floor
  r = run(g, r.now, 30, { want: REST, gap: 55 });
  assert.ok(r.out.length >= 4, JSON.stringify(r.out));
  assert.ok(Math.abs(r.out[0][1] - 0.85) < 1e-9);
  assert.equal(g.scale, SCALE_MIN);
  for (let i = 1; i < r.out.length; i++) assert.ok(r.out[i][0] - r.out[i - 1][0] >= 1000, 'one step a second at most');
  // on time again: back up, slowly (a wait before each step)
  r = run(g, r.now, 120, { want: REST });
  assert.equal(g.scale, 1);
  for (let i = 1; i < r.out.length; i++) assert.ok(r.out[i][0] - r.out[i - 1][0] >= 8000);
  // late frames at the quicker pace (something moving) say nothing about the picture at rest
  const b = new Governor();
  r = run(b, 0, 30, { want: BUSY, gap: 25 });
  assert.deepEqual(r.out, []);
  assert.equal(b.scale, 1);
});

test("the governor: the card's measured time keeps a still frame within about half the resting frame time", () => {
  const g = new Governor();
  // the card needing 26 of each 33 ms at rest: too much, though no frame is late
  let r = run(g, 0, 10, { want: REST, gpuMs: 26 });
  assert.ok(r.out.length >= 1 && g.scale < 1);
  // 14 of 33 ms: fine where it is (neither down nor up)
  const g2 = new Governor();
  g2.scale = 0.85;
  r = run(g2, 0, 60, { want: REST, gpuMs: 14 });
  assert.deepEqual(r.out, []);
  // 6 of 33 ms: room to spare, back up
  r = run(g2, r.now, 30, { want: REST, gpuMs: 6 });
  assert.equal(g2.scale, 1);
  // while something moves (60 a second asked for), a still frame of 14 ms is judged against the
  // resting pace: kept, though it is most of a 60th of a second
  const g3 = new Governor();
  r = run(g3, 0, 30, { want: BUSY, gap: 17, gpuMs: 14 });
  assert.deepEqual(r.out, []);
  // at "as fast as it goes" the resting pace is 60 a second, and the budget with it
  const g4 = new Governor();
  r = run(g4, 0, 10, { want: BUSY, gpuMs: 14, budget: BUSY });
  assert.ok(g4.scale < 1);
  // a frame now and then that took the card very long (a shader compiled, the shadows redrawn) among
  // quick ones: nothing to act on
  const g5 = new Governor();
  for (let i = 0, now = 0; i < 2000; i++) {
    now += REST;
    assert.equal(g5.frame({ now, gap: REST, want: REST, gpuMs: i % 7 === 0 ? 900 : 5, budget: REST }), null);
  }
});

test('the governor: late frames while the card has time to spare are the page, not the picture', () => {
  // (a turn being computed, a panel rebuilt: the frames come late, the card needs 8 of 33 ms)
  const g = new Governor();
  const r = run(g, 0, 60, { want: REST, gap: 60, gpuMs: 8 });
  assert.deepEqual(r.out, []);
  assert.equal(g.scale, 1);
});

test('the governor: a step up that has to be taken back is tried less and less often', () => {
  const g = new Governor();
  g.scale = 0.85;
  let now = 0;
  const ups = [];
  // on time at 0.85, late at 1
  for (let i = 0; i < 400000 && now < 600000; i++) {
    const late = g.scale > 0.9;
    const gap = late ? 55 : REST;
    now += gap;
    const s = g.frame({ now, gap, want: REST, budget: REST });
    if (s != null && s > 0.9) ups.push(now);
  }
  assert.ok(ups.length >= 3 && ups.length <= 8, `${ups.length} tries in ten minutes`);
  for (let i = 2; i < ups.length; i++) assert.ok(ups[i] - ups[i - 1] > (ups[i - 1] - ups[i - 2]) * 1.5, 'the wait doubles');
});

test('the governor ignores what says nothing about the card', () => {
  const g = new Governor();
  // the page was hidden, or stalled: gaps of seconds
  for (let i = 0, now = 0; i < 200; i++) {
    now += 3000;
    assert.equal(g.frame({ now, gap: 3000, want: REST, budget: REST }), null);
  }
  assert.equal(g.scale, 1);
  // just built, resized or given new scenery: held for a while, however the frames come
  const h = new Governor();
  h.hold(0, 5000);
  for (let i = 0, now = 0; now < 5000; i++) {
    now += 60;
    assert.equal(h.frame({ now, gap: 60, want: REST, budget: REST }), null);
  }
  assert.equal(h.scale, 1);
  // a hitch every second (a turn computed, a panel rebuilt) among frames on time
  let now = 1e6;
  for (let i = 0; i < 3000; i++) {
    const gap = i % 30 === 0 ? 150 : REST;
    now += gap;
    assert.equal(g.frame({ now, gap, want: REST, budget: REST }), null);
  }
});

console.log(`pace: ${passed} tests passed`);
