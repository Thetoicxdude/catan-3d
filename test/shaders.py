# Are shaders still compiled in the middle of play? The programs the renderer has built are counted
# as soon as a campaign is on screen, the opening is played (settlements, roads, markers, previews,
# the camera coming to rest) and they are counted again: nothing may have been added. (A program
# compiled on the frame that first needs it is a hitch of a good part of a second on a real driver.)
#   python3 test/shaders.py           (QUALITY=high ART=1: with the asset pack; MAP=sea-1: Seafarers;
#                                      MAP=sea-3 TURNS=16: the fog islands, the board rebuilt as the fog lifts)
import asyncio, sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
Q = os.environ.get('QUALITY', 'medium')
ART = os.environ.get('ART') == '1'
MAP = os.environ.get('MAP', 'base-4')
TURNS = int(os.environ.get('TURNS', '4'))
INIT = "window.__noAssets = %s; window.__testHooks = true; window.__mapFps = 4; localStorage.setItem('catan3d-settings-v1', JSON.stringify({ speed: 'turbo', quality: '%s', qualityPicked: true, opponents: 3 }));" % ('false' if ART else 'true', Q)
PROGS = "(() => { const r = __game.map.renderer; return r.info.programs.map((p) => (p.cacheKey || '').split(',').slice(0, 3).join('/').slice(0, 60) + ':' + p.id); })()"

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        ctx = await b.new_context(viewport={'width': 640, 'height': 400})
        await ctx.route('**/*', route)
        page = await ctx.new_page()
        page.set_default_timeout(300000)
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.add_init_script(INIT)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=180000)
        if ART:
            await page.wait_for_function("__mapView() && __mapView().flora && __mapView().flora.real && !__mapView().applying", timeout=900000, polling=1000)
        await page.click('[data-k="single"]')
        await page.wait_for_selector('.setup-card', timeout=30000)
        if MAP != 'base-4':
            await page.click(f'[data-map="{MAP}"]')
            await page.wait_for_timeout(1500)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=300000)
        await page.wait_for_timeout(1200)
        p0 = await page.evaluate(PROGS)
        # the opening, played by the computer for every seat; then a few turns
        await page.evaluate('window.__autoHuman = true; __game.schedule()')
        await page.wait_for_function(f"__game.state.phase === 'over' || (__game.state.phase === 'play' && __game.state.turn >= {TURNS})", timeout=900000, polling=1000)
        await page.evaluate('window.__autoHuman = false; __game.frozen = true')
        await page.wait_for_timeout(5000)
        p1 = await page.evaluate(PROGS)
        new = [x.split(':')[0] for x in p1 if x not in p0]
        rebuilds = await page.evaluate('__game.map.rebuilds || 0')
        ok = not new and not errs
        print(json.dumps({'quality': Q, 'art': ART, 'map': MAP, 'turn': await page.evaluate('__game.state.turn'), 'board_rebuilds': rebuilds, 'programs_at_start': len(p0), 'after_opening': len(p1), 'compiled_during_play': new}))
        print(('PASS' if ok else 'FAIL'), 'no shader compiled during play', errs[:3])
        await b.close()
    srv.shutdown()
    print('RESULT', 'ok' if ok else 'FAILED')
    if not ok: sys.exit(1)
asyncio.run(main())
