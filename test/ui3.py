# Drives the human seat through real clicks: setup placement, roll, build, bank trade, dev card, robber, discard, offers.
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')  # screenshots
os.makedirs(SP, exist_ok=True)
JS_HELPERS = """(() => {
window.__snap = () => { const c = __game.map.camera; c.target.copy(c.goal); c.h = c.goalH; c.apply(); };
window.__scr = (kind, id) => {
  __snap();
  const m = __game.map; let p;
  if (kind === 'v') p = m.pieces.vertexPos(id);
  else if (kind === 'e') p = m.pieces.edgeMid(id);
  else { const h = window.__GEO.hexes[id]; p = m.pieces.vertexPos(0); p.set(h.x, m.terrain.heightAt(h.x, h.z), h.z); }
  p.project(m.camera.cam);
  const r = m.canvas.getBoundingClientRect();
  return { x: (p.x * 0.5 + 0.5) * r.width + r.left, y: (-p.y * 0.5 + 0.5) * r.height + r.top };
};
return 1; })()"""
async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        page = await ctx.new_page()
        if not os.environ.get('ASSETS'): await page.add_init_script('window.__noAssets = true;')  # UI-flow test: skip the asset pack
        await page.add_init_script("window.__mapFps = 0.12; localStorage.setItem('catan3d-settings-v1', JSON.stringify({speed:'turbo', follow:false, quality:'low'}));")
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u:
                await r.fulfill(status=200, body=THREE, headers={'content-type':'application/javascript'})
            elif 'fonts.g' in u:
                await r.fulfill(status=200, body='', headers={'content-type':'text/css'})
            else:
                await r.continue_()
        await page.route('**/*', route)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen', timeout=60000)
        await page.click('[data-k="single"]')
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=60000)
        await page.evaluate(JS_HELPERS)
        await page.evaluate("import('/src/engine/geometry.js').then(m => window.__GEO = m.GEO)")
        await page.wait_for_function('window.__GEO', timeout=10000)
        G = lambda js: page.evaluate(js)
        async def wait_human(cond='true', timeout=60):
            t0 = time.time()
            while time.time() - t0 < timeout:
                ok = await G(f"(() => {{ const s=__game.state; const a = (s.phase==='setup' ? [s.setup.order[s.setup.i]] : null); return {cond}; }})()")
                if ok: return True
                await page.wait_for_timeout(250)
            return False
        # ---- setup: place settlement + road by clicking ----
        for rnd in range(2):
            assert await wait_human("s.phase==='setup' && s.setup.order[s.setup.i]===0 && s.setup.step==='settlement'"), 'no setup turn'
            await page.wait_for_timeout(400)
            v = await G("(() => { const ids = __game.map.interaction.ids; return ids[Math.floor(ids.length/2)]; })()")
            await G("__game.map.focus(0,5,128)"); await G("__snap()")
            pos = await G(f"__scr('v', {v})")
            await page.mouse.move(pos['x'], pos['y']); await page.wait_for_timeout(300)
            await page.mouse.click(pos['x'], pos['y'])
            await page.wait_for_timeout(500)
            placed = await G(f"!!__game.state.vertices[{v}]")
            print('setup settlement click', v, placed)
            if not placed:
                await page.screenshot(path=f'{SP}/ui3-fail.png', timeout=120000); break
            e = await G("__game.map.interaction.ids[0]")
            pos = await G(f"__scr('e', {e})")
            await page.mouse.click(pos['x'], pos['y'])
            await page.wait_for_timeout(500)
            print('setup road click', e, await G(f"__game.state.edges[{e}] === 0"))
        # ---- wait for my first turn ----
        assert await wait_human("s.phase==='play' && s.current===0 && !s.rolled", 120), 'no play turn'
        await page.screenshot(path=f'{SP}/ui3-myturn.png', timeout=120000)
        await page.click('.act:has-text("擲骰")')
        await page.wait_for_timeout(800)
        st = await G("({rolled: __game.state.rolled, dice: __game.state.dice, pending: __game.state.pending})")
        print('rolled', st)
        # resolve a seven if it happened
        if st['pending'] and st['pending']['type'] == 'robber':
            # the dice stay on screen for a moment before the robber move is offered
            await page.wait_for_function("__game.map.interaction && __game.map.interaction.ids.length > 3", timeout=20000)
            hx = await G("__game.map.interaction.ids[3]")
            pos = await G(f"__scr('h', {hx})")
            await page.mouse.click(pos['x'], pos['y']); await page.wait_for_timeout(600)
            if await G("__game.state.pending && __game.state.pending.type==='steal'"):
                await page.click('.modal .btn.primary'); await page.wait_for_timeout(400)
        # give resources and build a road via button + click
        await G("(() => { const r = __game.state.players[0].res; Object.assign(r, {wood:6, brick:6, wool:4, grain:5, ore:6}); __game.state.bank.wood -= 6; __game.state.bank.brick -= 6; __game.state.bank.wool -= 4; __game.state.bank.grain -= 5; __game.state.bank.ore -= 6; __game.refresh(); })()")
        await page.keyboard.press('1'); await page.wait_for_timeout(500)
        e = await G("__game.map.interaction && __game.map.interaction.ids[0]")
        pos = await G(f"__scr('e', {e})")
        await page.mouse.move(pos['x'], pos['y']); await page.wait_for_timeout(300)
        await page.mouse.click(pos['x'], pos['y']); await page.wait_for_timeout(600)
        print('built road via click', await G(f"__game.state.edges[{e}] === 0"))
        # city via button
        await page.click('.act:has-text("城市")'); await page.wait_for_timeout(500)
        v = await G("__game.map.interaction.ids[0]")
        pos = await G(f"__scr('v', {v})")
        await page.mouse.move(pos['x'], pos['y']); await page.wait_for_timeout(300)
        await page.mouse.click(pos['x'], pos['y']); await page.wait_for_timeout(600)
        print('city', await G(f"__game.state.vertices[{v}]"))
        await page.screenshot(path=f'{SP}/ui3-built.png', timeout=120000)
        # bank trade
        await page.click('.act:has-text("交易")'); await page.wait_for_timeout(500)
        await page.screenshot(path=f'{SP}/ui3-trade.png', timeout=120000)
        picks = await page.query_selector_all('.modal .res-grid')
        g1 = await picks[0].query_selector_all('.res-pick'); g2 = await picks[1].query_selector_all('.res-pick')
        await g1[0].click(); await page.wait_for_timeout(200)
        picks = await page.query_selector_all('.modal .res-grid'); g2 = await picks[1].query_selector_all('.res-pick')
        await g2[4].click(); await page.wait_for_timeout(200)
        before = await G("__game.state.players[0].res.ore")
        await page.click('.modal .menu-actions .btn.primary'); await page.wait_for_timeout(400)
        print('bank trade ore', before, '->', await G("__game.state.players[0].res.ore"))
        # player offer
        await page.click('.tabs button:has-text("與其他國家交易")'); await page.wait_for_timeout(300)
        steppers = await page.query_selector_all('.modal .res-grid .stepper')
        plus_give = await steppers[2].query_selector_all('button'); await plus_give[1].click(); await page.wait_for_timeout(150)
        steppers = await page.query_selector_all('.modal .res-grid .stepper')
        plus_get = await steppers[5 + 1].query_selector_all('button'); await plus_get[1].click(); await page.wait_for_timeout(150)
        await page.click('.modal .menu-actions .btn.primary'); await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{SP}/ui3-offer.png', timeout=120000)
        tr = await G("__game.state.trade")
        print('offer', json.dumps(tr))
        if tr:
            yes = [k for k, v in tr['resp'].items() if v == 'yes']
            if yes:
                await page.click('.modal .resp .btn.primary'); await page.wait_for_timeout(400)
                print('traded; trade now', await G("__game.state.trade"))
            else:
                await page.click('.modal .menu-actions .btn'); await page.wait_for_timeout(300)
                print('cancelled; trade now', await G("__game.state.trade"))
        await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
        # dev card: inject a knight bought last turn, play it, move robber by click
        await G("__game.state.players[0].dev.push({type:'knight', turn: 0}); __game.state.devDeck.pop(); __game.refresh()")
        await page.click('.act:has-text("手中卡牌")'); await page.wait_for_timeout(400)
        await page.screenshot(path=f'{SP}/ui3-dev.png', timeout=120000)
        await page.click('.dev-card .btn.primary'); await page.wait_for_timeout(500)
        print('pending after knight', await G("__game.state.pending"))
        hx = await G("__game.map.interaction.ids[5]")
        await G("__game.map.focus(0,5,128)")
        pos = await G(f"__scr('h', {hx})")
        await page.mouse.move(pos['x'], pos['y']); await page.wait_for_timeout(300)
        await page.mouse.click(pos['x'], pos['y']); await page.wait_for_timeout(700)
        print('robber now', await G("__game.state.board.robber"), 'target', hx, 'pending', await G("__game.state.pending"))
        if await G("__game.state.pending && __game.state.pending.type==='steal'"):
            await page.click('.modal .btn.primary'); await page.wait_for_timeout(400)
        await page.click('.act:has-text("結束回合")'); await page.wait_for_timeout(600)
        print('turn passed', await G("__game.state.current"))
        # force discard: give me 10 cards and make the next roller roll a seven
        await G("""(() => { const s=__game.state; const r=s.players[0].res; const add={wood:2,brick:2,wool:2,grain:2,ore:2}; for (const k in add){ r[k]+=add[k]; s.bank[k]-=add[k]; } })()""")
        ok = await wait_human("__game.dialogs.kind==='discard' || (s.current===0)", 90)
        print('discard or my turn', await G("__game.dialogs.kind"), await G("__game.state.pending"))
        if await G("__game.dialogs.kind==='discard'"):
            await page.screenshot(path=f'{SP}/ui3-discard.png', timeout=120000)
            await page.click('.modal .modal-foot .btn:has-text("自動挑選")'); await page.wait_for_timeout(200)
            await page.click('.modal .modal-foot .btn.primary'); await page.wait_for_timeout(400)
            print('after discard', await G("__game.state.pending"))
        for l in logs[:30]: print(l)
        await b.close()
    srv.shutdown()
asyncio.run(main())
