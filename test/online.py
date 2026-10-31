# Two browser pages play a full online campaign through the mock room (host + one remote player).
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')  # screenshots
os.makedirs(SP, exist_ok=True)
INIT = """window.__mapFps = 0.15; window.__mockRoom = true; window.__perf = 100; window.__keySlot = NAME;
localStorage.setItem('catan3d-settings-v1', JSON.stringify({speed:'turbo', follow:false, quality:'low', name: NAME, color: COLOR, opponents: 3}));"""
# ROOMS=ws: play over the real room server (`npx wrangler dev --port 8787`) instead of the in-browser mock
if os.environ.get('ROOMS') == 'ws': INIT = INIT.replace('window.__mockRoom = true;', "window.__rooms = 'ws://127.0.0.1:8787/rooms/';")
CLIENT_STEP = """(async () => {
  const g = window.__game; if (!g || !g.client) return 'nogame';
  const ai = await import('/src/ai/ai.js'); const eng = await import('/src/engine/engine.js');
  const v = g.view(); const me = g.viewer;
  if (v.phase === 'over') return 'over';
  if (g.net.busy()) return 'busy';
  if (!eng.actorsNow(v).includes(me)) return 'wait';
  window.__cmem = window.__cmem || {};
  const a = ai.aiAct(v, me, window.__cmem, Math.random);
  if (!a) return 'none';
  g.dispatch(a); return a.type;
})()"""
async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1100, 'height': 700})
        logs = []
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u:
                await r.fulfill(status=200, body=THREE, headers={'content-type':'application/javascript'})
            elif 'fonts.g' in u:
                await r.fulfill(status=200, body='', headers={'content-type':'text/css'})
            else:
                await r.continue_()
        await ctx.route('**/*', route)
        host = await ctx.new_page()
        host.set_default_navigation_timeout(180000)  # the other pages keep this software-rendered browser busy
        if not os.environ.get('ASSETS'): await host.add_init_script('window.__noAssets = true;')  # UI-flow test: skip the asset pack
        await host.add_init_script(INIT.replace('NAME', '"主持王國"').replace('COLOR', '"#c8372d"'))
        host.on('console', lambda m: logs.append(f'[host {m.type}] {m.text}') if m.type in ('error','warning') else None)
        host.on('pageerror', lambda e: logs.append(f'[host pageerror] {e}'))
        await host.goto('http://127.0.0.1:8765/dist/index.test.html')
        await host.wait_for_selector('.menu-screen', timeout=60000)
        await host.click('[data-k="create"]')
        await host.wait_for_selector('.code-box b', timeout=20000)
        code = (await host.inner_text('.code-box b')).strip()
        print('room code', code)
        await host.screenshot(path=f'{SP}/on-host-lobby.png', timeout=120000)
        client = await ctx.new_page()
        client.set_default_navigation_timeout(180000)  # the other pages keep this software-rendered browser busy
        if not os.environ.get('ASSETS'): await client.add_init_script('window.__noAssets = true;')  # UI-flow test: skip the asset pack
        await client.add_init_script(INIT.replace('NAME', '"小明聯邦"').replace('COLOR', '"#c8372d"'))
        client.on('console', lambda m: logs.append(f'[client {m.type}] {m.text}') if m.type in ('error','warning') else None)
        client.on('pageerror', lambda e: logs.append(f'[client pageerror] {e}'))
        await client.goto('http://127.0.0.1:8765/dist/index.test.html')
        await client.wait_for_selector('.menu-screen', timeout=60000)
        await client.click('[data-k="join"]')
        await client.wait_for_selector('#join-code', timeout=20000)
        await client.fill('#join-code', code)
        await client.click('.join-row .btn')
        await client.wait_for_selector('.online-screen .status', timeout=20000)
        # host sees the player
        for i in range(40):
            names = await host.inner_text('.online-screen .seat-list')
            if '小明聯邦' in names: break
            await host.wait_for_timeout(500)
        print('host sees client:', '小明聯邦' in names)
        print('client status:', await client.inner_text('.online-screen .status'))
        await host.screenshot(path=f'{SP}/on-host-lobby2.png', timeout=120000)
        await host.click('.online-screen .modal-foot .btn.primary')
        await host.wait_for_function('window.__game && window.__game.state', timeout=60000)
        await client.wait_for_function('window.__game && window.__game.client', timeout=60000)
        print('both in game; client seat', await client.evaluate('__game.viewer'))
        await host.evaluate('window.__autoHuman = true; __game.schedule()')
        t0 = time.time(); steps = {}; checks = 0; mism = 0
        while time.time() - t0 < float(os.environ.get('SECS', '300')):
            r = await client.evaluate(CLIENT_STEP)
            steps[r] = steps.get(r, 0) + 1
            if r == 'over': break
            if steps.get('wait', 0) % 40 == 0:
                # compare the client's own hand with the host's truth
                cmp = await client.evaluate('(() => { const v = __game.view(); return {seq: v.seq, res: v.players[__game.viewer].res, dev: v.players[__game.viewer].dev.length, seat: __game.viewer}; })()')
                truth = await host.evaluate(f'(() => {{ const s = __game.state; return {{seq: s.seq, res: s.players[{cmp["seat"]}].res, dev: s.players[{cmp["seat"]}].dev.length}}; }})()')
                if cmp['seq'] == truth['seq']:
                    checks += 1
                    if cmp['res'] != truth['res'] or cmp['dev'] != truth['dev']: mism += 1; print('MISMATCH', cmp, truth)
            await client.wait_for_timeout(120)
        hs = await host.evaluate('({phase: __game.state.phase, winner: __game.state.winner, turn: __game.state.turn, seq: __game.state.seq})')
        cs = await client.evaluate('({phase: __game.state.phase, winner: __game.state.winner, turn: __game.state.turn, seq: __game.state.seq})')
        print('host', hs, 'client', cs)
        print('client steps', steps, 'hand checks', checks, 'mismatches', mism)
        await client.screenshot(path=f'{SP}/on-client-end.png', timeout=120000)
        for l in logs[:40]: print(l)
        await b.close()
    srv.shutdown()
asyncio.run(main())
