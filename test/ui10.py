# The second round of the interface's motions (the design: Claude Docs「卡坦島：互動與動畫設計」, P2 and
# P3): the home screen fading over to the setup, a badge whose number went up bouncing, the official
# room's shields lighting up as players sit down and its last three seconds coming up large; the Cards
# page's blueprint staying at the top while the collection scrolls under it (and staying where it was
# scrolled), a wonder making way for another; ten cards drawn with a wonder's back glowing gold and
# "turn them all over"; the missions' bars growing from where they were; a choice among a few sliding
# over; the campaign starting step by step; in a game a piece dropping into place, the turn's mark
# sliding to the next nation, a trade offer going out and the answers beside the nations, a card stolen
# trembling first, the tooltip fading in, a wonder's card bouncing, and the previews of what would stand
# where the pointer is; in a room, a player sitting down sliding in and one leaving fading out; on a
# phone the blueprint on top too; with "reduce motion" nothing sliding, bouncing or dropping.
#   python3 test/ui10.py          (SHOTS=dir for the screenshots)
import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)

ALL = ['aqueduct', 'granary', 'market', 'shipyard', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press', 'gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library']
BP = ['road', 'settlement', 'city', 'dev', 'market', 'gardens']
# every Web Animation started on the page: its element's class, its parent's, what it moves
RECORD = """window.__anims = [];
{ const A = Element.prototype.animate;
  const cls = (e) => !e ? '' : typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || e.tagName;
  Element.prototype.animate = function (k, o) {
    try {
      const props = [...new Set((Array.isArray(k) ? k : [k]).flatMap((f) => Object.keys(f)))].filter((x) => x !== 'offset' && x !== 'easing' && x !== 'composite');
      window.__anims.push({ cls: cls(this), parent: cls(this.parentElement), props, kind: this.dataset ? this.dataset.slot || this.dataset.k || this.dataset.p || '' : '' });
    } catch (e) {}
    return A.call(this, k, o);
  };
}
// screens as they start to leave: could they still be clicked or found?
window.__leaves = [];
new MutationObserver((ms) => { for (const m of ms) { const e = m.target; if (e.classList && e.classList.contains('menu-screen') && e.classList.contains('leaving') && !e.__seen) { e.__seen = true; window.__leaves.push({ inert: !!e.inert, found: e.querySelectorAll('[data-k], [id]').length, cls: e.className }); } } }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
// the loading screen's steps, as they are shown
window.__steps = [];
new MutationObserver(() => { const e = document.querySelector('.loading:not(.leaving) .ld-text'); if (e && window.__steps[window.__steps.length - 1] !== e.textContent) window.__steps.push(e.textContent); }).observe(document, { subtree: true, childList: true, characterData: true });"""
ANIMS = "(since) => window.__anims.slice(since)"
NANIMS = "() => window.__anims.length"

def init(lang='zh', mode='develop', coins=3000):
    return RECORD + "\nwindow.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; if (!localStorage.getItem('catan3d-settings-v1')) { localStorage.setItem('catan3d-settings-v1', JSON.stringify({ lang: '%s', speed: 'turbo', quality: 'low', qualityPicked: true, opponents: 3, mode: '%s', bps: [%s, %s, %s], bpCur: 0, bpv: 2 })); localStorage.setItem('catan3d-cards-v1', JSON.stringify({ own: %s, coins: %d, prog: { welcome: 1, games10: 6 } })); localStorage.setItem('catan3d-ms-seen', JSON.stringify({ games10: 2 })); }" % (lang, mode, json.dumps(BP), json.dumps(BP), json.dumps(BP), json.dumps(ALL), coins)

async def route(r):
    u = r.request.url
    if 'cdn.jsdelivr.net/npm/three' in u:
        await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
    elif 'fonts.g' in u:
        await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
    else:
        await r.continue_()

async def open_page(b, reduce=False, w=1366, h=820, mobile=False, extra=''):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, reduced_motion='reduce' if reduce else 'no-preference', is_mobile=mobile, has_touch=mobile)
    page = await ctx.new_page()
    page.set_default_timeout(120000)
    await page.add_init_script(init() + extra)
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    await page.route('**/*', route)
    await page.goto('http://127.0.0.1:8765/dist/index.test.html')
    await page.wait_for_selector('.menu-screen.home', timeout=60000)
    await page.wait_for_timeout(1200)
    return ctx, page, logs

def has(a, cls, props=None, parent=None):
    return any(cls in x['cls'] and (props is None or all(p in x['props'] for p in props)) and (parent is None or parent in x['parent']) for x in a)

async def start_game(page):
    await page.click('text=開始戰役')
    await page.wait_for_function('window.__game && window.__game.state')
    await page.evaluate('() => { window.__autoHuman = true; window.__game.schedule(); }')
    await page.wait_for_function("() => __game.state.phase === 'play'", timeout=240000)
    await page.wait_for_timeout(1500)
    # (the computers would carry on over the checks)
    await page.evaluate("() => { window.__autoHuman = false; __game.schedule = () => {}; clearTimeout(__game.timer); const s = __game.state; s.current = 0; s.rolled = true; s.pending = null; s.trade = null; __game.refresh(); }")
    await page.wait_for_timeout(500)

async def room(b):
    # ── a room: a player sitting down slides in, one leaving fades out ──
    ctx = await b.new_context(viewport={'width': 1100, 'height': 760})
    await ctx.route('**/*', route)
    rooms = []
    for name in ['"主持王國"', '"小明聯邦"']:
        pg = await ctx.new_page()
        pg.set_default_timeout(120000)
        await pg.add_init_script(init() + "\nwindow.__mockRoom = true; window.__perf = 100; window.__keySlot = %s; { const s = JSON.parse(localStorage.getItem('catan3d-settings-v1')); s.name = %s; localStorage.setItem('catan3d-settings-v1', JSON.stringify(s)); }" % (name, name))
        await pg.goto('http://127.0.0.1:8765/dist/index.test.html')
        await pg.wait_for_selector('.menu-screen.home', timeout=60000)
        rooms.append(pg)
    host, client = rooms
    await host.click('[data-k="create"]')
    await host.wait_for_selector('.code-box b', timeout=30000)
    code = (await host.inner_text('.code-box b')).strip()
    await host.wait_for_timeout(800)
    # (who sat where, each time the host's seats were drawn)
    await host.evaluate("() => { window.__sigs = []; setInterval(() => { const d = __sess() && __sess().seatDrawn; const k = d ? d.sigs.join('|') : ''; if (k && window.__sigs[window.__sigs.length - 1] !== k) window.__sigs.push(k); }, 10); }")
    n0 = await host.evaluate(NANIMS)
    await client.click('[data-k="join"]')
    await client.wait_for_selector('#join-code', timeout=20000)
    await client.fill('#join-code', code)
    await client.click('.join-row .btn')
    await host.wait_for_function("() => document.querySelector('.online-screen .seat-list').textContent.includes('小明聯邦')", timeout=60000)
    await client.click('.online-screen .modal-foot .btn')
    await host.wait_for_function("() => [...document.querySelectorAll('.online-screen .seat-list > .seat > .nm')].every((n) => !n.textContent.includes('小明聯邦'))", timeout=60000)
    await host.wait_for_timeout(500)
    a = await host.evaluate(ANIMS, n0)
    came = [x for x in a if x['props'] == ['opacity', 'translate'] and 'nm' in x['cls']]
    left = [x for x in a if 'seat-ghost' in x['cls']]
    seatsN = await host.evaluate("() => document.querySelectorAll('.online-screen .seat-list .seat').length")
    sigs = [x.split('|') for x in await host.evaluate("() => window.__sigs")]
    # (as many rows slid in as times someone sat down, as many faded out as times a player's seat went
    # to someone else or to nobody: a slow page here can drop out of the room for a moment and come back)
    sat = sum(1 for a0, b0 in zip(sigs, sigs[1:]) for x, y in zip(a0, b0) if y.startswith('remote:') and x != y)
    went = sum(1 for a0, b0 in zip(sigs, sigs[1:]) for x, y in zip(a0, b0) if x.startswith('remote:') and x != y)
    check('a room: a player sitting down slides in, one leaving fades out (not counted as a seat)', sat >= 1 and went >= 1 and len(came) == sat and len(left) == went and seatsN == 4, (len(came), sat, len(left), went, seatsN))
    await ctx.close()


async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        if os.environ.get('ONLY') == 'room':
            await room(b)
            await b.close()
            srv.shutdown()
            return finish()
        ctx, page, logs = await open_page(b)

        # ── the home screen ──
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("() => { const c = window.__cards.get(); c.fresh = [...c.fresh, 'market', 'camp']; window.__cards.commit(); }")
        await page.wait_for_timeout(700)
        a = await page.evaluate(ANIMS, n0)
        check('a badge whose number went up bounces', has(a, 'hm-badge', ['scale']), [x['cls'] for x in a][:5])
        seats = lambda k: [{'kind': 'host'}] + [{'kind': 'remote', 'name': 'x%d' % i, 'peer': 'p%d' % i} for i in range(k - 1)] + [{'kind': 'open'}] * (4 - k)
        await page.evaluate("(s) => __screen().setMatch({ phase: 'hosting', code: 'abcd', seats: s, seat: 0, rem: 40000 })", seats(1))
        await page.wait_for_timeout(800)
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("(s) => __screen().setMatch({ phase: 'hosting', code: 'abcd', seats: s, seat: 0, rem: 39000 })", seats(3))
        lit = await page.evaluate("() => document.querySelectorAll('.ho-shields .ho-lit').length")
        # (this browser draws few frames while the map turns behind: the glow goes when it is done, or
        # a moment after at the latest)
        await page.wait_for_timeout(1800)
        a = await page.evaluate(ANIMS, n0)
        bounced = [x for x in a if 'seat-shield' in x['cls'] and x['props'] == ['scale']]
        check("the official room: two players sit down, two shields light up and bounce", len(bounced) == 2 and lit == 2 and await page.evaluate("() => document.querySelectorAll('.ho-shields .ho-lit').length") == 0, (len(bounced), lit))
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("(s) => __screen().setMatch({ phase: 'hosting', code: 'abcd', seats: s, seat: 0, rem: 2900 })", seats(3))
        await page.wait_for_timeout(1300)
        final = await page.evaluate("() => document.querySelector('.ho-timer').classList.contains('final')")
        await page.screenshot(path=f'{SP}/ui10-final.png')
        a = await page.evaluate(ANIMS, n0)
        check('the last three seconds come up large', final and sum(1 for x in a if 'ho-sec' in x['cls'] and x['props'] == ['scale']) >= 2, (final, sum(1 for x in a if 'ho-sec' in x['cls'])))
        await page.evaluate("() => __screen().setMatch(null)")

        # ── the Cards page: the blueprint stays on top ──
        await page.click('.hm-tab[data-k="cards"]')
        await page.wait_for_selector('.menu-screen.page .cards-page')
        await page.wait_for_timeout(600)
        top0 = await page.evaluate("() => document.querySelector('.cp-deck').getBoundingClientRect().top")
        await page.evaluate("() => { const s = document.querySelector('.cp-scroll'); s.scrollTop = s.scrollHeight; }")
        await page.wait_for_timeout(300)
        st = await page.evaluate("() => { const s = document.querySelector('.cp-scroll'), d = document.querySelector('.cp-deck').getBoundingClientRect(); return { scrolled: s.scrollTop, deck: d.top, page: document.querySelector('.pg-main').scrollTop }; }")
        check('the blueprint stays at the top while the collection scrolls under it', st['scrolled'] > 100 and abs(st['deck'] - top0) < 1 and st['page'] == 0, (top0, st))
        await page.screenshot(path=f'{SP}/ui10-cards-scrolled.png')
        # a wonder in its place: the gardens make way for the library
        await page.click('.cp-coll .cc[data-k="library"]')
        kept = await page.evaluate("() => document.querySelector('.cp-scroll').scrollTop")
        n0 = await page.evaluate(NANIMS)
        # (pressed from the page itself: Playwright would first scroll the button into view)
        await page.evaluate("() => document.querySelector('.cp-acts .btn.primary').click()")
        fly = await page.evaluate("() => document.querySelectorAll('.m-fly .m-flyer').length")
        await page.wait_for_timeout(1400)
        a = await page.evaluate(ANIMS, n0)
        bp = await page.evaluate("() => JSON.parse(localStorage.getItem('catan3d-settings-v1')).bps[0]")
        after = await page.evaluate("() => { const s = document.querySelector('.cp-scroll'); return { scroll: s.scrollTop, max: s.scrollHeight - s.clientHeight, shown: getComputedStyle(document.querySelector('.cp-slot[data-slot=\"library\"] .cc')).visibility }; }")
        flyers = [x for x in a if 'm-flyer' in x['cls']]
        check('a wonder makes way: the old one fades out of its place as the new one flies in', fly == 2 and len(flyers) == 2 and 'library' in bp and 'gardens' not in bp and after['shown'] == 'visible', (fly, len(flyers), bp, after))
        check('the collection stays where it was scrolled as the page is drawn again', kept > 100 and abs(after['scroll'] - min(kept, after['max'])) < 2, (kept, after))

        # ── the Missions page, then Draw & Shop (from the rail: one page in another's place) ──
        n0 = await page.evaluate(NANIMS)
        await page.click('.pg-item[data-k="missions"]')
        await page.wait_for_selector('.menu-screen.page .missions-page')
        await page.wait_for_timeout(1200)
        a = await page.evaluate(ANIMS, n0)
        grew = [x for x in a if 'ms-bar' in x['parent'] and x['props'] == ['translate']]
        seen = await page.evaluate("() => JSON.parse(localStorage.getItem('catan3d-ms-seen'))")
        check("a mission's bar grows from where it was last seen", len(grew) == 1 and seen.get('games10') == 6, (len(grew), seen.get('games10')))
        n0 = await page.evaluate(NANIMS)
        await page.click('.pg-item[data-k="shop"]')
        await page.click('.pg-item[data-k="missions"]')
        await page.wait_for_timeout(300)
        a = await page.evaluate(ANIMS, n0)
        check('...and only once', not [x for x in a if 'ms-bar' in x['parent']], len(a))
        # ten drawn, all the last card of the pack (a wonder): its back glows gold before it turns over
        await page.evaluate("() => { crypto.getRandomValues = (arr) => { arr[0] = 0xfffffff0; return arr; }; }")
        await page.click('.pg-item[data-k="shop"]')
        await page.wait_for_selector('.menu-screen.page .shop-page')
        await page.click('.btn.sp-draw >> nth=1')
        await page.wait_for_timeout(250)
        # (the button goes when the cards are all over: pressed at once, the browser here being slow)
        mid = await page.evaluate("() => { const m = { wonders: document.querySelectorAll('.sp-reveal .rv.wonder').length, glow: document.querySelectorAll('.sp-reveal .rv-glow').length, skip: !!document.querySelector('.rv-skip'), playing: document.querySelector('.sp-reveal').getAnimations({ subtree: true }).filter((x) => x.playState !== 'finished').length }; const b = document.querySelector('.rv-skip'); if (b) b.click(); return m; }")
        await page.wait_for_timeout(150)
        done = await page.evaluate("() => ({ skip: !!document.querySelector('.rv-skip'), playing: document.querySelector('.sp-reveal').getAnimations({ subtree: true }).filter((x) => x.playState !== 'finished').length })")
        c = await page.evaluate("() => window.__cards.get()")
        await page.wait_for_function("(n) => +document.querySelector('.sp-bals .cur.shard .num').textContent.replace(/,/g, '') === n", arg=c['shards'], timeout=40000)
        await page.screenshot(path=f'{SP}/ui10-draw.png')
        check("ten drawn: a wonder's back glows gold, and 'turn them all over' shows them at once", mid['wonders'] == 10 and mid['glow'] == 10 and mid['skip'] and mid['playing'] > 10 and not done['skip'] and done['playing'] == 0, (mid, done))
        # (one drawn: a picture of the glow, the flip held as the gold comes up)
        await page.click('.btn.sp-draw >> nth=0')
        await page.wait_for_timeout(120)
        await page.evaluate("() => { for (const a of document.querySelector('.sp-reveal').getAnimations({ subtree: true })) { a.pause(); a.currentTime = 450; } }")
        await page.screenshot(path=f'{SP}/ui10-glow.png')
        await page.evaluate("() => { for (const a of document.querySelector('.sp-reveal').getAnimations({ subtree: true })) a.finish(); }")
        await page.click('.pg-home')
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.wait_for_timeout(500)

        # ── to the setup: the home screen fades over ──
        await page.evaluate("() => { window.__leaves = []; }")
        n0 = await page.evaluate(NANIMS)
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(1500)
        leaves = await page.evaluate("() => window.__leaves")
        a = await page.evaluate(ANIMS, n0)
        gone = await page.evaluate("() => ({ leaving: document.querySelectorAll('.menu-screen.leaving').length, next: !!document.querySelector('.menu-screen:not(.leaving) .setup-card') })")
        check('the home screen fades out over the setup and cannot be clicked or found meanwhile', len(leaves) == 1 and 'home' in leaves[0]['cls'] and leaves[0]['inert'] and leaves[0]['found'] == 0 and has(a, 'menu-screen home', ['opacity']) and gone['leaving'] == 0 and gone['next'], (leaves, gone))
        # a choice among a few: the selection slides over (the last row: not the mode)
        n0 = await page.evaluate(NANIMS)
        await page.locator('.setup-card .seg:not(.maps)').last.locator('button:not(.on)').first.click()
        await page.wait_for_timeout(1200)
        a = await page.evaluate(ANIMS, n0)
        left = await page.evaluate("() => document.querySelectorAll('.seg-glide, .seg.gliding').length")
        check('a choice among a few: the selection slides over to it', has(a, 'seg-glide', ['translate']) and left == 0, ([x['cls'] for x in a][:4], left))
        # the campaign starts step by step
        await start_game(page)
        steps = await page.evaluate("() => window.__steps")
        loading = await page.evaluate("() => document.querySelectorAll('.loading').length")
        check('the campaign starts step by step (a bar filling), then the screen fades away', steps[-3:] == ['佈置戰場', '測繪島嶼地形', '召集各國'] and loading == 0, (steps, loading))

        # ── in a game ──
        g = "__game"
        # a piece put down drops from above and lands
        drop = await page.evaluate("""() => { const g = __game, s = g.state, m = __mapView(), G = __geo();
          const v = G.vertices.findIndex((x, i) => !s.vertices[i] && !x.neighbors.some((n) => s.vertices[n]) && x.hexes.every((h) => s.board.hexes[h].terrain !== 'sea'));
          s.vertices[v] = { p: 0, t: 's' }; m.sync(g.view(), [], true);
          const r = m.pieces.buildings.get(v);
          return { v, anim: m.pieces.anims.some((a) => a.kind === 'drop' && a.rec === r), up: r.mesh.position.y - r.baseY }; }""")
        # (frames by hand: the map draws a frame every two seconds here)
        landed = await page.evaluate("(v) => { const m = __mapView(), r = m.pieces.buildings.get(v); const ys = []; for (let i = 0; i < 16; i++) { m.pieces.update(0, 0.05); ys.push(r.mesh.position.y - r.baseY); } return { y: Math.abs(r.mesh.position.y - r.baseY), anim: r.anim, fell: ys.slice(0, 6).every((y, i) => i === 0 || y <= ys[i - 1] + 1e-9), squash: Math.min(...ys.map((_, i) => i)) >= 0 }; }", drop['v'])
        check('a piece put down drops from above and lands', drop['anim'] and drop['up'] > 1 and landed['y'] < 1e-6 and not landed['anim'], (drop, landed))
        # the turn passes on: its mark slides to the next nation
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("() => { const s = __game.state; s.current = 1; __game.refresh(); }")
        mid = await page.evaluate("() => ({ mark: document.querySelectorAll('.ol-body .ol-turn').length, arriving: !!document.querySelector('.nation.current.arriving[data-p=\"1\"]') })")
        await page.wait_for_timeout(2500)
        a = await page.evaluate(ANIMS, n0)
        end = await page.evaluate("() => ({ mark: document.querySelectorAll('.ol-body .ol-turn').length, arriving: document.querySelectorAll('.arriving').length })")
        check("the turn passes on: its mark slides to the next nation's row", mid['mark'] == 1 and mid['arriving'] and has(a, 'ol-turn', ['translate']) and end['mark'] == 0 and end['arriving'] == 0, (mid, end))
        await page.evaluate("() => { const s = __game.state; s.current = 0; __game.refresh(); }")
        await page.wait_for_timeout(500)
        # a trade offer: the cards go out to the nations asked; their answers beside them
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("() => __game.presentFx([{ type: 'offer', p: 0, give: { wood: 1, ore: 2 }, get: { grain: 1 }, to: [1, 2, 3] }], __game.view())")
        a = await page.evaluate(ANIMS, n0)
        cards = [x for x in a if 'fx-card' in x['cls']]
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("() => { const s = __game.state; s.trade = { id: 77, from: 0, give: { wood: 1 }, get: { grain: 1 }, resp: { 1: 'yes', 2: 'no', 3: null } }; __game.refresh(); }")
        marks = await page.evaluate("() => ['yes', 'no', 'wait'].map((k) => document.querySelectorAll('.ol-resp.' + k).length)")
        a = await page.evaluate(ANIMS, n0)
        await page.screenshot(path=f'{SP}/ui10-trade.png')
        n1 = await page.evaluate(NANIMS)
        await page.evaluate("() => __game.refresh()")
        again = [x for x in await page.evaluate(ANIMS, n1) if 'ol-resp' in x['cls']]
        check('an offer goes out to each nation asked; the answers show beside them, bouncing once', len(cards) == 6 and marks == [1, 1, 1] and sum(1 for x in a if 'ol-resp' in x['cls']) == 2 and not again, (len(cards), marks, len(again)))
        await page.evaluate("() => { __game.state.trade = null; __game.refresh(); }")
        # a card stolen from you trembles in the hand first
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("() => __game.presentFx([{ type: 'steal', p: 1, from: 0, res: 'wood' }], __game.view())")
        a = await page.evaluate(ANIMS, n0)
        await page.wait_for_timeout(500)
        b2 = await page.evaluate(ANIMS, n0)
        check('a card stolen from you trembles first, then goes', any(x['props'] == ['translate'] for x in a) and not any('fx-card' in x['cls'] for x in a) and any('fx-card' in x['cls'] for x in b2), ([x['cls'] for x in a][:3]))
        # the tooltip fades in
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("() => { __game.hud.showTip(null); __game.hud.showTip('<h5>x</h5>', 500, 300); __game.hud.showTip('<h5>y</h5>', 520, 310); }")
        a = await page.evaluate(ANIMS, n0)
        check('a tooltip fades in (once, not as it follows the pointer)', sum(1 for x in a if 'tooltip' in x['cls'] and x['props'] == ['opacity']) == 1, len(a))
        await page.evaluate("() => __game.hud.showTip(null)")
        # a wonder's stage done: its card in the nation's blueprint bounces
        n0 = await page.evaluate(NANIMS)
        k = await page.evaluate("() => __game.state.players[0].bp.find((k) => ['gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library'].includes(k))")
        await page.evaluate("(k) => __game.popWonder(0, k)", k)
        await page.wait_for_timeout(400)
        a = await page.evaluate(ANIMS, n0)
        check("a wonder's stage done: its card in the nations list bounces", k and any('bp-mini' in x['cls'] and x['kind'] == k and x['props'] == ['scale'] for x in a), k)
        # previews: a settlement, a development, a wonder, a building beside a settlement
        prev = await page.evaluate("""() => { const g = __game, s = g.state, m = __mapView(), G = __geo();
          const out = {};
          const v = G.vertices.findIndex((x, i) => !s.vertices[i] && !x.neighbors.some((n) => s.vertices[n]) && x.hexes.every((h) => s.board.hexes[h].terrain !== 'sea'));
          m.setInteraction({ kind: 'vertex', ids: [v], ghost: 'settlement', player: 0, onPick() {} });
          m.setHover(v);
          const o = m.pieces.ghostObj;
          out.piece = !!o && o.position.y > m.pieces.vertexPos(v).y + 0.3;
          const h = s.board.hexes.findIndex((x, i) => x.terrain === 'fields' && !(s.plots || [])[i]);
          m.setInteraction({ kind: 'hex', ids: [h], player: 0, devGhost: { what: 'plot' }, onPick() {} });
          m.setHover(h);
          const gp = m.developLayer.ghostIt;
          out.plot = !!gp && gp.obj.position.y > gp.y0 + 0.5 && !m.pieces.ghostObj;
          let see = true; if (gp) gp.obj.traverse((x) => { if (x.isMesh && !(x.material.transparent && x.material.opacity < 1)) see = false; });
          out.through = see;
          const d = s.board.hexes.findIndex((x) => x.terrain === 'desert');
          m.setInteraction({ kind: 'hex', ids: [d], player: 0, devGhost: { what: 'wonder', k: 'library' }, onPick() {} });
          m.setHover(d);
          out.wonder = !!m.developLayer.ghostIt && m.developLayer.ghostIt.kind === 'wonder';
          const mine = s.vertices.findIndex((x) => x && x.p === 0);
          m.setInteraction({ kind: 'vertex', ids: [mine], player: 0, devGhost: { what: 'annex', k: 'market' }, onPick() {} });
          m.setHover(mine);
          out.annex = !!m.developLayer.ghostIt && m.developLayer.ghostIt.kind === 'annex';
          m.setHover(null);
          out.cleared = !m.developLayer.ghostIt;
          m.setInteraction(null);
          return out; }""")
        check('choosing where to build: what would stand there shows, see-through, dropping into place', all(prev.values()), prev)
        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors', not errors, errors[:5])
        await ctx.close()

        # ── a phone: the blueprint on top too ──
        ctx, page, logs = await open_page(b, w=390, h=844, mobile=True)
        await page.click('.hm-tab[data-k="cards"]')
        await page.wait_for_selector('.menu-screen.page .cards-page')
        await page.wait_for_timeout(700)
        await page.screenshot(path=f'{SP}/ui10-phone-cards.png')
        ph = await page.evaluate("() => { const s = document.querySelector('.cp-scroll'), d = document.querySelector('.cp-deck').getBoundingClientRect(); s.scrollTop = 400; return { deck: d.bottom, room: s.getBoundingClientRect().height, tall: s.scrollHeight > s.clientHeight, top: document.querySelector('.cp-deck').getBoundingClientRect().top === d.top }; }")
        await page.wait_for_timeout(200)
        await page.screenshot(path=f'{SP}/ui10-phone-cards-scrolled.png')
        check('a phone: the blueprint on top, the collection scrolling under it with room to see', ph['tall'] and ph['top'] and ph['room'] > 380 and ph['deck'] < 330, ph)
        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors (phone)', not errors, errors[:5])
        await ctx.close()

        await room(b)

        # ── reduce motion: nothing slides, bounces or drops ──
        ctx, page, logs = await open_page(b, reduce=True)
        n0 = await page.evaluate(NANIMS)
        await page.evaluate("() => { const c = window.__cards.get(); c.fresh = [...c.fresh, 'post']; window.__cards.commit(); }")
        await page.click('[data-k="single"]')
        await page.wait_for_timeout(1500)
        await page.locator('.setup-card .seg:not(.maps)').last.locator('button:not(.on)').first.click()
        await page.wait_for_timeout(300)
        await start_game(page)
        await page.evaluate("""() => { const g = __game, s = g.state, m = __mapView(), G = __geo();
          const v = G.vertices.findIndex((x, i) => !s.vertices[i] && !x.neighbors.some((n) => s.vertices[n]) && x.hexes.every((h) => s.board.hexes[h].terrain !== 'sea'));
          s.vertices[v] = { p: 0, t: 's' }; m.sync(g.view(), [], true); s.current = 1; g.refresh(); }""")
        await page.wait_for_timeout(500)
        a = await page.evaluate(ANIMS, n0)
        moving = [x for x in a if 'translate' in x['props'] or 'scale' in x['props'] or 'rotate' in x['props'] or 'transform' in x['props']]
        drops = await page.evaluate("() => __mapView().pieces.anims.filter((a) => a.kind === 'drop').length")
        check('reduce motion: nothing slides, bounces or drops (things only fade)', not moving and drops == 0, (moving[:4], drops))
        errors = [l for l in logs if 'pageerror' in l or '[error]' in l]
        check('no page errors (reduce motion)', not errors, errors[:5])
        await ctx.close()
        await b.close()
    srv.shutdown()
    finish()

def finish():
    bad = [k for k, v in results.items() if not v]
    print('\nui10: ' + ('all passed' if not bad else 'FAILED: ' + ', '.join(bad)))
    sys.exit(1 if bad else 0)

asyncio.run(main())
