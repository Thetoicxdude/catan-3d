# Published maps on the self-hosted site (needs the local server: `npm run dev` with the test signing
# key in .dev.vars, see test/accounts.mjs --keys): a signed-in player publishes a map from the workshop
# and gets its code; the workshop's draft is now that map: changed, it is published as the map's next
# version under the same code; 我的地圖 lists it with its version, takes it off the public list and
# back, and 編輯 opens it again from the server; an account has five maps (the sixth is refused,
# deleting one frees a place). Another player opens it by its link (the newest version) and from the
# public list; a room is set up on it by its code, the other player's page fetches that version and
# lays out the same board, and the campaign starts; the author changes the map during the game, the
# other player's page reloads and fetches the version the room plays; rating it at the end.
#   KEYS=/path/to/keys python3 test/maps.py
import asyncio, sys, os, json, subprocess, tempfile, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'hexverse-shots')
os.makedirs(SP, exist_ok=True)
SITE = os.environ.get('SITE', 'http://127.0.0.1:8787')
KEYS = os.environ['KEYS']
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

def token(sub, name):
    return subprocess.check_output(['node', os.path.join(os.path.dirname(__file__), 'accounts.mjs'), '--token', KEYS, sub, name], text=True).strip()

# (the author's page stays the host: the other page, slower by the test hook, never takes the game over)
INIT = "window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; window.__perf = PERF; localStorage.setItem('hexverse-settings-v1', JSON.stringify({lang:'zh',  speed: 'turbo', quality: 'low', qualityPicked: true, name: NAME }));"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        logs = []
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u or 'accounts.google.com' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        async def player(sub, name, perf):
            ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
            await ctx.route('**/*', route)
            r = await ctx.request.post(SITE + '/api/login', data=json.dumps({'credential': token(sub, name)}), headers={'origin': SITE, 'content-type': 'application/json'})
            assert r.status == 200, await r.text()
            page = await ctx.new_page()
            page.set_default_timeout(120000)
            await page.add_init_script(INIT.replace('NAME', json.dumps(name)).replace('PERF', str(perf)))
            page.on('console', lambda m: logs.append(f'[{name} {m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda e: logs.append(f'[{name} pageerror] {e}'))
            return ctx, page
        stamp = str(int(time.time()))
        actx, a = await player('maps-a-' + stamp, '甲國', 900)
        bctx, bp = await player('maps-b-' + stamp, '乙國', 100)
        try:
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
            await a.wait_for_selector('.ed-side .ed-publine', timeout=10000)
            line = await a.inner_text('.ed-side .ed-publine')
            btn = a.locator('.ed-side .modal-foot .btn', has_text='已發布')
            check('the draft is now the published map: its code and version, nothing to publish', code in line and '第 1 版' in line and await btn.count() == 1 and await btn.is_disabled(), line)
            # a change: the next version, the same code
            name2 = name + '二'
            await a.fill('.ed-side input[aria-label="地圖名稱"]', name2)
            await a.press('.ed-side input[aria-label="地圖名稱"]', 'Tab')
            await a.wait_for_timeout(300)
            line = await a.inner_text('.ed-side .ed-publine')
            up = a.locator('.ed-side .modal-foot .btn', has_text='更新')
            check('a change shows as not published yet; the button updates the map', '還沒發布的變更' in line and await up.count() == 1 and await up.is_enabled(), line)
            await a.screenshot(path=f'{SP}/maps-changed.png')
            await up.click()
            await a.wait_for_selector('.modal[data-kind="published"] .code-box b', timeout=30000)
            same = (await a.inner_text('.modal .code-box b')).strip()
            lead = await a.inner_text('.modal .lead')
            title = await a.inner_text('.modal .modal-head')
            check('updating keeps the code, as the second version', same == code and '第 2 版' in lead and '地圖已更新' in title, lead)
            await a.click('.modal .modal-head .icon-btn')
            await a.wait_for_timeout(300)
            line = await a.inner_text('.ed-side .ed-publine')
            check('the workshop shows the new version', '第 2 版' in line and '還沒發布' not in line, line)
            got = await (await actx.request.get(f'{SITE}/api/maps/{code}?t={time.time()}')).json()
            old = await (await actx.request.get(f'{SITE}/api/maps/{code}?rev=0')).json()
            check('the server has the new version, and the first one by its revision', got['map']['rev'] == 1 and got['map']['name'] == name2 and old['map']['draft']['name'] == name, f"{got['map']['rev']} {got['map']['name']} / {old['map']['draft']['name']}")
            # ── my maps: the version, off the list and back, edit from the server ──
            await a.click('.ed-side .modal-foot .btn:has-text("我的地圖")')
            prow = f'.ed-pubs .ed-mine-row:has-text("{code}")'
            await a.wait_for_selector(prow, timeout=30000)
            head = await a.inner_text('.ed-pubs .row-label')
            txt = await a.inner_text(prow)
            check('my maps: the count of five, the map with its version, public', '1/5' in head and '第 2 版' in txt and '公開' in txt and name2 in txt, head + ' | ' + txt.replace('\n', ' '))
            await a.screenshot(path=f'{SP}/maps-mine.png')
            await a.click(f'{prow} .btn:has-text("從列表移除")')
            await a.wait_for_selector(f'{prow} .btn:has-text("放回列表")', timeout=30000)
            off = await a.inner_text(prow)
            lst = await (await bctx.request.get(f'{SITE}/api/maps?sort=new&t={time.time()}')).json()
            check('taken off the public list, still among my maps', '不公開' in off and not any(m['code'] == code for m in lst['maps']), off.replace('\n', ' '))
            await a.click(f'{prow} .btn:has-text("放回列表")')
            await a.wait_for_selector(f'{prow} .btn:has-text("從列表移除")', timeout=30000)
            lst = await (await bctx.request.get(f'{SITE}/api/maps?sort=new&t={time.time()}1')).json()
            check('and back on it', any(m['code'] == code for m in lst['maps']))
            # (the draft on this device deleted: 編輯 brings the map back from the server)
            lrow = f'.ed-mine:not(.ed-pubs) > .ed-mine-row:has-text("{name2}")'
            await a.click(f'{lrow} .btn:has-text("刪除")')
            await a.wait_for_timeout(300)
            check('the draft on this device deleted', await a.locator(lrow).count() == 0)
            await a.wait_for_selector(prow, timeout=30000)
            await a.click(f'{prow} .btn:has-text("編輯")')
            await a.wait_for_selector('.modal[data-kind="mine"]', state='detached', timeout=30000)
            await a.wait_for_timeout(300)
            val = await a.input_value('.ed-side input[aria-label="地圖名稱"]')
            line = await a.inner_text('.ed-side .ed-publine')
            check('編輯 opens the published map in the workshop', val == name2 and code in line and '第 2 版' in line, f'{val} | {line}')
            # ── five maps an account: four more (straight to the server), the sixth refused ──
            drafts = json.loads(subprocess.check_output(['node', '-e', "import('./test/drafts.mjs').then((m) => console.log(JSON.stringify(m.DRAFTS)))"], text=True, cwd=os.path.join(os.path.dirname(__file__), '..')))
            for k in ('ring', 'strip', 'archipelago', 'fixed'):
                r = await actx.request.post(SITE + '/api/maps', data=json.dumps({'draft': {**drafts[k], 'name': k + stamp[-4:]}}), headers={'origin': SITE, 'content-type': 'application/json'})
                assert r.status == 200, await r.text()
            await a.select_option('.ed-side select[aria-label="從範本重新開始"]', 'standard')
            await a.wait_for_timeout(400)
            check('a new draft from a template is a draft of its own', await a.locator('.ed-side .ed-publine').count() == 0 and await a.locator('.ed-side .modal-foot .btn:has-text("發布")').count() == 1)
            await a.click('.ed-side .modal-foot .btn:has-text("發布")')
            await a.wait_for_selector('.toasts .toast:has-text("無法發布")', timeout=30000)
            tt = await a.inner_text('.toasts .toast:has-text("無法發布")')
            check('the sixth map is refused, saying why', '最多 5 張' in tt, tt.replace('\n', ' '))
            await a.click('.ed-side .modal-foot .btn:has-text("我的地圖")')
            await a.wait_for_function("document.querySelectorAll('.ed-pubs .ed-mine-row').length === 5", timeout=30000)
            head = await a.inner_text('.ed-pubs .row-label')
            note = await a.inner_text('.ed-pubs .ed-pubnote')
            check('my maps: five of five', '5/5' in head and '先刪掉一張' in note, head + ' | ' + note)
            await a.screenshot(path=f'{SP}/maps-full.png')
            drow = '.ed-pubs .ed-mine-row:has-text("ring' + stamp[-4:] + '")'
            await a.click(f'{drow} .btn:has-text("刪除")')
            armed = await a.inner_text(f'{drow} .btn.danger')
            await a.click(f'{drow} .btn.danger')
            await a.wait_for_function("document.querySelectorAll('.ed-pubs .ed-mine-row').length === 4", timeout=30000)
            head = await a.inner_text('.ed-pubs .row-label')
            check('deleting asks once more, then frees a place', '確定' in armed and '4/5' in head, armed + ' | ' + head)
            await a.click('.modal .modal-head .icon-btn')
            await a.click('.ed-side .modal-foot .btn:has-text("發布")')
            await a.wait_for_selector('.modal[data-kind="published"] .code-box b', timeout=30000)
            check('and the new map is published', (await a.inner_text('.modal .code-box b')).strip() != code)
            await a.click('.modal .modal-head .icon-btn')
            # ── another player opens it by its link (the newest version), and from the public list ──
            await bp.goto(f'{SITE}/#map={code}')
            await bp.wait_for_selector(f'.setup-card [data-map="u-{code}.1"].on', timeout=90000)
            card = await bp.inner_text('.setup-card')
            check('the link opens the campaign menu on the newest version', name2 in card and '甲國' in card, card.replace('\n', ' ')[:200])
            await bp.click('.setup-card .btn:has-text("公開地圖")')
            await bp.wait_for_selector(f'.mb-row:has-text("{code}")', timeout=30000)
            row = await bp.inner_text(f'.mb-row:has-text("{code}")')
            check('the public list has it', name2 in row and '甲國' in row, row.replace('\n', ' '))
            await bp.screenshot(path=f'{SP}/maps-list.png')
            await bp.click('.modal .modal-head .icon-btn')
            # ── a room on it, by its code ──
            await a.goto(SITE + '/')
            await a.wait_for_selector('.menu-screen.home', timeout=90000)
            await a.click('[data-k="create"]')
            await a.wait_for_selector('.online-screen .code-box b', timeout=120000)
            room = (await a.inner_text('.code-box b')).strip()
            await a.fill('.room-layout input[aria-label="玩家地圖代號"]', code.lower())
            await a.click('.room-layout .btn:has-text("使用")')
            await a.wait_for_selector(f'.room-layout [data-map="u-{code}.1"].on', timeout=30000)
            lay = await a.inner_text('.room-layout')
            check('the host sets the room up on the map by its code (the newest version)', name2 in lay, lay.replace('\n', ' ')[:200])
            # (a new page load: the same address with only another #… would not reload the page; without the
            # map kept on this device, the page fetches the room's version)
            fetched = []
            bp.on('request', lambda r: fetched.append(r.url) if f'/api/maps/{code}' in r.url else None)
            await bp.evaluate("localStorage.removeItem('hexverse-maps-seen-v1')")
            await bp.goto(f'{SITE}/?join=1#room={room.lower()}')
            await bp.wait_for_function(f"document.querySelector('.room-terms') && document.querySelector('.room-terms').textContent.includes({json.dumps(name2)})", timeout=90000)
            terms = await bp.inner_text('.room-terms')
            check('the other player\'s page fetches the room\'s version of the map', name2 in terms and any('rev=1' in u for u in fetched), terms + ' ' + ' '.join(fetched))
            for i in range(60):
                if '乙國' in await a.inner_text('.online-screen .seat-list'): break
                await a.wait_for_timeout(500)
            await a.click('.online-screen .modal-foot .btn.primary')
            await a.wait_for_function('window.__game && window.__game.state', timeout=120000)
            await bp.wait_for_function('window.__game && window.__game.client && window.__game.state', timeout=120000)
            hb = await a.evaluate("({ map: __game.state.map, hexes: __game.state.board.hexes.length, def: !!__game.state.mapDef })")
            cb = await bp.evaluate("({ map: __game.state.map, hexes: __game.state.board.hexes.length })")
            same = await a.evaluate("JSON.stringify(__game.state.board.hexes.map((h) => h.terrain + h.number))") == await bp.evaluate("JSON.stringify(__game.state.board.hexes.map((h) => h.terrain + h.number))")
            check('both pages play the map, on the same board', hb['map'] == f'u-{code}.1' and cb['map'] == hb['map'] and hb['hexes'] == cb['hexes'] and hb['def'] and same, f'{hb} {cb}')
            await a.wait_for_timeout(3000)
            await bp.screenshot(path=f'{SP}/maps-online.png')
            # ── the author changes the map during the game: a reloaded page still gets the room's version ──
            v3 = {**got['map']['draft'], 'name': name2 + '三', 'vp': 12}
            r = await actx.request.post(f'{SITE}/api/maps/{code}', data=json.dumps({'draft': v3}), headers={'origin': SITE, 'content-type': 'application/json'})
            rj = await r.json()
            board = await a.evaluate("JSON.stringify(__game.state.board.hexes.map((h) => h.terrain + h.number))")
            fetched.clear()
            await bp.evaluate("localStorage.removeItem('hexverse-maps-seen-v1')")
            await bp.reload()
            await bp.wait_for_function('window.__game && window.__game.state && window.__game.state.board', timeout=120000)
            await bp.wait_for_timeout(1500)
            cb = await bp.evaluate("({ map: __game.state.map, board: JSON.stringify(__game.state.board.hexes.map((h) => h.terrain + h.number)) })")
            check('the author changed it mid-game; the reloaded page plays the room\'s version', rj.get('rev') == 2 and cb['map'] == f'u-{code}.1' and cb['board'] == board and any('rev=1' in u for u in fetched), f"{rj} {cb['map']} {' '.join(fetched)}")
            # ── rating it at the end (the other player's page; the game is ended by hand) ──
            await bp.evaluate("(() => { const g = __game; g.state.phase = 'over'; g.state.winner = 0; g.overShown = false; g.refresh(); })()")
            await bp.wait_for_selector('.modal .mb-rate-stars button', timeout=30000)
            await bp.click('.modal .mb-rate-stars button:nth-child(4)')
            await bp.wait_for_function("document.querySelectorAll('.modal .mb-rate-stars button.on').length === 4", timeout=30000)
            got = await (await bctx.request.get(f'{SITE}/api/maps/{code}?t={time.time()}')).json()
            check('rating the map when the campaign is over', got['map']['votes'] == 1 and got['map']['rating'] == 4 and got['map']['plays'] >= 1 and got['map']['rev'] == 2, json.dumps({k: got['map'][k] for k in ('votes', 'rating', 'plays', 'rev')}))
            # (an outside address the test machine cannot reach, such as a profile picture, is not the page's fault)
            # (and the sixth map's refusal: one 403 on the author's page)
            refused = [l for l in logs if 'status of 403' in l]
            errs = [l for l in logs if ('pageerror' in l or ' error]' in l) and 'ERR_TUNNEL_CONNECTION_FAILED' not in l and 'status of 403' not in l]
            check('no page errors', not errs and len(refused) <= 1, '\n'.join(errs[:6] + refused))
        except Exception:
            # (where it stopped: both pages and the pages' log)
            for nm, pg in (('a', a), ('b', bp)):
                try: await pg.screenshot(path=f'{SP}/maps-fail-{nm}.png')
                except Exception: pass
            print('\n'.join(logs[-30:]))
            raise
        await b.close()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
