# The development mode's buildings of 2026-11-18 online, used from a player's own page: the almshouse's
# card and the observatory's second roll at the dice, the warehouse's cards put away (the host's page
# sees only how many), the caravanserai's trade, the counting house's card at the turn's end, and the
# garrison's two cards for a wonder. Each is the player's action reaching the host through the room
# (codec.js sanitizeAction) and the host's answer reaching the player; the hands stay right throughout.
# The host and one player; the computer takes the other two seats. The buildings are set into the
# host's state (their rules: test/develop2.mjs; on one page: test/ui11.py).
#   python3 test/online8.py           (ROOMS=ws: through the real room server, `npm run dev` first)
import asyncio, sys, os, json, time, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from shot import serve, THREE
from playwright.async_api import async_playwright
SP = os.environ.get('SHOTS') or os.path.join(tempfile.gettempdir(), 'hexverse-shots')
os.makedirs(SP, exist_ok=True)
BASIC = ['road', 'settlement', 'city', 'dev']
HOST_BP = BASIC + ['caravan', 'observatory', 'lighthouse']
PLAYER_BP = BASIC + ['warehouse', 'caravan', 'garrison']
ALL = ['aqueduct', 'granary', 'market', 'shipyard', 'guild', 'barracks', 'wall', 'mercenaries', 'adventurers', 'post', 'camp', 'academy', 'press', 'gardens', 'lighthouse', 'greatWall', 'royalRoad', 'library',
       'farmstead', 'homestead', 'grange', 'caravan', 'harborOffice', 'roadworks', 'newTown', 'townHall', 'governor', 'lectureHall', 'scriptorium', 'university',
       'warehouse', 'countingHouse', 'almshouse', 'smithy', 'terraces', 'observatory', 'watchtower', 'temple', 'builders', 'garrison', 'workshop', 'guildHall', 'monument']
INIT = """window.__developOpen = true; window.__mapFps = 0.12; window.__mockRoom = true; window.__perf = PERF; window.__keySlot = NAME; window.__noAssets = true;
localStorage.setItem('hexverse-settings-v1', JSON.stringify({lang:'zh', speed:'turbo', follow:false, quality:'low', qualityPicked:true, name: NAME, color: COLOR, opponents: 3, bps: BPS, bpCur: 0}));
localStorage.setItem('hexverse-cards-v1', JSON.stringify({own: OWN}));"""
if os.environ.get('ROOMS') == 'ws': INIT = INIT.replace('window.__mockRoom = true;', "window.__rooms = 'ws://127.0.0.1:8787/rooms/';")
CLIENT_STEP = """(async () => {
  const g = window.__game; if (!g || !g.client) return 'nogame';
  const ai = await import('/src/ai/ai.js'); const eng = await import('/src/engine/engine.js');
  const v = g.view(); const me = g.viewer;
  eng.ensureMap(v);
  if (v.phase === 'over') return 'over';
  if (g.net.busy()) return 'busy';
  if (!eng.actorsNow(v).includes(me)) return 'wait';
  window.__cmem = window.__cmem || {};
  const a = ai.aiAct(v, me, window.__cmem, Math.random);
  if (!a) return 'none';
  g.dispatch(a); return a.type;
})()"""
# The host sets the player's turn: their buildings beside their first settlement, their hand, whether
# the dice are rolled; the computers' next moves called off; the state sent out. With `roll`, the dice
# are seeded so that the roll and the observatory's second one are not 7 (no robber in the way).
SET = """async ([c, built, hand, rolled, roll]) => {
  const g = __game, s = g.state;
  clearTimeout(g.timer); g.timer = null; g.thinking = null;
  const v = s.vertices.findIndex((b) => b && b.p === c);
  for (const k of built) s.players[c].built[k] = v;
  if (built.includes('warehouse')) s.players[c].store = s.players[c].store || { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  s.players[c].res = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...hand };
  s.current = c; s.rolled = rolled; s.pending = null; s.trade = null; s.used = {}; s.sub = null;
  if (roll) {
    const eng = await import('/src/engine/engine.js'); const R = await import('/src/engine/rng.js');
    for (let k = 1; k < 600; k++) {
      const t = JSON.parse(JSON.stringify(s)); t.rng = R.seedState(k); eng.ensureMap(t);
      let ev = eng.applyAction(t, { type: 'roll', p: c, alms: 'ore' });
      const a = ev.find((e) => e.type === 'roll');
      if (!a || a.sum === 7) continue;
      if (t.pending && t.pending.type === 'reroll') {
        ev = eng.applyAction(t, { type: 'reroll', p: c, yes: true });
        const b = ev.find((e) => e.type === 'roll');
        if (!b || b.sum === 7) continue;
      }
      s.rng = R.seedState(k); break;
    }
  }
  g.net.onChange(s, []); if (g.refresh) g.refresh();
  return v; }"""
# the player's hand, as their page has it and as the host does
MINE = "() => ({ res: __game.view().players[__game.viewer].res, cur: __game.view().current, me: __game.viewer })"
TRUTH = "(c) => { const s = __game.state; return { res: s.players[c].res, store: s.players[c].store || null, rolled: s.rolled, used: s.used, pending: s.pending && s.pending.type, turn: s.turn, current: s.current }; }"
LOG = "() => document.querySelector('.log-body').innerText"
results = {}
def check(name, ok, info=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, info)

async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1100, 'height': 700})
        logs = []
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three' in u: await r.fulfill(status=200, body=THREE, headers={'content-type': 'application/javascript'})
            elif 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            else: await r.continue_()
        await ctx.route('**/*', route)
        async def page(name, color, perf, bp):
            pg = await ctx.new_page()
            pg.set_default_timeout(180000)
            pg.set_default_navigation_timeout(180000)
            await pg.add_init_script(INIT.replace('NAME', json.dumps(name)).replace('COLOR', json.dumps(color)).replace('PERF', str(perf)).replace('BPS', json.dumps([bp, [], []])).replace('OWN', json.dumps(ALL)))
            pg.on('console', lambda m: logs.append(f'[{name} {m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            pg.on('pageerror', lambda e: logs.append(f'[{name} pageerror] {e}'))
            await pg.goto('http://127.0.0.1:8765/dist/index.test.html')
            await pg.wait_for_selector('.menu-screen', timeout=90000)
            return pg
        host = await page('主持王國', '#c8372d', 900, HOST_BP)
        await host.click('[data-k="create"]')
        await host.wait_for_selector('.code-box b', timeout=30000)
        code = (await host.inner_text('.code-box b')).strip()
        await host.click('.room-layout .modes button:has-text("發展模式")')
        await host.wait_for_function("document.querySelector('.room-layout .modes button.on') && document.querySelector('.room-layout .modes button.on').textContent.includes('發展模式')", timeout=20000)
        c = await page('小明聯邦', '#2f6fd0', 100, PLAYER_BP)
        await c.click('[data-k="join"]')
        await c.wait_for_selector('#join-code', timeout=30000)
        await c.fill('#join-code', code)
        await c.click('.join-row .btn')
        await c.wait_for_selector('.online-screen .status', timeout=30000)
        for i in range(60):
            if '小明聯邦' in await host.inner_text('.online-screen .seat-list'): break
            await host.wait_for_timeout(500)
        await host.click('.online-screen .modal-foot .btn.primary')
        await host.wait_for_function('window.__game && window.__game.state', timeout=120000)
        await c.wait_for_function('window.__game && window.__game.client', timeout=120000)
        seat = await c.evaluate('__game.viewer')
        bp = await host.evaluate('(s) => __game.state.players[s].bp', seat)
        check('the player brings their blueprint with the new buildings', bp == PLAYER_BP, bp)

        # the opening, the player's page acting for itself
        await host.evaluate('window.__autoHuman = true; __game.schedule()')
        t0 = time.time()
        while time.time() - t0 < 300:
            await c.evaluate(CLIENT_STEP)
            if await host.evaluate("__game.state.phase === 'play' && __game.state.turn >= 2"): break
            await c.wait_for_timeout(120)
        await host.evaluate('window.__autoHuman = false')
        phase = await host.evaluate('__game.state.phase')
        check('the opening is played', phase == 'play', phase)

        async def turn(built, hand, rolled, roll=False):
            v = await host.evaluate(SET, [seat, built, hand, rolled, roll])
            want = {'wood': 0, 'brick': 0, 'wool': 0, 'grain': 0, 'ore': 0, **hand}
            await c.wait_for_function('([w, s]) => { const v = __game.view(); return v.current === s && JSON.stringify(v.players[s].res) === JSON.stringify(w); }', arg=[want, seat], timeout=60000)
            await c.wait_for_timeout(300)
            return v
        async def settled(cond, timeout=30):
            # the host's state once the player's action has come through, and the player's page caught up
            t1 = time.time()
            while time.time() - t1 < timeout:
                tr = await host.evaluate(TRUTH, seat)
                if eval(cond, {}, {'t': tr}):
                    mine = await c.evaluate(MINE)
                    for i in range(40):
                        if mine['res'] == tr['res']: break
                        await c.wait_for_timeout(150)
                        mine = await c.evaluate(MINE)
                        tr = await host.evaluate(TRUTH, seat)
                    return tr, mine
                await c.wait_for_timeout(200)
            return await host.evaluate(TRUTH, seat), await c.evaluate(MINE)

        # the almshouse's card, then the dice, then the observatory asks about a second roll (a wool)
        await turn(['almshouse', 'observatory'], {'wool': 2}, False, roll=True)
        await c.click('.act[data-k="roll"]')
        await c.wait_for_selector('.modal[data-kind="bonus"]', timeout=30000)
        await c.click('.modal[data-kind="bonus"] .res-pick >> nth=4')
        await c.wait_for_selector('.modal[data-kind="reroll"]', timeout=60000)
        # (the button's own click, at once: the dialog answers by itself when its time is up)
        await c.evaluate("() => document.querySelector('.modal[data-kind=\"reroll\"] .btn.primary').click()")
        tr, mine = await settled("t['rolled'] and t['pending'] != 'reroll' and t['used'].get('observatory')")
        log = await c.evaluate(LOG)
        check('the almshouse\'s ore before the dice, from the player\'s page', tr['used'].get('almshouse') and tr['res']['ore'] >= 1, tr)
        check('the observatory asks the player, a wool for a second roll', tr['used'].get('observatory') and tr['pending'] != 'reroll' and '天文台' in log, (tr['used'], log[-200:]))
        check('the player\'s hand as the host has it', mine['res'] == tr['res'], (mine['res'], tr['res']))

        # the warehouse: two ores put away; the host's own page sees how many, not which
        await turn(['warehouse'], {'ore': 3}, True)
        await c.keyboard.press('b')
        await c.wait_for_timeout(400)
        await c.click('.bm-row[data-k="bp:warehouse"]')
        await c.wait_for_selector('.modal[data-kind="warehouse"]', timeout=30000)
        for i in range(2):
            await c.click('.modal[data-kind="warehouse"] .dv-srow >> nth=4 >> .dv-sbtn >> nth=0')
        await c.click('.modal[data-kind="warehouse"] .modal-foot .btn.primary')
        tr, mine = await settled("t['store'] and t['store']['ore'] == 2")
        seen = await host.evaluate('(s) => { const p = __game.view().players[s]; return { store: p.store === undefined ? null : p.store, n: p.storeCount }; }', seat)
        own = await c.evaluate("() => { const p = __game.view().players[__game.viewer]; const e = document.querySelector('.stat.store'); return { store: p.store, stat: e && !e.hidden ? e.innerText : null }; }")
        check('the warehouse: two ores put away from the player\'s page', tr['store'] and tr['store']['ore'] == 2 and tr['res']['ore'] == 1, tr)
        check('the player sees what is in their warehouse (and the top bar the count), the host\'s page only how many', own['store'] and own['store']['ore'] == 2 and own['stat'] and '2' in own['stat'] and seen['store'] is None and seen['n'] == 2, (own, seen))

        # the caravanserai: wood and brick for an ore
        await turn(['caravan'], {'wood': 1, 'brick': 1}, True)
        await c.keyboard.press('b')
        await c.wait_for_timeout(400)
        await c.click('.bm-row[data-k="bp:caravan"]')
        await c.wait_for_selector('.modal[data-kind="trade"]', timeout=30000)
        await c.click('.modal[data-kind="trade"] .dv-opts >> nth=1 >> .dv-res >> nth=4')
        await c.click('.modal[data-kind="trade"] .modal-foot .btn.primary')
        tr, mine = await settled("t['res']['ore'] == 1")
        check('the caravanserai\'s trade from the player\'s page', tr['res'] == {'wood': 0, 'brick': 0, 'wool': 0, 'grain': 0, 'ore': 1} and mine['res'] == tr['res'], (tr['res'], mine['res']))

        # the counting house: a brick as the turn ends
        await turn(['countingHouse'], {'ore': 9}, True)
        t_before = await host.evaluate('__game.state.turn')
        await c.click('.act[data-k="end"]')
        await c.wait_for_selector('.modal[data-kind="bonus"]', timeout=30000)
        await c.click('.modal[data-kind="bonus"] .res-pick >> nth=1')
        tr, mine = await settled(f"t['turn'] > {t_before} or t['current'] != {seat}")
        log = await c.evaluate(LOG)
        check('the counting house\'s brick as the player ends the turn', tr['res']['brick'] >= 1 and '錢莊' in log, (tr['res'], log[-200:]))
        await host.evaluate('() => { const g = __game; clearTimeout(g.timer); g.timer = null; g.thinking = null; }')

        # the garrison: the robber at the player's wonder, two cards and no knight save it
        await turn(['garrison'], {'wood': 2, 'grain': 1}, True)
        h = await host.evaluate("""(seat) => {
          const g = __game, s = g.state, G = __geo();
          clearTimeout(g.timer); g.timer = null; g.thinking = null;
          const v = s.vertices.findIndex((b) => b && b.p === seat);
          const deserts = s.board.hexes.map((x, i) => x.terrain === 'desert' ? i : -1).filter((i) => i >= 0);
          const h = deserts[0];
          // a settlement of the player's at the desert, and their wonder on it (any other there moved off)
          let w = G.hexes[h].vertices.find((u) => !s.vertices[u] && !G.vertices[u].neighbors.some((x) => s.vertices[x]));
          if (w === undefined) w = G.hexes[h].vertices.find((u) => s.vertices[u] && s.vertices[u].p === seat);
          if (w === undefined) { w = G.hexes[h].vertices[0]; }
          s.vertices[w] = { p: seat, t: 's' };
          s.wonders = s.wonders.filter((x) => x.h !== h && x.p !== seat);
          s.wonders.push({ h, k: 'gardens', p: seat, s: 2, t: 1, done: false });
          s.players[seat].dev = s.players[seat].dev.filter((d) => d.type !== 'knight');
          const mover = [0, 1, 2, 3].find((q) => q !== seat && g.players[q].kind === 'ai') ?? 0;
          if (s.board.robber === h) s.board.robber = s.board.hexes.findIndex((x) => x.terrain !== 'desert');
          s.current = mover; s.rolled = true; s.trade = null; s.pending = { type: 'robber', reason: 'seven' };
          g.dispatch({ type: 'robber', p: mover, hex: h });
          return h; }""", seat)
        await c.wait_for_selector('.modal[data-kind="defend"] .modal-foot .btn', timeout=60000)
        # (answered at once, the options read in the same breath: the host's 15 seconds run meanwhile,
        # and a screenshot with SwiftShader takes longer than that)
        r0 = await c.evaluate("() => { const bs = [...document.querySelectorAll('.modal[data-kind=\"defend\"] .modal-foot .btn')]; const b = bs.find((x) => x.textContent.includes('付 2 張')); if (b) b.click(); return { opts: bs.map((x) => x.textContent), clicked: !!b }; }")
        opts, clicked = r0['opts'], r0['clicked']
        ok = None
        for i in range(80):
            r = await host.evaluate('([s, h]) => ({ pending: __game.state.pending && __game.state.pending.type, wonder: __game.state.wonders.some((w) => w.h === h && w.p === s), hand: Object.values(__game.state.players[s].res).reduce((a, b) => a + b, 0) })', [seat, h])
            if r['pending'] != 'defend':
                ok = r
                break
            await c.wait_for_timeout(250)
        await c.wait_for_timeout(800)
        await c.screenshot(path=f'{SP}/o8-garrison.png', timeout=120000)
        log = await c.evaluate(LOG)
        # (three cards, two paid; the robber may then take the last)
        check('the garrison: two cards from the player\'s page save the wonder', clicked and ok and ok['wonder'] and ok['hand'] <= 1 and '衛戍所' in log, (opts, ok, log[-160:]))

        pres = await host.evaluate('window.__presSize || 0')
        check('the host presence stays under 4 KiB', 0 < pres <= 3900, f'{pres} bytes')
        errs = [l for l in logs if 'pageerror' in l or ' error]' in l]
        check('no page errors', not errs, '\n'.join(errs[:6]))
        for l in logs[:20]: print(l)
        await b.close()
    srv.shutdown()
    bad = [k for k, v in results.items() if not v]
    print('RESULT', 'ok' if not bad else 'FAILED: ' + ', '.join(bad))
    if bad: sys.exit(1)
asyncio.run(main())
