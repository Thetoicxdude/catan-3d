# 5–6 players on the large island: the setup screen's choices, a campaign the computer plays for
# every seat (paired turns), the board and its labels on the bigger map, six nations in the panel,
# the second player's banner, the bank-only trade dialog, and the final standings.
#   python3 test/ui5.py            (TURNS=sbp for the special building phase)
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
TURNS = os.environ.get('TURNS', 'paired')
SFX = '' if TURNS == 'paired' else '-' + TURNS  # screenshot names
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

# every map label must sit where its transform puts it (see ui1.py)
CHECK = r"""() => {
  const layer = document.querySelector('.map-labels');
  const host = layer.getBoundingClientRect();
  const out = { shown: 0, tokens: 0, bad: [] };
  for (const box of layer.children) {
    if (getComputedStyle(box).display === 'none') continue;
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(box.style.transform || '');
    if (!m) continue;
    const el = box.classList.contains('float') ? box : box.firstElementChild || box;
    out.shown++;
    if (el.classList.contains('token')) out.tokens++;
    if (box.offsetLeft !== 0 || box.offsetTop !== 0) out.bad.push(`${el.className} offset ${box.offsetLeft},${box.offsetTop}`);
    if (el.classList.contains('drop')) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - host.left - +m[1];
    const dy = r.top + r.height / 2 - host.top - +m[2];
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) out.bad.push(`${el.className} off by ${dx.toFixed(0)},${dy.toFixed(0)}`);
  }
  return out;
}"""

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        W = int(os.environ.get('W', 1280)); H = int(os.environ.get('H', 800))
        ctx = await b.new_context(viewport={'width': W, 'height': H})
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        await page.add_init_script("window.__noAssets = true; window.__mapFps = 0.5; localStorage.setItem('catan3d-settings-v1', JSON.stringify({ speed: 'turbo', quality: 'low', qualityPicked: true }));")
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        await page.route('**/*', route)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen', timeout=90000)
        await page.click('[data-k="single"]')
        await page.wait_for_selector('[data-map="base-6"]')
        await page.click('[data-map="base-6"]')
        await page.wait_for_timeout(600)
        if TURNS == 'sbp':
            await page.click('.setup-card .seg button:has-text("特別建造階段")')
            await page.wait_for_timeout(300)
        card = await page.inner_text('.setup-card')
        check('the large island offers 5–6 players and the turn rules', '5 國（6 人局）' in card and '配對回合' in card and '特別建造階段' in card, card.replace('\n', ' ')[:200])
        check('no official spiral on the large island', '官方螺旋' not in card)
        seats = await page.evaluate("document.querySelectorAll('.setup-card .seat').length")
        check('five opponent seats', seats == 5, str(seats))
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{SP}/ui5{SFX}-setup.png')
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=120000)
        st = await page.evaluate('({ map: __game.state.map, n: __game.state.players.length, hexes: __game.state.board.hexes.length, rules: __game.state.rules, bank: __game.state.bank.wood, deck: __game.state.devDeck.length })')
        check('a six-nation campaign on the large island', st['map'] == 'base-6' and st['n'] == 6 and st['hexes'] == 30 and st['rules'] == {'turns': TURNS} and st['bank'] == 24 and st['deck'] == 34, json.dumps(st))
        await page.wait_for_timeout(3000)
        lab = await page.evaluate(CHECK)
        check('number tokens and harbors in place on the large island', not lab['bad'] and lab['tokens'] >= 28, f"{lab['shown']} labels, {lab['tokens']} tokens, bad {lab['bad'][:3]}")
        await page.screenshot(path=f'{SP}/ui5{SFX}-start.png')
        nations = await page.evaluate("document.querySelectorAll('.outliner .nation').length")
        check('six nations in the panel', nations == 6, str(nations))
        # the computer plays every seat from here; a shorter campaign (8 points)
        await page.evaluate('window.__autoHuman = true; __game.state.targetVP = 8; __game.schedule()')
        t0 = time.time()
        sub = 'pair' if TURNS == 'paired' else 'sbp'
        # stop the game as soon as a computer player's second part begins (checked on every move)
        await page.evaluate(f"""(() => {{
          const g = __game; const orig = g.dispatch.bind(g);
          g.dispatch = (a, o) => {{
            const r = orig(a, o);
            const s = g.state;
            if (!window.__held && s.sub && s.sub.k === '{sub}' && s.current !== 0) {{ window.__held = true; g.frozen = true; clearTimeout(g.timer); g.timer = null; }}
            return r;
          }};
        }})()""")
        await page.wait_for_function('window.__held === true', timeout=600000, polling=250)
        print('first second part after %.0fs' % (time.time() - t0))
        await page.evaluate('window.__autoHuman = false; clearTimeout(__game.timer); __game.timer = null; __game.refresh()')
        await page.wait_for_timeout(500)
        banner = await page.inner_text('.banner') if await page.query_selector('.banner') else ''
        want = '第二位' if TURNS == 'paired' else '特別建造'
        check('the banner names the second part of the turn', want in banner, banner.replace('\n', ' '))
        lead = await page.evaluate("document.querySelectorAll('.outliner .nation.lead').length")
        check('the main player is marked while the second part runs', lead == 1, str(lead))
        await page.screenshot(path=f'{SP}/ui5{SFX}-second.png')
        tabs = await page.evaluate("(() => { __game.dialogs.trade(__game.ctx(), () => {}); return [...document.querySelectorAll('.modal .tabs button')].map((b) => b.textContent); })()")
        check('in the second part only the bank can be traded with', tabs == ['海上貿易'], json.dumps(tabs, ensure_ascii=False))
        await page.screenshot(path=f'{SP}/ui5{SFX}-trade.png')
        await page.evaluate('__game.dialogs.close(true)')
        # on to the end
        await page.evaluate('window.__autoHuman = true; __game.frozen = false; __game.schedule()')
        await page.wait_for_function("__game.state.phase === 'over'", timeout=1500000, polling=1000)
        print('campaign over after %.0fs, turn %s' % (time.time() - t0, await page.evaluate('__game.state.turn')))
        await page.wait_for_selector('.standings .standing', timeout=30000)
        await page.wait_for_timeout(1500)  # the dialog fades in
        rows = await page.evaluate("document.querySelectorAll('.standings .standing').length")
        check('six nations in the final standings', rows == 6, str(rows))
        await page.screenshot(path=f'{SP}/ui5{SFX}-over.png')
        await page.evaluate('__game.dialogs.close(true)')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f'{SP}/ui5{SFX}-final-map.png')
        # a phone: the nations panel opened
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_timeout(1500)
        # (the panel was open at desktop width: the phone's nations button would close it)
        if await page.evaluate("document.querySelector('.outliner').classList.contains('closed')"):
            await page.click('[data-k="nations"]')
        await page.wait_for_timeout(800)
        await page.screenshot(path=f'{SP}/ui5{SFX}-phone.png')
        errs = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
