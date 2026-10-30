# Headless screenshots of the built page (WebGL via SwiftShader). CDN requests are served locally.
import asyncio, json, sys, os, http.server, threading, functools
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the project folder
THREE = open(f'{ROOT}/node_modules/three/build/three.module.min.js', 'rb').read()

def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    class Quiet(handler.func):
        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

async def main():
    page_path = sys.argv[1]  # e.g. dist/dev.test.html?seed=1
    out = sys.argv[2]
    shots = json.loads(sys.argv[3]) if len(sys.argv) > 3 else [{"name": "a"}]
    width = int(os.environ.get('W', 1280)); height = int(os.environ.get('H', 800))
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'])
        ctx = await b.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1)
        page = await ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def route(r):
            url = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in url:
                await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript', 'access-control-allow-origin': '*'})
            elif 'fonts.googleapis.com' in url or 'fonts.gstatic.com' in url:
                await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else:
                await r.continue_()
        await page.route('**/*', route)
        await page.goto(f'http://127.0.0.1:8765/{page_path}')
        try:
            await page.wait_for_function('window.__ready === true', timeout=90000)
        except Exception as e:
            print('not ready', e)
        info = await page.evaluate('() => ({build: window.__buildMs, gl: (()=>{try{const c=document.querySelector("canvas");const g=c.getContext("webgl2");return g.getParameter(g.RENDERER)}catch(e){return String(e)}})()})')
        print('info', info)
        for s in shots:
            if 'js' in s:
                await page.evaluate(s['js'])
            await page.wait_for_timeout(s.get('wait', 2500))
            await page.screenshot(path=f'{out}-{s["name"]}.png')
            print('shot', s['name'])
        for l in logs[:40]:
            print(l)
        await b.close()
    srv.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
