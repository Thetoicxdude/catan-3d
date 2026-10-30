# Official matchmaking: N pages press "quick match"; check they converge into one room and start.
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
# ROOMS=ws: play over the real room server (`npx wrangler dev --port 8787`) instead of the in-browser mock
ROOMJS = "window.__rooms = 'ws://127.0.0.1:8787/rooms/';" if os.environ.get('ROOMS') == 'ws' else 'window.__mockRoom = true;'
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')  # screenshots
os.makedirs(SP, exist_ok=True)
N = int(os.environ.get('N', '3'))
SECS = os.environ.get('MM', '20')
async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        W, H = (int(x) for x in os.environ.get('VIEW', '1000x680').split('x'))
        ctx = await b.new_context(viewport={'width': W, 'height': H})
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type':'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type':'text/css'})
            else: await r.continue_()
        await ctx.route('**/*', route)
        logs = []
        pages = []
        names = ['甲國', '乙國', '丙國', '丁國', '戊國']
        for i in range(N):
            pg = await ctx.new_page()
            NOA = '' if os.environ.get('ASSETS') else 'window.__noAssets = true; '  # UI-flow test: skip the asset pack
            await pg.add_init_script(NOA + f"window.__mapFps = 0.1; {ROOMJS} window.__mmSeconds = {SECS}; localStorage.setItem('catan3d-settings-v1', JSON.stringify({{speed:'turbo', follow:false, quality:'low', name: '{names[i]}'}}));")
            pg.on('pageerror', lambda e, i=i: logs.append(f'[p{i} pageerror] {e}'))
            pg.on('console', lambda m, i=i: logs.append(f'[p{i} {m.type}] {m.text}') if m.type == 'error' else None)
            await pg.goto('http://127.0.0.1:8765/dist/index.test.html')
            await pg.wait_for_selector('.menu-screen', timeout=60000)
            await pg.wait_for_selector('[data-k="match"]', timeout=20000)
            pages.append(pg)
        # everyone presses quick match at about the same time (clicked together: in this software-rendered
        # test browser a single click can take several seconds, longer than the test's short countdown)
        await asyncio.gather(*[pg.click('[data-k="match"]', timeout=90000) for pg in pages])
        t0 = time.time()
        shot = False
        while time.time() - t0 < 120:
            st = []
            for pg in pages:
                st.append(await pg.evaluate("""(() => { const g = window.__game; const m = document.querySelector('.match-screen');
                  return { game: !!(g && g.state), seat: g ? g.viewer : null, code: m ? (m.querySelector('.mm-code')||{}).textContent : null,
                           count: m ? (m.querySelector('.mm-count b')||{}).textContent : null, status: m ? (m.querySelector('.mm-status')||{}).textContent : null }; })()"""))
            if not shot and all(s['code'] for s in st):
                shot = True
                await pages[-1].screenshot(path=f'{SP}/match-lobby.png', timeout=120000)
                print('lobby', json.dumps(st, ensure_ascii=False))
            if all(s['game'] for s in st):
                print('all in game after %.1fs' % (time.time() - t0), json.dumps(st, ensure_ascii=False))
                break
            await pages[0].wait_for_timeout(700)
        else:
            print('TIMEOUT', json.dumps(st, ensure_ascii=False))
        # check: same room, distinct seats
        info = []
        for pg in pages:
            info.append(await pg.evaluate("({code: __game.net && __game.net.code, role: __game.net && __game.net.role, seat: __game.viewer, kinds: __game.players.map(p=>p.kind).join(',')})"))
        print('rooms', json.dumps(info, ensure_ascii=False))
        await pages[0].screenshot(path=f'{SP}/match-game.png', timeout=120000)
        for l in logs[:20]: print(l)
        await b.close()
    srv.shutdown()
asyncio.run(main())
