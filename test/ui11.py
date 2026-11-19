# The development mode's buildings of 2026-11-18 on the page: the shop's neutral buildings for coins,
# then a campaign whose blueprint has the warehouse, the caravanserai and the apprentice workshop, and
# (set into the state) the other buildings whose effects ask the player something: the workshop's card
# left out, the warehouse's cards put away, the caravanserai's trade, the observatory's second roll, the
# almshouse's card at the roll, the counting house's at the turn's end, the smithy's ore and the road
# bureau's card less in the build menu, a farmstead's third level, the garrison's two cards for a wonder;
# the log's lines for them; the models on the map. The rules themselves: test/develop2.mjs.
#   python3 test/ui11.py          (SHOTS=dir for the screenshots)
import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'hexverse-shots')
os.makedirs(SP, exist_ok=True)
results = {}
DECK = ['road', 'settlement', 'city', 'dev', 'warehouse', 'caravan', 'workshop']
OLD = ['aqueduct', 'granary', 'market', 'shipyard', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press', 'gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library']
NEW = ['farmstead', 'homestead', 'grange', 'caravan', 'harborOffice', 'roadworks', 'newTown', 'townHall', 'governor', 'lectureHall', 'scriptorium', 'university',
       'warehouse', 'countingHouse', 'almshouse', 'smithy', 'terraces', 'observatory', 'watchtower', 'temple', 'builders', 'garrison', 'workshop', 'guildHall', 'monument']
# (all but three of the neutral ones: two are bought in the shop, the builders' yard is a mission's)
OWN = OLD + [k for k in NEW if k not in ('temple', 'monument', 'builders')]
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

# the human's turn, taken over, with a hand given
TURN = """(hand) => { const g = __game, s = g.state; window.__autoHuman = false; clearTimeout(g.timer); g.timer = null; g.thinking = null; s.current = 0; s.rolled = true; s.pending = null; s.trade = null; s.used = {}; s.devPlayed = false;
  Object.assign(s.players[0].res, { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 }, hand); g.refresh(); }"""
# a building of player 0's beside its first settlement (a city when asked)
BUILT = """([k, city]) => { const s = __game.state; const v = s.vertices.findIndex((b) => b && b.p === 0); if (city) s.vertices[v].t = 'c'; s.players[0].built[k] = v; if (k === 'warehouse') s.players[0].store = s.players[0].store || { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 }; __game.refresh(); return v; }"""
HAND = "() => ({ ...__game.state.players[0].res })"
LOG = "() => document.querySelector('.log-body').innerText"

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1366, 'height': 820})
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        await page.add_init_script("window.__developOpen = true; window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; if (!localStorage.getItem('hexverse-settings-v1')) localStorage.setItem('hexverse-settings-v1', JSON.stringify({ lang: 'zh', speed: 'turbo', quality: 'low', qualityPicked: true, mode: 'develop', opponents: 3, bps: [%s, [], []], bpCur: 0, bpv: 2 })); if (!localStorage.getItem('hexverse-cards-v1')) localStorage.setItem('hexverse-cards-v1', JSON.stringify({ own: %s, coins: 400 }));" % (json.dumps(DECK), json.dumps(OWN)))
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

        # ── the shop: the neutral buildings for coins, first ──
        await page.click('.hm-tab[data-k="shop"]')
        await page.wait_for_selector('.menu-screen.page .shop-page')
        await page.click('[data-tab="shop"]')
        await page.wait_for_timeout(400)
        tier = await page.evaluate("""() => { const t = document.querySelector('.sp-tier'); return { neutral: t.classList.contains('neutral'), head: t.querySelector('.sp-tierhead').innerText,
          cards: [...t.querySelectorAll('.sp-item .cc')].map((c) => c.dataset.k), price: t.querySelector('.sp-item:not(.owned) .sp-trade') ? t.querySelector('.sp-item:not(.owned) .sp-trade').innerText : '' }; }""")
        check('the shop opens with the 13 neutral buildings, for coins', tier['neutral'] and len(tier['cards']) == 13 and '中立建築' in tier['head'] and '150' in tier['price'], tier)
        await page.click('.sp-item:has(.cc[data-k="temple"]) .sp-trade')
        await page.wait_for_timeout(500)
        c = await page.evaluate("() => window.__cards.get()")
        check('a neutral building bought: 150 coins, no shards', 'temple' in c['own'] and c['coins'] == 250 and (c.get('shards') or 0) == 0, (c['coins'], c.get('shards')))
        await page.screenshot(path=f'{SP}/ui11-shop.png')
        # the card's way of being had
        await page.click('.pg-item[data-k="cards"]')
        await page.wait_for_selector('.menu-screen.page .cards-page')
        await page.click('.cp-coll .cc[data-k="monument"]')
        how = await page.inner_text('.cp-detail')
        check('a neutral card not owned: the shop sells it for coins', '商店' in how and '150' in how and '金幣' in how, how.replace('\n', ' ')[:120])
        await page.click('.cp-coll .cc[data-k="builders"]')
        how = await page.inner_text('.cp-detail')
        check('a mission\'s neutral card: the mission and the shop', '任務' in how and '金幣' in how, how.replace('\n', ' ')[:120])
        await page.click('.pg-home')
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.wait_for_timeout(300)

        # ── a campaign ──
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(1800)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state')
        await page.wait_for_timeout(1500)
        bp = await page.evaluate("() => __game.state.players[0].bp")
        check('the nation brings the new buildings in its blueprint', bp == DECK, bp)
        await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
        await page.wait_for_function("() => __game.state.phase === 'play'", timeout=180000)
        await page.wait_for_timeout(1200)

        # the apprentice workshop standing: the warehouse one card short, the card chosen
        await page.evaluate(BUILT, ['workshop', True])
        await page.evaluate(TURN, {'wood': 3, 'brick': 3, 'grain': 2})
        await page.keyboard.press('b')
        await page.wait_for_timeout(400)
        row = await page.evaluate("() => { const r = document.querySelector('.bm-row[data-k=\"bp:warehouse\"]'); return { off: r.classList.contains('off'), sub: r.querySelector('.bm-sub').textContent, tokens: r.querySelectorAll('.bm-cost .rtok').length }; }")
        check('the build menu: the warehouse a card short with the workshop, and why', not row['off'] and '學徒工坊' in row['sub'] and row['tokens'] == 4, row)
        await page.screenshot(path=f'{SP}/ui11-menu.png')
        await page.click('.bm-row[data-k="bp:warehouse"]')
        await page.wait_for_timeout(300)
        spots = await page.evaluate("() => __game.map.interaction && __game.map.interaction.kind === 'vertex' ? __game.map.interaction.ids : []")
        await page.evaluate("(v) => __game.map.interaction.onPick(v)", spots[0])
        await page.wait_for_selector('.modal[data-kind="develop"]')
        opts = await page.locator('.modal[data-kind="develop"] .dv-res').count()
        check('the workshop asks which card to leave out: one of each kind the cost has', opts == 3, opts)
        await page.screenshot(path=f'{SP}/ui11-skip.png')
        await page.click('.modal[data-kind="develop"] .dv-res >> nth=2')
        await page.click('.modal[data-kind="develop"] .modal-foot .btn.primary')
        await page.wait_for_timeout(500)
        h = await page.evaluate(HAND)
        built = await page.evaluate("() => __game.state.players[0].built.warehouse")
        check('the warehouse stands, the grain chosen left out', built == spots[0] and h['wood'] == 1 and h['brick'] == 1 and h['grain'] == 2, (built, h))

        # the warehouse: three cards put away, out of the hand
        await page.evaluate(TURN, {'ore': 5, 'wool': 1})
        await page.keyboard.press('b')
        await page.wait_for_timeout(300)
        use = await page.evaluate("() => document.querySelector('.bm-row[data-k=\"bp:warehouse\"] .bm-cost').innerText")
        await page.click('.bm-row[data-k="bp:warehouse"]')
        await page.wait_for_selector('.modal[data-kind="warehouse"]')
        for _ in range(3):
            await page.click('.modal[data-kind="warehouse"] .dv-srow >> nth=4 >> .dv-sbtn >> nth=0')
        full = await page.locator('.modal[data-kind="warehouse"] .dv-srow >> nth=4 >> .dv-sbtn >> nth=0').is_disabled()
        await page.screenshot(path=f'{SP}/ui11-warehouse.png')
        await page.click('.modal[data-kind="warehouse"] .modal-foot .btn.primary')
        await page.wait_for_timeout(500)
        st = await page.evaluate("() => ({ store: __game.state.players[0].store, res: __game.state.players[0].res, stat: document.querySelector('.stat.store') && !document.querySelector('.stat.store').hidden ? document.querySelector('.stat.store').innerText : null })")
        check('the warehouse: its row a use, three ores put away (no fourth), counted in the top bar', '使用' in use and full and st['store']['ore'] == 3 and st['res']['ore'] == 2 and st['stat'] and '3' in st['stat'], st)

        # the caravanserai: two different cards for an ore
        await page.evaluate(BUILT, ['caravan', False])
        await page.evaluate(TURN, {'wood': 1, 'brick': 1})
        await page.keyboard.press('b')
        await page.wait_for_timeout(300)
        await page.click('.bm-row[data-k="bp:caravan"]')
        await page.wait_for_selector('.modal[data-kind="trade"]')
        await page.click('.modal[data-kind="trade"] .dv-opts >> nth=1 >> .dv-res >> nth=4')
        await page.click('.modal[data-kind="trade"] .modal-foot .btn.primary')
        await page.wait_for_timeout(500)
        h = await page.evaluate(HAND)
        log = await page.evaluate(LOG)
        check('the caravanserai: wood and brick for an ore, in the log', h == {'wood': 0, 'brick': 0, 'wool': 0, 'grain': 0, 'ore': 1} and '商隊旅館' in log, h)

        # the smithy: a road with wood and an ore, the menu says so
        await page.evaluate(BUILT, ['smithy', False])
        await page.evaluate(TURN, {'wood': 1, 'ore': 1})
        await page.keyboard.press('b')
        await page.wait_for_timeout(300)
        row = await page.evaluate("() => { const r = document.querySelector('.bm-row[data-k=\"road\"]'); return { off: r.classList.contains('off'), sub: r.querySelector('.bm-sub').textContent, tokens: [...r.querySelectorAll('.bm-cost .rtok')].map((x) => [...x.classList].find((c) => c.startsWith('rt-'))) }; }")
        check('the smithy: the road paid with wood and an ore, and the menu says so', not row['off'] and '鐵匠鋪' in row['sub'] and sorted(row['tokens']) == ['rt-ore', 'rt-wood'], row)
        await page.keyboard.press('b')
        # (one settlement holds them all in this test: the map has room for five beside it)
        await page.evaluate("() => { delete __game.state.players[0].built.smithy; }")

        # the road bureau: the turn's first road a card less, the menu says so
        await page.evaluate(BUILT, ['roadworks', False])
        await page.evaluate(TURN, {'brick': 1})
        await page.keyboard.press('b')
        await page.wait_for_timeout(300)
        row = await page.evaluate("() => { const r = document.querySelector('.bm-row[data-k=\"road\"]'); return { off: r.classList.contains('off'), sub: r.querySelector('.bm-sub').textContent, tokens: [...r.querySelectorAll('.bm-cost .rtok')].map((x) => [...x.classList].find((c) => c.startsWith('rt-'))) }; }")
        check('the road bureau: the first road of the turn for a brick, and the menu says so', not row['off'] and '築路司' in row['sub'] and row['tokens'] == ['rt-brick'], row)
        await page.keyboard.press('b')
        await page.evaluate("() => { delete __game.state.players[0].built.roadworks; }")

        # the almshouse: a card first, then the dice
        await page.evaluate(BUILT, ['almshouse', False])
        await page.evaluate(TURN, {'wood': 1})
        await page.evaluate("() => { __game.state.rolled = false; __game.refresh(); }")
        await page.click('.act[data-k="roll"]')
        await page.wait_for_selector('.modal[data-kind="bonus"]')
        await page.click('.modal[data-kind="bonus"] .res-pick >> nth=3')
        await page.wait_for_timeout(600)
        r = await page.evaluate("() => ({ rolled: __game.state.rolled, grain: __game.state.players[0].res.grain, used: !!__game.state.used.almshouse })")
        check('the almshouse: a grain chosen, then the dice', r['rolled'] and r['used'] and r['grain'] >= 1, r)

        # the observatory: the dice, then whether to roll again for a wool
        await page.evaluate("() => { delete __game.state.players[0].built.almshouse; }")
        await page.evaluate(BUILT, ['observatory', False])
        await page.evaluate(TURN, {'wool': 2})
        await page.evaluate("() => { __game.state.rolled = false; __game.refresh(); }")
        await page.click('.act[data-k="roll"]')
        await page.wait_for_selector('.modal[data-kind="reroll"]')
        await page.screenshot(path=f'{SP}/ui11-reroll.png')
        pd = await page.evaluate("() => __game.state.pending")
        await page.click('.modal[data-kind="reroll"] .btn.primary')
        await page.wait_for_timeout(800)
        r = await page.evaluate("() => ({ pending: __game.state.pending && __game.state.pending.type, used: !!__game.state.used.observatory })")
        log = await page.evaluate(LOG)
        check('the observatory: asked after the roll, a wool for a second, in the log', pd and pd['type'] == 'reroll' and r['used'] and '天文台' in log, (pd, r))
        await page.evaluate("() => { delete __game.state.players[0].built.observatory; }")

        # the counting house: a card at the turn's end
        await page.evaluate(BUILT, ['countingHouse', False])
        await page.evaluate(TURN, {'ore': 9})
        turn = await page.evaluate("() => __game.state.turn")
        await page.click('.act[data-k="end"]')
        await page.wait_for_selector('.modal[data-kind="bonus"]')
        await page.click('.modal[data-kind="bonus"] .res-pick >> nth=1')
        await page.wait_for_timeout(600)
        r = await page.evaluate("() => ({ turn: __game.state.turn })")
        log = await page.evaluate(LOG)
        check('the counting house: a brick chosen as the turn ends', r['turn'] > turn and '錢莊' in log and '磚塊' in log, (turn, r))
        await page.evaluate("() => { delete __game.state.players[0].built.countingHouse; }")

        # a farmstead's third level
        v = await page.evaluate(BUILT, ['farmstead', True])
        hx = await page.evaluate("""(v) => { const s = __game.state, G = __geo(); const h = G.vertices[v].hexes.find((x) => s.board.hexes[x].terrain !== 'desert' && s.board.hexes[x].terrain !== 'sea' && s.board.robber !== x && (!s.plots[x] || s.plots[x].p === 0));
          const r = { forest: 'wood', hills: 'brick', pasture: 'wool', fields: 'grain', mountains: 'ore' }[s.board.hexes[h].terrain]; s.plots[h] = { p: 0, r: [r, r] }; __game.refresh(); return h; }""", v)
        await page.evaluate(TURN, {'wool': 2, 'grain': 3, 'ore': 3, 'brick': 1})
        await page.evaluate("(h) => __game.onButton('develop')", hx)
        await page.wait_for_timeout(300)
        await page.evaluate("(h) => __game.map.interaction.onPick(h)", hx)
        await page.wait_for_selector('.modal[data-kind="develop"]')
        title = await page.inner_text('.modal[data-kind="develop"] .modal-head h3')
        await page.click('.modal[data-kind="develop"] .res-pick:not(.off)')
        await page.wait_for_timeout(600)
        lv = await page.evaluate("(h) => __game.state.plots[h].r.length", hx)
        check('beside a farmstead\'s city a development goes to a third level', '三級' in title and lv == 3, (title, lv))

        # the garrison: two cards save the wonder
        ok = await page.evaluate("""() => { const g = __game, s = g.state, G = __geo();
          const d = s.board.hexes.map((h, i) => h.terrain === 'desert' ? i : -1).filter((i) => i >= 0 && !s.wonders.some((w) => w.h === i));
          for (const h of d) for (const v of G.hexes[h].vertices) {
            if (s.vertices[v] || G.vertices[v].neighbors.some((u) => s.vertices[u])) continue;
            s.vertices[v] = { p: 0, t: 's' }; s.players[0].pieces.settlements--;
            const k = 'gardens'; s.wonders.push({ h, k, p: 0, s: 2, t: s.turn, done: false });
            s.players[0].bp = [...s.players[0].bp.filter((x) => x !== 'workshop'), k];
            return h;
          }
          return -1; }""")
        await page.evaluate(BUILT, ['garrison', False])
        await page.evaluate("""(h) => { const g = __game, s = g.state; Object.assign(s.players[0].res, { wood: 2, brick: 0, wool: 0, grain: 1, ore: 0 }); s.players[0].dev = s.players[0].dev.filter((c) => c.type !== 'knight');
          s.current = 1; s.rolled = true; s.pending = { type: 'robber', reason: 'seven' }; s.trade = null;
          if (s.board.robber === h) s.board.robber = s.board.hexes.findIndex((x, i) => i !== h && x.terrain !== 'desert');
          g.dispatch({ type: 'robber', p: 1, hex: h }); }""", ok)
        await page.wait_for_selector('.modal[data-kind="defend"]', timeout=20000)
        opt = await page.evaluate("() => ({ knight: document.querySelector('.modal[data-kind=\"defend\"] .modal-foot .btn.primary') ? document.querySelector('.modal[data-kind=\"defend\"] .modal-foot .btn.primary').disabled : null, pay: [...document.querySelectorAll('.modal[data-kind=\"defend\"] .modal-foot .btn')].map((b) => b.innerText) })")
        await page.screenshot(path=f'{SP}/ui11-garrison.png')
        await page.click('.modal[data-kind="defend"] .modal-foot .btn:has-text("付 2 張防衛")')
        # (read at once: the computer's turn goes on, and the next roll may bring cards)
        r = await page.evaluate("(h) => ({ wonder: __game.state.wonders.some((w) => w.h === h), hand: Object.values(__game.state.players[0].res).reduce((a, b) => a + b, 0) })", ok)
        await page.wait_for_timeout(800)
        log = await page.evaluate(LOG)
        # (three cards, two paid; the robber then steals the last from the owner beside it, as ever)
        check('the garrison: two cards save the wonder with no knight, in the log', ok >= 0 and any('付 2 張防衛' in x for x in opt['pay']) and r['wonder'] and r['hand'] <= 1 and '衛戍所' in log and '付了' in log, (opt, r))

        # the new buildings on the map, as models
        await page.evaluate("() => { const s = __game.state; s.current = 0; s.pending = null; __game.refresh(); }")
        await page.wait_for_timeout(2500)
        on = await page.evaluate("() => [...__game.map.developLayer.items.values()].filter((i) => i.kind === 'annex').map((i) => i.info.k)")
        check('the new buildings stand on the map', all(k in on for k in ['warehouse', 'workshop', 'caravan', 'farmstead', 'garrison']), on)
        await page.screenshot(path=f'{SP}/ui11-map.png')

        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errors, errors[:5])
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('\nui11:', 'all passed' if not bad else 'FAILED: ' + ', '.join(bad))
    sys.exit(1 if bad else 0)

asyncio.run(main())
