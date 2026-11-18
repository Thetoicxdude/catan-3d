# The pictures behind the side bar's pages (assets/ui/page_*.webp, pages.css): the game's own island,
# drawn by the game at high quality, laid out as a campaign in full swing (the development mode's
# buildings beside the cities, wonders on the deserts, improvements on the land, roads between), from a
# camera chosen for each page. The panels, number tokens and labels are hidden: only the map.
#   npm run build && python3 tools/art/pageart.py OUTDIR [W H]      (default 1920 x 1080)
#   SHOTS=cards,shop   only those pages; WAIT=ms the time a view is given to settle (shadows, scenery)
#   LIGHT=gold  a lower, warmer sun
#   then: python3 tools/art/pageart.py --pack OUTDIR   writes assets/ui/page_<name>.webp from OUTDIR (graded:
#   softer, calmer, darker corners)
import asyncio, sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'test'))

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Each page's view: what it looks at (a group of the showcase and which one; or the island's middle),
# how far (the camera's distance), how steep (pitch: degrees from straight down) and from where (yaw,
# in turns), and where in the frame it sits (dx, dz: the target moved off it, in map units).
VIEWS = {
    # Cards: farmland round a city of the building cards, a windmill and the hay, the sea beyond
    'cards': {'at': ['buildings', 2], 'h': 30, 'pitch': 64, 'yaw': 0.5, 'dx': 0, 'dz': 0},
    # Draw & Shop: the shipyard's harbour, the boats, the sea
    'shop': {'at': ['buildings', 'shipyard'], 'h': 40, 'pitch': 63, 'yaw': 0.55, 'dx': 0, 'dz': 0},
    # Missions: a world wonder raised on the desert, the country around it
    'missions': {'at': ['wonders', 0], 'h': 34, 'pitch': 62, 'yaw': 0.0, 'dx': 0, 'dz': 0},
    # Profile: your own city (red) among its fields and windmills
    'profile': {'at': ['buildings', 0], 'h': 28, 'pitch': 62, 'yaw': 0.0, 'dx': 0, 'dz': 0},
    # Settings: the whole island from high up, as on the map table
    'settings': {'at': None, 'h': 140, 'pitch': 50, 'yaw': 0.04, 'dx': 0, 'dz': 6},
}

SETUP = r"""() => {
  const g = __game, s = g.state, G = __geo();
  s.phase = 'play'; s.current = 0; s.rolled = true; s.pending = null; s.trade = null;
  const T = (id) => s.board.hexes[id].terrain;
  const land = G.hexes.filter((h) => !h.sea && T(h.id) !== 'sea');
  const dist = (h) => Math.hypot(h.x, h.z);
  const of = (t) => land.filter((h) => T(h.id) === t).sort((a, b) => dist(a) - dist(b));
  s.vertices = s.vertices.map(() => null);
  s.edges = s.edges.map(() => -1);
  for (const p of s.players) p.built = {};
  s.plots = s.plots.map(() => null);
  const ok = (v) => !s.vertices[v] && !G.vertices[v].neighbors.some((n) => s.vertices[n]);
  const roads = (v, p, n) => { let k = 0; for (const e of G.vertices[v].edges) { if (k >= n) break; if (s.edges[e] === -1) { s.edges[e] = p; k++; } } };
  const put = (v, p, t, ks) => { s.vertices[v] = { p, t }; for (const k of ks || []) s.players[p].built[k] = v; roads(v, p, 2); };
  const out = { buildings: [], wonders: [] };
  // the deserts: a wonder on each (done), a settlement of its owner on a corner
  s.wonders = []; s.ruins = [];
  const WON = [['lighthouse', 1], ['library', 2], ['greatWall', 3], ['gardens', 0]];
  of('desert').forEach((d, i) => {
    const [k, p] = WON[i % WON.length];
    put(d.vertices[1], p, 's', []);
    s.wonders.push({ h: d.id, k, p, s: 3, t: 1, done: true });
    out.wonders.push([k, d.x, d.z]);
  });
  // improvements: level 2 on the nearest hex of each terrain, level 1 on the next two
  const res = { fields: 'grain', forest: 'wood', hills: 'brick', pasture: 'wool', mountains: 'ore' };
  Object.entries(res).forEach(([ter, r], i) => {
    of(ter).slice(0, 3).forEach((h, j) => { s.plots[h.id] = { p: (i + j) % 4, r: j === 0 ? [r, r] : [r] }; });
  });
  // cities with two buildings each on inland corners near the middle; the shipyard on the coast
  const list = ['wall', 'barracks', 'market', 'guild', 'aqueduct', 'granary', 'academy', 'press', 'camp', 'post', 'mercenaries', 'adventurers'];
  const inland = G.vertices.filter((v) => v.hexes.length === 3 && v.hexes.every((h) => T(h) !== 'sea' && T(h) !== 'desert')).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  let c = 0;
  for (const v of inland) {
    if (c * 2 >= list.length) break;
    if (!ok(v.id)) continue;
    const ks = list.slice(c * 2, c * 2 + 2);
    put(v.id, c % 4, 'c', ks);
    out.buildings.push([ks.join('+'), v.x, v.z]);
    c++;
  }
  // more villages about the island
  for (const v of G.vertices) {
    if (Math.random() < 0.82 || !ok(v.id) || v.hexes.every((h) => T(h) === 'sea')) continue;
    put(v.id, Math.floor(Math.random() * 4), 's', []);
  }
  const coast = G.vertices.filter((v) => v.coastal && ok(v.id)).sort((a, b) => Math.abs(a.z - 20) - Math.abs(b.z - 20));
  if (coast.length) {
    put(coast[0].id, 2, 'c', ['shipyard']);
    out.buildings.push(['shipyard', coast[0].x, coast[0].z]);
  }
  // (all at once: nothing dropping in with its puff of dust)
  g.map.sync(g.view(), [], false);
  g.refresh();
  return out;
}"""

# The picture as a page's backdrop: a touch softer (it sits behind the page's sheets), its colours a
# little calmer and warmer, the corners darker.
def grade(im):
    from PIL import Image, ImageFilter, ImageEnhance, ImageChops
    w, h = im.size
    im = im.filter(ImageFilter.GaussianBlur(radius=w / 1600))
    im = ImageEnhance.Color(im).enhance(0.86)
    im = ImageEnhance.Contrast(im).enhance(0.94)
    r, g, b = im.split()
    r = r.point(lambda v: min(255, int(v * 1.035)))
    b = b.point(lambda v: int(v * 0.95))
    im = Image.merge('RGB', (r, g, b))
    # (a vignette: a radial falloff drawn small and scaled up smooth)
    m = Image.new('L', (160, 90))
    px = m.load()
    for y in range(90):
        for x in range(160):
            dx, dy = (x - 79.5) / 80, (y - 44.5) / 45
            d = (dx * dx + dy * dy) ** 0.5
            px[x, y] = int(255 * max(0.0, min(1.0, (d - 0.55) / 0.8)) ** 1.6 * 0.42)
    m = m.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(radius=w / 200))
    dark = Image.new('RGB', (w, h), (8, 10, 12))
    return Image.composite(dark, im, m)

def pack(src):
    from PIL import Image
    dst = os.path.join(ROOT, 'assets', 'ui')
    for name in ['cards', 'shop', 'missions', 'profile', 'settings']:
        f = os.path.join(src, f'{name}.png')
        if not os.path.exists(f):
            continue
        im = grade(Image.open(f).convert('RGB'))
        out = os.path.join(dst, f'page_{name}.webp')
        im.save(out, 'WEBP', quality=78, method=6)
        print(out, os.path.getsize(out) // 1024, 'KB')

async def main(out, W, H):
    from shot import serve, THREE
    from playwright.async_api import async_playwright
    only = [x for x in os.environ.get('SHOTS', '').split(',') if x]
    wait = int(os.environ.get('WAIT', '9000'))
    os.makedirs(out, exist_ok=True)
    # (the same island and the same villages every time: the page's randomness seeded)
    seed = int(os.environ.get('SEED', '7'))
    init = ("window.__developOpen = true; window.__testHooks = true; Math.random = (() => { let s = %d; return () => ((s = (s * 16807) %% 2147483647) / 2147483647); })();"
            " crypto.getRandomValues = (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296) >>> 0; return a; };"
            " localStorage.setItem('hexverse-settings-v1', JSON.stringify({ lang: 'zh', speed: 'turbo', quality: 'high', qualityPicked: true, mode: 'develop', opponents: 3, bps: [['road','settlement','city','dev','granary','market','gardens']], bpCur: 0, bpv: 2 }));") % seed
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = await b.new_page(viewport={'width': W, 'height': H})
        page.set_default_timeout(600000)
        await page.add_init_script(init)
        logs = []
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u:
                await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u:
                await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else:
                await r.continue_()
        await page.route('**/*', route)
        await page.goto('http://127.0.0.1:8765/site/index.html')
        await page.wait_for_selector('.menu-screen.home', timeout=300000)
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(1500)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state')
        await page.wait_for_function('() => __game.map && __game.map.flora && __game.map.flora.real', timeout=600000)
        await page.wait_for_timeout(3000)
        await page.evaluate('() => { __game.schedule = () => {}; clearTimeout(__game.timer); }')
        where = await page.evaluate(SETUP)
        print('where', json.dumps(where), flush=True)
        # only the map: no panels, tokens, labels or vignette; the full resolution kept
        await page.add_style_tag(content='.hud > *:not(canvas), .map-labels, .toasts, .banner, .nexthint, .vignette, .tooltip { visibility: hidden !important; }')
        # (the land as it is: no nations' colours over it)
        await page.evaluate('''() => { const m = __game.map; m.governor.frame = () => null; m.governor.scale = 1; m.applyPixelRatio(); m.setMapMode('terrain');
          const T = m.territory.fillTex.constructor, U = m.terrain.uniforms, none = new T(new Uint8Array(4), 1, 1); none.needsUpdate = true;
          U.uTerritory.value = none; U.uBorder.value = none; m.poke(1000); }''')
        # LIGHT=gold: a lower, warmer sun (long shadows), the sky's light a little cooler
        if os.environ.get('LIGHT') == 'gold':
            await page.evaluate('''() => { const m = __game.map, S = m.sun;
              S.position.set(-0.62, 0.45, 0.64).normalize().multiplyScalar(120);
              S.color.setHex(0xffd2a0); S.intensity = 3.4;
              m.hemi.color.setHex(0xcfd8ea); m.hemi.groundColor.setHex(0x6a5636);
              S.updateMatrixWorld(); S.target.updateMatrixWorld(); S.shadow.updateMatrices(S);
              m.shadowSig = null; m.shadowDirty = 3; m.poke(2000); }''')
        for name, v in VIEWS.items():
            if only and name not in only:
                continue
            if v['at'] is None:
                x, z = 0, 0
            else:
                grp, key = v['at']
                items = where[grp]
                it = next((i for i in items if i[0] == key), None) if isinstance(key, str) else (items[key] if key < len(items) else None)
                if not it:
                    print('no', name, v['at'])
                    continue
                x, z = it[1], it[2]
            # (YAWS=0,0.25,…: the same view from several sides, to choose from)
            yaws = [float(y) for y in os.environ['YAWS'].split(',')] if os.environ.get('YAWS') else [None]
            for yw in yaws:
                await page.evaluate('''([x, z, h, pitch, yaw]) => { const m = __game.map, c = m.camera; m.focus(x, z, h);
                  c.goalPitch = pitch; c.goalYaw = yaw * Math.PI * 2;
                  c.target.copy(c.goal); c.h = c.goalH; c.yaw = c.goalYaw; c.pitch = c.goalPitch; c.apply(); m.poke(4000); }''',
                  [x + v['dx'], z + v['dz'], v['h'], v['pitch'], v['yaw'] if yw is None else yw])
                await page.wait_for_timeout(wait)
                f = f'{out}/{name}.png' if yw is None else f'{out}/{name}-{yw:g}.png'
                await page.screenshot(path=f)
                print('shot', f, flush=True)
        for l in logs[:20]:
            print(l)
        await b.close()
    srv.shutdown()

if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--pack':
        pack(sys.argv[2])
    else:
        out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/pageart'
        W = int(sys.argv[2]) if len(sys.argv) > 2 else 1920
        H = int(sys.argv[3]) if len(sys.argv) > 3 else 1080
        asyncio.run(main(out, W, H))
