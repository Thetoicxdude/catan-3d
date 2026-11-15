# The development mode online: the host picks the mode in the lobby (four seats on the 37-hex island),
# two players join with blueprints of their own and see the room's terms, the computer takes the last
# seat. Checks that every page lays out the same island, that each nation brings the blueprint its
# player chose at home (kept to the cards that player owns: the second one owns only a few), that the developments, buildings and wonders reach every page as the host has them,
# that a player answers the robber at their wonder from their own page (the defence dialog, a knight
# played), that hands stay right, and that the host's presence stays under the 4 KiB limit.
#   python3 test/online7.py           (ROOMS=ws: through the real room server, `npm run dev` first)
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
PRESETS = {
    'port': ['market', 'shipyard', 'guild', 'granary', 'post', 'camp', 'lighthouse'],
    'order': ['barracks', 'wall', 'mercenaries', 'adventurers', 'academy', 'press', 'greatWall'],
    'scholars': ['academy', 'press', 'barracks', 'adventurers', 'market', 'granary', 'library'],
}
FRONTIER = ['post', 'camp', 'market', 'aqueduct', 'wall', 'shipyard', 'royalRoad']
ALL = ['aqueduct', 'granary', 'market', 'shipyard', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press', 'gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library']
# (the second player owns a few cards only: of the Pioneers' blueprint they bring what they own)
FEW = ['granary', 'market', 'post', 'camp', 'wall']
FRONTIER_OWNED = [k for k in FRONTIER if k in FEW]
INIT = """window.__mapFps = 0.12; window.__mockRoom = true; window.__perf = PERF; window.__keySlot = NAME; window.__noAssets = true;
localStorage.setItem('catan3d-settings-v1', JSON.stringify({lang:'zh', speed:'turbo', follow:false, quality:'low', qualityPicked:true, name: NAME, color: COLOR, opponents: 3, bps: BPS, bpCur: 0}));
localStorage.setItem('catan3d-cards-v1', JSON.stringify({own: OWN}));"""
if os.environ.get('ROOMS') == 'ws': INIT = INIT.replace('window.__mockRoom = true;', "window.__rooms = 'ws://127.0.0.1:8787/rooms/';")
CLIENT_STEP = """(async () => {
  const g = window.__game; if (!g || !g.client) return 'nogame';
  const ai = await import('/src/ai/ai.js'); const eng = await import('/src/engine/engine.js');
  const v = g.view(); const me = g.viewer;
  eng.ensureMap(v);
  if (v.phase === 'over') return 'over';
  if (g.net.busy()) return 'busy';
  if (!eng.actorsNow(v).includes(me)) return 'wait';
  // (the defence is answered through its dialog, by the test)
  if (v.pending && v.pending.type === 'defend') return 'defend';
  window.__cmem = window.__cmem || {};
  const a = ai.aiAct(v, me, window.__cmem, Math.random);
  if (!a) return 'none';
  g.dispatch(a); return a.type;
})()"""
BOARD = """(async () => { const C = await import('/src/net/codec.js');
  const s = __game.state; return { map: s.map, hexes: s.board.hexes.length, hash: C.boardHash(s.board), develop: !!(s.rules && s.rules.develop), target: s.targetVP, bps: s.players.map((p) => p.bp) }; })()"""
# what the development mode looks like on a page
DEV = """(() => { const v = __game.view(); return { seq: v.seq, plots: JSON.stringify(v.plots), wonders: JSON.stringify(v.wonders), built: v.players.map((p) => JSON.stringify(p.built)), bought: v.players.map((p) => p.bought) }; })()"""
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1100, 'height': 700})
        logs = []
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        await ctx.route('**/*', route)
        async def page(name, color, perf, bp, own=ALL):
            pg = await ctx.new_page()
            pg.set_default_timeout(180000)
            pg.set_default_navigation_timeout(180000)
            bps = [bp, [], []]
            await pg.add_init_script(INIT.replace('NAME', json.dumps(name)).replace('COLOR', json.dumps(color)).replace('PERF', str(perf)).replace('BPS', json.dumps(bps)).replace('OWN', json.dumps(own)))
            pg.on('console', lambda m: logs.append(f'[{name} {m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            pg.on('pageerror', lambda e: logs.append(f'[{name} pageerror] {e}'))
            await pg.goto('http://127.0.0.1:8765/dist/index.test.html')
            await pg.wait_for_selector('.menu-screen', timeout=90000)
            return pg
        host = await page('主持王國', '#c8372d', 900, PRESETS['port'])
        await host.click('[data-k="create"]')
        await host.wait_for_selector('.code-box b', timeout=30000)
        code = (await host.inner_text('.code-box b')).strip()
        await host.click('.room-layout .modes button:has-text("發展模式")')
        await host.wait_for_function("document.querySelector('.room-layout .modes button.on') && document.querySelector('.room-layout .modes button.on').textContent.includes('發展模式')", timeout=20000)
        await host.wait_for_function("document.querySelectorAll('.online-screen .seat-list .seat').length === 4", timeout=20000)
        lay = await host.inner_text('.room-layout')
        check('the host picks the development mode: four seats, no map to pick', '藍圖' in lay and '4 席' in lay and '駛向新海岸' not in lay, lay.replace('\n', ' '))
        await host.screenshot(path=f'{SP}/o7-host-lobby.png', timeout=120000)
        clients = []
        for name, color, bp, own in [('小明聯邦', '#2f6fd0', PRESETS['order'], ALL), ('阿華公國', '#3f9a4a', FRONTIER, FEW)]:
            c = await page(name, color, 100, bp, own)
            await c.click('[data-k="join"]')
            await c.wait_for_selector('#join-code', timeout=30000)
            await c.fill('#join-code', code)
            await c.click('.join-row .btn')
            await c.wait_for_selector('.online-screen .status', timeout=30000)
            clients.append(c)
        for c in clients:
            await c.wait_for_function("document.querySelector('.room-terms') && document.querySelector('.room-terms').textContent.includes('發展模式')", timeout=60000)
        # the lobby shows each player the blueprint they bring (chosen at home: nothing to pick here)
        await clients[1].wait_for_selector('.room-deck .deck-line', timeout=60000)
        shown = await clients[1].evaluate("() => document.querySelectorAll('.room-deck .deck-line .dk-card:not(.empty)').length")
        picks = await clients[1].locator('.dk-pick').count()
        check('the lobby shows the blueprint brought, nothing to pick', shown == len(FRONTIER_OWNED) and picks == 0, (shown, picks))
        await clients[1].screenshot(path=f'{SP}/o7-client-lobby.png', timeout=120000)
        terms = await clients[0].inner_text('.room-terms')
        check('players see the room\'s terms', '發展模式' in terms and '4 席' in terms and '18 分' in terms, terms)
        for i in range(60):
            names = await host.inner_text('.online-screen .seat-list')
            if '小明聯邦' in names and '阿華公國' in names: break
            await host.wait_for_timeout(500)
        await host.click('.online-screen .modal-foot .btn.primary')
        await host.wait_for_function('window.__game && window.__game.state', timeout=120000)
        for c in clients: await c.wait_for_function('window.__game && window.__game.client', timeout=120000)
        hb = await host.evaluate(BOARD)
        cbs = [await c.evaluate(BOARD) for c in clients]
        seats = [await c.evaluate('__game.viewer') for c in clients]
        check('the host plays the development mode', hb['map'] == 'dev-4' and hb['hexes'] == 37 and hb['develop'] and hb['target'] == 18, json.dumps({k: hb[k] for k in ('map', 'hexes', 'develop', 'target')}))
        check('every player lays out the same island', all(cb['map'] == 'dev-4' and cb['hash'] == hb['hash'] and cb['develop'] for cb in cbs), json.dumps([cb['hash'] for cb in cbs]))
        ai_seat = [i for i in range(4) if i not in (0, seats[0], seats[1])][0]
        check('each player brings the blueprint they chose, of the cards they own', hb['bps'][0] == PRESETS['port'] and hb['bps'][seats[0]] == PRESETS['order'] and hb['bps'][seats[1]] == FRONTIER_OWNED and len(hb['bps'][ai_seat]) == 7, hb['bps'])
        check('every page knows the blueprints', all(cb['bps'] == hb['bps'] for cb in cbs))

        # the opening and a few rounds, players' pages acting for themselves
        await host.evaluate('window.__autoHuman = true; __game.schedule()')
        t0 = time.time(); steps = {}; checks = 0; mism = 0; devs = 0; dev_bad = 0
        while time.time() - t0 < float(os.environ.get('SECS', '420')):
            for c in clients:
                r = await c.evaluate(CLIENT_STEP)
                steps[r] = steps.get(r, 0) + 1
            if steps.get('wait', 0) % 30 == 0:
                hs = await host.evaluate(DEV)
                for c in clients:
                    cmp = await c.evaluate('(() => { const v = __game.view(); return {seq: v.seq, res: v.players[__game.viewer].res, dev: v.players[__game.viewer].dev.length, seat: __game.viewer}; })()')
                    truth = await host.evaluate(f'(() => {{ const s = __game.state; return {{seq: s.seq, res: s.players[{cmp["seat"]}].res, dev: s.players[{cmp["seat"]}].dev.length}}; }})()')
                    if cmp['seq'] == truth['seq']:
                        checks += 1
                        if cmp['res'] != truth['res'] or cmp['dev'] != truth['dev']: mism += 1; print('MISMATCH', cmp, truth)
                    cs = await c.evaluate(DEV)
                    if cs['seq'] == hs['seq']:
                        devs += 1
                        for k in ('plots', 'wonders', 'built', 'bought'):
                            if cs[k] != hs[k]: dev_bad += 1; print('DEV MISMATCH', k, cs[k], hs[k]); break
            if await host.evaluate("__game.state.phase === 'over' || __game.state.turn > 40"): break
            await clients[0].wait_for_timeout(100)
        st = await host.evaluate("(() => { const s = __game.state; return { turn: s.turn, phase: s.phase, plots: s.plots.filter(Boolean).length, built: s.players.map((p) => Object.keys(p.built).length), wonders: s.wonders.length, pres: window.__presSize || 0 }; })()")
        print('host', st, 'steps', steps, 'hand checks', checks, 'dev checks', devs)
        check('the campaign goes on with the players\' pages', st['turn'] > 12, st)
        check('hands stay right', checks > 0 and mism == 0, f'{checks} checks')
        check('developments, buildings and wonders reach the players as the host has them', devs > 0 and dev_bad == 0, f'{devs} checks')

        # the robber at a player's wonder: the player answers on their own page with a knight
        await host.evaluate('window.__autoHuman = false')
        seat = seats[0]
        setup = await host.evaluate("""(seat) => {
          const g = __game, s = g.state, G = __geo();
          if (s.phase === 'over') return -1;
          const deserts = s.board.hexes.map((h, i) => h.terrain === 'desert' ? i : -1).filter((i) => i >= 0);
          // the wonder on a desert of its own (any other wonder there is moved off for the test)
          const h = deserts[0];
          s.wonders = s.wonders.filter((w) => w.h !== h && w.p !== seat);
          s.wonders.push({ h, k: 'greatWall', p: seat, s: 2, t: 1, done: false });
          s.players[seat].dev.push({ type: 'knight', turn: 1 });
          const mover = [0, 1, 2, 3].find((q) => q !== seat && g.players[q].kind === 'ai') ?? 0;
          if (s.board.robber === h) s.board.robber = s.board.hexes.findIndex((x, i) => x.terrain !== 'desert');
          s.current = mover; s.rolled = true; s.trade = null; s.pending = { type: 'robber', reason: 'seven' };
          g.dispatch({ type: 'robber', p: mover, hex: h });
          return h; }""", seat)
        check('the robber comes to the player\'s wonder', setup >= 0, setup)
        c = clients[0]
        knights = await host.evaluate('(s) => __game.state.players[s].knights', seat)
        # (answered at once: the dialog answers by itself after 15 seconds)
        await c.wait_for_selector('.modal[data-kind="defend"] .btn.primary:not([disabled])', timeout=60000)
        # (the button's own click: three pages drawing the island with SwiftShader leave too few frames
        # for Playwright to see the dialog hold still before its 15 seconds are up)
        await c.evaluate('() => document.querySelector(\'.modal[data-kind="defend"] .btn.primary\').click()')
        ok = False
        for i in range(80):
            r = await host.evaluate('(s) => ({ pending: __game.state.pending && __game.state.pending.type, knights: __game.state.players[s].knights, wonder: __game.state.wonders.some((w) => w.p === s) })', seat)
            if r['pending'] != 'defend':
                ok = r['knights'] == knights + 1 and r['wonder']
                break
            await c.wait_for_timeout(250)
        check('the player\'s knight saves the wonder', ok, r)
        pres = await host.evaluate('window.__presSize || 0')
        check('the host presence stays under 4 KiB', 0 < pres <= 3900, f'{pres} bytes')
        errs = [l for l in logs if 'pageerror' in l or ' error]' in l]
        check('no page errors', not errs, '\n'.join(errs[:6]))
        for l in logs[:30]: print(l)
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
