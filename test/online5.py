# A 6-seat online room on the large island (paired turns): the host picks the island in the lobby, two
# players join and see the room's terms, the computer takes the other three seats, and the campaign is
# played to its end. Checks that every page lays out the same board from the map and seed (the board
# no longer travels in the presence), that hands stay right, that the host's presence stays under the
# 4 KiB limit, and that the second player's part of the turn reaches the players.
#   python3 test/online5.py           (ROOMS=ws: through the real room server, `npm run dev` first)
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
INIT = """window.__mapFps = 0.12; window.__mockRoom = true; window.__perf = PERF; window.__keySlot = NAME; window.__noAssets = true;
localStorage.setItem('catan3d-settings-v1', JSON.stringify({speed:'turbo', follow:false, quality:'low', qualityPicked:true, name: NAME, color: COLOR, opponents: 3}));"""
if os.environ.get('ROOMS') == 'ws': INIT = INIT.replace('window.__mockRoom = true;', "window.__rooms = 'ws://127.0.0.1:8787/rooms/';")
CLIENT_STEP = """(async () => {
  const g = window.__game; if (!g || !g.client) return 'nogame';
  const ai = await import('/src/ai/ai.js'); const eng = await import('/src/engine/engine.js');
  const v = g.view(); const me = g.viewer;
  eng.ensureMap(v); // (these modules are loaded apart from the page's bundle: put the game's map in play for them too)
  if (v.sub) window.__subSeen = (window.__subSeen || 0) + 1;
  if (v.phase === 'over') return 'over';
  if (g.net.busy()) return 'busy';
  if (!eng.actorsNow(v).includes(me)) return 'wait';
  window.__cmem = window.__cmem || {};
  const a = ai.aiAct(v, me, window.__cmem, Math.random);
  if (!a) return 'none';
  g.dispatch(a); return a.type;
})()"""
BOARD = """(async () => { const C = await import('/src/net/codec.js');
  const s = __game.state; return { map: s.map, hexes: s.board.hexes.length, hash: C.boardHash(s.board), rules: s.rules || null }; })()"""
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
        await host.click('.room-layout .seg button:has-text("大島嶼")')
        await host.wait_for_function("document.querySelectorAll('.online-screen .seat-list .seat').length === 6", timeout=20000)
        lay = await host.inner_text('.room-layout')
        check('the host picks the large island: six seats, paired turns', '配對回合' in lay and '6 席' in lay, lay.replace('\n', ' '))
        await host.screenshot(path=f'{SP}/o5-host-lobby.png', timeout=120000)
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
            await c.wait_for_function("document.querySelector('.room-terms') && document.querySelector('.room-terms').textContent.includes('大島嶼')", timeout=60000)
        terms = await clients[0].inner_text('.room-terms')
        check('players see the room\'s terms', '大島嶼' in terms and '6 席' in terms and '配對回合' in terms, terms)
        await clients[0].screenshot(path=f'{SP}/o5-client-lobby.png', timeout=120000)
        for i in range(60):
            names = await host.inner_text('.online-screen .seat-list')
            if '小明聯邦' in names and '阿華公國' in names: break
            await host.wait_for_timeout(500)
        await host.click('.online-screen .modal-foot .btn.primary')
        await host.wait_for_function('window.__game && window.__game.state', timeout=120000)
        for c in clients: await c.wait_for_function('window.__game && window.__game.client', timeout=120000)
        hb = await host.evaluate(BOARD)
        cbs = [await c.evaluate(BOARD) for c in clients]
        check('the host plays the large island', hb['map'] == 'base-6' and hb['hexes'] == 30 and hb['rules'] == {'turns': 'paired'}, json.dumps(hb))
        check('every player lays out the same board', all(cb['map'] == 'base-6' and cb['hash'] == hb['hash'] and cb['rules'] == hb['rules'] for cb in cbs), json.dumps(cbs))
        # a shorter campaign for the test (the clients learn the target from the host)
        await host.evaluate('__game.state.targetVP = 7; window.__autoHuman = true; __game.schedule()')
        t0 = time.time(); steps = {}; checks = 0; mism = 0
        done = [False, False]
        while time.time() - t0 < float(os.environ.get('SECS', '1500')) and not all(done):
            for i, c in enumerate(clients):
                if done[i]: continue
                r = await c.evaluate(CLIENT_STEP)
                steps[r] = steps.get(r, 0) + 1
                if r == 'over': done[i] = True
            if steps.get('wait', 0) % 50 == 0:
                for c in clients:
                    cmp = await c.evaluate('(() => { const v = __game.view(); return {seq: v.seq, res: v.players[__game.viewer].res, dev: v.players[__game.viewer].dev.length, seat: __game.viewer}; })()')
                    truth = await host.evaluate(f'(() => {{ const s = __game.state; return {{seq: s.seq, res: s.players[{cmp["seat"]}].res, dev: s.players[{cmp["seat"]}].dev.length}}; }})()')
                    if cmp['seq'] == truth['seq']:
                        checks += 1
                        if cmp['res'] != truth['res'] or cmp['dev'] != truth['dev']: mism += 1; print('MISMATCH', cmp, truth)
            if steps.get('wait', 0) % 400 == 1:
                await clients[0].screenshot(path=f'{SP}/o5-client-play.png', timeout=120000)
            await clients[0].wait_for_timeout(100)
        hs = await host.evaluate('({phase: __game.state.phase, winner: __game.state.winner, turn: __game.state.turn, seq: __game.state.seq, pres: window.__presSize || 0})')
        cs = [await c.evaluate('({phase: __game.state.phase, winner: __game.state.winner, seq: __game.state.seq, sub: window.__subSeen || 0})') for c in clients]
        print('host', hs, 'clients', cs, 'steps', steps, 'hand checks', checks, 'mismatches', mism, 'after %.0fs' % (time.time() - t0))
        check('the campaign reaches its end on every page', hs['phase'] == 'over' and all(c['phase'] == 'over' and c['winner'] == hs['winner'] for c in cs))
        check('hands stay right', checks > 0 and mism == 0, f'{checks} checks')
        check('the second player\'s part reaches the players', all(c['sub'] > 0 for c in cs))
        check('the host presence stays under 4 KiB', 0 < hs['pres'] <= 3900, f"{hs['pres']} bytes")
        await clients[0].screenshot(path=f'{SP}/o5-client-end.png', timeout=120000)
        errs = [l for l in logs if 'pageerror' in l or ' error]' in l]
        check('no page errors', not errs, '\n'.join(errs[:6]))
        for l in logs[:30]: print(l)
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
