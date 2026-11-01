# Seafarers on the page (scenario 1, Heading for New Shores; MAP=sea-2: scenario 2, The Four Islands):
# the setup screen, the islands, the pirate and the gold fields on the 3D map, an opening ship placed
# through the interface, building a ship and moving one with the action bar, the gold field's dialog,
# carrying the campaign on after a reload, and a campaign the computer plays to its end.
#   python3 test/ui6.py            MAP=sea-2 python3 test/ui6.py
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
MAP = os.environ.get('MAP', 'sea-1')
VP, TOKENS = {'sea-1': (14, 26), 'sea-2': (13, 22)}[MAP]
PRE = 'ui6' if MAP == 'sea-1' else 'ui6-' + MAP
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

CHECK = r"""() => {
  const layer = document.querySelector('.map-labels');
  const host = layer.getBoundingClientRect();
  const out = { shown: 0, tokens: 0, bad: [] };
  for (const box of layer.children) {
    if (getComputedStyle(box).display === 'none') continue;
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(box.style.transform || '');
    if (!m) continue;
    const el = box.classList.contains('float') ? box : box.firstElementChild || box;
    out.shown++;
    if (el.classList.contains('token')) out.tokens++;
    if (box.offsetLeft !== 0 || box.offsetTop !== 0) out.bad.push(`${el.className} offset`);
    if (el.classList.contains('drop')) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - host.left - +m[1];
    const dy = r.top + r.height / 2 - host.top - +m[2];
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) out.bad.push(`${el.className} off by ${dx.toFixed(0)},${dy.toFixed(0)}`);
  }
  return out;
}"""
# helpers that use the page's own bundle through the game object
SEA = """(() => { const g = __game, v = g.view(); return { phase: v.phase, ships: v.ships ? v.ships.filter((p) => p >= 0).length : -1, mine: v.ships ? v.ships.filter((p) => p === 0).length : -1, pirate: v.board.pirate, target: v.targetVP, map: v.map, chits: v.players.map((p) => p.chits) }; })()"""

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        await page.add_init_script("window.__noAssets = true; window.__mapFps = 0.5; localStorage.setItem('catan3d-settings-v1', JSON.stringify({ speed: 'turbo', quality: 'low', qualityPicked: true }));")
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        await page.route('**/*', route)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen', timeout=90000)
        await page.click('[data-k="single"]')
        await page.click(f'[data-map="{MAP}"]')
        await page.wait_for_timeout(800)
        card = await page.inner_text('.setup-card')
        check('the scenario on the setup screen', '航海家' in card and f'{VP} 分（劇本規定）' in card and '3 國（4 人局）' in card, card.replace('\n', ' ')[:160])
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{SP}/{PRE}-setup.png')
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=120000)
        st = await page.evaluate(SEA)
        check('a Seafarers campaign', st['map'] == MAP and st['ships'] == 0 and st['target'] == VP and st['pirate'] >= 0, json.dumps(st))
        await page.wait_for_timeout(3000)
        lab = await page.evaluate(CHECK)
        check('number tokens in place on the islands', not lab['bad'] and lab['tokens'] >= TOKENS, f"{lab['tokens']} tokens, bad {lab['bad'][:3]}")
        await page.screenshot(path=f'{SP}/{PRE}-start.png')
        # the first opening placement is ours (first player 0?): put the settlement on the coast by hand
        await page.wait_for_function("__game.state.phase === 'setup' && __game.state.setup.order[__game.state.setup.i] === 0 && __game.state.setup.step === 'settlement'", timeout=300000, polling=300)
        # (geometry and the sea analysis from the source modules: the same map, built again)
        spot = await page.evaluate("""(async () => {
          const G = await import('/src/engine/geometry.js'); const S = await import('/src/engine/seafarers.js');
          G.useMap('MAP');
          const g = __game, v = g.view(); const sea = S.seaInfo(v.board, G.GEO);
          const ids = g.map.interaction.ids;
          const id = ids.find((x) => sea.coast[x] && G.GEO.vertices[x].edges.some((e) => sea.eLand[e] === 0)) ?? ids.find((x) => sea.coast[x]) ?? ids[0];
          g.dispatch({ type: 'settlement', p: 0, vertex: id });
          return id; })()""".replace("'MAP'", json.dumps(MAP)))
        await page.wait_for_timeout(600)
        banner = await page.inner_text('.banner')
        has_ship = '改放船' in banner
        print('opening settlement at', spot, '| banner:', banner.replace('\n', ' '))
        if has_ship:
            await page.click('.banner .btn:has-text("改放船")')
            await page.wait_for_timeout(400)
            e = await page.evaluate("__game.map.interaction.ghost === 'ship' ? __game.map.interaction.ids[0] : -1")
            await page.evaluate(f"__game.map.interaction.onPick({e})")
            await page.wait_for_timeout(400)
            ok = await page.evaluate(f"__game.state.ships[{e}] === 0")
            check('an opening ship through the interface', ok, f'edge {e}')
        else:
            await page.evaluate("__game.map.interaction.onPick(__game.map.interaction.ids[0])")
            print('(that spot was inland: placed a road)')
        # the computer plays every seat from here; hold at our first turn with ships around
        await page.evaluate('window.__autoHuman = true; __game.state.targetVP = 10; __game.schedule()')
        await page.evaluate("""(() => { const g = __game; const orig = g.dispatch.bind(g);
          g.dispatch = (a, o) => { const r = orig(a, o); const s = g.state;
            if (!window.__held && s.phase === 'play' && s.turn >= 12 && s.current === 0 && s.rolled && !s.pending && !s.trade) { window.__held = true; g.frozen = true; clearTimeout(g.timer); g.timer = null; }
            return r; }; })()""")
        await page.wait_for_function('window.__held === true', timeout=900000, polling=500)
        # our seat waits for us again (no computer plays it); the game is ours to drive
        await page.evaluate('window.__autoHuman = false; __game.frozen = false; clearTimeout(__game.timer); __game.timer = null; __game.refresh()')
        st = await page.evaluate(SEA)
        print('held at our turn', json.dumps(st))
        await page.screenshot(path=f'{SP}/{PRE}-mid.png')
        # build a ship from the action bar
        await page.evaluate("Object.assign(__game.state.players[0].res, { wood: 3, wool: 3 }); __game.refresh()")
        await page.wait_for_timeout(300)
        shipBtn = await page.evaluate("(() => { const b = __game.hud.btns.ship; return { hidden: b.hidden, off: b.classList.contains('off'), why: b.dataset.why }; })()")
        if not shipBtn['off']:
            await page.click('.act:has-text("船") >> nth=0')
            await page.wait_for_timeout(400)
            e = await page.evaluate("__game.map.interaction && __game.map.interaction.ghost === 'ship' ? __game.map.interaction.ids[0] : -1")
            before = await page.evaluate('__game.state.players[0].pieces.ships')
            await page.evaluate(f"__game.map.interaction.onPick({e})")
            await page.wait_for_timeout(400)
            after = await page.evaluate('__game.state.players[0].pieces.ships')
            check('a ship built from the action bar', e >= 0 and after == before - 1, f'edge {e}, ships left {before} → {after}')
        else:
            check('the ship button explains why it is off', not shipBtn['hidden'] and shipBtn['why'], shipBtn['why'])
        # move a ship if one may move (the one just built counts as an old one here: a ship built this turn stays)
        await page.evaluate("__game.state.newShips = []; __game.refresh()")
        await page.wait_for_timeout(300)
        mv = await page.evaluate("(() => { const b = __game.hud.btns.moveShip; return { off: b.classList.contains('off'), why: b.dataset.why }; })()")
        print('move-ship button', mv)
        if not mv['off']:
            await page.click('.act:has-text("移船")')
            await page.wait_for_timeout(300)
            frm = await page.evaluate('__game.map.interaction.ids[0]')
            await page.evaluate(f'__game.map.interaction.onPick({frm})')
            await page.wait_for_timeout(300)
            to = await page.evaluate("__game.map.interaction.ghost === 'ship' ? __game.map.interaction.ids[0] : -1")
            await page.evaluate(f'__game.map.interaction.onPick({to})')
            await page.wait_for_timeout(400)
            ok = await page.evaluate(f'__game.state.ships[{to}] === 0 && __game.state.ships[{frm}] === -1 && __game.state.shipMoved')
            check('a ship moved from the action bar', ok, f'{frm} → {to}')
        # the gold field's dialog
        await page.evaluate("__game.state.pending = { type: 'gold', amounts: { 0: 2 } }; __game.refresh()")
        await page.wait_for_selector('.modal .res-grid', timeout=20000)
        await page.wait_for_timeout(900)
        await page.screenshot(path=f'{SP}/{PRE}-gold.png')
        res_before = await page.evaluate('({...__game.state.players[0].res})')
        await page.click('.modal .res-pick:nth-child(5) .stepper button:last-child')
        await page.click('.modal .res-pick:nth-child(5) .stepper button:last-child')
        await page.click('.modal .modal-foot .btn.primary')
        await page.wait_for_timeout(500)
        res_after = await page.evaluate('({...__game.state.players[0].res})')
        check('the gold dialog gives the picked resources', res_after['ore'] == res_before['ore'] + 2 and await page.evaluate('__game.state.pending === null'), f"{res_before['ore']} → {res_after['ore']}")
        # the campaign survives a reload: continue it from the home screen
        before = await page.evaluate(SEA)
        await page.reload()
        await page.wait_for_selector('.menu-screen', timeout=90000)
        await page.wait_for_timeout(1500)
        await page.click('text=繼續上一局')
        await page.wait_for_function('window.__game && window.__game.state', timeout=120000)
        # (the camera flies to our first settlement; the test page draws a frame every two seconds: skip the flight)
        await page.wait_for_timeout(800)
        await page.evaluate('(() => { const c = __game.map.camera; c.target.copy(c.goal); c.h = c.goalH; c.yaw = c.goalYaw; c.pitch = c.goalPitch; c.apply(); })()')
        await page.wait_for_timeout(4500)
        after = await page.evaluate(SEA)
        lab = await page.evaluate(CHECK)
        check('the campaign continues after a reload', after['map'] == MAP and after['ships'] == before['ships'] and after['pirate'] == before['pirate'] and after['target'] == before['target'] and not lab['bad'] and lab['tokens'] >= 6, f"{json.dumps(before)} → {json.dumps(after)}, {lab['tokens']} tokens")
        await page.screenshot(path=f'{SP}/{PRE}-continued.png')
        # on to the end
        await page.evaluate('window.__autoHuman = true; __game.frozen = false; __game.schedule()')
        t0 = time.time()
        await page.wait_for_function("__game.state.phase === 'over'", timeout=1500000, polling=1000)
        st = await page.evaluate(SEA)
        print('campaign over after %.0fs' % (time.time() - t0), json.dumps(st), 'turn', await page.evaluate('__game.state.turn'))
        check('ships at sea by the end', st['ships'] > 0)
        await page.wait_for_timeout(1500)
        await page.evaluate('__game.dialogs.close(true)')
        # the whole map again (the campaign was carried on close to our first settlement)
        await page.evaluate('(() => { const m = __game.map, c = m.camera; m.frameLand(__game.hud.freeRect(), c.fitIsland(1.12)); c.target.copy(c.goal); c.h = c.goalH; c.apply(); })()')
        await page.wait_for_timeout(4500)
        await page.screenshot(path=f'{SP}/{PRE}-final.png')
        # zoomed out: the paper map
        await page.evaluate('__game.map.camera.goalH = __game.map.camera.zoomMax(); __game.map.camera.h = __game.map.camera.goalH')
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{SP}/{PRE}-far.png')
        errs = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
