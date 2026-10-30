// Building/ship/prop models → lean game GLBs: weld, optional meshopt simplify, quantize (KHR_mesh_quantization,
// decoded natively by three.js — no WebAssembly at runtime). Maps are copied alongside.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, quantize, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const SRC = 'bldg/out';
const OUT = 'bldg/pack';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT + '/tex', { recursive: true });
// name: [simplify ratio, max error]
const JOBS = { house1: [0.7, 0.0006], house2: [0.8, 0.0006], house3: [0.65, 0.0006], house4: [0.8, 0.0006], fort: [1, 0], pier: [0.8, 0.001], pinnace: [0.75, 0.001], dutch: [0.85, 0.001], props: [1, 0] };
const tri = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + p.getIndices().getCount() / 3, 0), 0);
for (const [name, [ratio, error]] of Object.entries(JOBS)) {
  const doc = await io.read(`${SRC}/${name}.glb`);
  const before = tri(doc);
  await doc.transform(weld({ tolerance: 0.0001 }));
  if (ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
  await doc.transform(prune(), dedup(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }));
  await io.write(`${OUT}/${name}.glb`, doc);
  for (const k of ['d', 'm', 'n']) if (fs.existsSync(`${SRC}/${name}_${k}.webp`)) fs.copyFileSync(`${SRC}/${name}_${k}.webp`, `${OUT}/${name}_${k}.webp`);
  console.log(name.padEnd(8), 'tris', before, '→', tri(doc), ' glb', Math.round(fs.statSync(`${OUT}/${name}.glb`).size / 1024) + ' KB');
}
for (const f of fs.readdirSync(`${SRC}/tex`)) fs.copyFileSync(`${SRC}/tex/${f}`, `${OUT}/tex/${f}`);
