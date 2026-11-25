# Regression tests for the v-150 fixes (headless Chrome, no network needed).
# Run from the repo root:  python3 tests/v150_t.py [--slow] [folder to serve, default: .]
#  1. a card without set name / name / uid (old backup, other device) must not break Collection (sort by set, set filter)
#  2. « Log out → Erase from this device » must erase nothing when the sync fails (offline)
import http.server, json, sys, threading, functools
from playwright.sync_api import sync_playwright

SLOW = '--slow' in sys.argv   # 6× slower processor (timing-dependent bugs)
args = [a for a in sys.argv[1:] if a != '--slow']
root = args[0] if args else '.'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_port}/index.html#collection'

COLL = [
  {'uid': 'a1', 'cardId': 'sv01-001', 'lang': 'fr', 'name': 'Pikachu', 'setId': 'sv01', 'setName': 'Écarlate et Violet', 'localId': '1', 'status': 'owned', 'qty': 1},
  {'uid': 'a2', 'cardId': 'sv02-002', 'lang': 'fr', 'name': 'Salamèche', 'setId': 'sv02', 'localId': '2', 'status': 'owned', 'qty': 1},   # no setName
  {'cardId': 'sv03-003', 'lang': 'en', 'setId': 'sv03', 'localId': '3', 'status': 'owned', 'qty': 2},                                     # no name, no uid
]
fails = []
def check(ok, what):
    print(('OK   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def open_app(coll):
        pg = b.new_page()
        if SLOW: pg.context.new_cdp_session(pg).send('Emulation.setCPUThrottlingRate', {'rate': 6})
        pg.errors = []
        pg.on('pageerror', lambda e: pg.errors.append(str(e)))
        pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())   # offline: only the app itself
        seed = {'pf_collection': coll, 'pf_tour': 1, 'pf_news': 99, 'pf_settings': {'lang': 'fr', 'sort': 'set', 'lastRefresh': 9e12}}
        pg.add_init_script('if(!sessionStorage.getItem("seeded")){sessionStorage.setItem("seeded",1);' +
                           ''.join(f'localStorage.setItem({json.dumps(k)},{json.dumps(json.dumps(v))});' for k, v in seed.items()) + '}')
        pg.goto(URL)
        try: pg.wait_for_selector('#cgrid .tile', timeout=30000 if SLOW else 10000); return pg
        except Exception: return pg

    pg = open_app(COLL)
    check(pg.locator('#cgrid .tile').count() == 3, 'Collection shows the 3 cards (sorted by set)')
    if pg.locator('#csort').count():
        check(pg.locator('#cset option').count() == 4, 'set filter lists every set')
        pg.select_option('#csort', 'name')
        check(pg.locator('#cgrid .tile').count() == 3, 'sort by name works with a card without name')
    log = pg.evaluate("localStorage.getItem('pf_errlog')||'[]'")
    check(not pg.errors and json.loads(log) == [], 'no script error ' + str(pg.errors or log)[:300])
    pg.close()

    # 2. erase on logout while the sync fails (well-formed cards only)
    pg = open_app(COLL[:1])
    pg.evaluate("""()=>{const fail={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:{message:'offline'}})})})}),
        auth:{signOut:async()=>{window.__signedOut=1}}};sb=fail;user={id:'u1',email:'test@example.com'};renderShell()}""")
    pg.click('#accBtn'); pg.click('#aOut'); pg.click('#oWipe')
    pg.wait_for_function('document.querySelector(".toast")||window.__signedOut', timeout=15000); pg.wait_for_timeout(300)
    n = pg.evaluate('collection.length')
    check(n == 1, f'nothing erased when the sync fails ({n} card(s) left)')
    check(not pg.evaluate('!!window.__signedOut'), 'still signed in (so the changes can still be sent)')
    check(pg.locator('.toast').count() and 'rien n’a été effacé' in pg.text_content('.toast'), 'the user is told why')
    b.close()
srv.shutdown()
print('\n' + ('ALL PASSED' if not fails else f'{len(fails)} FAILED'))
sys.exit(1 if fails else 0)
