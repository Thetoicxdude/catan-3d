# Full auto-played campaign through the real UI (all seats AI-driven), with screenshots and error capture.
import asyncio, sys, os, json, time, tempfile
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
        await page.add_init_script(f"window.__mapFps = {os.environ.get('FPS','0.4')}; localStorage.setItem('catan3d-settings-v1', JSON.stringify({{speed:'turbo', follow:false, quality:'low'}}));")
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
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
        await page.click('[data-k="single"]')
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=60000)
        await page.evaluate('window.__autoHuman = true; __game.schedule()')
        t0 = time.time(); shots = 0; last_turn = -1
        while time.time() - t0 < float(os.environ.get('SECS', '240')):
            st = await page.evaluate('() => ({phase: __game.state.phase, turn: __game.state.turn, winner: __game.state.winner, dlg: __game.dialogs.kind, vps: __game.state.players.map((p,i)=>i)})')
            if st['phase'] == 'over':
                print('game over at turn', st['turn'], 'winner', st['winner'])
                await page.wait_for_timeout(2500)
                await page.screenshot(path=f'{SP}/ui2-over.png')
                break
            if st['turn'] in (2, 20, 40) and st['turn'] != last_turn:
                last_turn = st['turn']
                await page.screenshot(path=f'{SP}/ui2-t{st["turn"]}.png')
                print('shot turn', st['turn'], 'dialog', st['dlg'])
            await page.wait_for_timeout(500)
        info = await page.evaluate('() => ({turn: __game.state.turn, phase: __game.state.phase, log: document.querySelectorAll(".log-body p").length})')
        print('final', info)
        for l in logs[:30]: print(l)
        await b.close()
    srv.shutdown()
asyncio.run(main())
