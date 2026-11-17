# The interface's motions (src/ui/motion.js; the design: Claude Docs「卡坦島：互動與動畫設計」): a control
# pressed shrinks and springs back; the Cards page (a card flying into the blueprint and landing, one
# taken out with the rest closing the gap, a full blueprint shaking, "in use" stamped, the detail fading
# in); a page and a dialog leaving leave a picture of themselves that nobody can click or find, gone at
# once; coins of a mission flying into the head and the number counting up to them; cards drawn again
# turning into shards that fly in; in a game the build menu growing out of its button and sinking back, a row that cannot
# be built shaking with its missing resources flashing, the development card turning over with the
# screen dimmed and the menu stepped back (a click sends it away), your turn dropping in; and with
# "reduce motion" nothing flying, no picture left by a closing dialog.
#   python3 test/ui9.py          (SHOTS=dir for the screenshots)
import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

ALL = ['aqueduct', 'granary', 'market', 'shipyard', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press', 'gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library']
FIVE = ['road', 'settlement', 'city', 'dev', 'market']
# every Web Animation started on the page, by its element's class and the properties it moves
RECORD = """window.__anims = [];
{ const A = Element.prototype.animate;
  Element.prototype.animate = function (k, o) {
    try {
      const c = typeof this.className === 'string' ? this.className : (this.className && this.className.baseVal) || this.tagName;
      const props = [...new Set((Array.isArray(k) ? k : [k]).flatMap((f) => Object.keys(f)))].filter((x) => x !== 'offset' && x !== 'easing' && x !== 'composite');
      window.__anims.push({ cls: c, props, kind: this.dataset ? this.dataset.slot || this.dataset.k || '' : '' });
    } catch (e) {}
    return A.call(this, k, o);
  };
}"""
ANIMS = "(since) => window.__anims.slice(since)"
NANIMS = "() => window.__anims.length"
CARDS = "() => window.__cards.get()"
# the human's turn, taken over (a computer's move already on its timer is called off: it would land after)
MY_TURN = """() => { const g = __game, s = g.state; window.__autoHuman = false; clearTimeout(g.timer); g.timer = null; g.thinking = null; s.current = 0; s.rolled = true; s.pending = null; s.trade = null; for (const r of ['wood','brick','wool','grain','ore']) s.players[0].res[r] = 12; g.refresh(); }"""

def init(own, coins=0, bps=None):
    return RECORD + "\nwindow.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; if (!localStorage.getItem('catan3d-settings-v1')) { localStorage.setItem('catan3d-settings-v1', JSON.stringify({ lang: 'zh', speed: 'turbo', quality: 'low', qualityPicked: true, opponents: 3, bps: %s, bpCur: 0, bpv: 2 })); localStorage.setItem('catan3d-cards-v1', JSON.stringify({ own: %s, coins: %d })); }" % (json.dumps(bps or [FIVE, FIVE, FIVE]), json.dumps(own), coins)

async def route(r):
    u = r.request.url
    if 'cdn.jsdelivr.net/npm/three' in u:
        await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
    elif 'fonts.g' in u:
        await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
    else:
        await r.continue_()

async def open_page(b, reduce=False, own=ALL, coins=0):
    ctx = await b.new_context(viewport={'width': 1366, 'height': 820}, reduced_motion='reduce' if reduce else 'no-preference')
    page = await ctx.new_page()
    page.set_default_timeout(120000)
    await page.add_init_script(init(own, coins))
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    await page.route('**/*', route)
    await page.goto('http://127.0.0.1:8765/dist/index.test.html')
    await page.wait_for_selector('.menu-screen.home', timeout=60000)
    await page.wait_for_timeout(1200)
    return ctx, page, logs

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx, page, logs = await open_page(b)

        # ── a control pressed: it shrinks at once and springs back ──
        n0 = await page.evaluate(NANIMS)
        box = await page.locator('.hm-tab[data-k="cards"]').bounding_box()
        await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        await page.mouse.down()
        pressed = await page.evaluate(ANIMS, n0)
        await page.mouse.up()
        await page.wait_for_selector('.menu-screen.page .cards-page')
        released = await page.evaluate(ANIMS, n0)
        check('a control pressed shrinks and springs back', any('hm-tab' in a['cls'] and a['props'] == ['scale'] for a in pressed) and sum(1 for a in released if 'hm-tab' in a['cls'] and a['props'] == ['scale']) >= 2, pressed[:3])
        await page.wait_for_timeout(500)

        # ── the Cards page ──
        n0 = await page.evaluate(NANIMS)
        await page.click('.cp-coll .cc[data-k="shipyard"]')
        a = await page.evaluate(ANIMS, n0)
        check('a card opened: its detail fades in', any('cp-detail' in x['cls'] and 'opacity' in x['props'] for x in a), [x['cls'] for x in a][:4])
        n0 = await page.evaluate(NANIMS)
        await page.click('.cp-acts .btn.primary')
        flying = await page.evaluate("() => ({ flyers: document.querySelectorAll('.m-fly .m-flyer').length, hidden: getComputedStyle(document.querySelector('.cp-slot[data-slot=\"shipyard\"] .cc')).visibility })")
        await page.wait_for_timeout(1500)
        landed = await page.evaluate("() => ({ flyers: document.querySelectorAll('.m-fly .m-flyer').length, shown: getComputedStyle(document.querySelector('.cp-slot[data-slot=\"shipyard\"] .cc')).visibility, bp: JSON.parse(localStorage.getItem('catan3d-settings-v1')).bps[0] })")
        a = await page.evaluate(ANIMS, n0)
        check('a card put in the blueprint flies there and its place bounces as it lands', flying['flyers'] == 1 and flying['hidden'] == 'hidden' and landed['flyers'] == 0 and landed['shown'] == 'visible' and landed['bp'] == FIVE + ['shipyard'] and any('m-flyer' in x['cls'] and 'translate' in x['props'] for x in a) and any('cp-slot' in x['cls'] and x['props'] == ['scale'] for x in a), (flying, landed))
        await page.screenshot(path=f'{SP}/ui9-cards.png')
        n0 = await page.evaluate(NANIMS)
        await page.click('.cp-slot[data-slot="city"]')
        a = await page.evaluate(ANIMS, n0)
        moved = sorted(x['kind'] for x in a if 'cp-slot' in x['cls'] and x['props'] == ['translate'])
        bp = await page.evaluate("() => JSON.parse(localStorage.getItem('catan3d-settings-v1')).bps[0]")
        check('a card taken out: the ones after it close the gap, it flies back', moved == ['dev', 'market', 'shipyard'] and bp == ['road', 'settlement', 'dev', 'market', 'shipyard'] and any('m-flyer' in x['cls'] for x in a), (moved, bp))
        await page.wait_for_timeout(800)
        # filled up, then one more: the blueprint shakes
        for k in ['city', 'granary']:
            await page.click(f'.cp-coll .cc[data-k="{k}"]')
            await page.click('.cp-acts .btn.primary')
            await page.wait_for_timeout(200)
        await page.click('.cp-coll .cc[data-k="camp"]')
        n0 = await page.evaluate(NANIMS)
        await page.click('.cp-acts .btn.primary')
        a = await page.evaluate(ANIMS, n0)
        flash = await page.inner_text('.cp-flash')
        check('a full blueprint shakes and says so', any('cp-slots' in x['cls'] and x['props'] == ['translate'] for x in a) and '已滿' in flash, flash)
        # another blueprint into use: stamped
        await page.click('.cp-tab[data-set="2"]')
        n0 = await page.evaluate(NANIMS)
        await page.click('.cp-use .btn')
        a = await page.evaluate(ANIMS, n0)
        check('"in use" is stamped', any('cp-inuse' in x['cls'] and 'rotate' in x['props'] for x in a), [x['cls'] for x in a][:4])

        # ── the page leaves for the home screen: a picture of it that nobody can click or find ──
        await page.click('.pg-home')
        left = await page.evaluate("() => { const g = document.querySelector('.menu-screen.page'); return { page: !!g, leaving: !!(g && g.classList.contains('leaving')), inert: !!(g && g.inert), found: document.querySelectorAll('.pg-item[data-k], .cards-page [data-k]').length, home: !!document.querySelector('.menu-screen.home:not(.leaving)') }; }")
        await page.wait_for_timeout(700)
        gone = await page.evaluate("() => document.querySelectorAll('.menu-screen.page').length")
        check('a page leaving fades away untouchable over the home screen, gone at once', left['page'] and left['leaving'] and left['inert'] and left['found'] == 0 and left['home'] and gone == 0, (left, gone))

        # ── a dialog closing: a picture of it, not clickable, not found, gone at once ──
        await page.click('.hm-medal[data-k="rules"]')
        await page.wait_for_selector('.modal[data-kind="rules"]')
        await page.wait_for_timeout(400)
        await page.click('.modal[data-kind="rules"] .modal-head .icon-btn')
        ghost = await page.evaluate("() => { const g = document.querySelector('.modal-layer.leaving'); return { ghost: !!g, inert: !!(g && g.inert), kinds: document.querySelectorAll('.modal[data-kind]').length, open: !!document.querySelector('.modal-layer:not(.leaving) .modal') }; }")
        await page.wait_for_timeout(700)
        gone = await page.evaluate("() => document.querySelectorAll('.modal-layer.leaving').length")
        check('a closing dialog leaves a picture that nobody can click or find, gone at once', ghost['ghost'] and ghost['inert'] and ghost['kinds'] == 0 and not ghost['open'] and gone == 0, (ghost, gone))

        # ── the Missions page: a mission's coins fly in; Draw & Shop: cards drawn again turn into shards ──
        await page.click('.hm-tab[data-k="missions"]')
        await page.wait_for_selector('.menu-screen.page .missions-page')
        await page.wait_for_timeout(500)
        await page.click('[data-claim="welcome"]')
        early = await page.evaluate("() => ({ coins: document.querySelectorAll('.m-fly .m-coin').length, shown: document.querySelector('.sp-bals .cur.coin .num').textContent })")
        await page.wait_for_function("() => document.querySelector('.sp-bals .cur.coin .num').textContent === '200'", timeout=10000)
        await page.wait_for_timeout(400)
        left = await page.evaluate("() => document.querySelectorAll('.m-fly .m-coin').length")
        check("a mission's coins fly into the head, the number counting up to them", early['coins'] >= 3 and early['shown'] != '200' and left == 0, early)
        # (every card of the pack owned: a draw gives shards)
        await page.evaluate("() => { const c = window.__cards.get(); c.coins = 1000; window.__cards.commit(); }")
        await page.click('.pg-item[data-k="shop"]')
        await page.wait_for_selector('.menu-screen.page .shop-page')
        await page.click('.btn.sp-draw >> nth=1')
        await page.wait_for_timeout(900)
        mid = await page.evaluate("() => ({ shards: document.querySelectorAll('.m-fly .m-coin.shard').length, shown: +document.querySelector('.sp-bals .cur.shard .num').textContent.replace(/,/g, '') })")
        c = await page.evaluate(CARDS)
        await page.wait_for_function("(n) => +document.querySelector('.sp-bals .cur.shard .num').textContent.replace(/,/g, '') === n", arg=c['shards'], timeout=15000)
        coins = await page.evaluate("() => document.querySelector('.sp-bals .cur.coin .num').textContent")
        check('ten cards drawn again: their shards fly in, the coins counted off', mid['shards'] >= 1 and mid['shown'] < c['shards'] and coins == '100', (mid, c['shards'], coins))
        await page.screenshot(path=f'{SP}/ui9-draw.png')
        await page.click('.pg-home')
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.wait_for_timeout(500)

        # ── in a game ──
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(1800)
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state')
        await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
        await page.wait_for_function("() => __game.state.phase === 'play'", timeout=180000)
        await page.wait_for_timeout(1500)
        await page.evaluate(MY_TURN)
        await page.wait_for_timeout(600)
        # the build menu grows out of its button and sinks back
        n0 = await page.evaluate(NANIMS)
        await page.keyboard.press('b')
        a = await page.evaluate(ANIMS, n0)
        grew = any('build-menu' in x['cls'] and 'translate' in x['props'] and 'opacity' in x['props'] for x in a)
        await page.wait_for_timeout(400)
        # a row that cannot be built: it shakes, its missing resources flash
        await page.evaluate("() => { const s = __game.state; for (const r of ['wood','brick','wool','grain','ore']) s.players[0].res[r] = 0; s.players[0].res.grain = 1; __game.refresh(); }")
        await page.wait_for_timeout(300)
        n0 = await page.evaluate(NANIMS)
        # (a shut row is aria-disabled, which Playwright will not click; a player can)
        await page.click('.bm-row[data-k="city"]', force=True)
        a = await page.evaluate(ANIMS, n0)
        flash = await page.evaluate("() => document.querySelectorAll('.bm-row[data-k=\"city\"] .bm-need.short.flash').length")
        check('a row that cannot be built shakes, its missing resources flash', any('bm-row' in x['cls'] and x['props'] == ['translate'] for x in a) and flash == 2, (flash, [x['cls'] for x in a][:3]))
        await page.keyboard.press('b')
        closing = await page.evaluate("() => document.querySelector('.build-menu').classList.contains('closing')")
        await page.wait_for_timeout(600)
        hidden = await page.evaluate("() => document.querySelector('.build-menu').hidden")
        check('the build menu grows out of its button and sinks back', grew and closing and hidden, (grew, closing, hidden))
        # a development card bought: it turns over with the screen dimmed and the menu stepped back; a click sends it away
        await page.evaluate(MY_TURN)
        await page.keyboard.press('b')
        await page.wait_for_timeout(400)
        await page.click('.bm-row[data-k="dev"]')
        await page.wait_for_selector('.fx-dev', timeout=10000)
        await page.wait_for_timeout(400)
        shown = await page.evaluate("() => ({ reveal: !!document.querySelector('.fx-reveal'), dim: document.querySelectorAll('.fx-dim').length, menu: +getComputedStyle(document.querySelector('.build-menu')).opacity })")
        await page.screenshot(path=f'{SP}/ui9-dev.png')
        await page.mouse.click(683, 330)
        await page.wait_for_timeout(1200)
        after = await page.evaluate("() => ({ reveal: !!document.querySelector('.fx-reveal'), card: document.querySelectorAll('.fx-dev').length })")
        check('a development card turns over with the screen dimmed and the menu stepped back; a click sends it away', shown['reveal'] and shown['dim'] >= 1 and shown['menu'] < 0.5 and not after['reveal'] and after['card'] == 0, (shown, after))
        # your turn: the order drops in
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("() => { const s = __game.state; s.turn += 1; s.current = 0; s.rolled = false; s.pending = null; __game.refresh(); }")
        await page.wait_for_timeout(300)
        a = await page.evaluate(ANIMS, n0)
        banner = await page.inner_text('.banner')
        check('your turn: the order drops in from the bar', '你的回合' in banner and any(x['cls'].startswith('banner') and 'translate' in x['props'] for x in a), banner)
        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errors, errors[:5])
        await ctx.close()

        # ── reduce motion: nothing flies, a closing dialog leaves no picture ──
        ctx, page, logs = await open_page(b, reduce=True)
        await page.click('.hm-tab[data-k="cards"]')
        await page.wait_for_selector('.menu-screen.page .cards-page')
        await page.click('.cp-coll .cc[data-k="shipyard"]')
        n0 = await page.evaluate(NANIMS)
        await page.click('.cp-acts .btn.primary')
        a = await page.evaluate(ANIMS, n0)
        flyers = await page.evaluate("() => document.querySelectorAll('.m-fly .m-flyer').length")
        shownv = await page.evaluate("() => getComputedStyle(document.querySelector('.cp-slot[data-slot=\"shipyard\"] .cc')).visibility")
        await page.click('.pg-home')
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.click('.hm-medal[data-k="rules"]')
        await page.wait_for_selector('.modal[data-kind="rules"]')
        await page.click('.modal[data-kind="rules"] .modal-head .icon-btn')
        ghost = await page.evaluate("() => document.querySelectorAll('.modal-layer.leaving').length")
        moving = [x for x in a if 'translate' in x['props'] or 'scale' in x['props'] or 'rotate' in x['props']]
        check('reduce motion: nothing flies or bounces, no picture of a closing dialog', flyers == 0 and shownv == 'visible' and ghost == 0 and not moving, (flyers, shownv, ghost, moving[:3]))
        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors (reduce motion)', not errors, errors[:5])
        await ctx.close()
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('\nui9: ' + ('all passed' if not bad else 'FAILED: ' + ', '.join(bad)))
    sys.exit(1 if bad else 0)

asyncio.run(main())
