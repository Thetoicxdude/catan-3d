// Rocks, boulders, cliffs and stumps: decimate the photo-scans to game-ready meshes,
// shrink textures to WebP and pack each as a meshopt-compressed GLB.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = '/mnt/user-data/uploads/Claude/catan-assets/models';
const OUT = process.argv[2] || 'out/rocks';
fs.mkdirSync(OUT, { recursive: true });

// slug → target triangles per mesh
const ERR = {};
const JOBS = {
  namaqualand_boulder_02: 1800,
  namaqualand_boulders_01: 900,
  namaqualand_stones_01: 300,
  rock_07: 700,
  rock_09: 500,
  rock_face_01: 2600,
  rock_face_02: 2400,
  rock_moss_set_01: 700,
  stone_01: 500,
  tree_stump_01: 1400,
  dead_quiver_trunk: 1200,
};

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

function tris(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
  return n;
}

const report = [];
for (const [slug, target] of Object.entries(JOBS)) {
  const doc = await io.read(`${SRC}/${slug}/${slug}_1k.gltf`);
  const meshes = doc.getRoot().listMeshes().length;
  const before = tris(doc);
  const ratio = Math.min(1, (target * meshes) / before);
  for (const mat of doc.getRoot().listMaterials()) mat.setDoubleSided(false);
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: ERR[slug] || 0.02, lockBorder: false }),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80, slots: /^(baseColor|normal)/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 75, slots: /^(occlusion|metallicRoughness)/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const file = `${OUT}/${slug}.glb`;
  await io.write(file, doc);
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => n.getName());
  report.push({ slug, before: Math.round(before), after: Math.round(tris(doc)), kb: Math.round(fs.statSync(file).size / 1024), nodes });
}
console.table(report.map((r) => ({ ...r, nodes: r.nodes.length })));
fs.writeFileSync(`${OUT}/rocks.json`, JSON.stringify(report, null, 1));
