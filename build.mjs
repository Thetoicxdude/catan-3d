// Bundles the game into one self-contained page (three.js loads from the CDN via an import map).
// node build.mjs [entry] [out]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const entry = process.argv[2] || 'src/main.js';
const out = process.argv[3] || 'dist/index.html';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

const res = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  // only the bare 'three' import comes from the CDN; its addons (glTF loader…) are bundled
  plugins: [{ name: 'three-cdn', setup: (b) => b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', external: true })) }],
  minify: true,
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = ['src/ui/styles.css', 'src/ui/map.css', 'src/ui/cards.css']
  .map((f) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

const page = `<title>卡坦島 3D 戰略版</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;700;900&family=UnifrakturMaguntia&display=swap">
<style>
${css}
</style>
<div id="app"></div>
<script type="importmap">{"imports":{"three":"${THREE_URL}"}}</script>
<script type="module">
${js}
</script>
`;
mkdirSync(dirname(out), { recursive: true }); // a fresh clone has no dist/ yet
writeFileSync(out, page);
// local test wrapper (the artifact host adds its own skeleton)
// the exact document skeleton the artifact host wraps the page in (copied from the published page),
// so the tests render under the same base styles the players get
const HOST_SKELETON =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}' +
  'html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}' +
  'img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';
const wrapped = `${HOST_SKELETON}${page}\n</body></html>`;
writeFileSync(out.replace(/\.html$/, '.test.html'), wrapped);
// the realistic asset pack ships next to the page
const outDir = dirname(out);
if (existsSync('assets/manifest.json')) {
  rmSync(join(outDir, 'assets'), { recursive: true, force: true });
  cpSync('assets', join(outDir, 'assets'), { recursive: true });
}
// the self-hosted site (Cloudflare Worker, see server/worker.js and wrangler.jsonc): the same page in the
// same skeleton, pointed at our own room server for online play
if (out === 'dist/index.html') {
  // the version shown on the title screen: Workers Builds passes the commit, locally it comes from git
  const git = (cmd) => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  // a build started by hand from the dashboard may pass a branch name instead of a commit
  const isSha = (x) => /^[0-9a-f]{7,40}$/i.test(x || '');
  const build = {
    sha: [process.env.WORKERS_CI_COMMIT_SHA, git('git rev-parse HEAD')].find(isSha)?.slice(0, 7) || 'dev',
    branch: process.env.WORKERS_CI_BRANCH || git('git rev-parse --abbrev-ref HEAD'),
    at: new Date().toISOString(),
  };
  rmSync('site', { recursive: true, force: true });
  mkdirSync('site', { recursive: true });
  writeFileSync('site/index.html', `${HOST_SKELETON}<script>window.__rooms = '/rooms/'; window.__build = ${JSON.stringify(build)};</script>\n${page}\n</body></html>`);
  if (existsSync('assets/manifest.json')) cpSync('assets', 'site/assets', { recursive: true });
}
console.log(`built ${out}: ${(page.length / 1024).toFixed(0)} KB (js ${(js.length / 1024).toFixed(0)} KB)`);
