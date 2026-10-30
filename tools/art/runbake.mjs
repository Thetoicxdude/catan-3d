// Drives the bake page in headless Chromium: impostor atlases for the foliage.
// usage: node runbake.mjs [jobName ...]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = 'out/imp-raw';
fs.mkdirSync(OUT, { recursive: true });

const M = 'models';
export const JOBS = {
  fir_a: { url: `${M}/fir_sapling/fir_sapling_1k.gltf`, node: 'fir_sapling_a' },
  fir_b: { url: `${M}/fir_sapling/fir_sapling_1k.gltf`, node: 'fir_sapling_b' },
  fir_c: { url: `${M}/fir_sapling/fir_sapling_1k.gltf`, node: 'fir_sapling_c' },
  quiver1: { url: `${M}/quiver_tree_01/quiver_tree_01_1k.gltf`, node: 'quiver_tree_01' },
  quiver2: { url: `${M}/quiver_tree_02/quiver_tree_02_1k.gltf`, node: 'quiver_tree_02' },
  rooibos_a: { url: `${M}/wild_rooibos_bush/wild_rooibos_bush_1k.gltf`, node: 'wild_rooibos_bush_a', mapOverride: 'fixed/wild_rooibos_bush_diffa.png' },
  rooibos_b: { url: `${M}/wild_rooibos_bush/wild_rooibos_bush_1k.gltf`, node: 'wild_rooibos_bush_b', mapOverride: 'fixed/wild_rooibos_bush_diffa.png' },
  fern_b: { url: `${M}/fern_02/fern_02_1k.gltf`, node: 'fern_02_b', mapOverride: 'fixed/fern_02_diffa.png' },
  fern_c: { url: `${M}/fern_02/fern_02_1k.gltf`, node: 'fern_02_c', mapOverride: 'fixed/fern_02_diffa.png' },
  broad_a: { url: `${M}/island_tree_01/island_tree_01_1k.gltf`, node: 'island_tree_01_LOD0', mapOverride: 'fixed/island_tree_01_leaves_diffa.png' },
  broad_b: { url: `${M}/tree_small_02/tree_small_02_1k.gltf`, node: 'tree_small_02_LOD0', mapOverride: 'fixed/tree_small_02_leaves_diffa.png' },
};

const want = process.argv.slice(2);
const { server, port } = await serve('/home/claude/assetwork/www');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/bake.html`);
await page.waitForFunction(() => window.__bakeReady, null, { timeout: 60000 });

const meta = fs.existsSync(`${OUT}/meta.json`) ? JSON.parse(fs.readFileSync(`${OUT}/meta.json`, 'utf8')) : {};
for (const [name, job] of Object.entries(JOBS)) {
  if (want.length && !want.includes(name)) continue;
  const t0 = Date.now();
  const r = await page.evaluate((j) => window.bakeImpostor(j), job);
  for (const k of ['color', 'normal']) fs.writeFileSync(`${OUT}/${name}_${k}.png`, Buffer.from(r[k].split(',')[1], 'base64'));
  meta[name] = { R: r.R, C: r.C, height: r.height, width: r.width, G: r.G, F: r.F };
  console.log(name, ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(meta[name]));
}
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
await browser.close();
server.close();
