import asyncio, sys, os, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')  # screenshots
os.makedirs(SP, exist_ok=True)
async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        for mock, w, h in [(True, 1100, 700), (False, 1100, 700), (True, 400, 820)]:
            ctx = await b.new_context(viewport={'width': w, 'height': h})
            page = await ctx.new_page()
            await page.add_init_script(f"window.__mapFps = 0.15; {'window.__mockRoom = true;' if mock else ''}")
            async def route(r):
                u = r.request.url
                if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type':'application/javascript'})
                elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type':'text/css'})
                else: await r.continue_()
            await page.route('**/*', route)
            await page.goto('http://127.0.0.1:8765/dist/index.test.html')
            await page.wait_for_selector('.menu-screen', timeout=60000)
            await page.click('text=線上對戰')
            await page.wait_for_timeout(2500)
            await page.screenshot(path=f'{SP}/entry-{"mock" if mock else "none"}-{w}.png', timeout=120000)
            print('shot', mock, w, await page.evaluate('document.documentElement.scrollWidth'))
            await ctx.close()
        await b.close()
    srv.shutdown()
asyncio.run(main())
