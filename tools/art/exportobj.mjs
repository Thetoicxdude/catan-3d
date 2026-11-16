// The development mode's models (src/render/devmodels.js) written out for the card renders in Blender
// (tools/art/cards/bldgcards.py): one OBJ per model, a group per material slot, and a JSON beside it with
// the kit parts and plants the model asks for (Blender places the original Poly Haven models there).
//   node tools/art/exportobj.mjs OUTDIR [b:granary w:gardens:done f:fields:2 …]   (no list: every card)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildingModel, wonderModel, facilityModel, CARD_MODELS } from '../../src/render/devmodels.js';
import { BUILDING_IDS, isWonder } from '../../src/engine/develop.js';

const out = process.argv[2] || '/tmp/devobj';
mkdirSync(out, { recursive: true });
let list = process.argv.slice(3);
// every card: the buildings, the wonders complete, the road (the other basic cards are set up in Blender)
if (!list.length) list = [...BUILDING_IDS.map((k) => (isWonder(k) ? `w:${k}:done` : `b:${k}`)), 'k:road'];

for (const item of list) {
  const [kind, k, x] = item.split(':');
  const stage = x === undefined ? 1 : isNaN(+x) ? x : +x;
  const m = kind === 'b' ? buildingModel(k) : kind === 'w' ? wonderModel(k, stage) : kind === 'k' ? CARD_MODELS[k] && CARD_MODELS[k]() : facilityModel(k, stage);
  if (!m) {
    console.warn('no model', item);
    continue;
  }
  const b = m.build();
  const lines = [`# ${item} (catan-3d devmodels.js)`, `mtllib ${item.replace(/:/g, '_')}.mtl`];
  let vbase = 1;
  for (const [slot, g] of Object.entries(b.geos)) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const uv = g.attributes.uv;
    lines.push(`o ${slot}`, `usemtl ${slot}`);
    for (let i = 0; i < p.count; i++) lines.push(`v ${p.getX(i).toFixed(5)} ${p.getY(i).toFixed(5)} ${p.getZ(i).toFixed(5)}`);
    for (let i = 0; i < p.count; i++) lines.push(`vt ${(uv ? uv.getX(i) : 0).toFixed(5)} ${(uv ? uv.getY(i) : 0).toFixed(5)}`);
    for (let i = 0; i < p.count; i++) lines.push(`vn ${n.getX(i).toFixed(4)} ${n.getY(i).toFixed(4)} ${n.getZ(i).toFixed(4)}`);
    for (let i = 0; i < p.count; i += 3) {
      const a = vbase + i;
      lines.push(`f ${a}/${a}/${a} ${a + 1}/${a + 1}/${a + 1} ${a + 2}/${a + 2}/${a + 2}`);
    }
    vbase += p.count;
  }
  const name = item.replace(/:/g, '_');
  writeFileSync(join(out, name + '.obj'), lines.join('\n') + '\n');
  writeFileSync(join(out, name + '.mtl'), Object.keys(b.geos).map((s) => `newmtl ${s}\nKd 0.8 0.8 0.8\n`).join('\n'));
  writeFileSync(join(out, name + '.json'), JSON.stringify({ item, kit: b.kit, plants: b.plants, fires: b.fires, smoke: b.smoke, box: { min: b.box.min, max: b.box.max } }, null, 1));
  console.log(item, Object.keys(b.geos).join(' '), b.kit.length, 'kit parts', b.plants.length, 'plants');
}
