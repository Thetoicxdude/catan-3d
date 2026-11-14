# The home screen's official room, live, after the lobby socket dies without a word (a phone that
# slept, a network that changed): page A's sockets are cut off (nothing in, nothing out, still
# "open"), then B opens an official room and C joins it. A should catch up by itself: at once when it
# comes back to the front, and within half a minute even if nothing happens.
#   npm run dev   (then, in another shell)   python3 test/lobby.py
import asyncio, sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import THREE
from playwright.async_api import async_playwright
SITE = os.environ.get('SITE', 'http://127.0.0.1:8787')
KILL = """(() => {
  const Native = window.WebSocket;
  const all = [];
  class WS extends Native {
    constructor(...a) { super(...a); all.push(this); this.__dead = false; }
    send(d) { if (this.__dead) return; return super.send(d); }
    set onmessage(f) { super.onmessage = (e) => { if (!this.__dead && f) f.call(this, e); }; }
    get onmessage() { return super.onmessage; }
    set onclose(f) { super.onclose = (e) => { if (!this.__dead && f) f.call(this, e); }; }
    get onclose() { return super.onclose; }
  }
  window.WebSocket = WS;
  window.__killWs = () => { let n = 0; for (const s of all) if (s.readyState === 1 && !s.__dead) { s.__dead = true; n++; } return n; };
  window.__wsCount = () => all.length;
})();"""
INIT = KILL + "window.__noAssets = true; window.__mapFps = 0.5; window.__mmSeconds = 120; localStorage.setItem('catan3d-settings-v1', JSON.stringify({lang:'zh',  speed: 'turbo', quality: 'low', qualityPicked: true, name: NAME }));"
STATE = "(() => ({ n: document.querySelector('.ho-n') && document.querySelector('.ho-n').textContent, sec: document.querySelector('.ho-sec') && document.querySelector('.ho-sec').textContent, idle: document.querySelector('.ho-timer') && document.querySelector('.ho-timer').classList.contains('idle'), ws: window.__wsCount() }))()"

async def wait_for(page, pred, limit, label, t0):
    end = time.time() + limit
    while time.time() < end:
        s = await page.evaluate(STATE)
        if pred(s):
            print(f'{label}: after {time.time() - t0:.1f}s', s)
            return True
        await page.wait_for_timeout(500)
    print(f'{label}: NOT within {limit}s', await page.evaluate(STATE))
    return False

async def main():
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u or 'accounts.google.com' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        pages = []
        for name in ['觀察者', '玩家乙', '玩家丙']:
            ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
            await ctx.route('**/*', route)
            pg = await ctx.new_page()
            await pg.add_init_script(INIT.replace('NAME', json.dumps(name)))
            await pg.goto(SITE + '/', wait_until='domcontentloaded', timeout=180000)
            pg.on('pageerror', lambda e, n=name: print('[pageerror]', n, str(e)[:200]))
            try:
                await pg.wait_for_selector('.menu-screen.home', state='attached', timeout=180000)
            except Exception as e:
                print('home did not open for', name, await pg.evaluate("document.body.innerText.slice(0, 300)"))
                raise
            print('page up:', name)
            pages.append(pg)
        a, bp, cp = pages
        await a.wait_for_timeout(3000)
        print('A before', await a.evaluate(STATE))
        # 1. A's socket dies; B opens an official room; A comes back to the front
        print('A sockets cut:', await a.evaluate('__killWs()'))
        t0 = time.time()
        await bp.click('.ho-board')
        await a.wait_for_timeout(6000)
        s = await a.evaluate(STATE)
        print('A 6s later (socket dead, nothing should change yet)', s)
        await a.wait_for_timeout(2500)
        t1 = time.time()
        await a.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        ok &= await wait_for(a, lambda s: s['n'] == '1/4', 12, 'A sees B\'s room after coming back to the front', t1)
        # 2. dead again, C joins: no event at all this time
        await a.wait_for_timeout(2000)
        print('A sockets cut:', await a.evaluate('__killWs()'))
        t2 = time.time()
        await cp.click('.ho-board')
        ok &= await wait_for(a, lambda s: s['n'] == '2/4' and not s['idle'], 40, 'A sees C join and the countdown, with no event', t2)
        print('B', await bp.evaluate(STATE), '| C', await cp.evaluate(STATE))
        # leave matchmaking
        await cp.click('.ho-board')
        await bp.click('.ho-board')
        await a.wait_for_timeout(3000)
        print('A after both left', await a.evaluate(STATE))
        await b.close()
    print('RESULT', 'ok' if ok else 'FAILED')
    if not ok: sys.exit(1)
asyncio.run(main())
