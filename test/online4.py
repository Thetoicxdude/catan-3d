# Room rules in a three-player online campaign (mock room; ROOMS=ws for the real room server):
#  1. the room's creator hands the campaign to the fastest device once it starts
#  2. chat lines reach every page
#  3. the turn clock: nobody moves, the host finishes the opening placements when time runs out
#  4. the host's page dies: the next best page takes over and the campaign goes on
#  5. a player who leaves through the menu is replaced by the computer at once
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
INIT = """window.__mapFps = 0.15; window.__mockRoom = true; window.__noAssets = true;
window.__testHooks = true; window.__keySlot = SLOT; window.__perf = PERF; window.__turnMs = { setup: 7000, play: 12000 };
localStorage.setItem('catan3d-settings-v1', JSON.stringify({speed:'fast', follow:false, quality:'low', name: NAME, color: COLOR, opponents: 3}));"""
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
ROLE = "(() => { const g = window.__game; if (!g || g.destroyed) return 'none'; return g.client ? 'client' : (g.net ? 'host' : 'local'); })()"
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

async def wait_for(page, js, secs=60, step=500):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            if await page.evaluate(js): return True
        except Exception:
            pass
        await page.wait_for_timeout(step)
    return False

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1000, 'height': 640})
        logs = []
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        await ctx.route('**/*', route)
        async def page(tag, name, color, perf):
            pg = await ctx.new_page()
            pg.set_default_navigation_timeout(180000)
            pg.set_default_timeout(120000)
            await pg.add_init_script(INIT.replace('SLOT', json.dumps(tag)).replace('PERF', str(perf)).replace('NAME', json.dumps(name)).replace('COLOR', json.dumps(color)))
            pg.on('console', lambda m: logs.append(f'[{tag} {m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            pg.on('pageerror', lambda e: logs.append(f'[{tag} pageerror] {e}'))
            await pg.goto('http://127.0.0.1:8765/dist/index.test.html')
            await pg.wait_for_selector('.menu-screen', timeout=90000)
            return pg
        p1 = await page('p1', '甲王國', '#c8372d', 100)
        await p1.click('[data-k="create"]')
        await p1.wait_for_selector('.code-box b', timeout=30000)
        code = (await p1.inner_text('.code-box b')).strip()
        print('room', code)
        p2 = await page('p2', '乙聯邦', '#2f62b8', 300)
        p3 = await page('p3', '丙共和', '#3c8f4a', 200)
        for pg in (p2, p3):
            await pg.click('[data-k="join"]')
            await pg.wait_for_selector('#join-code', timeout=30000)
            await pg.fill('#join-code', code)
            await pg.click('.join-row .btn')
        ok = await wait_for(p1, "(() => { const t = document.querySelector('.online-screen .seat-list'); return t && t.textContent.includes('乙聯邦') && t.textContent.includes('丙共和'); })()", 60)
        check('lobby has both players', ok)
        await p1.click('.online-screen .modal-foot .btn.primary')
        # 1. the fastest device (p2) ends up hosting; the creator plays on as a player
        ok = await wait_for(p2, ROLE + " === 'host'", 90)
        r1 = await p1.evaluate(ROLE)
        r3 = await p3.evaluate(ROLE)
        check('fastest device hosts after the start', ok and r1 == 'client' and r3 == 'client', f'p1={r1} p2={await p2.evaluate(ROLE)} p3={r3}')
        seats = await p2.evaluate("__game.state.players.map((p) => p.name + ':' + p.kind)")
        print('host seats', seats)
        # every page shows the same campaign
        await p1.wait_for_timeout(2500)
        sq = [await pg.evaluate('__game.state.seq') for pg in (p1, p2, p3)]
        check('same campaign on every page', len(set(sq)) == 1, str(sq))
        log1 = await p1.inner_text('.log-body')
        check('handover noted in the battle log', '主持' in log1, log1[-120:].replace('\n', ' | '))
        # 2. chat
        await p3.click('.log-tabs [data-tab="chat"]')
        await p3.fill('.chat-form input', '大家好，我是丙')
        await p3.press('.chat-form input', 'Enter')
        got1 = await wait_for(p1, "document.querySelector('.chat-list') && document.querySelector('.chat-list').textContent.includes('大家好，我是丙')", 20)
        got2 = await wait_for(p2, "document.querySelector('.chat-list') && document.querySelector('.chat-list').textContent.includes('大家好，我是丙')", 20)
        dot = await p1.evaluate("!document.querySelector('.log-tabs [data-tab=\"chat\"] .dot').hidden")
        check('chat reaches the other pages', got1 and got2, f'unread dot on p1: {dot}')
        await p2.click('.log-tabs [data-tab="chat"]')
        await p2.fill('.chat-form input', '收到，主持人在此')
        await p2.press('.chat-form input', 'Enter')
        got = await wait_for(p3, "document.querySelector('.chat-list').textContent.includes('收到，主持人在此')", 20)
        names = await p3.inner_text('.chat-list')
        check('host chat reaches players, with names', got and '乙聯邦' in names, names.replace('\n', ' | '))
        await p3.screenshot(path=f'{SP}/on4-chat.png')
        # 3. the clock: nobody moves; the opening placements are finished when time runs out
        clock = await p1.evaluate("(() => { const c = document.querySelector('.turn-clock'); return c && !c.hidden ? c.textContent.trim() : null; })()")
        check('turn clock shown to players', bool(clock), str(clock))
        i0 = await p2.evaluate('__game.state.setup ? __game.state.setup.i : -1')
        await p2.wait_for_timeout(26000)
        i1 = await p2.evaluate('__game.state.setup ? __game.state.setup.i : -1')
        ph = await p2.evaluate('__game.state.phase')
        tlog = await p2.inner_text('.log-body')
        check('time-outs move the opening along', i1 >= i0 + 2 or ph == 'play', f'setup.i {i0} -> {i1}, phase {ph}; "時間到" in log: {"時間到" in tlog}')
        await p1.screenshot(path=f'{SP}/on4-clock.png')
        # 4. the host's page dies (no goodbye): the next best page (p3) takes over
        seq_before = await p2.evaluate('__game.state.seq')
        await p2.evaluate("(() => { const s = window.__sess(); if (s) { s.handoverNow = () => {}; } })()")
        await p2.close()
        t0 = time.time()
        ok = await wait_for(p3, ROLE + " === 'host'", 60)
        took = time.time() - t0
        r1 = await p1.evaluate(ROLE)
        check('next best page takes over when the host dies', ok and r1 == 'client', f'after {took:.1f}s, p1={r1}')
        seq3 = await p3.evaluate('__game.state.seq')
        check('takeover starts from the last state', seq3 >= seq_before - 2, f'host had {seq_before}, new host {seq3}')
        await p3.evaluate('window.__autoHuman = true; __game.schedule()')
        # p1 plays its own moves for a while; the campaign goes on under the new host
        steps = {}
        t0 = time.time()
        while time.time() - t0 < 45:
            r = await p1.evaluate(CLIENT_STEP)
            steps[r] = steps.get(r, 0) + 1
            await p1.wait_for_timeout(250)
        seq_after = await p3.evaluate('__game.state.seq')
        c1 = await p1.evaluate('({seq: __game.state.seq, res: __game.view().players[__game.viewer].res, seat: __game.viewer})')
        truth = await p3.evaluate(f"(() => {{ const s = __game.state; return {{seq: s.seq, res: s.players[{c1['seat']}].res}}; }})()")
        check('campaign goes on after the takeover', seq_after > seq3 + 5, f'seq {seq3} -> {seq_after}; p1 steps {steps}')
        check('player hand matches the new host', c1['seq'] != truth['seq'] or c1['res'] == truth['res'], f'{c1} vs {truth}')
        # 5. p1 leaves through the menu: the computer takes its nation at once
        seat1 = c1['seat']
        await p1.click('.topbar [data-k="menu"]')
        await p1.wait_for_selector('.modal .btn.primary', timeout=20000)
        await p1.click('.modal .btn.primary')
        ok = await wait_for(p3, f"__game.state.players[{seat1}].kind === 'ai'", 15)
        check('a leaving player is replaced by the computer at once', ok, await p3.evaluate(f"__game.state.players.map((p) => p.name + ':' + p.kind).join(' ')"))
        await p3.screenshot(path=f'{SP}/on4-end.png')
        print('max host presence bytes', await p3.evaluate('window.__presSize'))
        for l in logs[:30]: print(l)
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
asyncio.run(main())
