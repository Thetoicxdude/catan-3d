# The building cards on the page (src/meta/collection.js, src/ui/cards-ui.js): a new player's home screen
# (the welcome present waiting on the Draw & Shop tab), taking it, a draw (the card goes into the
# blueprint in use), the shop (shards for a card), the Cards page (18 cards, the locked ones with how to
# get them, a card put in, another blueprint taken into use), the setup showing that blueprint, a
# campaign where it is played (the computers with seven cards each), a mission done in play, and the
# coins and missions of the finished game; the pages at phone width.
#   python3 test/ui8.py          (SHOTS=dir for the screenshots)
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

CARDS = "() => window.__cards.get()"
SETTINGS = "() => JSON.parse(localStorage.getItem('catan3d-settings-v1'))"
MY_TURN = """() => { const g = __game, s = g.state; window.__autoHuman = false; s.current = 0; s.rolled = true; s.pending = null; s.trade = null; s.used = {}; for (const r of ['wood','brick','wool','grain','ore']) s.players[0].res[r] = 12; g.refresh(); }"""

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1366, 'height': 820})
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        # a new player: no cards stored yet
        await page.add_init_script("window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; if (!localStorage.getItem('catan3d-settings-v1')) localStorage.setItem('catan3d-settings-v1', JSON.stringify({ lang: 'zh', speed: 'turbo', quality: 'low', qualityPicked: true, mode: 'develop', opponents: 3 }));")
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
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.wait_for_timeout(1200)

        # ── a new player's home screen ──
        c = await page.evaluate(CARDS)
        check('a new player owns the granary and the market', c['own'] == ['granary', 'market'] and c['coins'] == 0, c['own'])
        marks = await page.evaluate("() => ({ tabs: [...document.querySelectorAll('.hm-tab')].filter((t) => getComputedStyle(t).display !== 'none').map((t) => t.dataset.k), shop: document.querySelector('.hm-tab[data-k=\"shop\"] .hm-badge').textContent, shopShown: !document.querySelector('.hm-tab[data-k=\"shop\"] .hm-badge').hidden, cardsShown: !document.querySelector('.hm-tab[data-k=\"cards\"] .hm-badge').hidden })")
        check('the side tabs, the welcome present marked', marks['tabs'] == ['cards', 'shop'] and marks['shopShown'] and marks['shop'] == '1' and not marks['cardsShown'], marks)
        await page.screenshot(path=f'{SP}/ui8-home.png')

        # ── Draw & Shop: the present, a draw ──
        await page.click('.hm-tab[data-k="shop"]')
        await page.wait_for_selector('.modal.side-page.from-right .shop-page')
        await page.click('[data-tab="missions"]')
        await page.click('[data-claim="welcome"]')
        await page.wait_for_timeout(300)
        c = await page.evaluate(CARDS)
        bal = await page.inner_text('.sp-bals')
        check('the welcome present: 200 coins, shown at the top', c['coins'] == 200 and 'welcome' in c['got'] and '200' in bal, (c['coins'], bal))
        await page.click('[data-tab="draw"]')
        await page.click('.sp-draw >> nth=0')
        await page.wait_for_timeout(1500)
        c = await page.evaluate(CARDS)
        got = await page.evaluate("() => [...document.querySelectorAll('.sp-reveal .rv .cc')].map((x) => x.dataset.k)")
        s = await page.evaluate(SETTINGS)
        check('a draw: 100 coins, a card of the pack, into the blueprint in use', c['coins'] == 100 and len(got) == 1 and got[0] in c['own'] and len(c['own']) == 3 and got[0] in s['bps'][0], (c['coins'], got, s['bps'][0]))
        await page.screenshot(path=f'{SP}/ui8-draw.png')
        ten = await page.locator('.sp-draw >> nth=1').is_disabled()
        check('ten draws need 900 coins', ten)

        # ── the shop: shards for a chosen card ──
        await page.evaluate("() => { const c = window.__cards.get(); c.shards = 120; window.__cards.commit(); }")
        await page.click('[data-tab="shop"]')
        await page.wait_for_timeout(300)
        k = await page.evaluate("() => { const it = [...document.querySelectorAll('.sp-item')].find((x) => !x.classList.contains('owned') && x.querySelector('.cc:not(.k-wonder)')); return it ? it.querySelector('.cc').dataset.k : null; }")
        await page.click(f'.sp-item:has(.cc[data-k="{k}"]) .sp-trade')
        await page.wait_for_timeout(300)
        c = await page.evaluate(CARDS)
        check('a card from the shop for 100 shards', k in c['own'] and c['shards'] == 20, (k, c['shards']))
        wonder_off = await page.evaluate("() => { const it = [...document.querySelectorAll('.sp-item')].find((x) => x.querySelector('.cc.k-wonder.locked')); return it ? it.querySelector('.sp-trade').disabled : null; }")
        check('a wonder costs more shards than there are', wonder_off is True, wonder_off)
        await page.screenshot(path=f'{SP}/ui8-shop.png')

        # ── the Cards page: the collection, a locked card, the blueprints ──
        await page.click('.modal-foot .btn:has-text("卡牌")')
        await page.wait_for_selector('.modal.side-page.from-left .cards-page')
        n = await page.locator('.cp-coll .cc').count()
        locked = await page.locator('.cp-coll .cc.locked').count()
        c = await page.evaluate(CARDS)
        check('the Cards page shows the 18 cards, the ones not owned locked', n == 18 and locked == 18 - len(c['own']), (n, locked))
        await page.click('.cp-coll .cc[data-k="aqueduct"]')
        how = await page.inner_text('.cp-detail')
        check('a locked card says how to get it', '任務' in how and '開發' in how, how.replace('\n', ' ')[:80])
        # another blueprint: two cards in it, then taken into use
        await page.click('.cp-tab[data-set="1"]')
        for k in ['market', 'granary']:
            await page.click(f'.cp-coll .cc[data-k="{k}"]')
            await page.click('.cp-acts .btn.primary')
            await page.wait_for_timeout(150)
        await page.click('.cp-use .btn')
        await page.wait_for_timeout(200)
        s = await page.evaluate(SETTINGS)
        check('a second blueprint made and taken into use', s['bpCur'] == 1 and s['bps'][1] == ['market', 'granary'], (s['bpCur'], s['bps']))
        # a card out of it again from its place
        await page.click('.cp-slot[data-slot="granary"]')
        s = await page.evaluate(SETTINGS)
        check('a card taken out from its place', s['bps'][1] == ['market'], s['bps'][1])
        await page.click('.cp-acts .btn.primary')
        await page.screenshot(path=f'{SP}/ui8-cards.png')
        await page.click('.modal.side-page .modal-head .icon-btn')
        await page.wait_for_timeout(300)

        # ── the setup shows the blueprint in use; the campaign plays it ──
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(1800)
        line = await page.evaluate("() => { const d = document.querySelector('.deck-line'); return d ? { text: d.textContent, cards: d.querySelectorAll('.dk-card:not(.empty)').length } : null; }")
        check('the setup shows blueprint 2 with its two cards', line and '藍圖 2' in line['text'] and line['cards'] == 2, line)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state')
        await page.wait_for_timeout(2000)
        bps = await page.evaluate("() => __game.state.players.map((p) => p.bp)")
        check('the nation brings its two cards, the computers seven each', bps[0] == ['market', 'granary'] and all(len(x) == 7 for x in bps[1:]), bps)
        await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
        await page.wait_for_function("() => __game.state.phase === 'play'", timeout=180000)
        await page.wait_for_timeout(1200)
        await page.evaluate(MY_TURN)
        await page.keyboard.press('b')
        await page.wait_for_timeout(400)
        rows = await page.evaluate("() => [...document.querySelectorAll('.build-menu .bm-row')].filter((r) => !r.hidden).map((r) => r.dataset.k)")
        check('the build menu has the two cards of the blueprint', [r for r in rows if r.startswith('bp:')] == ['bp:market', 'bp:granary'] and 'develop' in rows, rows)
        await page.screenshot(path=f'{SP}/ui8-build.png')
        await page.keyboard.press('b')

        # a mission done in play: a development
        await page.evaluate("() => __game.onButton('develop')")
        await page.wait_for_timeout(400)
        hexes = await page.evaluate("() => __game.map.interaction && __game.map.interaction.kind === 'hex' ? __game.map.interaction.ids : []")
        await page.evaluate("(h) => __game.map.interaction.onPick(h)", hexes[0])
        await page.wait_for_selector('.modal[data-kind="develop"]')
        await page.click('.modal[data-kind="develop"] .res-pick:not(.off)')
        await page.wait_for_timeout(600)
        c = await page.evaluate(CARDS)
        toast = await page.evaluate("() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | ')")
        check('a development done: its mission, and a note', c['prog'].get('plot') == 1 and '任務完成' in toast, (c['prog'].get('plot'), toast[:120]))

        # the end of the campaign: coins and missions, on its last sheet
        before = c['coins']
        await page.evaluate("() => { const g = __game, s = g.state; s.phase = 'over'; s.winner = 0; s.pending = null; g.refresh(); }")
        await page.wait_for_selector('.modal[data-kind="over"] .rewards', timeout=20000)
        c = await page.evaluate(CARDS)
        rw = await page.inner_text('.modal[data-kind="over"] .rewards')
        gained = c['coins'] - before
        check('a win: coins for the game, the win and the first game today', gained == 30 + 40 + 50 and str(gained) in rw, (gained, rw.replace('\n', ' ')))
        check('the missions of a finished game: a game and a win of the development mode', c['prog'].get('devgame') == 1 and c['prog'].get('devwin') == 1 and c['games'] == 1 and c['wins'] == 1, c['prog'])
        await page.screenshot(path=f'{SP}/ui8-over.png')
        # counted once: the same game again counts nothing
        again = await page.evaluate("() => { const r = __game.result(); const before = window.__cards.get().coins; __game.onGameOver(r); return window.__cards.get().coins - before; }")
        check('a game is counted once', again == 0, again)

        # back home: rewards waiting (the development, the game, the win)
        await page.evaluate("() => localStorage.removeItem('catan3d-save-v1')")
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        badge = await page.inner_text('.hm-tab[data-k="shop"] .hm-badge')
        check('the Draw & Shop tab shows three rewards waiting', badge == '3', badge)
        await page.click('.hm-tab[data-k="shop"]')
        await page.click('[data-tab="missions"]')
        await page.click('[data-claim="devwin"]')
        await page.wait_for_timeout(300)
        c = await page.evaluate(CARDS)
        s = await page.evaluate(SETTINGS)
        check('the win of a development game gives the academy, into the blueprint', 'academy' in c['own'] and 'academy' in s['bps'][1], (c['own'], s['bps'][1]))

        # ── phone width: the medals instead of the tabs, the pages over the whole screen ──
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.wait_for_timeout(800)
        vis = await page.evaluate("() => ({ tabs: [...document.querySelectorAll('.hm-tab')].some((t) => getComputedStyle(t).display !== 'none'), medals: [...document.querySelectorAll('.hm-medal')].filter((m) => getComputedStyle(m).display !== 'none').map((m) => m.dataset.k) })")
        check('a phone shows the medals, not the tabs', not vis['tabs'] and vis['medals'][:2] == ['cards', 'shop'], vis)
        await page.click('.hm-medal[data-k="cards"]')
        await page.wait_for_selector('.cards-page')
        await page.wait_for_timeout(400)
        geo = await page.evaluate("() => { const m = document.querySelector('.modal.side-page').getBoundingClientRect(); const slots = [...document.querySelectorAll('.cp-slots > *')].map((x) => Math.round(x.getBoundingClientRect().top)); return { w: Math.round(m.width), oneRow: new Set(slots).size === 1, over: document.documentElement.scrollWidth > innerWidth }; }")
        check('the Cards page fills a phone, its seven places in one row', geo['w'] == 390 and geo['oneRow'] and not geo['over'], geo)
        await page.screenshot(path=f'{SP}/ui8-phone-cards.png')

        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errors, errors[:5])
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('\nui8:', 'all passed' if not bad else 'FAILED: ' + ', '.join(bad))
    sys.exit(1 if bad else 0)

asyncio.run(main())
