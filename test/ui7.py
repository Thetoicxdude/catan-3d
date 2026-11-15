# The development mode on the page: the campaign setup (the mode, the blueprint in use shown — it is
# chosen on the home screen's Cards page, test/ui8.py — the island by the number of players), then a
# campaign on the 37-hex island: the build menu's rows for
# developments and the blueprint, a development (hex, then its resource), a special building beside a
# settlement, a wonder on a desert, buying a card with the barracks, the robber at the wonder and its
# defence with a knight, the badges on the map, and the campaign carried on after a reload.
#   python3 test/ui7.py          (SHOTS=dir for the screenshots)
import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
results = {}
# a player who owns every card, with a blueprint of seven: the four basic cards, two buildings and a
# wonder (the royal road)
DECK = ['road', 'settlement', 'city', 'dev', 'market', 'wall', 'royalRoad']
ALL = ['aqueduct', 'granary', 'market', 'shipyard', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press', 'gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library']
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

# the human to move, dice rolled, nothing pending, plenty in hand
MY_TURN = """() => { const g = __game, s = g.state; window.__autoHuman = false; s.current = 0; s.rolled = true; s.pending = null; s.trade = null; s.used = {}; for (const r of ['wood','brick','wool','grain','ore']) s.players[0].res[r] = 12; g.refresh(); }"""
# labels on the map sit where they are anchored (as ui6.py checks)
CHECK = r"""() => {
  const layer = document.querySelector('.map-labels');
  const host = layer.getBoundingClientRect();
  const out = { shown: 0, badges: 0, bad: [] };
  for (const box of layer.children) {
    if (getComputedStyle(box).display === 'none') continue;
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(box.style.transform || '');
    if (!m) continue;
    const el = box.classList.contains('float') ? box : box.firstElementChild || box;
    out.shown++;
    if (el.classList.contains('dv-badge')) out.badges++;
    if (el.classList.contains('drop')) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - host.left - +m[1];
    const dy = r.top + r.height / 2 - host.top - +m[2];
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) out.bad.push(`${el.className} off by ${dx.toFixed(0)},${dy.toFixed(0)}`);
  }
  return out;
}"""

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1366, 'height': 820})
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        await page.add_init_script("window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; if (!localStorage.getItem('catan3d-settings-v1')) localStorage.setItem('catan3d-settings-v1', JSON.stringify({ lang: 'zh', speed: 'turbo', quality: 'low', qualityPicked: true, mode: 'develop', opponents: 3, bps: [%s, [], []], bpCur: 0 })); if (!localStorage.getItem('catan3d-cards-v1')) localStorage.setItem('catan3d-cards-v1', JSON.stringify({ own: %s }));" % (json.dumps(DECK), json.dumps(ALL)))
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

        # ── the campaign setup: the blueprint in use is shown, nothing to choose (the Cards page: ui8.py) ──
        mine = DECK
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(2000)
        on = await page.locator('[data-mode="develop"].on').count()
        check('the setup shows the development mode', on == 1)
        line = await page.evaluate("() => { const d = document.querySelector('.deck-line'); return d ? { text: d.textContent, cards: d.querySelectorAll('.dk-card:not(.empty)').length } : null; }")
        chooser = await page.locator('.deck-chooser, .dk-pick').count()
        check('the setup shows the blueprint in use, nothing to pick', line and line['cards'] == 7 and chooser == 0, (line, chooser))
        await page.screenshot(path=f'{SP}/ui7-setup.png')
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state')
        await page.wait_for_timeout(2000)
        info = await page.evaluate("() => { const s = __game.state; return { map: s.map, hexes: s.board.hexes.length, target: s.targetVP, bp0: s.players[0].bp, others: s.players.slice(1).map((p) => p.bp.length), deck: s.devDeck.length, bank: s.bank.wood }; }")
        check('a four-player campaign on the 37-hex island', info['map'] == 'dev-4' and info['hexes'] == 37 and info['target'] == 18 and info['deck'] == 35 and info['bank'] == 30, info)
        check('the nation brings its blueprint, the computers theirs', info['bp0'] == mine and info['others'] == [7, 7, 7], info['bp0'])

        # the opening, played by the computer for us
        await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
        await page.wait_for_function("() => __game.state.phase === 'play'", timeout=180000)
        await page.wait_for_timeout(1500)
        await page.evaluate(MY_TURN)
        await page.wait_for_timeout(600)

        # ── the build menu ──
        await page.keyboard.press('b')
        await page.wait_for_timeout(400)
        rows = await page.evaluate("() => [...document.querySelectorAll('.build-menu .bm-row')].filter((r) => !r.hidden).map((r) => r.dataset.k)")
        check('the build menu has the development and the blueprint', 'develop' in rows and [r for r in rows if r.startswith('bp:')] == ['bp:market', 'bp:wall', 'bp:royalRoad'], rows)
        await page.screenshot(path=f'{SP}/ui7-build.png')

        # a development: the row, a hex on the map, the resource
        await page.click('.bm-row[data-k="develop"]')
        await page.wait_for_timeout(400)
        hexes = await page.evaluate("() => __game.map.interaction && __game.map.interaction.kind === 'hex' ? __game.map.interaction.ids : []")
        check('the map offers hexes to develop', len(hexes) > 0, hexes[:6])
        await page.evaluate("(h) => __game.map.interaction.onPick(h)", hexes[0])
        await page.wait_for_selector('.modal[data-kind="develop"]')
        await page.click('.modal[data-kind="develop"] .res-pick:not(.off)')
        await page.wait_for_timeout(500)
        plot = await page.evaluate("(h) => __game.state.plots[h]", hexes[0])
        check('the development stands', plot and plot['p'] == 0 and len(plot['r']) == 1, plot)

        # a special building: the first row of the blueprint that may be built, beside a settlement
        await page.evaluate(MY_TURN)
        await page.keyboard.press('b')
        await page.wait_for_timeout(300)
        k = await page.evaluate("() => { const r = [...document.querySelectorAll('.bm-row.bm-b:not(.off):not(.wonder)')][0]; return r ? r.dataset.k : null; }")
        check('a building of the blueprint can be built', bool(k), k)
        if k:
            await page.click(f'.bm-row[data-k="{k}"]')
            await page.wait_for_timeout(300)
            spots = await page.evaluate("() => __game.map.interaction && __game.map.interaction.kind === 'vertex' ? __game.map.interaction.ids : []")
            await page.evaluate("(v) => __game.map.interaction.onPick(v)", spots[0])
            await page.wait_for_timeout(400)
            if await page.locator('.modal[data-kind="develop"]').count():
                await page.click('.modal[data-kind="develop"] .res-pick')
                await page.wait_for_timeout(300)
            built = await page.evaluate("() => __game.state.players[0].built")
            check('the special building stands beside the settlement', built.get(k[3:]) == spots[0], built)

        # a wonder: a settlement of ours on a desert's corner first
        ok = await page.evaluate("""() => {
          const g = __game, s = g.state, G = __geo();
          const deserts = s.board.hexes.map((h, i) => h.terrain === 'desert' ? i : -1).filter((i) => i >= 0 && i !== s.board.robber && !s.wonders.some((w) => w.h === i));
          for (const h of deserts) {
            for (const v of G.hexes[h].vertices) {
              if (s.vertices[v] || G.vertices[v].neighbors.some((u) => s.vertices[u])) continue;
              s.vertices[v] = { p: 0, t: 's' };
              s.players[0].pieces.settlements--;
              return h;
            }
          }
          return -1; }""")
        check('a desert corner for the wonder', ok >= 0, ok)
        await page.evaluate(MY_TURN)
        await page.keyboard.press('b')
        await page.wait_for_timeout(300)
        await page.click('.bm-row.bm-b.wonder')
        await page.wait_for_timeout(300)
        wh = await page.evaluate("() => __game.map.interaction && __game.map.interaction.kind === 'hex' ? __game.map.interaction.ids : []")
        check('the map offers the deserts', ok in wh, wh)
        await page.evaluate("(h) => __game.map.interaction.onPick(h)", ok)
        await page.wait_for_timeout(400)
        w = await page.evaluate("() => __game.state.wonders.filter((x) => x.p === 0)")
        check('the wonder is begun', len(w) == 1 and w[0]['s'] == 1 and w[0]['h'] == ok, w)

        # buying a card with the barracks: the choice, then a knight
        await page.evaluate("() => { const s = __game.state; s.players[0].built.barracks = s.vertices.findIndex((b) => b && b.p === 0); }")
        await page.evaluate(MY_TURN)
        knights = await page.evaluate("() => __game.state.players[0].dev.filter((c) => c.type === 'knight').length")
        await page.keyboard.press('4')
        await page.wait_for_selector('.modal[data-kind="dev"]')
        await page.click('.dv-opt:has-text("兵營")')
        await page.click('.modal-foot .btn.primary')
        await page.wait_for_timeout(400)
        k2 = await page.evaluate("() => __game.state.players[0].dev.filter((c) => c.type === 'knight').length")
        check('the barracks gives a knight', k2 == knights + 1, (knights, k2))

        # the robber at our wonder: the defence dialog, a knight played
        await page.evaluate("""(h) => { const g = __game, s = g.state; s.current = 1; s.rolled = true; s.pending = { type: 'robber', reason: 'seven' }; s.trade = null;
          if (s.board.robber === h) s.board.robber = s.board.hexes.findIndex((x, i) => i !== h && x.terrain !== 'desert');
          g.dispatch({ type: 'robber', p: 1, hex: h }); }""", ok)
        await page.wait_for_selector('.modal[data-kind="defend"]', timeout=20000)
        await page.screenshot(path=f'{SP}/ui7-defend.png')
        before = await page.evaluate("() => __game.state.players[0].knights")
        await page.click('.modal[data-kind="defend"] .btn.primary')
        await page.wait_for_timeout(600)
        after = await page.evaluate("() => ({ knights: __game.state.players[0].knights, wonders: __game.state.wonders.filter((x) => x.p === 0).length, pending: __game.state.pending })")
        check('a knight saves the wonder', after['knights'] == before + 1 and after['wonders'] == 1, after)

        # the badges on the map, in their places
        await page.evaluate("() => { const s = __game.state; s.current = 0; s.pending = null; __game.refresh(); }")
        await page.wait_for_timeout(2500)
        lab = await page.evaluate(CHECK)
        check('the badges are on the map, in place', lab['badges'] >= 2 and not lab['bad'], lab)
        await page.screenshot(path=f'{SP}/ui7-map.png')

        # carried on after a reload
        await page.evaluate("() => __game.save()")
        await page.reload()
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.click('[data-k="continue"]')
        await page.wait_for_function('window.__game && window.__game.state')
        await page.wait_for_timeout(2000)
        again = await page.evaluate("() => ({ map: __game.state.map, plots: __game.state.plots.filter(Boolean).length, wonders: __game.state.wonders.length, built: Object.keys(__game.state.players[0].built).length })")
        check('the campaign carries on after a reload', again['map'] == 'dev-4' and again['plots'] >= 1 and again['wonders'] >= 1 and again['built'] >= 1, again)

        # and the computer plays it on a while
        # (SwiftShader is slow and its speed varies, so wait for the turns rather than a fixed time; a
        # stuck game still fails, and shows where it stands)
        await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
        try:
            await page.wait_for_function("() => __game.state.turn > 5", timeout=90000)
        except Exception:
            pass
        t = await page.evaluate("() => { const s = __game.state; return { turn: s.turn, current: s.current, rolled: s.rolled, pending: s.pending && s.pending.type, over: s.phase === 'over' }; }")
        check('the campaign goes on', t['turn'] > 5 or t['over'], t)

        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errors, errors[:5])
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('\nui7:', 'all passed' if not bad else 'FAILED: ' + ', '.join(bad))
    sys.exit(1 if bad else 0)

asyncio.run(main())
