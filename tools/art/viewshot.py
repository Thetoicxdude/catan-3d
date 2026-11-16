# A picture of the development mode's models on the light stage (tools/art/viewer.js).
#   node build.mjs tools/art/viewer.js dist/viewer.html
#   python3 tools/art/viewshot.py 'show=s:x,b:granary,b:market&h=9' out.png [width height]
import asyncio, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'test'))
from shot import serve, THREE
from playwright.async_api import async_playwright

async def main():
    query, out = sys.argv[1], sys.argv[2]
    w = int(sys.argv[3]) if len(sys.argv) > 3 else 1400
    h = int(sys.argv[4]) if len(sys.argv) > 4 else 800
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = await b.new_page(viewport={'width': w, 'height': h})
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
        await page.goto('http://127.0.0.1:8765/dist/viewer.test.html?' + query)
        await page.wait_for_function('window.__ready === true', timeout=240000)
        await page.wait_for_timeout(300)
        await page.screenshot(path=out)
        print('info', await page.evaluate('window.__info'))
        for l in logs[:20]:
            print(l)
        await b.close()
    srv.shutdown()

asyncio.run(main())
