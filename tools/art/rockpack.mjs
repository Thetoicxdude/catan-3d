// CSP-friendly rock/animal packs: no meshopt (no WebAssembly needed to decode) and no embedded
// textures (those load as plain same-origin WebP files instead of blob: URLs).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, resample, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

fs.mkdirSync('out/rocks2', { recursive: true });
const rocks = [];
for (const f of fs.readdirSync('out/rocks').filter((f) => f.endsWith('.glb'))) {
  const slug = f.replace('.glb', '');
  const doc = await io.read('out/rocks/' + f);
  const m = doc.getRoot().listMaterials()[0];
  const tex = {};
  for (const [k, t] of [
    ['d', m.getBaseColorTexture()],
    ['n', m.getNormalTexture()],
    ['mr', m.getMetallicRoughnessTexture()],
  ]) {
    if (!t) continue;
    fs.writeFileSync(`out/rocks2/${slug}_${k}.webp`, Buffer.from(t.getImage()));
    tex[k] = `${slug}_${k}.webp`;
  }
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setBaseColorTexture(null);
    mat.setNormalTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setOcclusionTexture(null);
  }
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (e instanceof EXTMeshoptCompression || e instanceof EXTTextureWebP) e.dispose();
  await doc.transform(prune(), dedup());
  await io.write(`out/rocks2/${slug}.glb`, doc);
  rocks.push({ slug, tex, kb: Math.round(fs.statSync(`out/rocks2/${slug}.glb`).size / 1024) });
}
console.table(rocks.map((r) => ({ slug: r.slug, kb: r.kb, tex: Object.keys(r.tex).join(',') })));
fs.writeFileSync('out/rocks2/rocks.json', JSON.stringify(rocks.map(({ slug, tex }) => ({ slug, tex })), null, 1));

fs.mkdirSync('out/animals2', { recursive: true });
const KEEP = { sheep: ['Idle', 'Jump'], cow: ['Idle', 'Walk', 'WalkSlow'], horse: ['Idle', 'Walk', 'WalkSlow', 'Run'], pig: ['Idle', 'Jump'] };
for (const [name, keep] of Object.entries(KEEP)) {
  const doc = await io.read(`out/animals-raw/${name}.glb`);
  for (const a of doc.getRoot().listAnimations()) {
    const short = a.getName().replace(/^.*\|/, '');
    if (!keep.includes(short)) a.dispose();
    else a.setName(short);
  }
  await doc.transform(resample({ tolerance: 1e-4 }), prune(), dedup(), quantize({ quantizePosition: 14, quantizeNormal: 10 }));
  await io.write(`out/animals2/${name}.glb`, doc);
  console.log(name, Math.round(fs.statSync(`out/animals2/${name}.glb`).size / 1024) + ' KB');
}
