# Mobile layout + menu flows (rules, settings, exit to menu, continue saved game, hot-seat pass screen).
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')  # screenshots
os.makedirs(SP, exist_ok=True)
async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        mobile = os.environ.get('MOBILE') == '1'
        ctx = await b.new_context(viewport={'width': 400, 'height': 820} if mobile else {'width': 1280, 'height': 800}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = await ctx.new_page()
        if not os.environ.get('ASSETS'): await page.add_init_script('window.__noAssets = true;')  # UI-flow test: skip the asset pack
        await page.add_init_script("window.__mapFps = 0.2;")
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
        await page.wait_for_timeout(3000)
        tag = 'm' if mobile else 'd'
        await page.screenshot(path=f'{SP}/ui4-{tag}-menu.png', timeout=120000)
        sw = await page.evaluate('document.documentElement.scrollWidth')
        print('scrollWidth', sw)
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(800)
        await page.screenshot(path=f'{SP}/ui4-{tag}-setup.png', timeout=120000)
        print('scrollWidth setup', await page.evaluate('document.documentElement.scrollWidth'))
        if not mobile:
            # make seat 2 a human for hot-seat
            await page.select_option('#seat-kind-0', 'human')
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=60000)
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{SP}/ui4-{tag}-game.png', timeout=120000)
        print('scrollWidth game', await page.evaluate('document.documentElement.scrollWidth'))
        if not mobile:
            # let AI place for both humans until the pass screen appears
            await page.evaluate('window.__autoHuman = false')
            for i in range(80):
                st = await page.evaluate("({pass: __game.passTo, viewer: __game.viewer, phase: __game.state.phase, who: __game.state.setup.order[__game.state.setup.i]})")
                if st['pass'] is not None:
                    print('pass screen for', st); break
                # place for current human via dispatch using AI
                await page.evaluate("""(async () => { const ai = await import('/src/ai/ai.js'); const eng = await import('/src/engine/engine.js');
                    const s = __game.state; if (s.phase!=='setup') return; const p = s.setup.order[s.setup.i];
                    if (__game.players[p].kind !== 'human' || p !== __game.viewer) return;
                    const a = ai.aiAct(eng.makeView(s, p), p, {}, Math.random); if (a) __game.dispatch(a); })()""")
                await page.wait_for_timeout(400)
            await page.screenshot(path=f'{SP}/ui4-d-pass.png', timeout=120000)
            await page.click('.pass-screen .btn.primary')
            await page.wait_for_timeout(500)
            print('viewer now', await page.evaluate('__game.viewer'))
            # rules + settings dialogs
            await page.click('.topbar [data-k="rules"]'); await page.wait_for_timeout(400)
            await page.screenshot(path=f'{SP}/ui4-d-rules.png', timeout=120000)
            await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
            await page.click('.topbar [data-k="settings"]'); await page.wait_for_timeout(300)
            await page.click('.modal .seg button:has-text("快")'); await page.wait_for_timeout(200)
            print('speed', await page.evaluate('__game.settings.speed'))
            await page.keyboard.press('Escape')
            # exit to menu and continue
            await page.click('.topbar [data-k="menu"]'); await page.wait_for_timeout(300)
            await page.click('.modal .btn.primary:has-text("回到主選單")')
            await page.wait_for_selector('.menu-screen', timeout=60000)
            await page.wait_for_timeout(1500)
            print('has continue', await page.evaluate("!!document.querySelector('.menu-screen') && [...document.querySelectorAll('.menu-screen [data-k=continue]')].some(b=>!b.hidden && b.textContent.includes('繼續上一局'))"))
            await page.click('text=繼續上一局')
            await page.wait_for_function('window.__game && window.__game.state', timeout=60000)
            await page.wait_for_timeout(1500)
            print('continued at', await page.evaluate("({phase: __game.state.phase, i: __game.state.setup.i})"))
        for l in logs[:30]: print(l)
        await b.close()
    srv.shutdown()
asyncio.run(main())
