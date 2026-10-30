// Visual test harness: plays an AI game for N turns and renders the map.
import { createGame, applyAction, makeView, actorsNow } from './engine/engine.js';
import { aiAct } from './ai/ai.js';
import { makeRng } from './engine/rng.js';
import { MapView } from './render/scene.js';
import { GEO } from './engine/geometry.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 4242);
const turns = Number(params.get('turns') || 30);
const quality = params.get('q') || 'high';
const players = [
  { name: '赤焰王國', color: '#c8372d', kind: 'ai', ai: { level: 'normal' } },
  { name: '蒼藍聯邦', color: '#2f6fd0', kind: 'ai', ai: { level: 'normal' } },
  { name: '琥珀公國', color: '#e8892b', kind: 'ai', ai: { level: 'normal' } },
  { name: '白楊共和國', color: '#ece6d6', kind: 'ai', ai: { level: 'normal' } },
];
const st = createGame({ seed, players });
const rnd = makeRng(seed);
const mem = players.map(() => ({}));
let guard = 0;
while (st.phase !== 'over' && st.turn < turns && guard++ < 5000) {
  const actors = actorsNow(st);
  let acted = false;
  for (const p of actors) {
    const a = aiAct(makeView(st, p), p, mem[p], rnd);
    if (!a) continue;
    applyAction(st, a);
    acted = true;
    break;
  }
  if (!acted) break;
}
const t0 = performance.now();
const view = new MapView(document.getElementById('app'));
view.boardRef = st.board;
view.build(st, players, quality);
view.sync(st, [], false);
window.__buildMs = performance.now() - t0;
if (params.get('still')) {
  window.__shot = (x, z, h, mode = 'terrain', yawDeg = 0, pitch = 50, marks = null) => {
    view.setMapMode(mode);
    const c = view.camera;
    c.goal.set(x, 0, z);
    c.goalH = h;
    c.target.set(x, 0, z);
    c.h = h;
    c.yaw = c.goalYaw = (yawDeg * Math.PI) / 180;
    c.pitch = c.goalPitch = pitch;
    if (marks === 'vertex') {
      const ids = [];
      st.vertices.forEach((b, v) => !b && ids.push(v));
      view.setInteraction({ kind: 'vertex', ids: ids.filter((v, i) => i % 3 === 0), player: 0, onPick() {} });
      view.setHover(ids[6]);
    } else if (marks === 'edge') {
      const ids = [];
      st.edges.forEach((p, e) => p < 0 && ids.push(e));
      view.setInteraction({ kind: 'edge', ids: ids.filter((e, i) => i % 4 === 0), player: 0, onPick() {} });
    } else if (marks === 'hex') {
      view.setInteraction({ kind: 'hex', ids: [...Array(19).keys()].filter((h) => h !== st.board.robber), player: 0, onPick() {} });
    } else view.setInteraction(null);
    for (const k of Object.keys(view.modeT)) view.modeT[k] = k === mode ? 1 : 0;
    const t1 = performance.now();
    view.shadowDirty = 2;
    view.frame();
    view.frame();
    return performance.now() - t1;
  };
} else view.start();
window.__view = view;
window.__state = st;
window.__hexes = GEO.hexes.map((h) => ({ id: h.id, x: h.x, z: h.z, t: st.board.hexes[h.id].terrain }));
// resolves once the realistic asset pack has replaced the procedural scenery (or failed)
window.__assets = () =>
  new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      if ((view.flora.real && !view.applying && (view.models || window.__noModels)) || performance.now() - t0 > 150000) {
        clearInterval(iv);
        res({ real: view.flora.real, models: !!view.models, counts: view.flora.counts, ms: Math.round(performance.now() - t0) });
      }
    }, 100);
  });
window.__hexAt = (type, k = 0) => window.__hexes.filter((h) => h.t === type)[k];
// positions of pieces for close-up shots
window.__pieceAt = (kind, k = 0) => {
  const out = [];
  st.vertices.forEach((b, v) => b && b.t === kind && out.push(v));
  const v = out[k % Math.max(1, out.length)];
  return v == null ? null : { v, ...GEO.vertices[v] };
};
window.__harborAt = (k = 0) => {
  const hb = st.board.harbors[k % st.board.harbors.length];
  const e = GEO.edges[hb.edge];
  return { x: e.x + e.outward.x * 3, z: e.z + e.outward.z * 3, type: hb.type };
};
window.__ready = true;
