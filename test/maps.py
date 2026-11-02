# Published maps on the self-hosted site (needs the local server: `npm run dev` with the test signing
# key in .dev.vars, see test/accounts.mjs --keys): a signed-in player publishes a map from the workshop
# and gets its code; publishing it again keeps the code; it shows among their published maps; another
# player opens it by its link and from the public list; a room is set up on it by its code, the other
# player's page fetches it and lays out the same board, and the campaign starts; rating it at the end.
#   KEYS=/path/to/keys python3 test/maps.py
import asyncio, sys, os, json, subprocess, tempfile, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
SITE = os.environ.get('SITE', 'http://127.0.0.1:8787')
KEYS = os.environ['KEYS']
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

def token(sub, name):
    return subprocess.check_output(['node', os.path.join(os.path.dirname(__file__), 'accounts.mjs'), '--token', KEYS, sub, name], text=True).strip()

INIT = "window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; localStorage.setItem('catan3d-settings-v1', JSON.stringify({ speed: 'turbo', quality: 'low', qualityPicked: true, name: NAME }));"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        logs = []
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u or 'accounts.google.com' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        async def player(sub, name):
            ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
            await ctx.route('**/*', route)
            r = await ctx.request.post(SITE + '/api/login', data=json.dumps({'credential': token(sub, name)}), headers={'origin': SITE, 'content-type': 'application/json'})
            assert r.status == 200, await r.text()
            page = await ctx.new_page()
            page.set_default_timeout(120000)
            await page.add_init_script(INIT.replace('NAME', json.dumps(name)))
            page.on('console', lambda m: logs.append(f'[{name} {m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda e: logs.append(f'[{name} pageerror] {e}'))
            return ctx, page
        stamp = str(int(time.time()))
        actx, a = await player('maps-a-' + stamp, '甲國')
        bctx, bp = await player('maps-b-' + stamp, '乙國')
        # ── publishing from the workshop ──
        await a.goto(SITE + '/')
        await a.wait_for_selector('.menu-screen.home', timeout=90000)
        await a.click('[data-k="workshop"]')
        await a.wait_for_selector('.menu-screen.editor .ed-grid polygon', timeout=30000)
        name = '測試群島' + stamp[-4:]
        await a.fill('.ed-side input[aria-label="地圖名稱"]', name)
        await a.press('.ed-side input[aria-label="地圖名稱"]', 'Tab')
        await a.wait_for_timeout(300)
        await a.click('.ed-side .modal-foot .btn:has-text("發布")')
        await a.wait_for_selector('.modal .code-box b', timeout=30000)
        code = (await a.inner_text('.modal .code-box b')).strip()
        lead = await a.inner_text('.modal .lead')
        check('a map published from the workshop gets a code', len(code) == 6 and '公開列表' in lead, code)
        await a.screenshot(path=f'{SP}/maps-published.png')
        await a.click('.modal .modal-head .icon-btn')
        await a.click('.ed-side .modal-foot .btn:has-text("發布")')
        await a.wait_for_selector('.modal .code-box b', timeout=30000)
        again = (await a.inner_text('.modal .code-box b')).strip()
        check('publishing the same map again keeps its code', again == code and '之前就發布過了' in await a.inner_text('.modal .lead'), again)
        await a.click('.modal .modal-head .icon-btn')
        await a.click('.ed-side .modal-foot .btn:has-text("我的地圖")')
        await a.wait_for_selector(f'.ed-pubs .ed-mine-row:has-text("{code}")', timeout=30000)
        check('it shows among the player\'s published maps', True, code)
        await a.click('.modal .modal-head .icon-btn')
        # ── another player opens it by its link, and from the public list ──
        await bp.goto(f'{SITE}/#map={code}')
        await bp.wait_for_selector(f'.setup-card [data-map="u-{code}"].on', timeout=90000)
        card = await bp.inner_text('.setup-card')
        check('the link opens the campaign menu on the map', name in card and '甲國' in card and '地圖規定' in card, card.replace('\n', ' ')[:200])
        await bp.click('.setup-card .btn:has-text("公開地圖")')
        await bp.wait_for_selector(f'.mb-row:has-text("{code}")', timeout=30000)
        row = await bp.inner_text(f'.mb-row:has-text("{code}")')
        check('the public list has it', name in row and '甲國' in row, row.replace('\n', ' '))
        await bp.screenshot(path=f'{SP}/maps-list.png')
        await bp.click('.modal .modal-head .icon-btn')
        # ── a room on it, by its code ──
        await a.goto(SITE + '/')
        await a.wait_for_selector('.menu-screen.home', timeout=90000)
        await a.click('[data-k="create"]')
        await a.wait_for_selector('.code-box b', timeout=30000)
        room = (await a.inner_text('.code-box b')).strip()
        await a.fill('.room-layout input[aria-label="玩家地圖代號"]', code.lower())
        await a.click('.room-layout .btn:has-text("使用")')
        await a.wait_for_selector(f'.room-layout [data-map="u-{code}"].on', timeout=30000)
        lay = await a.inner_text('.room-layout')
        check('the host sets the room up on the map by its code', name in lay, lay.replace('\n', ' ')[:200])
        # (a new page load: the same address with only another #… would not reload the page)
        await bp.goto(f'{SITE}/?join=1#room={room.lower()}')
        await bp.wait_for_function(f"document.querySelector('.room-terms') && document.querySelector('.room-terms').textContent.includes({json.dumps(name)})", timeout=90000)
        terms = await bp.inner_text('.room-terms')
        check('the other player\'s page fetches the map for the room\'s terms', name in terms, terms)
        for i in range(60):
            if '乙國' in await a.inner_text('.online-screen .seat-list'): break
            await a.wait_for_timeout(500)
        await a.click('.online-screen .modal-foot .btn.primary')
        await a.wait_for_function('window.__game && window.__game.state', timeout=120000)
        await bp.wait_for_function('window.__game && window.__game.client && window.__game.state', timeout=120000)
        hb = await a.evaluate("({ map: __game.state.map, hexes: __game.state.board.hexes.length, def: !!__game.state.mapDef })")
        cb = await bp.evaluate("({ map: __game.state.map, hexes: __game.state.board.hexes.length })")
        same = await a.evaluate("JSON.stringify(__game.state.board.hexes.map((h) => h.terrain + h.number))") == await bp.evaluate("JSON.stringify(__game.state.board.hexes.map((h) => h.terrain + h.number))")
        check('both pages play the map, on the same board', hb['map'] == f'u-{code}' and cb['map'] == hb['map'] and hb['hexes'] == cb['hexes'] and hb['def'] and same, f'{hb} {cb}')
        await a.wait_for_timeout(3000)
        await bp.screenshot(path=f'{SP}/maps-online.png')
        # ── rating it at the end (the other player's page; the game is ended by hand) ──
        await bp.evaluate("(() => { const g = __game; g.state.phase = 'over'; g.state.winner = 0; g.overShown = false; g.refresh(); })()")
        await bp.wait_for_selector('.modal .mb-rate-stars button', timeout=30000)
        await bp.click('.modal .mb-rate-stars button:nth-child(4)')
        await bp.wait_for_function("document.querySelectorAll('.modal .mb-rate-stars button.on').length === 4", timeout=30000)
        got = await (await bctx.request.get(f'{SITE}/api/maps/{code}?t={time.time()}')).json()
        check('rating the map when the campaign is over', got['map']['votes'] == 1 and got['map']['rating'] == 4 and got['map']['plays'] >= 1, json.dumps({k: got['map'][k] for k in ('votes', 'rating', 'plays')}))
        # (an outside address the test machine cannot reach, such as a profile picture, is not the page's fault)
        errs = [l for l in logs if ('pageerror' in l or ' error]' in l) and 'ERR_TUNNEL_CONNECTION_FAILED' not in l]
        check('no page errors', not errs, '\n'.join(errs[:6]))
        await b.close()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
