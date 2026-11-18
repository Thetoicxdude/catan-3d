# The building cards on the page (src/meta/collection.js, src/ui/cards-ui.js, the pages: src/ui/pages.js):
# a new player's home screen (a full first blueprint: the four basic cards and three buildings; the
# welcome present waiting on the Missions tab, the side bar's five tabs on the left), taking it on the
# Missions page (the whole screen), a draw (into the collection: the blueprint is full), the shop (shards
# for a card), the pack's banner and its twelve cards, the Cards page (the basic cards and the 18
# buildings framed by rarity, the ones not owned grey, the rarities' chips, the stand never empty, a card
# opened with its cost, another blueprint without the development card taken into use), the setup
# showing that blueprint, a campaign where it is played (no development cards for money; the computers
# with seven cards each), a mission done in play, and the coins and missions of the finished game; the
# pages at phone width (the side bar along the bottom).
#   python3 test/ui8.py          (SHOTS=dir for the screenshots)
import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'hexverse-shots')
os.makedirs(SP, exist_ok=True)
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

CARDS = "() => window.__cards.get()"
SETTINGS = "() => JSON.parse(localStorage.getItem('hexverse-settings-v1'))"
# the human's turn, taken over (a computer's move already on its timer is called off: it would land after)
MY_TURN = """() => { const g = __game, s = g.state; window.__autoHuman = false; clearTimeout(g.timer); g.timer = null; g.thinking = null; s.current = 0; s.rolled = true; s.pending = null; s.trade = null; s.used = {}; for (const r of ['wood','brick','wool','grain','ore']) s.players[0].res[r] = 12; g.refresh(); }"""

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1366, 'height': 820})
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        # a new player: no cards stored yet
        await page.add_init_script("window.__developOpen = true; window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; if (!localStorage.getItem('hexverse-settings-v1')) localStorage.setItem('hexverse-settings-v1', JSON.stringify({ lang: 'zh', speed: 'turbo', quality: 'low', qualityPicked: true, mode: 'develop', opponents: 3 }));")
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
        s = await page.evaluate(SETTINGS)
        first = ['road', 'settlement', 'city', 'dev', 'granary', 'market', 'aqueduct']
        # (nothing saved yet: the first blueprint is the settings' default)
        deck1 = (s.get('bps') or [first])[0]
        check('a new player: three buildings, a full first blueprint with the basic cards', c['own'] == ['aqueduct', 'granary', 'market'] and c['coins'] == 0 and deck1 == first, (c['own'], deck1))
        marks = await page.evaluate("() => ({ tabs: [...document.querySelectorAll('.hm-tab')].filter((t) => getComputedStyle(t).display !== 'none').map((t) => [t.dataset.k, Math.round(t.getBoundingClientRect().left)]), missions: document.querySelector('.hm-tab[data-k=\"missions\"] .hm-badge').textContent, missionsShown: !document.querySelector('.hm-tab[data-k=\"missions\"] .hm-badge').hidden, cardsShown: !document.querySelector('.hm-tab[data-k=\"cards\"] .hm-badge').hidden })")
        check('the side bar\'s five tabs on the left, the welcome present marked on Missions', marks['tabs'] == [['cards', 0], ['shop', 0], ['missions', 0], ['profile', 0], ['settings', 0]] and marks['missionsShown'] and marks['missions'] == '1' and not marks['cardsShown'], marks)
        await page.screenshot(path=f'{SP}/ui8-home.png')

        # ── Missions: the present (a page over the whole screen, the home screen gone) ──
        await page.click('.hm-tab[data-k="missions"]')
        await page.wait_for_selector('.menu-screen.page .missions-page')
        await page.wait_for_timeout(600)
        geo = await page.evaluate("() => { const r = document.querySelector('.menu-screen.page').getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), home: !!document.querySelector('.menu-screen.home:not(.leaving)') }; }")
        check('the Missions page takes the whole screen in the home screen\'s place', geo['x'] == 0 and geo['w'] == 1366 and geo['h'] == 820 and not geo['home'], geo)
        await page.click('[data-claim="welcome"]')
        # (the coins fly into the head and the number counts up to them)
        await page.wait_for_function("() => document.querySelector('.sp-bals .cur.coin .num').textContent === '200'", timeout=10000)
        c = await page.evaluate(CARDS)
        bal = await page.inner_text('.sp-bals')
        check('the welcome present: 200 coins, shown at the top', c['coins'] == 200 and 'welcome' in c['got'] and '200' in bal, (c['coins'], bal))
        # ── Draw & Shop: a draw ──
        await page.click('.pg-item[data-k="shop"]')
        await page.wait_for_selector('.menu-screen.page .shop-page')
        await page.click('.btn.sp-draw >> nth=0')
        await page.wait_for_timeout(1500)
        c = await page.evaluate(CARDS)
        got = await page.evaluate("() => [...document.querySelectorAll('.sp-reveal .rv .cc')].map((x) => x.dataset.k)")
        s = await page.evaluate(SETTINGS)
        check('a draw: 100 coins, a card of the pack into the collection (the blueprint is full)', c['coins'] == 100 and len(got) == 1 and got[0] in c['own'] and len(c['own']) == 4 and (s.get('bps') or [first])[0] == first, (c['coins'], got, s.get('bps')))
        await page.screenshot(path=f'{SP}/ui8-draw.png')
        pack = await page.evaluate("() => ({ fan: [...document.querySelectorAll('.sp-fan .cc')].map((c) => c.dataset.k), pool: [...document.querySelectorAll('.sp-pool .cc')].map((c) => [c.dataset.k, !c.classList.contains('locked')]) })")
        drawn = [k for k, mine in pack['pool'] if mine]
        check('the pack\'s banner fans out its wonders; under it the twelve cards of the pack, the one drawn in colour', sorted(pack['fan']) == ['gardens', 'greatWall', 'library', 'lighthouse', 'royalRoad'] and len(pack['pool']) == 12 and drawn == got, pack)
        ten = await page.locator('.btn.sp-draw >> nth=1').is_disabled()
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
        await page.click('.pg-item[data-k="cards"]')
        await page.wait_for_selector('.menu-screen.page .cards-page')
        n = await page.locator('.cp-coll .cc').count()
        locked = await page.locator('.cp-coll .cc.locked').count()
        lock_icons = await page.locator('.cp-coll .cc .cc-lock, .cp-coll .cc .cc-cost').count()
        c = await page.evaluate(CARDS)
        check('the Cards page: the 4 basic cards and the 18 buildings, the ones not owned grey only, no costs on them', n == 22 and locked == 18 - len(c['own']) and lock_icons == 0, (n, locked, lock_icons))
        # rarity: each card's frame by how it is had, in that order (basic, common, rare, epic, legendary);
        # a gem cut for each but the basic cards, a crown on the legendary ones
        rar = await page.evaluate("() => { const cs = [...document.querySelectorAll('.cp-coll .cc')]; const r = (c) => [...c.classList].find((x) => x.startsWith('r-')); return { order: cs.map(r), gems: cs.filter((c) => c.querySelector('.cc-gem svg')).length, crowns: cs.filter((c) => c.querySelector('.cc-crown')).map((c) => c.dataset.k), shipyard: r(document.querySelector('.cp-coll .cc[data-k=\"shipyard\"]')), frame: getComputedStyle(document.querySelector('.cp-coll .cc[data-k=\"granary\"]')).backgroundImage.includes('gradient') }; }")
        want = ['r-basic'] * 4 + ['r-common'] * 3 + ['r-rare'] * 3 + ['r-epic'] * 7 + ['r-legendary'] * 5
        check('every card framed by its rarity, basic to legendary; a gem on all but the basic cards, a crown on the wonders', rar['order'] == want and rar['gems'] == 18 and sorted(rar['crowns']) == ['gardens', 'greatWall', 'library', 'lighthouse', 'royalRoad'] and rar['shipyard'] == 'r-rare' and rar['frame'], rar)
        # the card on its stand before any is picked (the stand is never empty), and the rarity's chips
        stand = await page.evaluate("() => { const d = document.querySelector('.cp-detail .cd'); return d ? { k: d.querySelector('.cc.big').dataset.k, acts: !!document.querySelector('.cp-detail .cp-acts .btn') } : null; }")
        check('the stand shows a card before any is picked, with what to do with it', stand and stand['k'] and stand['acts'], stand)
        await page.click('.cp-chip[data-r="legendary"]')
        only = await page.evaluate("() => [...document.querySelectorAll('.cp-coll .cc')].map((c) => c.dataset.k)")
        await page.click('.cp-chip[data-r="legendary"]')
        back = await page.locator('.cp-coll .cc').count()
        check('a rarity\'s chip shows its cards alone, and again all of them', sorted(only) == ['gardens', 'greatWall', 'library', 'lighthouse', 'royalRoad'] and back == 22, (only, back))
        await page.click('.cp-coll .cc[data-k="shipyard"]')
        how = await page.inner_text('.cp-detail')
        costs = await page.locator('.cp-detail .cb').count()
        check('a card opened: its cost in large cards, how to get it', '任務' in how and '開發' in how and costs == 3, (costs, how.replace('\n', ' ')[:90]))
        # another blueprint: the basic cards but the development card, two buildings; then taken into use
        await page.click('.cp-tab[data-set="1"]')
        await page.click('.cp-slot[data-slot="dev"]')
        for k in ['market', 'granary']:
            await page.click(f'.cp-coll .cc[data-k="{k}"]')
            await page.click('.cp-acts .btn.primary')
            await page.wait_for_timeout(150)
        await page.click('.cp-use .btn')
        await page.wait_for_timeout(200)
        s = await page.evaluate(SETTINGS)
        mine = ['road', 'settlement', 'city', 'market', 'granary']
        check('a second blueprint made (a basic card out) and taken into use', s['bpCur'] == 1 and s['bps'][1] == mine, (s['bpCur'], s['bps']))
        # a card out of it again from its place, and back
        await page.click('.cp-slot[data-slot="granary"]')
        s = await page.evaluate(SETTINGS)
        check('a card taken out from its place', s['bps'][1] == mine[:-1], s['bps'][1])
        await page.click('.cp-acts .btn.primary')
        await page.screenshot(path=f'{SP}/ui8-cards.png')
        # home from the rail's crest
        await page.click('.pg-home')
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.wait_for_timeout(300)

        # ── the setup shows the blueprint in use; the campaign plays it ──
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(1800)
        line = await page.evaluate("() => { const d = document.querySelector('.deck-line'); return d ? { text: d.textContent, cards: d.querySelectorAll('.dk-card:not(.empty)').length } : null; }")
        check('the setup shows blueprint 2 with its five cards', line and '藍圖 2' in line['text'] and line['cards'] == 5, line)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state')
        await page.wait_for_timeout(2000)
        bps = await page.evaluate("() => __game.state.players.map((p) => p.bp)")
        check('the nation brings its five cards, the computers seven each', bps[0] == mine and all(len(x) == 7 for x in bps[1:]), bps)
        await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
        await page.wait_for_function("() => __game.state.phase === 'play'", timeout=180000)
        await page.wait_for_timeout(1200)
        await page.evaluate(MY_TURN)
        await page.keyboard.press('b')
        await page.wait_for_timeout(400)
        rows = await page.evaluate("() => [...document.querySelectorAll('.build-menu .bm-row')].filter((r) => !r.hidden).map((r) => r.dataset.k)")
        check('the build menu has the two buildings of the blueprint', [r for r in rows if r.startswith('bp:')] == ['bp:market', 'bp:granary'] and 'develop' in rows, rows)
        dev = await page.evaluate("() => { const r = document.querySelector('.bm-row[data-k=\"dev\"]'); return { off: r.classList.contains('off'), nocard: r.classList.contains('nocard'), why: r.dataset.why || r.title }; }")
        check('no development card in the blueprint: its row is shut, and why', dev['off'] and dev['nocard'] and '藍圖' in (dev['why'] or ''), dev)
        refused = await page.evaluate("() => { try { __game.dispatch({ type: 'buyDev', p: 0 }); return __game.state.players[0].dev.length; } catch (e) { return 'refused'; } }")
        check('and the rules refuse it', refused in ('refused', 0), refused)
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
        gained = c['coins'] - before
        # (the total counts up from 0: read it once it has got there)
        try:
            await page.wait_for_function("(n) => document.querySelector('.modal[data-kind=\"over\"] .rewards').textContent.includes(String(n))", arg=gained, timeout=8000)
        except Exception:
            pass
        rw = await page.inner_text('.modal[data-kind="over"] .rewards')
        check('a win: coins for the game, the win and the first game today', gained == 30 + 40 + 50 and str(gained) in rw, (gained, rw.replace('\n', ' ')))
        check('the missions of a finished game: a game and a win of the development mode', c['prog'].get('devgame') == 1 and c['prog'].get('devwin') == 1 and c['games'] == 1 and c['wins'] == 1, c['prog'])
        await page.screenshot(path=f'{SP}/ui8-over.png')
        # counted once: the same game again counts nothing
        again = await page.evaluate("() => { const r = __game.result(); const before = window.__cards.get().coins; __game.onGameOver(r); return window.__cards.get().coins - before; }")
        check('a game is counted once', again == 0, again)

        # back home: rewards waiting (the development, the game, the win)
        await page.evaluate("() => localStorage.removeItem('hexverse-save-v1')")
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        badge = await page.inner_text('.hm-tab[data-k="missions"] .hm-badge')
        check('the Missions tab shows three rewards waiting', badge == '3', badge)
        await page.click('.hm-tab[data-k="missions"]')
        await page.click('[data-claim="devwin"]')
        await page.wait_for_timeout(300)
        c = await page.evaluate(CARDS)
        s = await page.evaluate(SETTINGS)
        check('the win of a development game gives the academy, into the blueprint with room', 'academy' in c['own'] and 'academy' in s['bps'][1], (c['own'], s['bps'][1]))

        # ── phone width: the side bar along the bottom, the pages over the whole screen ──
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.wait_for_timeout(800)
        vis = await page.evaluate("() => ({ tabs: [...document.querySelectorAll('.hm-tab')].map((t) => { const r = t.getBoundingClientRect(); return [t.dataset.k, Math.round(r.top), Math.round(r.bottom)]; }), medals: [...document.querySelectorAll('.hm-medal')].filter((m) => m.getBoundingClientRect().width > 0).map((m) => m.dataset.k) })")
        row = len(set(t[1] for t in vis['tabs'])) == 1 and all(t[2] >= 830 for t in vis['tabs'])
        check('a phone shows the side bar along the bottom, the rules in the corner', len(vis['tabs']) == 5 and row and vis['medals'] == ['rules'], vis)
        await page.click('.hm-tab[data-k="cards"]')
        await page.wait_for_selector('.menu-screen.page .cards-page')
        await page.wait_for_timeout(600)
        geo = await page.evaluate("() => { const m = document.querySelector('.menu-screen.page').getBoundingClientRect(); const slots = [...document.querySelectorAll('.cp-slots > *')].map((x) => Math.round(x.getBoundingClientRect().top)); const bar = [...document.querySelectorAll('.pg-item')].map((x) => Math.round(x.getBoundingClientRect().bottom)); const home = document.querySelector('.pg-corner').getBoundingClientRect(); return { w: Math.round(m.width), oneRow: new Set(slots).size === 1, over: document.documentElement.scrollWidth > innerWidth, bar, home: [Math.round(home.left), Math.round(home.top)] }; }")
        check('the Cards page fills a phone, its seven places in one row, the bar at the bottom, home in the corner', geo['w'] == 390 and geo['oneRow'] and not geo['over'] and len(set(geo['bar'])) == 1 and geo['bar'][0] >= 830 and geo['home'][0] < 30 and geo['home'][1] < 30, geo)
        # a card opened: a sheet from below, its button in reach, the header still there
        await page.click('.cp-coll .cc[data-k="guild"]')
        await page.wait_for_timeout(500)
        # (where it comes to rest: a slow page may still be raising it)
        await page.evaluate("() => document.querySelector('.cp-detail').getAnimations().forEach((a) => a.finish())")
        sheet = await page.evaluate("() => { const d = document.querySelector('.cp-detail').getBoundingClientRect(); const a = document.querySelector('.cp-acts').getBoundingClientRect(); const bar = document.querySelector('.pg-rail').getBoundingClientRect(); return { top: Math.round(d.top), bottom: Math.round(d.bottom), acts: Math.round(a.bottom), bar: Math.round(bar.top) }; }")
        check('a card opened on a phone: a sheet over the bar, its button in sight', sheet['bottom'] <= sheet['bar'] + 1 and sheet['top'] > 60 and sheet['acts'] <= sheet['bottom'] + 1, sheet)
        await page.screenshot(path=f'{SP}/ui8-phone-cards.png')
        await page.click('.cp-x')
        await page.wait_for_timeout(300)
        await page.click('.pg-corner')
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        check('home again from the corner', True)

        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errors, errors[:5])
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('\nui8:', 'all passed' if not bad else 'FAILED: ' + ', '.join(bad))
    sys.exit(1 if bad else 0)

asyncio.run(main())
