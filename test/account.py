# Signing in on the game's own site and the record of finished campaigns (needs `npm run dev` started
# with the test signing key in .dev.vars: `node test/accounts.mjs --keys DIR` and copy DIR/dev.vars).
# Google's sign-in button is replaced by a stand-in that hands the page a token signed with that key.
#   KEYS=DIR python3 test/account.py
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'catan-shots')
os.makedirs(SP, exist_ok=True)
SITE = os.environ.get('SITE', 'http://127.0.0.1:8787/')
KEY = json.load(open(os.path.join(os.environ['KEYS'], 'keys.json')))
CLIENT_ID = open(os.path.join(os.path.dirname(__file__), '..', 'server', 'config.js')).read().split("'")[1]
STUB = """
window.__noAssets = true; window.__mapFps = 0.2; window.__autoHuman = true;
localStorage.setItem('catan3d-settings-v1', JSON.stringify({ speed: 'turbo', quality: 'low', qualityPicked: true, opponents: 1, target: 8, name: '測試王國' }));
(() => {
  const KEY = %s, AUD = %s;
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const enc = (o) => b64(new TextEncoder().encode(JSON.stringify(o)));
  async function mint() {
    const k = await crypto.subtle.importKey('jwk', KEY.priv, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const now = Math.floor(Date.now() / 1000);
    const h = enc({ alg: 'RS256', kid: KEY.kid, typ: 'JWT' });
    const p = enc({ iss: 'https://accounts.google.com', aud: AUD, sub: 'uitest' + (window.__sub || '1'), name: '小卡', picture: '', email: 'not-kept@example.com', iat: now, exp: now + 600 });
    const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(h + '.' + p));
    return h + '.' + p + '.' + b64(s);
  }
  let cfg = null;
  // stand-in for Google's sign-in library
  window.google = { accounts: { id: {
    initialize(c) { cfg = c; },
    renderButton(el) {
      el.innerHTML = '<button type="button" id="fake-gsi" style="height:40px;padding:0 18px;border-radius:20px;background:#202124;color:#fff;border:1px solid #5f6368">使用 Google 帳戶登入（測試）</button>';
      el.querySelector('button').onclick = async () => cfg.callback({ credential: await mint() });
    },
    disableAutoSelect() {},
  } } };
})();
""" % (json.dumps(KEY), json.dumps(CLIENT_ID))
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 760})
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            elif 'accounts.google.com' in u: await r.fulfill(status=200, body='', headers={'content-type': 'application/javascript'})
            else: await r.continue_()
        await ctx.route('**/*', route)
        page = await ctx.new_page()
        page.set_default_timeout(120000)
        page.on('pageerror', lambda e: print('pageerror', e))
        await page.add_init_script(STUB.replace("window.__sub || '1'", repr(str(int(time.time())))))
        await page.goto(SITE)
        await page.wait_for_selector('.hm-account', timeout=90000)
        await page.wait_for_function("document.querySelector('.hm-account').textContent.includes('登入')", timeout=30000)
        check('signed out: the plate offers to sign in', True, (await page.inner_text('.hm-account')).replace('\n', ' '))
        await page.screenshot(path=f'{SP}/acct-home.png')
        await page.click('.hm-account')
        await page.wait_for_selector('#fake-gsi', timeout=30000)
        await page.screenshot(path=f'{SP}/acct-signin.png')
        await page.click('#fake-gsi')
        ok = await page.wait_for_function("document.querySelector('.hm-account').classList.contains('in')", timeout=30000)
        plate = (await page.inner_text('.hm-account')).replace('\n', ' ')
        check('signed in: name and record on the plate', '小卡' in plate and '0 場' in plate, plate)
        cookies = await ctx.cookies()
        cs = [c for c in cookies if c['name'] == 'cs']
        check('session cookie is HttpOnly', cs and cs[0]['httpOnly'], str([(c['name'], c['httpOnly'], c['path']) for c in cs]))
        # a quick campaign against one computer player (to 8 points), played by the computer for us
        await page.click('[data-k="single"]')
        await page.click('text=開始戰役')
        await page.wait_for_function('window.__game && window.__game.state', timeout=120000)
        t0 = time.time()
        await page.wait_for_function("__game.state.phase === 'over'", timeout=900000, polling=2000)
        print('campaign over after %.0fs' % (time.time() - t0))
        got = await page.wait_for_function("[...document.querySelectorAll('.toast h4')].some((h) => h.textContent.includes('已記入戰績'))", timeout=30000)
        check('the finished campaign is recorded', bool(got))
        res = await page.evaluate('__game.result()')
        print('result', res)
        await page.screenshot(path=f'{SP}/acct-over.png')
        # back home: the plate shows one game; the record lists it
        await page.goto(SITE)
        await page.wait_for_function("document.querySelector('.hm-account') && document.querySelector('.hm-account').textContent.includes('1 場')", timeout=90000)
        await page.click('.hm-account')
        await page.wait_for_selector('.ac-recent li', timeout=30000)
        rec = (await page.inner_text('.modal.account')).replace('\n', ' ')
        check('the record lists the campaign', ('勝利' in rec or '第 2 名' in rec) and '單人' in rec, rec[:160])
        await page.screenshot(path=f'{SP}/acct-record.png')
        # sign out
        await page.click('.modal.account .modal-foot .btn:has-text("登出")')
        await page.wait_for_function("!document.querySelector('.hm-account').classList.contains('in')", timeout=30000)
        me = await page.evaluate("fetch('/api/me', {credentials: 'same-origin'}).then((r) => r.json())")
        check('signed out again', me.get('user') is None, json.dumps(me))
        # phone width
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_timeout(800)
        await page.screenshot(path=f'{SP}/acct-phone.png')
        await b.close()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
asyncio.run(main())
