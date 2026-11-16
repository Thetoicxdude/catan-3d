# The building cards with their pictures: the Cards side page (every card owned) and one card opened.
#   npm run build && python3 tools/art/cardshot.py OUTDIR [key=lighthouse] [width=1366 height=860]
import asyncio, sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'test'))
from shot import serve, THREE
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/cardshot'
KEY = sys.argv[2] if len(sys.argv) > 2 else 'lighthouse'
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1366
H = int(sys.argv[4]) if len(sys.argv) > 4 else 860
os.makedirs(OUT, exist_ok=True)
ALL = ['aqueduct', 'granary', 'market', 'shipyard', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press', 'gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library']
LANG = os.environ.get('LANG_UI', 'zh')
INIT = "window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; localStorage.setItem('catan3d-settings-v1', JSON.stringify({ lang: '%s', quality: 'low', qualityPicked: true, mode: 'develop', bps: [['road','settlement','city','dev','granary','market','gardens']], bpCur: 0, bpv: 2 })); localStorage.setItem('catan3d-cards-v1', JSON.stringify({ own: %s }));" % (LANG, json.dumps(ALL))

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = await b.new_page(viewport={'width': W, 'height': H})
        page.set_default_timeout(300000)
        await page.add_init_script(INIT)
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
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home', timeout=120000)
        tab = '.hm-tab[data-k="cards"]' if await page.locator('.hm-tab[data-k="cards"]').is_visible() else '.hm-medal[data-k="cards"]'
        await page.click(tab)
        await page.wait_for_selector('.modal.side-page .cards-page')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f'{OUT}/cards.png')
        await page.click(f'.cp-coll .cc[data-k="{KEY}"]')
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f'{OUT}/card-{KEY}.png')
        info = await page.evaluate("""() => ({ art: !document.documentElement.classList.contains('no-art'),
          pics: [...document.querySelectorAll('.cp-coll .cc-pic')].filter((e) => e.offsetWidth > 0).length,
          detail: !!document.querySelector('.cd-pic') && document.querySelector('.cd-pic').offsetWidth })""")
        print('cards', info)
        for l in logs[:20]:
            print(l)
        await b.close()
    srv.shutdown()

asyncio.run(main())
