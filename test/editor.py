# The map workshop: open it from the home screen, draw on the grid (a gold field, a second island by
# dragging), see the checks follow, look at the island in 3D, play it (the campaign menu lists it under
# 玩家地圖), carry the campaign on after a reload, and the workshop on a phone.
#   python3 test/editor.py
import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

INIT = "window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; localStorage.setItem('catan3d-settings-v1', JSON.stringify({ speed: 'turbo', quality: 'low', qualityPicked: true }));"
FACTS = "[...document.querySelectorAll('.ed-facts div b')].map((b) => +b.textContent)"
MSGS = "[...document.querySelectorAll('.ed-msgs li')].map((li) => li.className + ':' + li.textContent)"

async def cell(page, c, r):
    box = await page.locator(f'.ed-grid polygon[data-c="{c}"][data-r="{r}"]').bounding_box()
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        logs = []
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        await ctx.route('**/*', route)
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await page.add_init_script(INIT)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=90000)
        await page.click('[data-k="workshop"]')
        await page.wait_for_selector('.menu-screen.editor .ed-grid polygon', timeout=30000)
        facts = await page.evaluate(FACTS)
        msgs = await page.evaluate(MSGS)
        check('the workshop opens on the standard shape, ready to play', facts[:3] == [19, 19, 1] and any(m.startswith('ok:') for m in msgs), f'{facts} {msgs}')
        await page.wait_for_timeout(600)
        await page.screenshot(path=f'{SP}/editor-open.png')
        # a gold field in the middle of the island
        await page.click('.ed-tool[data-tool="g"]')
        x, y = await cell(page, 6, 5)
        await page.mouse.click(x, y)
        await page.wait_for_timeout(300)
        msgs = await page.evaluate(MSGS)
        check('a gold field brings the Seafarers rules', any('金礦' in m and m.startswith('note') for m in msgs), json.dumps(msgs, ensure_ascii=False))
        # sea round the east, then a second island drawn in one stroke
        await page.click('.ed-tool[data-tool="s"]')
        for (c, r) in [(9, 4), (9, 5), (9, 6)]:
            x, y = await cell(page, c, r)
            await page.mouse.click(x, y)
        await page.click('.ed-tool[data-tool="l"]')
        pts = [await cell(page, c, r) for (c, r) in [(10, 3), (10, 4), (11, 4), (11, 5), (10, 5), (10, 6), (11, 6), (11, 7)]]
        await page.mouse.move(*pts[0])
        await page.mouse.down()
        for (x, y) in pts[1:]:
            await page.mouse.move(x, y, steps=4)
        await page.mouse.up()
        await page.wait_for_timeout(400)
        facts = await page.evaluate(FACTS)
        side = await page.inner_text('.ed-side')
        check('a second island drawn in one stroke', facts[2] == 2 and facts[0] == 19 + 3 + 8, f'{facts}')
        check('the island options appear with ships', '開局' in side and '外島加分' in side, side.replace('\n', ' ')[:200])
        draft = await page.evaluate('__screen().draft')
        stored = await page.evaluate("JSON.parse(localStorage.getItem('catan3d-drafts-v1') || '[]')")
        await page.wait_for_timeout(600)
        stored = await page.evaluate("JSON.parse(localStorage.getItem('catan3d-drafts-v1') || '[]')")
        check('the draft is saved as it is drawn', len(stored) == 1 and len(stored[0]['draft']['cells']) == len(draft['cells']), f"{len(stored)} drafts")
        await page.screenshot(path=f'{SP}/editor-drawn.png')
        # the island in 3D
        await page.click('.ed-modes button[data-mode="view"]')
        await page.wait_for_function("document.querySelector('.menu-screen.editor.viewing') && !document.querySelector('.loading')", timeout=120000)
        # (the test page draws a frame every two seconds: skip the camera's flight)
        await page.evaluate('(() => { const c = __mapView().camera; c.target.copy(c.goal); c.h = c.goalH; c.yaw = c.goalYaw; c.pitch = c.goalPitch; c.apply(); })()')
        await page.wait_for_timeout(4500)
        # every land hex within the part of the screen the workshop leaves free
        fit = await page.evaluate("""(async () => {
          const G = await import('/src/engine/geometry.js');
          G.useMap(__screen().check.def);
          const m = __mapView(), cam = m.camera.cam, side = document.querySelector('.ed-side').getBoundingClientRect();
          const V = cam.position.constructor; const out = [];
          for (const v of G.GEO.vertices) { if (!v.land) continue; const p = new V(v.x, 0, v.z).project(cam);
            out.push([(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight]); }
          const xs = out.map((p) => p[0]), ys = out.map((p) => p[1]);
          return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), right: side.left, geo: G.GEO.hexes.length }; })()""")
        print('3D frame', json.dumps(fit))
        tokens = await page.evaluate("[...document.querySelectorAll('.map-labels .token')].filter((t) => t.parentElement.style.display !== 'none').length")
        check('the island on the 3D map', tokens >= 20, f'{tokens} number tokens shown')
        check('the island framed beside the settings', fit['minX'] >= -2 and fit['maxX'] <= fit['right'] + 2 and fit['minY'] >= 60 and fit['maxY'] <= 802, json.dumps(fit))
        await page.screenshot(path=f'{SP}/editor-3d.png')
        await page.click('.ed-modes button[data-mode="edit"]')
        await page.wait_for_timeout(300)
        # play it
        await page.click('.ed-side .modal-foot .btn.primary')
        await page.wait_for_selector('.setup-card .seg.maps button.wide.on', timeout=60000)
        card = await page.inner_text('.setup-card')
        check('the campaign menu lists the map under 玩家地圖, chosen', '玩家地圖' in card and '未命名的島嶼' in card and '地圖規定' in card, card.replace('\n', ' ')[:220])
        await page.wait_for_timeout(1500)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=120000)
        st = await page.evaluate("({ map: __game.state.map, def: !!__game.state.mapDef, hexes: __game.state.board.hexes.length, sea: !!(__game.state.rules && __game.state.rules.seafarers) })")
        check('a campaign on the drawn map', st['map'].startswith('my-') and st['def'] and st['hexes'] == 30 and st['sea'], json.dumps(st))
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f'{SP}/editor-play.png')
        # after a reload, with the draft gone, the campaign still carries its map
        await page.evaluate("localStorage.removeItem('catan3d-drafts-v1')")
        await page.reload()
        await page.wait_for_selector('.menu-screen.home', timeout=90000)
        await page.click('text=繼續上一局')
        await page.wait_for_function('window.__game && window.__game.state', timeout=120000)
        st2 = await page.evaluate("({ map: __game.state.map, hexes: __game.state.board.hexes.length })")
        check('the campaign continues after a reload, the draft deleted', st2['map'] == st['map'] and st2['hexes'] == 30, json.dumps(st2))
        await ctx.close()
        # the workshop on a phone
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        await ctx.route('**/*', route)
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await page.add_init_script(INIT)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=90000)
        await page.wait_for_timeout(800)
        await page.screenshot(path=f'{SP}/editor-home-phone.png')
        await page.click('[data-k="workshop"]')
        await page.wait_for_selector('.menu-screen.editor .ed-grid polygon', timeout=30000)
        await page.click('.ed-tool[data-tool="m"]')
        box = await page.locator('.ed-grid polygon[data-c="6"][data-r="4"]').bounding_box()
        await page.tap('.ed-grid svg', position={'x': box['x'] - (await page.locator('.ed-grid svg').bounding_box())['x'] + box['width'] / 2, 'y': box['y'] - (await page.locator('.ed-grid svg').bounding_box())['y'] + box['height'] / 2})
        await page.wait_for_timeout(300)
        k = await page.evaluate("(__screen().draft.cells.find((x) => x[0] === 6 && x[1] === 4) || [])[2]")
        grid = await page.locator('.ed-grid svg').bounding_box()
        check('drawing by touch on a phone', k == 'm' and grid['width'] > 300, f'cell {k}, grid {grid["width"]:.0f}×{grid["height"]:.0f}')
        await page.screenshot(path=f'{SP}/editor-phone.png', full_page=False)
        errs = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
