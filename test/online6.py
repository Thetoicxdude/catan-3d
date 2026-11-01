# A Seafarers room online (scenario 1, Heading for New Shores; MAP=sea-2: The Four Islands): the host
# picks the scenario in the lobby,
# two players join and see the room's terms (14 points), the computer takes the last seat, and the
# campaign is played to its end. Checks that every page lays out the same board from the map and seed,
# that ships, the pirate and the island chits reach the players as the host has them, that hands stay
# right (gold fields included), and that the host's presence stays under the 4 KiB limit.
#   python3 test/online6.py           (ROOMS=ws: through the real room server, `npm run dev` first)
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
MAP = os.environ.get('MAP', 'sea-1')
LABEL, HEXES, VP = {'sea-1': ('駛向新海岸', 42, 14), 'sea-2': ('四座島嶼', 35, 13)}[MAP]
PRE = 'o6' if MAP == 'sea-1' else 'o6-' + MAP
INIT = """window.__mapFps = 0.12; window.__mockRoom = true; window.__perf = PERF; window.__keySlot = NAME; window.__noAssets = true;
localStorage.setItem('catan3d-settings-v1', JSON.stringify({speed:'turbo', follow:false, quality:'low', qualityPicked:true, name: NAME, color: COLOR, opponents: 3}));"""
if os.environ.get('ROOMS') == 'ws': INIT = INIT.replace('window.__mockRoom = true;', "window.__rooms = 'ws://127.0.0.1:8787/rooms/';")
CLIENT_STEP = """(async () => {
  const g = window.__game; if (!g || !g.client) return 'nogame';
  const ai = await import('/src/ai/ai.js'); const eng = await import('/src/engine/engine.js');
  const v = g.view(); const me = g.viewer;
  eng.ensureMap(v); // (these modules are loaded apart from the page's bundle: put the game's map in play for them too)
  if (v.pending && v.pending.type === 'gold' && v.pending.amounts[me]) window.__goldSeen = (window.__goldSeen || 0) + 1;
  if (v.phase === 'over') return 'over';
  if (g.net.busy()) return 'busy';
  if (!eng.actorsNow(v).includes(me)) return 'wait';
  window.__cmem = window.__cmem || {};
  const a = ai.aiAct(v, me, window.__cmem, Math.random);
  if (!a) return 'none';
  g.dispatch(a); return a.type;
})()"""
BOARD = """(async () => { const C = await import('/src/net/codec.js');
  const s = __game.state; return { map: s.map, hexes: s.board.hexes.length, hash: C.boardHash(s.board), rules: s.rules || null, target: s.targetVP }; })()"""
# what the sea looks like on a page: ships (owner per path), the pirate, island chits, each player's ships in stock
SEA = """(() => { const v = __game.view(); return { seq: v.seq, ships: v.ships, pirate: v.board.pirate, chits: v.players.map((p) => p.chits), stock: v.players.map((p) => p.pieces.ships), isles: v.players.map((p) => (p.isles || []).length), home: v.players.map((p) => (p.home || []).join('.')), longest: v.longestRoad || null }; })()"""
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
        async def page(name, color, perf):
            pg = await ctx.new_page()
            pg.set_default_timeout(180000)
            pg.set_default_navigation_timeout(180000)
            await pg.add_init_script(INIT.replace('NAME', json.dumps(name)).replace('COLOR', json.dumps(color)).replace('PERF', str(perf)))
            pg.on('console', lambda m: logs.append(f'[{name} {m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            pg.on('pageerror', lambda e: logs.append(f'[{name} pageerror] {e}'))
            await pg.goto('http://127.0.0.1:8765/dist/index.test.html')
            await pg.wait_for_selector('.menu-screen', timeout=90000)
            return pg
        # the host stays the host: the fastest device by a margin
        host = await page('主持王國', '#c8372d', 900)
        await host.click('[data-k="create"]')
        await host.wait_for_selector('.code-box b', timeout=30000)
        code = (await host.inner_text('.code-box b')).strip()
        await host.click(f'.room-layout .seg button:has-text("{LABEL}")')
        await host.wait_for_function("document.querySelector('.room-layout .seg button.on') && document.querySelector('.room-layout .seg button.on').textContent.includes(LABEL)".replace('LABEL', json.dumps(LABEL)), timeout=20000)
        await host.wait_for_function("document.querySelectorAll('.online-screen .seat-list .seat').length === 4", timeout=20000)
        lay = await host.inner_text('.room-layout')
        check('the host picks the scenario: four seats, no turn rule to pick', '航海家' in lay and '4 席' in lay and '配對回合' not in lay, lay.replace('\n', ' '))
        await host.screenshot(path=f'{SP}/{PRE}-host-lobby.png', timeout=120000)
        clients = []
        for name, color in [('小明聯邦', '#2f6fd0'), ('阿華公國', '#3f9a4a')]:
            c = await page(name, color, 100)
            await c.click('[data-k="join"]')
            await c.wait_for_selector('#join-code', timeout=30000)
            await c.fill('#join-code', code)
            await c.click('.join-row .btn')
            await c.wait_for_selector('.online-screen .status', timeout=30000)
            clients.append(c)
        for c in clients:
            await c.wait_for_function("document.querySelector('.room-terms') && document.querySelector('.room-terms').textContent.includes('航海家')", timeout=60000)
        terms = await clients[0].inner_text('.room-terms')
        check('players see the room\'s terms', LABEL in terms and '4 席' in terms and f'{VP} 分' in terms, terms)
        await clients[0].screenshot(path=f'{SP}/{PRE}-client-lobby.png', timeout=120000)
        for i in range(60):
            names = await host.inner_text('.online-screen .seat-list')
            if '小明聯邦' in names and '阿華公國' in names: break
            await host.wait_for_timeout(500)
        await host.click('.online-screen .modal-foot .btn.primary')
        await host.wait_for_function('window.__game && window.__game.state', timeout=120000)
        for c in clients: await c.wait_for_function('window.__game && window.__game.client', timeout=120000)
        hb = await host.evaluate(BOARD)
        cbs = [await c.evaluate(BOARD) for c in clients]
        check('the host plays the scenario', hb['map'] == MAP and hb['hexes'] == HEXES and (hb['rules'] or {}).get('seafarers') and hb['target'] == VP, json.dumps(hb))
        check('every player lays out the same board', all(cb['map'] == MAP and cb['hash'] == hb['hash'] and (cb['rules'] or {}).get('seafarers') for cb in cbs), json.dumps(cbs))
        # a shorter campaign for the test (the clients learn the target from the host)
        await host.evaluate('__game.state.targetVP = 10; window.__autoHuman = true; __game.schedule()')
        t0 = time.time(); steps = {}; checks = 0; mism = 0; seas = 0; sea_bad = 0; most = 0
        done = [False, False]
        while time.time() - t0 < float(os.environ.get('SECS', '1800')) and not all(done):
            for i, c in enumerate(clients):
                if done[i]: continue
                r = await c.evaluate(CLIENT_STEP)
                steps[r] = steps.get(r, 0) + 1
                if r == 'over': done[i] = True
            if steps.get('wait', 0) % 40 == 0:
                hs = await host.evaluate(SEA)
                for c in clients:
                    cmp = await c.evaluate('(() => { const v = __game.view(); return {seq: v.seq, res: v.players[__game.viewer].res, dev: v.players[__game.viewer].dev.length, seat: __game.viewer}; })()')
                    truth = await host.evaluate(f'(() => {{ const s = __game.state; return {{seq: s.seq, res: s.players[{cmp["seat"]}].res, dev: s.players[{cmp["seat"]}].dev.length}}; }})()')
                    if cmp['seq'] == truth['seq']:
                        checks += 1
                        if cmp['res'] != truth['res'] or cmp['dev'] != truth['dev']: mism += 1; print('MISMATCH', cmp, truth)
                    cs = await c.evaluate(SEA)
                    if cs['seq'] == hs['seq']:
                        seas += 1
                        most = max(most, sum(1 for x in hs['ships'] if x >= 0))
                        for k in ('ships', 'pirate', 'chits', 'stock', 'isles', 'home'):
                            if cs[k] != hs[k]: sea_bad += 1; print('SEA MISMATCH', k, cs[k], hs[k]); break
            if steps.get('wait', 0) % 400 == 1:
                await clients[0].screenshot(path=f'{SP}/{PRE}-client-play.png', timeout=120000)
            await clients[0].wait_for_timeout(100)
        hs = await host.evaluate('({phase: __game.state.phase, winner: __game.state.winner, turn: __game.state.turn, seq: __game.state.seq, pres: window.__presSize || 0, ships: __game.state.ships.filter((p) => p >= 0).length, pirate: __game.state.board.pirate})')
        cs = [await c.evaluate('({phase: __game.state.phase, winner: __game.state.winner, seq: __game.state.seq, gold: window.__goldSeen || 0, ships: __game.view().ships.filter((p) => p >= 0).length})') for c in clients]
        print('host', hs, 'clients', cs, 'steps', steps, 'hand checks', checks, 'mismatches', mism, 'sea checks', seas, 'sea mismatches', sea_bad, 'most ships', most, 'after %.0fs' % (time.time() - t0))
        check('the campaign reaches its end on every page', hs['phase'] == 'over' and all(c['phase'] == 'over' and c['winner'] == hs['winner'] for c in cs))
        check('hands stay right', checks > 0 and mism == 0, f'{checks} checks')
        check('the sea reaches the players as the host has it', seas > 0 and sea_bad == 0 and most > 0, f'{seas} checks, up to {most} ships')
        check('ships at sea on every page at the end', hs['ships'] > 0 and all(c['ships'] == hs['ships'] for c in cs), f"{hs['ships']} ships")
        check('the host presence stays under 4 KiB', 0 < hs['pres'] <= 3900, f"{hs['pres']} bytes")
        await clients[0].screenshot(path=f'{SP}/{PRE}-client-end.png', timeout=120000)
        errs = [l for l in logs if 'pageerror' in l or ' error]' in l]
        check('no page errors', not errs, '\n'.join(errs[:6]))
        for l in logs[:30]: print(l)
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
