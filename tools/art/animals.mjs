// Slim the converted animals: drop unused clips, resample keyframes, meshopt-compress.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, dedup, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const KEEP = { sheep: ['Idle', 'Jump'], cow: ['Idle', 'Walk', 'WalkSlow'], horse: ['Idle', 'Walk', 'WalkSlow', 'Run'], pig: ['Idle', 'Jump'] };
fs.mkdirSync('out/animals', { recursive: true });
for (const [name, keep] of Object.entries(KEEP)) {
  const doc = await io.read(`out/animals-raw/${name}.glb`);
  for (const a of doc.getRoot().listAnimations()) {
    const short = a.getName().replace(/^.*\|/, '');
    if (!keep.includes(short)) a.dispose();
    else a.setName(short);
  }
  await doc.transform(resample({ tolerance: 1e-4 }), prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(`out/animals/${name}.glb`, doc);
  const anims = doc.getRoot().listAnimations().map((a) => a.getName());
  console.log(name, Math.round(fs.statSync(`out/animals/${name}.glb`).size / 1024) + ' KB', anims.join(','));
}
