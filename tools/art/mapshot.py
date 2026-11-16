# The development mode's models on the real map, with the asset pack: a campaign whose state is laid
# out as a showcase (every facility on its terrain at both levels, every building beside a settlement,
# the shipyard on a coast, wonders on the deserts), then pictures from the map's own camera, put together
# on contact sheets, and a check that a building names itself under the pointer.
#   npm run build && python3 tools/art/mapshot.py OUTDIR [quality=high]
#   WONDERS='[["lighthouse","done",0],["library",2,1],["greatWall","ruin",2]]'  the deserts (default below)
#   ONLY=wonders|buildings|facilities  just those pictures; H=26  the camera's distance for close-ups
import asyncio, sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'test'))
from shot import serve, THREE
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mapshot'
Q = sys.argv[2] if len(sys.argv) > 2 else 'high'
ONLY = os.environ.get('ONLY', '')
# PICK: only the pictures whose names hold one of these (comma separated)
PICK = [x for x in os.environ.get('PICK', '').split(',') if x]
H = float(os.environ.get('H', '24'))
os.makedirs(OUT, exist_ok=True)
ALL = ['aqueduct', 'granary', 'market', 'shipyard', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press', 'gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library']
INIT = "window.__testHooks = true; localStorage.setItem('catan3d-settings-v1', JSON.stringify({ lang: 'zh', speed: 'turbo', quality: '%s', qualityPicked: true, mode: 'develop', opponents: 3, bps: [['road','settlement','city','dev','granary','market','gardens']], bpCur: 0, bpv: 2 })); localStorage.setItem('catan3d-cards-v1', JSON.stringify({ own: %s }));" % (Q, json.dumps(ALL))
WONDERS = json.loads(os.environ['WONDERS']) if os.environ.get('WONDERS') else [['lighthouse', 'done', 1], ['library', 'done', 2], ['greatWall', 'ruin', 3]]
SETUP = r"""(wonders) => {
  const g = __game, s = g.state, G = __geo();
  s.phase = 'play'; s.current = 0; s.rolled = true; s.pending = null; s.trade = null;
  const T = (id) => s.board.hexes[id].terrain;
  const land = G.hexes.filter((h) => !h.sea && T(h.id) !== 'sea');
  const dist = (h) => Math.hypot(h.x, h.z);
  const of = (t) => land.filter((h) => T(h.id) === t).sort((a, b) => dist(a) - dist(b));
  s.vertices = s.vertices.map(() => null);
  for (const p of s.players) p.built = {};
  s.plots = s.plots.map(() => null);
  const ok = (v) => !s.vertices[v] && !G.vertices[v].neighbors.some((n) => s.vertices[n]);
  const put = (v, p, t, ks) => { s.vertices[v] = { p, t }; for (const k of ks || []) s.players[p].built[k] = v; };
  const out = { facilities: [], buildings: [], wonders: [] };
  // the deserts first: a wonder (or its ruin) on each, a settlement of its owner on a corner
  s.wonders = []; s.ruins = [];
  const D = of('desert');
  D.forEach((d, i) => {
    const [k, st, p] = wonders[i] || wonders[0];
    put(d.vertices[1], p, 's', []);
    if (st === 'ruin') s.ruins.push({ h: d.id, k });
    else s.wonders.push({ h: d.id, k, p, s: st === 'done' ? 3 : st, t: 1, done: st === 'done' });
    out.wonders.push([k + ':' + st, d.x, d.z]);
  });
  // the facilities: level 2 on the nearest hex of each terrain, level 1 on the next
  const res = { fields: 'grain', forest: 'wood', hills: 'brick', pasture: 'wool', mountains: 'ore' };
  Object.entries(res).forEach(([ter, r], i) => {
    of(ter).slice(0, 2).forEach((h, j) => {
      s.plots[h.id] = { p: (i + j) % 4, r: j === 0 ? [r, r] : [r] };
      out.facilities.push([ter + (j ? 1 : 2), h.x, h.z]);
    });
  });
  // the buildings: two beside each city, on inland corners near the middle; the shipyard beside a
  // village on the coast
  const list = ['aqueduct', 'granary', 'market', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press'];
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
  const coast = G.vertices.filter((v) => v.coastal && ok(v.id)).sort((a, b) => Math.abs(a.z - 20) - Math.abs(b.z - 20));
  if (coast.length) {
    put(coast[0].id, 2, 's', ['shipyard']);
    out.buildings.push(['shipyard', coast[0].x, coast[0].z]);
    const other = coast.find((v) => ok(v.id) && Math.hypot(v.x - coast[0].x, v.z - coast[0].z) > 30);
    if (other) {
      put(other.id, 3, 'c', ['shipyard', 'granary']);
      out.buildings.push(['shipyard+granary', other.x, other.z]);
    }
  }
  g.refresh();
  // (the map follows the state on moves; here the state was laid out by hand)
  g.map.sync(g.view(), [], true);
  return out;
}"""

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = await b.new_page(viewport={'width': 1440, 'height': 900})
        page.set_default_timeout(300000)
        await page.add_init_script(INIT)
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
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
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=120000)
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(1500)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state')
        await page.wait_for_function('() => __game.map && __game.map.flora && __game.map.flora.real', timeout=300000)
        await page.wait_for_timeout(3000)
        # (the computers would carry on playing over the showcase)
        await page.evaluate('() => { __game.schedule = () => {}; clearTimeout(__game.timer); }')
        where = await page.evaluate(SETUP, WONDERS)
        print('where', json.dumps(where))
        # hide the panels for the pictures (the map only)
        await page.add_style_tag(content='.hud > *:not(.map-labels):not(canvas):not(.tooltip), .toasts, .banner, .nexthint { visibility: hidden !important; }')
        groups = [('wonders', 30), ('buildings', H), ('facilities', H)]
        shots = []
        for grp, h in groups:
            if ONLY and grp != ONLY:
                continue
            for name, x, z in where[grp]:
                if PICK and not any(p in name for p in PICK):
                    continue
                # (straight there: the camera glides a tenth of a second per frame, and SwiftShader
                # draws about a frame a second)
                await page.evaluate('''([x, z, h, pitch]) => { const m = __game.map, c = m.camera; m.focus(x, z, h);
                  if (pitch) c.goalPitch = pitch;
                  c.target.copy(c.goal); c.h = c.goalH; c.yaw = c.goalYaw; c.pitch = c.goalPitch; c.apply(); m.poke(); }''', [x, z + 2, h, float(os.environ.get('PITCH', '0'))])
                await page.wait_for_timeout(int(os.environ.get('WAIT', '4000')))
                f = f'{OUT}/{grp}-{name.replace("+", "_").replace(":", "_")}.png'
                await page.screenshot(path=f)
                shots.append((grp, name, f))
                print('shot', grp, name, flush=True)
        # a building names itself under the pointer
        if where['buildings'] and (not ONLY or ONLY == 'buildings'):
            name, x, z = where['buildings'][0]
            await page.evaluate('''([x, z, h]) => { const m = __game.map, c = m.camera; m.focus(x, z, h);
              c.target.copy(c.goal); c.h = c.goalH; c.yaw = c.goalYaw; c.pitch = c.goalPitch; c.apply(); m.poke(); }''', [x, z + 2, H])
            await page.wait_for_timeout(2500)
            pt = await page.evaluate('''() => { const L = __game.map.developLayer; const it = [...L.items.values()].find((i) => i.kind === 'annex');
              const v = it.anchor.position.clone().add(it.obj.position.clone().multiplyScalar(it.anchor.scale.x)); v.y += it.size.h * it.anchor.scale.x * 0.45;
              const r = __game.map.camera.screenRect(); v.project(__game.map.camera.cam);
              return [ (v.x * 0.5 + 0.5) * r.width + r.left, (-v.y * 0.5 + 0.5) * r.height + r.top, it.info.k ]; }''')
            await page.mouse.move(pt[0] - 40, pt[1] - 40)
            await page.mouse.move(pt[0], pt[1], steps=4)
            await page.wait_for_timeout(800)
            tip = await page.evaluate("() => { const t = document.querySelector('.tooltip'); return t && !t.hidden ? t.innerText : null; }")
            print('hover', pt[2], '→', repr(tip))
            await page.screenshot(path=f'{OUT}/hover.png')
        for l in logs[:30]:
            print(l)
        await b.close()
    srv.shutdown()
    # contact sheets: six pictures a sheet, at half size, with their names
    from PIL import Image, ImageDraw
    for grp in ['wonders', 'buildings', 'facilities']:
        fs = [s for s in shots if s[0] == grp]
        for n in range(0, len(fs), 6):
            part = fs[n:n + 6]
            sheet = Image.new('RGB', (720 * 3, 450 * 2), (30, 30, 30))
            for i, (_, name, f) in enumerate(part):
                im = Image.open(f).convert('RGB').resize((720, 450))
                ImageDraw.Draw(im).text((10, 8), name, fill=(255, 255, 255))
                sheet.paste(im, ((i % 3) * 720, (i // 3) * 450))
            sheet.save(f'{OUT}/sheet-{grp}-{n // 6 + 1}.png')

asyncio.run(main())
