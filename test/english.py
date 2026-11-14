# The page in English (the default: no language saved): no Chinese anywhere on it. Walks the home screen,
# its settings and rules, the campaign setup, a campaign the computer plays for the human seat (the log,
# banners, hints, toasts and the dialogs on the way), a Seafarers campaign (ships, the pirate, gold), the
# map workshop and the online screens; every text node and every title / aria-label / placeholder is
# checked, and any "[i18n] no English for" warning fails the run. The language row in the settings is the
# one exception: 中文 is the name of the language, marked lang="zh-Hant".
#
#   python3 test/english.py            (SHOTS=dir for the screenshots; W, H for the window)
import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)

SWEEP = r"""() => {
  const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;
  const keep = (el) => el && el.closest && el.closest('[lang^="zh"]');
  const where = (el) => (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase());
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    if (!CJK.test(n.nodeValue)) continue;
    const el = n.parentElement;
    if (!el || keep(el) || el.closest('script,style')) continue;
    out.push('text "' + n.nodeValue.trim().slice(0, 90) + '" in ' + where(el));
  }
  for (const el of document.body.querySelectorAll('*')) {
    if (keep(el)) continue;
    for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'data-empty', 'data-why']) {
      const v = el.getAttribute(a);
      if (v && CJK.test(v)) out.push(a + ' "' + v.slice(0, 90) + '" on ' + where(el));
    }
  }
  for (const el of document.body.querySelectorAll('input, textarea')) if (!keep(el) && CJK.test(el.value || '')) out.push('value "' + el.value.slice(0, 90) + '" of ' + where(el));
  if (CJK.test(document.title)) out.push('document title "' + document.title + '"');
  if (document.documentElement.lang !== 'en') out.push('html lang is ' + document.documentElement.lang);
  return [...new Set(out)];
}"""

problems = {}
def note(where, found):
    for f in found:
        problems.setdefault(f, where)

async def main():
    srv = serve()
    W = int(os.environ.get('W', 1280)); H = int(os.environ.get('H', 800))
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H})
        page = await ctx.new_page()
        # turbo computers, low quality; no language saved: English
        await page.add_init_script("window.__noAssets = true; window.__mockRoom = true; window.__mapFps = 0.5; if (!localStorage.getItem('catan3d-settings-v1')) localStorage.setItem('catan3d-settings-v1', JSON.stringify({ speed: 'turbo', quality: 'low', qualityPicked: true }));")
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
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

        async def snap(name):
            # (the page can be too busy for a picture while the computers play: skipped then)
            try:
                await page.screenshot(path=f'{SP}/en-{name}.png', timeout=45000)
            except Exception as e:
                print('screenshot skipped:', name, str(e).split('\n')[0])
        async def sweep(where, shot=None):
            note(where, await page.evaluate(SWEEP))
            if shot:
                await snap(shot)
        async def close_dialog():
            await page.keyboard.press('Escape')
            await page.wait_for_timeout(300)
            btn = page.locator('.modal [aria-label="Close"]')
            if await btn.count() and await btn.first.is_visible():
                await btn.first.click()
                await page.wait_for_timeout(300)

        await page.goto('http://127.0.0.1:8765/dist/index.test.html', timeout=120000)
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.wait_for_timeout(2500)
        await sweep('home', 'home')
        print('home', await page.evaluate("() => [document.documentElement.lang, document.title, document.querySelector('.hm-title').textContent]"))

        await page.click('.hm-medal[data-k="settings"]')
        await page.wait_for_timeout(500)
        await sweep('settings', 'settings')
        await close_dialog()
        await page.click('.hm-medal[data-k="rules"]')
        await page.wait_for_timeout(500)
        await sweep('rules', 'rules')
        await close_dialog()

        # the campaign setup, then a campaign the computer plays for us
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(800)
        await sweep('campaign setup', 'setup')
        await page.click('text=Start Campaign')
        await page.wait_for_function('window.__game && window.__game.state', timeout=60000)
        await page.wait_for_timeout(2500)
        await sweep('setup phase', 'game-setup')
        # the build menu, the hand of cards, the rules and the settings in the game
        for k in ['build', 'cards', 'rules', 'settings']:
            btn = page.locator(f'.actionbar [data-k="{k}"], .topbar [data-k="{k}"]')
            if await btn.count():
                await btn.first.click()
                await page.wait_for_timeout(500)
                await sweep(f'game {k}', f'game-{k}')
                await close_dialog()
        await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
        shots = 0
        for i in range(70):
            await page.wait_for_timeout(1500)
            await sweep('campaign')
            if i % 15 == 7 and shots < 4:
                shots += 1
                await snap(f'play{shots}')
            # a tooltip over the middle of the map
            if i % 10 == 3:
                await page.mouse.move(W / 2 + (i % 3 - 1) * 60, H / 2)
                await page.wait_for_timeout(400)
                await sweep('map tooltip')
            if await page.evaluate("() => window.__game.state.phase === 'over'"):
                break
        st = await page.evaluate("() => ({ phase: __game.state.phase, turn: __game.state.turn, log: document.querySelectorAll('.log-body p, .log-body div').length })")
        print('campaign', st)
        await page.wait_for_timeout(2000)
        await sweep('campaign end', 'over')

        # a Seafarers campaign: ships, the pirate, gold, the island bonus
        await page.evaluate("""() => { const k = 'catan3d-settings-v1'; const s = JSON.parse(localStorage.getItem(k)); s.map = 'sea-1'; s.opponents = 3; localStorage.setItem(k, JSON.stringify(s)); localStorage.removeItem('catan3d-save-v1'); }""")
        await page.goto('http://127.0.0.1:8765/dist/index.test.html', timeout=120000)
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(800)
        await sweep('seafarers setup')
        await page.click('text=Start Campaign')
        await page.wait_for_function('window.__game && window.__game.state', timeout=60000)
        await page.wait_for_timeout(2000)
        await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
        for i in range(50):
            await page.wait_for_timeout(1500)
            await sweep('seafarers campaign')
            if i == 30:
                await snap('seafarers')
            if i % 10 == 5:
                await page.mouse.move(W / 2 + (i % 3 - 1) * 90, H / 2 - 40)
                await page.wait_for_timeout(400)
                await sweep('seafarers tooltip')
        print('seafarers', await page.evaluate("() => ({ phase: __game.state.phase, turn: __game.state.turn })"))

        # the map workshop and the online screens
        await page.evaluate("() => localStorage.removeItem('catan3d-save-v1')")
        await page.goto('http://127.0.0.1:8765/dist/index.test.html', timeout=120000)
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.click('[data-k="workshop"]')
        await page.wait_for_timeout(1500)
        await sweep('workshop', 'workshop')
        await page.goto('http://127.0.0.1:8765/dist/index.test.html', timeout=120000)
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.click('[data-k="join"]')
        await page.wait_for_timeout(1200)
        await sweep('join', 'join')
        await page.goto('http://127.0.0.1:8765/dist/index.test.html', timeout=120000)
        await page.wait_for_selector('.menu-screen.home', timeout=60000)
        await page.click('[data-k="create"]')
        await page.wait_for_timeout(2500)
        await sweep('room', 'room')

        missing = [l for l in logs if '[i18n]' in l]
        errors = [l for l in logs if 'pageerror' in l]
        for l in errors[:10]: print(l)
        await b.close()
    srv.shutdown()
    if problems or missing or errors:
        print(f'\n{len(problems)} Chinese words on the English page:')
        for f, where in list(problems.items())[:80]: print(f'  [{where}] {f}')
        for l in missing[:40]: print('  ' + l)
        sys.exit(1)
    print('english ok: no Chinese on the page')

asyncio.run(main())
