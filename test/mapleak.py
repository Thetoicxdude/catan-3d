# Is an old map let go when a new island is built? The island is re-rolled N times in the campaign
# menu, the garbage collector is run, and the map views still alive are counted: only the one on
# screen may be (each one that stays keeps a WebGL context and all it holds on the graphics card).
#   python3 test/mapleak.py            (ART=1 QUALITY=high: with the asset pack, slow on software GL)
import asyncio, sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
N = int(os.environ.get('N', '5'))
ART = os.environ.get('ART') == '1'
Q = os.environ.get('QUALITY', 'low')
INIT = "window.__noAssets = %s; window.__testHooks = true; window.__mapFps = 2; localStorage.setItem('catan3d-settings-v1', JSON.stringify({lang:'zh',  speed: 'turbo', quality: '%s', qualityPicked: true }));" % ('false' if ART else 'true', Q)

async def main():
    srv = serve()
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info'])
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        ctx = await b.new_context(viewport={'width': 800, 'height': 500})
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
        await page.evaluate("window.__refs = [new WeakRef(__mapView())]; gc(); window.__heap0 = performance.memory.usedJSHeapSize")
        for i in range(N):
            await page.click('text=換一座島嶼')
            await page.wait_for_function("!document.querySelector('.loading') && __mapView() && __refs[__refs.length - 1].deref() !== __mapView()", timeout=300000)
            await page.evaluate("__refs.push(new WeakRef(__mapView()))")
            await page.wait_for_timeout(2500 if ART else 700)
        # a campaign on the last island, and back to the menu: the finished campaign is let go too
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=300000)
        await page.wait_for_timeout(1500)
        for _ in range(4):
            await page.evaluate("gc()")
            await page.wait_for_timeout(500)
        r = await page.evaluate("""({ built: __refs.length, alive: __refs.filter((r) => r.deref()).length,
          live: __refs.filter((r) => r.deref() && !r.deref().renderer.getContext().isContextLost()).length,
          heapMB: Math.round(performance.memory.usedJSHeapSize / 1e6), heap0MB: Math.round(__heap0 / 1e6), canvases: document.querySelectorAll('canvas.map-canvas').length,
          drawn: (() => { const m = __game.map; return m.renderer.info.render.calls > 0 || m.perf.calls > 0; })() })""")
        print(json.dumps(r))
        ok = r['alive'] == 1 and r['live'] == 1 and r['canvases'] == 1 and r['drawn'] and not errs
        print(('PASS' if ok else 'FAIL'), f"{r['built']} maps built, {r['alive']} alive, {r['live']} WebGL context(s); heap {r['heap0MB']} → {r['heapMB']} MB", errs[:3])
        await b.close()
    srv.shutdown()
    print('RESULT', 'ok' if ok else 'FAILED')
    if not ok: sys.exit(1)
asyncio.run(main())
