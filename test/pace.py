# How often the map is really drawn, in a browser (60 Hz): at rest, while the camera moves, with the
# window in the background, on the title screen, and with the 省電 / 不限 settings. The drawing
# itself is stubbed out (software GL can't keep 60 frames a second), so only the pacing is measured.
#   python3 test/pace.py
import asyncio, sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
INIT = "window.__noAssets = true; window.__testHooks = true; localStorage.setItem('catan3d-settings-v1', JSON.stringify({lang:'zh',  speed: 'turbo', quality: 'low', qualityPicked: true }));"
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)

# count the frames the map view draws (the drawing itself replaced by nothing)
STUB = """(mv) => { if (mv.__n !== undefined) return; mv.__n = 0; mv.post = null; mv.renderer.render = () => {}; const f = mv.frame.bind(mv); mv.frame = (...a) => { mv.__n++; f(...a); }; }"""

async def rate(page, mv, seconds=4):
    await page.evaluate(f"({STUB})({mv})")
    await page.wait_for_timeout(600)
    n0 = await page.evaluate(f"[{mv}.__n, performance.now()]")
    await page.wait_for_timeout(int(seconds * 1000))
    n1 = await page.evaluate(f"[{mv}.__n, performance.now()]")
    return (n1[0] - n0[0]) / ((n1[1] - n0[1]) / 1000)

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        ctx = await b.new_context(viewport={'width': 800, 'height': 500})
        await ctx.route('**/*', route)
        page = await ctx.new_page()
        page.set_default_timeout(180000)
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.add_init_script(INIT)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=180000)
        await page.wait_for_function('window.__mapView && __mapView()', timeout=60000)
        await page.evaluate("document.hasFocus = () => true")
        # the title screen: the camera cruises round the island, which is scenery
        r = await rate(page, '__mapView()')
        check('title screen (the camera cruising): the idle rate', 26 <= r <= 33, f'{r:.1f} frames a second')
        await page.click('[data-k="single"]')
        await page.wait_for_selector('.setup-card', timeout=30000)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=180000)
        await page.evaluate('__game.frozen = true')
        await page.wait_for_timeout(3000)
        mv = '__game.map'
        r = await rate(page, mv)
        check('a campaign at rest: about 30 frames a second', 26 <= r <= 33, f'{r:.1f}')
        await page.evaluate("(() => { const c = __game.map.camera; let t = 0; window.__pan = setInterval(() => { t += 0.05; c.goal.x = Math.sin(t) * 12; }, 16); })()")
        r = await rate(page, mv)
        check('the camera moving: about 60', 54 <= r <= 62, f'{r:.1f}')
        await page.evaluate("clearInterval(window.__pan)")
        await page.wait_for_timeout(2500)
        r = await rate(page, mv)
        check('at rest again: back to about 30', 26 <= r <= 33, f'{r:.1f}')
        # the window is not the one in use (and the pointer has not been at the map for a while)
        await page.evaluate("document.hasFocus = () => false; __game.map.attendedUntil = 0")
        r = await rate(page, mv)
        check('the window in the background: about 15', 13 <= r <= 17, f'{r:.1f}')
        # the pointer over the map brings the idle rate back though the window has no focus
        await page.mouse.move(400, 250)
        await page.mouse.move(420, 260, steps=4)
        r = await rate(page, mv, 2)
        check('the pointer at the map of a window in the background: about 30', 26 <= r <= 33, f'{r:.1f}')
        await page.evaluate("document.hasFocus = () => true")
        # the settings
        await page.evaluate("__game.map.setOptions({ fps: 'eco' })")
        await page.wait_for_timeout(600)
        r = await rate(page, mv)
        check('省電: about 20 at rest', 17 <= r <= 22, f'{r:.1f}')
        await page.evaluate("(() => { const c = __game.map.camera; let t = 0; window.__pan = setInterval(() => { t += 0.05; c.goal.x = Math.sin(t) * 12; }, 16); })()")
        r = await rate(page, mv)
        check('省電: about 30 while the camera moves', 26 <= r <= 33, f'{r:.1f}')
        await page.evaluate("__game.map.setOptions({ fps: 'max' })")
        r = await rate(page, mv)
        check('不限: every screen refresh while the camera moves', 55 <= r <= 62, f'{r:.1f}')
        await page.evaluate("clearInterval(window.__pan)")
        # the performance read-out
        await page.evaluate("__game.map.setOptions({ fps: 'std', stats: true })")
        await page.wait_for_timeout(1800)
        txt = await page.evaluate("document.querySelector('.perf-info') ? document.querySelector('.perf-info').textContent : ''")
        check('the performance read-out', '每秒' in txt and '繪製' in txt and 'Hz' in txt, txt.replace('\n', ' | '))
        await page.evaluate("__game.map.setOptions({ stats: false })")
        check('and it goes away again', not await page.evaluate("!!document.querySelector('.perf-info')"))
        check('no page errors', not errs, '\n'.join(errs[:4]))
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
