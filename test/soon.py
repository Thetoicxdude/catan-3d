# What a player sees at the launch (src/meta/features.js, src/ui/soon.js): the development mode closed —
# the side bar's Cards, Draw & Shop and Missions greyed (a click says "Coming soon" and opens nothing),
# no coins or badges, the mode greyed in the single-player setup and the room lobby, the Profile page's
# collection and blueprint greyed under a tag, the rules without the development mode; the credits at the
# end of the rules and at the foot of the Settings page (none on the home screen); the name Hexverse and
# no other game's; what a player kept under the earlier keys moved (src/meta/keys.js); the owner's switch
# (#dev-open, #dev-close); the same in English.
#   python3 test/soon.py          (SHOTS=dir for the screenshots)
import asyncio, sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'hexverse-shots')
os.makedirs(SP, exist_ok=True)
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

# a player of the earlier version (once, before the first load): their settings and cards under the
# earlier keys, a development-mode setup among them
EARLIER = 'catan' + '3d-'
FIRST = ("if (!sessionStorage.getItem('t-once')) { sessionStorage.setItem('t-once', '1');"
         " localStorage.setItem('%ssettings-v1', JSON.stringify({ lang: 'LANG', speed: 'turbo', quality: 'low', qualityPicked: true, name: '舊王國', mode: 'develop', opponents: 3 }));"
         " localStorage.setItem('%scards-v1', JSON.stringify({ own: ['granary', 'market', 'aqueduct'], coins: 340 })); }") % (EARLIER, EARLIER)
INIT = "window.__noAssets = true; window.__testHooks = true; window.__mapFps = 0.5; window.__mockRoom = true; " + FIRST

# the slip: shown, its words, inside the screen; and gone again after a while
SLIP = "() => { const s = document.querySelector('.soon-slip'); if (!s) return null; const r = s.getBoundingClientRect(); return { text: s.textContent, role: s.getAttribute('role'), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; }"

async def route(r):
    u = r.request.url
    if 'cdn.jsdelivr.net/npm/three' in u:
        await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
    elif 'fonts.g' in u:
        await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
    else:
        await r.continue_()

async def open_ctx(b, lang):
    ctx = await b.new_context(viewport={'width': 1366, 'height': 820})
    page = await ctx.new_page()
    page.set_default_timeout(60000)
    await page.add_init_script(INIT.replace('LANG', lang))
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    await page.route('**/*', route)
    await page.goto('http://127.0.0.1:8765/dist/index.test.html')
    await page.wait_for_selector('.menu-screen.home:not(.leaving)', timeout=60000)
    await page.wait_for_timeout(900)
    return ctx, page, logs

async def slip_after(page, sel, label, word):
    # (force: a closed thing is aria-disabled, which Playwright won't click, but a player can)
    await page.click(sel, force=True)
    await page.wait_for_selector('.soon-slip', timeout=3000)
    s = await page.evaluate(SLIP)
    check(f'{label}: "{word}" by it', s and s['text'] == word and s['inside'] and s['role'] == 'status', s)
    return s

async def close_dialog(page):
    await page.keyboard.press('Escape')
    await page.wait_for_timeout(300)

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx, page, logs = await open_ctx(b, 'zh')

        # ── what was kept under the earlier keys, moved ──
        keys = await page.evaluate("() => Object.keys(localStorage).sort()")
        s = await page.evaluate("() => JSON.parse(localStorage.getItem('hexverse-settings-v1') || 'null')")
        c = await page.evaluate("() => JSON.parse(localStorage.getItem('hexverse-cards-v1') || 'null')")
        check('the earlier keys moved to the new ones, none left behind', not any(k.startswith(EARLIER) for k in keys) and s and s.get('name') == '舊王國' and c and c.get('coins') == 340, keys)

        # ── the home screen: the name, nothing of another game, no credits ──
        home = await page.evaluate("() => ({ title: document.title, name: document.querySelector('.hm-title').textContent, credits: !!document.querySelector('.hm-credits'), text: document.body.innerText })")
        low = home['text'].lower()
        check('the name is Hexverse (the page and the home screen)', home['title'] == 'Hexverse' and home['name'] == 'Hexverse', (home['title'], home['name']))
        check('no other game\'s name on the home screen', 'catan' not in low and '卡坦' not in home['text'])
        check('no credits on the home screen', not home['credits'] and 'polyhaven' not in low and 'game-icons' not in low)

        # ── the side bar: the development mode's pages greyed, the others as before ──
        tabs = await page.evaluate("() => [...document.querySelectorAll('.hm-tab')].map((t) => [t.dataset.k, t.classList.contains('soon'), t.getAttribute('aria-disabled'), t.title, getComputedStyle(t).filter !== 'none'])")
        want = {'cards': True, 'shop': True, 'missions': True, 'profile': False, 'settings': False}
        check('Cards, Draw & Shop and Missions greyed; Profile and Settings not', all(t[1] == want[t[0]] and (t[2] == 'true') == want[t[0]] and t[4] == want[t[0]] for t in tabs) and len(tabs) == 5, tabs)
        check('a greyed tab says so in its title', all(('即將推出' in t[3]) == want[t[0]] for t in tabs), [t[3] for t in tabs])
        marks = await page.evaluate("() => ({ badges: [...document.querySelectorAll('.hm-tab .hm-badge')].filter((b) => !b.hidden).length, purse: document.querySelectorAll('.nav-purse').length })")
        check('no badges and no coins on the side bar', marks['badges'] == 0 and marks['purse'] == 0, marks)
        await slip_after(page, '.hm-tab[data-k="cards"]', 'the Cards tab clicked', '即將推出')
        await page.screenshot(path=f'{SP}/soon-home.png')
        still = await page.evaluate("() => ({ home: !!document.querySelector('.menu-screen.home:not(.leaving)'), page: !!document.querySelector('.menu-screen.page') })")
        check('…and no page opens', still['home'] and not still['page'], still)
        await page.wait_for_timeout(2300)
        check('the slip goes by itself', await page.evaluate("() => !document.querySelector('.soon-slip')"))
        await slip_after(page, '.hm-tab[data-k="missions"]', 'the Missions tab clicked', '即將推出')

        # ── the rules: no development mode, the credits last ──
        await page.click('.hm-medal[data-k="rules"]')
        await page.wait_for_selector('.modal .rules')
        r = await page.evaluate("() => { const x = document.querySelector('.modal .rules'); const hs = [...x.querySelectorAll('h4')].map((h) => h.textContent); const links = [...x.querySelectorAll('.credits a')].map((a) => a.href); return { hs, links, text: x.innerText }; }")
        check('the rules: no development mode section, no development key', '發展模式' not in r['hs'] and '發展模式' not in r['text'], r['hs'])
        check('the rules end with the credits (the art and the icons, the licence linked)', r['hs'][-1] == '素材來源' and any('game-icons.net' in l for l in r['links']) and any('creativecommons.org/licenses/by/3.0' in l for l in r['links']) and any('polyhaven.com' in l for l in r['links']) and any('kenney.nl' in l for l in r['links']), (r['hs'][-1:], r['links']))
        check('no other game\'s name in the rules', 'catan' not in r['text'].lower() and '卡坦' not in r['text'])
        # (the build costs: a token per card with each resource named, for players new to the pictures)
        ct = await page.evaluate("() => { const t = document.querySelector('.modal .cost-table'); return { groups: t.querySelectorAll('.cost-res').length, toks: t.querySelectorAll('.rtok').length, names: [...t.querySelectorAll('.ct-name')].slice(0, 2).map((n) => n.textContent) }; }")
        check('the rules\' build costs: a token per card, each resource named', ct['groups'] == 11 and ct['toks'] == 14 and ct['names'] == ['木材', '磚塊'], ct)
        await close_dialog(page)

        # ── Settings: the credits and the version at its foot, small ──
        await page.click('.hm-tab[data-k="settings"]')
        await page.wait_for_selector('.menu-screen.page[data-page="settings"] .set-foot')
        await page.wait_for_timeout(500)
        f = await page.evaluate("""() => { const f = document.querySelector('.set-foot'); const secs = [...document.querySelectorAll('.set-sec')]; const last = secs[secs.length - 1].getBoundingClientRect(); const r = f.getBoundingClientRect();
          return { text: f.innerText, links: [...f.querySelectorAll('a')].map((a) => a.href), below: r.top >= last.bottom, size: parseFloat(getComputedStyle(f).fontSize), ver: !!f.querySelector('.set-ver'), bals: document.querySelector('.pg-bals').innerHTML,
            rail: [...document.querySelectorAll('.pg-item')].map((b) => [b.dataset.k, b.classList.contains('soon')]) }; }""")
        check('Settings: the credits at its foot, under the last section, in small type', '素材來源' in f['text'] and f['below'] and f['size'] <= 12 and any('game-icons.net' in l for l in f['links']) and any('creativecommons.org/licenses/by/3.0' in l for l in f['links']), (f['size'], f['below'], f['links']))
        check('the page\'s rail: the same three greyed; no coins in the header', [k for k, soon in f['rail'] if soon] == ['cards', 'shop', 'missions'] and f['bals'] == '', f['rail'])
        await page.evaluate("() => { const m = document.querySelector('.pg-main'); m.scrollTop = m.scrollHeight; }")
        await page.wait_for_timeout(300)
        await page.screenshot(path=f'{SP}/soon-settings.png')
        await slip_after(page, '.pg-item[data-k="shop"]', 'Draw & Shop clicked on the rail', '即將推出')
        check('…and the Settings page stays', await page.evaluate("() => document.querySelector('.menu-screen.page:not(.leaving)').dataset.page") == 'settings')

        # ── Profile: the collection and the blueprint greyed under a tag, out of reach ──
        await page.click('.pg-item[data-k="profile"]')
        await page.wait_for_selector('.pf-coll.soon .soon-tag')
        await page.wait_for_timeout(500)
        pf = await page.evaluate("""() => { const q = (s) => document.querySelector(s);
          return { coll: q('.pf-coll').classList.contains('soon'), deck: q('.pf-deck').classList.contains('soon'), nation: q('.pf-nation').classList.contains('soon'),
            tags: [...document.querySelectorAll('.soon-tag')].map((t) => t.textContent),
            inert: [...document.querySelectorAll('.pf-coll button, .pf-deck button')].every((b) => !!b.closest('[inert]')),
            grey: getComputedStyle(q('.pf-deck .pf-deckrow')).filter, name: !q('#menu-name').closest('[inert]') }; }""")
        check('Profile: the collection and the blueprint greyed under "Coming soon", the nation not', pf['coll'] and pf['deck'] and not pf['nation'] and pf['tags'] == ['即將推出', '即將推出'] and 'grayscale' in pf['grey'] and pf['name'], pf)
        check('…their buttons out of reach (inert)', pf['inert'])
        await page.screenshot(path=f'{SP}/soon-profile.png')
        box = await page.locator('.pf-deck').bounding_box()
        await page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] * 0.6)
        await page.wait_for_selector('.soon-slip', timeout=3000)
        s = await page.evaluate(SLIP)
        check('a click on the greyed blueprint says "Coming soon" and stays on the page', s and s['text'] == '即將推出' and await page.evaluate("() => document.querySelector('.menu-screen.page:not(.leaving)').dataset.page") == 'profile', s)

        # ── the single-player setup: the mode greyed, standard kept ──
        await page.click('.pg-home')
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.wait_for_timeout(400)
        await page.click('[data-k="single"]')
        await page.wait_for_selector('button[data-mode="develop"]')
        await page.wait_for_timeout(400)
        m = await page.evaluate("() => ({ soon: document.querySelector('button[data-mode=\"develop\"]').classList.contains('soon'), on: document.querySelector('button[data-mode].on').dataset.mode, deck: !!document.querySelector('.deck-line') })")
        check('the setup: the development mode greyed, standard chosen (an earlier develop setup too), no blueprint', m['soon'] and m['on'] == 'standard' and not m['deck'], m)
        await slip_after(page, 'button[data-mode="develop"]', 'the development mode clicked in the setup', '即將推出')
        await page.wait_for_timeout(300)
        on = await page.evaluate("() => document.querySelector('button[data-mode].on').dataset.mode")
        check('…and the mode stays standard', on == 'standard')
        await page.screenshot(path=f'{SP}/soon-setup.png')

        # ── a room of one's own: the mode greyed in the lobby ──
        await page.goto('http://127.0.0.1:8765/dist/index.test.html')
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.click('[data-k="create"]')
        await page.wait_for_selector('.layout-row .seg button.soon', timeout=20000)
        lob = await page.evaluate("() => { const b = document.querySelector('.layout-row .seg button.soon'); return { text: b.textContent, on: b.parentElement.querySelector('.on').textContent }; }")
        check('the room lobby: the development mode greyed, standard chosen', lob['text'] == '發展模式' and lob['on'] == '標準', lob)
        await slip_after(page, '.layout-row .seg button.soon', 'the development mode clicked in the lobby', '即將推出')
        await page.screenshot(path=f'{SP}/soon-room.png')

        # ── the owner's switch: #dev-open on this device, #dev-close back ──
        await page.goto('http://127.0.0.1:8765/dist/index.test.html#dev-open')
        await page.reload()
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.wait_for_timeout(800)
        o = await page.evaluate("() => ({ flag: localStorage.getItem('hexverse-dev-open'), hash: location.hash, soon: document.querySelectorAll('.hm-tab.soon').length, purse: (document.querySelector('.nav-purse') || {}).textContent })")
        check('#dev-open: the pages open on this device (the moved coins there), the address cleaned', o['flag'] == '1' and o['hash'] == '' and o['soon'] == 0 and o['purse'] == '340', o)
        await page.click('.hm-medal[data-k="rules"]')
        await page.wait_for_selector('.modal .rules')
        hs = await page.evaluate("() => [...document.querySelectorAll('.modal .rules h4')].map((h) => h.textContent)")
        check('…and the rules have the development mode again, before the credits', '發展模式' in hs and hs[-1] == '素材來源', hs[-4:])
        await close_dialog(page)
        await page.goto('http://127.0.0.1:8765/dist/index.test.html#dev-close')
        await page.reload()
        await page.wait_for_selector('.menu-screen.home:not(.leaving)')
        await page.wait_for_timeout(600)
        o = await page.evaluate("() => ({ flag: localStorage.getItem('hexverse-dev-open'), soon: document.querySelectorAll('.hm-tab.soon').length })")
        check('#dev-close: closed again', o['flag'] is None and o['soon'] == 3, o)
        zh_logs = [l for l in logs if 'pageerror' in l or '[error]' in l]
        await ctx.close()

        # ── the same in English ──
        ctx, page, logs = await open_ctx(b, 'en')
        t = await page.evaluate("() => document.querySelector('.hm-tab[data-k=\"cards\"]').title")
        check('English: a greyed tab\'s title says Coming soon', 'Coming soon' in t, t)
        await slip_after(page, '.hm-tab[data-k="shop"]', 'English: Draw & Shop clicked', 'Coming soon')
        await page.click('.hm-medal[data-k="rules"]')
        await page.wait_for_selector('.modal .rules')
        hs = await page.evaluate("() => [...document.querySelectorAll('.modal .rules h4')].map((h) => h.textContent)")
        check('English rules: no Empire Mode, Credits last', 'Empire Mode' not in hs and hs[-1] == 'Credits', hs[-3:])
        names = await page.evaluate("() => [...document.querySelectorAll('.modal .cost-table .ct-name')].slice(0, 5).map((n) => n.textContent)")
        check('English rules: the resources named in English', names == ['Lumber', 'Brick', 'Lumber', 'Brick', 'Wool'], names)
        await close_dialog(page)
        await page.click('.hm-tab[data-k="settings"]')
        await page.wait_for_selector('.set-foot')
        ft = await page.inner_text('.set-foot')
        check('English settings: the credits at the foot', ft.startswith('CREDITS') or ft.startswith('Credits'), ft[:60])
        en_logs = [l for l in logs if 'pageerror' in l or '[error]' in l or '[i18n]' in l]
        await ctx.close()

        bad = zh_logs + en_logs
        check('no page errors', not bad, bad[:5])
        await b.close()
    srv.shutdown()
    failed = [k for k, v in results.items() if not v]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
