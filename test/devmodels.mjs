// The development mode's models (src/render/devmodels.js, devwonders.js): every building, facility and
// wonder stage builds; its geometry is whole (no NaN, normals and UVs on every vertex); it keeps to the
// art design's sizes and triangle budgets; every material slot it uses is one the meshes know; the
// shipyard's place on the shore and the others' places beside their settlement.
import { buildingModel, wonderModel, facilityModel, BUILDING_MODELS, FACILITY_MODELS, WONDER_MODELS, CARD_MODELS } from '../src/render/devmodels.js';
import { BUILDINGS, isWonder } from '../src/engine/develop.js';

let fails = 0;
let passes = 0;
const check = (name, ok, info = '') => {
  if (ok) passes++;
  else {
    fails++;
    console.log('FAIL', name, info);
  }
};
// the slots devmesh.js draws (devmesh.js PLAIN, the owner's roof and cloth)
const SLOTS = new Set(['stone', 'plaster', 'wood', 'dark', 'thatch', 'brick', 'rock', 'street', 'sand', 'marble', 'metal', 'copper', 'gold', 'leaf', 'water', 'canvas', 'paper', 'burlap', 'earth', 'glow', 'roof', 'cloth']);
const KITS = new Set(['props', 'fort', 'windmill', 'animal']);

function inspect(name, m, { w, h, tris }) {
  check(name + ' builds', !!m);
  if (!m) return;
  const b = m.build();
  let n = 0;
  let bad = 0;
  for (const [slot, g] of Object.entries(b.geos)) {
    check(`${name}: slot ${slot} is known`, SLOTS.has(slot));
    const p = g.attributes.position;
    check(`${name}: ${slot} has normals and UVs`, g.attributes.normal && g.attributes.uv && g.attributes.normal.count === p.count && g.attributes.uv.count === p.count);
    for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) bad++;
    n += p.count / 3;
  }
  check(`${name}: no NaN`, bad === 0, bad);
  const bb = b.box;
  const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  check(`${name}: within ${w} wide`, width <= w, width.toFixed(2));
  check(`${name}: within ${h} high`, bb.max.y <= h, bb.max.y.toFixed(2));
  check(`${name}: within ${tris} triangles`, n <= tris, n);
  for (const k of b.kit) check(`${name}: kit part ${k.model}`, KITS.has(k.model), k.model);
  for (const s of b.smoke) check(`${name}: smoke anchored`, Number.isFinite(s.x + s.y + s.z));
  return b;
}

// the special buildings beside a settlement: about the design's 1.6 across (a wall a little more), under
// 2.2 high (lower than the castle), about 3,000 triangles
for (const k of Object.keys(BUILDINGS).filter((k) => !isWonder(k))) {
  check(`building ${k} has a model`, !!BUILDING_MODELS[k]);
  inspect(`b:${k}`, buildingModel(k), { w: k === 'wall' ? 2.8 : 2.0, h: 2.2, tris: 3000 });
}
// the facilities: 2 (level 1) to 3 (level 2) across, give or take, under 2.5 high
for (const t of ['fields', 'forest', 'hills', 'pasture', 'mountains']) {
  check(`facility ${t} has a model`, !!FACILITY_MODELS[t]);
  for (const lv of [1, 2]) inspect(`f:${t}:${lv}`, facilityModel(t, lv), { w: lv === 1 ? 2.7 : 3.6, h: 2.5, tris: 3000 });
}
// the wonders: under 7 across, under 6 high (the lighthouse the tallest), about 10,000 triangles
for (const k of Object.keys(BUILDINGS).filter((k) => isWonder(k))) {
  check(`wonder ${k} has a model`, !!WONDER_MODELS[k]);
  const hs = {};
  for (const st of [1, 2, 3, 'done', 'ruin']) {
    const b = inspect(`w:${k}:${st}`, wonderModel(k, st), { w: 7.2, h: 6.0, tris: 10000 });
    if (b) hs[st] = b.box.max.y;
  }
  // (it goes up stage by stage; the ruin is lower than what stood)
  check(`${k}: the ruin lower than the complete wonder`, hs.ruin < hs.done, JSON.stringify(hs));
}
const tallest = Object.keys(WONDER_MODELS).map((k) => [k, wonderModel(k, 'done').build().box.max.y]).sort((a, b) => b[1] - a[1])[0];
check('the lighthouse is the tallest wonder', tallest[0] === 'lighthouse', tallest);
inspect('k:road', CARD_MODELS.road(), { w: 3.2, h: 1.0, tris: 3000 });

// where the buildings beside a settlement stand (render/develop.js): on the 37-hex map, two beside each
// inland city well apart and on its land side; a shipyard on the side of the sea
{
  const { createGame, ensureMap } = await import('../src/engine/engine.js');
  const { developMap } = await import('../src/engine/maps.js');
  const geo = await import('../src/engine/geometry.js');
  const { annexSpots } = await import('../src/render/develop.js');
  const st = createGame({ seed: 3, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i, color: '#fff', kind: 'human' })), map: developMap(4).id, firstPlayer: 0 });
  ensureMap(st);
  // (the live binding: useMap swaps the map in)
  const GEO = geo.GEO;
  const land = (h) => st.board.hexes[h] && st.board.hexes[h].terrain !== 'sea';
  let cities = 0;
  let shores = 0;
  GEO.vertices.forEach((g, v) => {
    if (g.hexes.length === 3 && g.hexes.every(land)) {
      st.vertices[v] = { p: 0, t: 'c' };
      const [a, b] = annexSpots(st, v, ['market', 'barracks'], land, null);
      const apart = Math.hypot(a.x - b.x, a.z - b.z);
      const toLand = (s) => g.hexes.some((h) => Math.hypot(GEO.hexes[h].x - s.x, GEO.hexes[h].z - s.z) < Math.hypot(GEO.hexes[h].x - g.x, GEO.hexes[h].z - g.z));
      if (apart < 3 || !toLand(a) || !toLand(b)) check(`city ${v}: its two buildings apart, on its land`, false, apart.toFixed(2));
      cities++;
      st.vertices[v] = null;
    } else if (g.coastal) {
      st.vertices[v] = { p: 0, t: 'c' };
      const [ship, other] = annexSpots(st, v, ['shipyard', 'granary'], land, null);
      // (away from the middle of its land hexes: towards the sea)
      const lx = g.hexes.reduce((s, h) => s + GEO.hexes[h].x, 0) / g.hexes.length;
      const lz = g.hexes.reduce((s, h) => s + GEO.hexes[h].z, 0) / g.hexes.length;
      const dot = (ship.x - g.x) * (lx - g.x) + (ship.z - g.z) * (lz - g.z);
      if (!ship.shore || dot >= 0 || !other || other.shore) check(`coast ${v}: the shipyard on the sea side, the granary inland`, false, JSON.stringify({ ship, other }));
      shores++;
      st.vertices[v] = null;
    }
  });
  check('settlements to place buildings beside', cities > 10 && shores > 10, { cities, shores });
}

console.log(fails ? `devmodels: ${fails} failed, ${passes} passed` : `devmodels: ${passes} passed`);
process.exit(fails ? 1 : 0);
