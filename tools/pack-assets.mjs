// Collects the processed realistic assets into ./assets and writes assets/manifest.json.
// Sources are produced by the bake/convert scripts in /home/claude/assetwork.
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || '/home/claude/assetwork/out';
const OUT = path.resolve('assets');
fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['imp', 'terrain', 'rocks', 'animals', 'models', 'tex']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const copy = (from, to) => fs.copyFileSync(path.join(SRC, from), path.join(OUT, to));
// the artifact host only serves web types: binary glTF travels base64-wrapped in JSON
const wrapGlb = (from, to) => fs.writeFileSync(path.join(OUT, to), JSON.stringify({ glb: fs.readFileSync(path.join(SRC, from)).toString('base64') }));
const impMeta = JSON.parse(fs.readFileSync(path.join(SRC, 'imp/impostors.json'), 'utf8'));
for (const name of Object.keys(impMeta)) {
  copy(`imp/${name}.webp`, `imp/${name}.webp`);
  copy(`imp/${name}_n.webp`, `imp/${name}_n.webp`);
}
const terrain = JSON.parse(fs.readFileSync(path.join(SRC, 'terrain/terrain.json'), 'utf8'));
for (const l of terrain.layers) {
  copy(`terrain/${l.name}.webp`, `terrain/${l.name}.webp`);
  copy(`terrain/${l.name}_n.webp`, `terrain/${l.name}_n.webp`);
}
// rocks: geometry-only glTF (no meshopt → no WebAssembly) plus plain WebP maps
const rocks = JSON.parse(fs.readFileSync(path.join(SRC, 'rocks2/rocks.json'), 'utf8')).sort((a, b) => a.slug.localeCompare(b.slug));
for (const r of rocks) {
  wrapGlb(`rocks2/${r.slug}.glb`, `rocks/${r.slug}.json`);
  for (const f of Object.values(r.tex)) copy(`rocks2/${f}`, `rocks/${f}`);
}
const animals = ['sheep', 'cow', 'horse', 'pig'];
for (const a of animals) wrapGlb(`animals2/${a}.glb`, `animals/${a}.json`);

// buildings, harbor kit, ships and props (baked atlases; see /home/claude/assetwork/bldg)
const BLDG = process.argv[3] || '/home/claude/assetwork/bldg/pack';
const MODELS = [
  { name: 'house1', group: 'houses' },
  { name: 'house2', group: 'houses' },
  { name: 'house3', group: 'houses' },
  { name: 'house4', group: 'houses' },
  { name: 'fort' },
  { name: 'pier' },
  { name: 'pinnace', group: 'ships' },
  { name: 'dutch', group: 'ships' },
  { name: 'props' },
];
const models = [];
for (const m of MODELS) {
  fs.writeFileSync(path.join(OUT, `models/${m.name}.json`), JSON.stringify({ glb: fs.readFileSync(path.join(BLDG, `${m.name}.glb`)).toString('base64') }));
  const maps = {};
  for (const k of ['d', 'm', 'n']) {
    const f = `${m.name}_${k}.webp`;
    if (fs.existsSync(path.join(BLDG, f))) {
      fs.copyFileSync(path.join(BLDG, f), path.join(OUT, 'models', f));
      maps[k] = f;
    }
  }
  models.push({ ...m, maps });
}
const tiles = ['street', 'stone', 'thatch', 'wood', 'brick', 'rock'].map((name) => ({ name, maps: { d: `${name}_d.webp`, n: `${name}_n.webp`, arm: `${name}_arm.webp` } }));
for (const t of tiles) for (const f of Object.values(t.maps)) fs.copyFileSync(path.join(BLDG, 'tex', f), path.join(OUT, 'tex', f));
// resource and development card art (Cycles still lifes from the scans above; see assetwork/cards)
const CARDS = '/home/claude/assetwork/cards/pack';
fs.mkdirSync(path.join(OUT, 'cards'), { recursive: true });
for (const r of ['wood', 'brick', 'wool', 'grain', 'ore']) for (const f of [`${r}.webp`, `${r}_s.webp`]) fs.copyFileSync(path.join(CARDS, f), path.join(OUT, 'cards', f));
for (const d of ['knight', 'road', 'plenty', 'monopoly', 'vp']) fs.copyFileSync(path.join(CARDS, `dev_${d}.webp`), path.join(OUT, 'cards', `dev_${d}.webp`));

const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else files.push({ path: path.relative(OUT, p).split(path.sep).join('/'), bytes: fs.statSync(p).size });
  }
};
walk(OUT);
const manifest = {
  version: 1,
  // what the 3D loader fetches (its progress bar); the card art is loaded by the page's CSS
  files: files.filter((f) => !f.path.startsWith('cards/')).sort((a, b) => a.path.localeCompare(b.path)),
  impostors: impMeta,
  terrain: { layers: terrain.layers },
  rocks,
  animals: animals.map((name) => ({ name })),
  models,
  tiles,
  credits: [
    { what: '中世紀木構房屋', who: 'Daniel74（Blend Swap）', license: 'CC0', url: 'https://www.blendswap.com/blends/view/75519' },
    { what: '城堡、碼頭、帆船與道具', who: 'Poly Haven', license: 'CC0', url: 'https://polyhaven.com/models' },
    { what: '植物、岩石、地表材質', who: 'Poly Haven', license: 'CC0', url: 'https://polyhaven.com' },
    { what: '農場動物（含動畫）', who: 'Quaternius', license: 'CC0', url: 'https://quaternius.com' },
  ],
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
const total = files.reduce((s, f) => s + f.bytes, 0);
console.log(`${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}`);
