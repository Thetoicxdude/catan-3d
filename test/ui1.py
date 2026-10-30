import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')  # screenshots
os.makedirs(SP, exist_ok=True)
async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        W = int(os.environ.get('W', 1280)); H = int(os.environ.get('H', 800))
        ctx = await b.new_context(viewport={'width': W, 'height': H})
        page = await ctx.new_page()
        if not os.environ.get('ASSETS'): await page.add_init_script('window.__noAssets = true;')  # UI-flow test: skip the asset pack
        await page.add_init_script('window.__mapFps = float(os.environ.get("FPS", "0.5"))'.replace('float(os.environ.get("FPS", "0.5"))', os.environ.get('FPS','0.5')))
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u:
                await r.fulfill(status=200, body=THREE, headers={'content-type':'application/javascript'})
            elif 'fonts.g' in u:
                await r.fulfill(status=200, body='', headers={'content-type':'text/css'})
            else:
                await r.continue_()
        await page.route('**/*', route)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen', timeout=60000)
        await page.wait_for_timeout(4000)
        await page.screenshot(path=f'{SP}/ui-menu.png')
        print('menu ok')
        await page.click('[data-k="single"]')
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=60000)
        await page.wait_for_timeout(6000)
        await page.screenshot(path=f'{SP}/ui-setup.png')
        st = await page.evaluate('() => ({phase: __game.state.phase, setup: __game.state.setup, current: __game.state.current})')
        print('state', st)
        # every map label (number tokens, harbour badges, the robber) must sit where its transform puts it:
        # its wrapper pinned to the layer's corner (offset 0,0) and the label centred on the projected anchor,
        # also while the tokens play their pulse (the animation must scale them in place, not move them)
        CHECK = r"""() => {
          const layer = document.querySelector('.map-labels');
          const host = layer.getBoundingClientRect();
          const out = { shown: 0, tokens: 0, pulsing: 0, bad: [] };
          for (const box of layer.children) {
            if (getComputedStyle(box).display === 'none') continue;
            const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(box.style.transform || '');
            if (!m) continue;
            const el = box.classList.contains('float') ? box : box.firstElementChild || box;
            out.shown++;
            if (el.classList.contains('token')) out.tokens++;
            if (el.classList.contains('pulse')) out.pulsing++;
            if (box.offsetLeft !== 0 || box.offsetTop !== 0) out.bad.push(`${el.className} offset ${box.offsetLeft},${box.offsetTop}`);
            if (el.classList.contains('drop')) continue;
            const r = el.getBoundingClientRect();
            const dx = r.left + r.width / 2 - host.left - +m[1];
            const dy = r.top + r.height / 2 - host.top - +m[2];
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) out.bad.push(`${el.className} off by ${dx.toFixed(0)},${dy.toFixed(0)}`);
          }
          return out;
        }"""
        lab = await page.evaluate(CHECK)
        print('map labels', lab['shown'], 'tokens', lab['tokens'], 'misplaced', len(lab['bad']))
        assert not lab['bad'] and lab['tokens'] >= 15, lab
        await page.evaluate("""() => { for (const t of document.querySelectorAll('.map-labels .token')) { t.classList.remove('pulse'); void t.offsetWidth; t.classList.add('pulse'); } }""")
        await page.wait_for_timeout(300)
        lab = await page.evaluate(CHECK)
        print('pulsing tokens', lab['pulsing'], 'misplaced', len(lab['bad']))
        assert not lab['bad'] and lab['pulsing'] >= 15, lab
        for l in logs[:30]: print(l)
        await b.close()
    srv.shutdown()
asyncio.run(main())
