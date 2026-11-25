# Contrôle béton — automatic part (headless Chrome, works offline: external sites are answered by fakes).
#   python3 tests/controle_beton.py              every combination (screen size × theme × language × Mode Safe) + extreme data
#   python3 tests/controle_beton.py --selftest   re-introduces one real bug per detector and checks that each one is caught
#   options: --root DIR (folder to serve, default .)   --quick (one combination, to iterate)
# The report is never cut. Exit code 0 only when there is nothing at all to report.
import functools, http.server, json, re, sys, threading, time
from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
ROOT = ARGS[ARGS.index('--root') + 1] if '--root' in ARGS else '.'
SELFTEST, QUICK = '--selftest' in ARGS, '--quick' in ARGS

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_port}/index.html'

# ---------- test data (extreme values on purpose) ----------
LONG = 'Dracaufeu-ex-Méga-Évolution-Illustration-Spéciale-Extrêmement-Longue'
def entry(i, **kw):
    e = {'uid': f'u{i}', 'cardId': f'sv0{i % 9 + 1}-{i:03}', 'lang': ['fr', 'en', 'ja'][i % 3], 'name': f'Carte {i}',
         'setId': f'sv0{i % 9 + 1}', 'setName': f'Extension numéro {i % 9}', 'localId': str(i), 'official': 165,
         'status': 'owned', 'qty': 1 + i % 3, 'variant': 'normal', 'cond': 'NM', 'added': 1_700_000_000_000 + i,
         'price': {'value': round(1 + i * 1.37, 2), 'trend': round(1 + i * 1.37, 2), 'updated': '2026-11-25'},
         'hist': [{'d': '2026-10-01', 'v': round(2 + i * 1.5, 2)}, {'d': '2026-11-01', 'v': round(1.5 + i * 1.4, 2)}, {'d': '2026-11-25', 'v': round(1 + i * 1.37, 2)}],
         'buy': i % 5 and round(i * 0.9, 2)}
    e.update(kw); return e
NORMAL = [entry(i) for i in range(36)] + [
    entry(100, name=LONG, setName='Extension au nom vraiment très très long pour tester les débordements', qty=9999),
    entry(101, name='SansPrix', price=None, hist=[]),
    entry(102, status='wish', name='Envie 1', prio=True), entry(103, status='wish', name=LONG, alert={'dir': 'below', 'price': 500, 'hit': 1}),
    entry(104, alert={'dir': 'above', 'price': 1, 'hit': 1}, grade={'co': 'Collect Aura', 'g': '9.5', 'cert': '1234567890'}, manual=1234.56),
    entry(105, cardId='mg:abc', name='Lightning Bolt', setId='lea', setName='Alpha', lang='en'),
    entry(106, cardId='op:OP01-001', name='Monkey.D.Luffy', setId='OP01', setName='Romance Dawn', lang='en', price=None,
          tcp={'normal': {'marketPrice': 3.2}}),
    entry(107, cardId='manual-x', manualCard=True, name='Carte manuelle', price=None, hist=[]),
    entry(108, myPrice={'v': 50, 'est': 40, 'src': 'ebay', 'd': '2026-11-20'}),
    entry(109, rarity='Illustration spéciale rare', price={'value': 0.43, 'updated': '2026-11-25'}, tcp={'normal': {'marketPrice': 60}}),
]
BIG = [entry(i) for i in range(1500)]

# ---------- fakes for the outside world ----------
CHART_STUB = 'window.Chart=class{constructor(c,o){this.c=c;(window.__charts=window.__charts||[]).push(o)}destroy(){}update(){}};'
def tcgdex(route):
    u = route.request.url
    m = re.search(r'/v2/(fr|en|ja)/cards/([^/?]+)$', u)
    if m:
        cid = m.group(2)
        body = {'id': cid, 'localId': cid.split('-')[-1], 'name': 'Carte test', 'image': '', 'rarity': 'Rare', 'illustrator': 'Test',
                'set': {'id': cid.split('-')[0], 'name': 'Extension test', 'cardCount': {'official': 165, 'total': 200}},
                'variants': {'normal': True, 'reverse': True, 'holo': False},
                'pricing': {'cardmarket': {'trend': 12.5, 'low': 9, 'avg1': 12, 'avg7': 12.2, 'avg30': 13, 'trend-holo': 20, 'avg7-holo': 21, 'updated': '2026-11-25'},
                            'tcgplayer': {'normal': {'marketPrice': 14}, 'updated': '2026-11-25'}}}
    elif re.search(r'/v2/\w+/sets$', u): body = [{'id': f'sv0{i}', 'name': f'Extension numéro {i}', 'cardCount': {'official': 165, 'total': 200}} for i in range(1, 10)]
    elif '/series/' in u: body = {'sets': []}
    elif re.search(r'/v2/\w+/cards$', u): body = [{'id': f'sv0{i % 9 + 1}-{i:03}', 'localId': f'{i:03}', 'name': f'Carte {i}'} for i in range(200)]
    else: return route.abort()
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

# ---------- detectors (run in the page after each screen) ----------
DETECT = r"""(safe)=>{
 const out=[],W=document.documentElement.clientWidth,H=innerHeight;
 const desc=el=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\s+/).slice(0,3).join('.'):'')+' «'+(el.innerText||el.value||'').trim().replace(/\s+/g,' ').slice(0,50)+'»';
 const shown=el=>{const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
 // a zone that scrolls sideways on purpose (tab of chips, carousel): its content may go past its edges, nothing else may
 const xScroller=el=>{for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o==='auto'||o==='scroll')return p}return null};
 const SKIP=/^(SCRIPT|STYLE|SVG|PATH|G|RECT|CIRCLE|POLYGON|POLYLINE|LINE|CANVAS|OPTION|BR|DEFS|STOP|LINEARGRADIENT|IMG)$/i;
 const se=document.scrollingElement;if(se.scrollWidth>W+1)out.push(['overflow','the page scrolls sideways ('+se.scrollWidth+' > '+W+')']);
 for(const md of document.querySelectorAll('.modal,.gv-pop,#main,.sheet'))if(shown(md)&&md.scrollWidth>md.clientWidth+1&&!/(auto|scroll)/.test(getComputedStyle(md).overflowX)||shown(md)&&/(auto|scroll)/.test(getComputedStyle(md).overflowX)&&md.scrollWidth>md.clientWidth+1&&md.matches('.modal,#main'))out.push(['overflow','panel scrolls sideways: '+desc(md)+' ('+md.scrollWidth+' > '+md.clientWidth+')']);
 const all=[...document.body.querySelectorAll('*')].filter(el=>!SKIP.test(el.tagName)&&!el.closest('svg')&&!el.closest('[aria-hidden=true]')&&el.id!=='splash');
 for(const el of all){
  if(!shown(el))continue;const r=el.getBoundingClientRect(),cs=getComputedStyle(el),xs=xScroller(el);
  if(!xs&&(r.right>W+1||r.left<-1)&&cs.position!=='fixed'&&!el.closest('.toast'))out.push(['overflow','outside the screen: '+desc(el)+' ['+Math.round(r.left)+'..'+Math.round(r.right)+' / '+W+']']);
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))continue;
  const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own||cs.display==='inline')continue;
  const txt=(el.innerText||'').trim();if(!txt)continue;
  if(el.scrollWidth>el.clientWidth+1){
   const hid=/(hidden|clip)/.test(cs.overflowX)||/(hidden|clip)/.test(cs.overflow);
   // « … » is fine for a long name in a narrow column; on a short text in a box much narrower than the room it has, it hides a sizing bug
   if(hid&&cs.textOverflow==='ellipsis'){const P=el.parentElement,pc=getComputedStyle(P),inner=P.clientWidth-parseFloat(pc.paddingLeft)-parseFloat(pc.paddingRight);
    const used=[...P.children].filter(shown).reduce((a,c)=>a+c.getBoundingClientRect().width,0),free=Math.round(inner-used);   // room left unused next to it on its line
    let box=null;for(let a=el;a&&a!==document.body;a=a.parentElement){const ps=getComputedStyle(a).position;if(ps==='fixed'||ps==='absolute'){box=a;break}}
    const narrowBox=box&&box.getBoundingClientRect().width<W*0.6&&box.getBoundingClientRect().width<500;   // floating bar / badge squeezed (e.g. left:50% bar)
    if(txt.length<=24&&(free>24||narrowBox))out.push(['ellipsis','short text cut with « … » while '+free+' px are free next to it: '+desc(el)+' (width '+el.clientWidth+')'])}
   else if(hid)out.push(['textcut','text cut without « … »: '+desc(el)+' ('+el.scrollWidth+' > '+el.clientWidth+')']);
   else if(!/(auto|scroll)/.test(cs.overflowX)){
    // spills out of its box: only a problem if it really leaves the visible box of its parent / the screen
    const pr=el.parentElement.getBoundingClientRect();if(r.left+el.scrollWidth>Math.min(W,pr.right)+1)out.push(['textspill','text goes out of its box: '+desc(el)+' ('+el.scrollWidth+' > '+el.clientWidth+')'])}
  }
  // cut by a parent that hides what goes past it (no « … », nothing says it)
  for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const pc=getComputedStyle(p);if(/(auto|scroll)/.test(pc.overflowX+pc.overflowY))break;
   if(/(hidden|clip)/.test(pc.overflowX)){const q=p.getBoundingClientRect();if(r.right>q.right+2||r.left<q.left-2){if(!(cs.textOverflow==='ellipsis'))out.push(['textcut','text hidden by its container '+desc(p)+': '+desc(el)]);}break}}
 }
 const text=[...document.querySelectorAll('#main,.ov,.toast,.upd-bar,.tour,.tabbar,header,.gv-pop')].filter(shown).map(x=>x.innerText).join('\n');
 const bad=text.match(/\bundefined\b|\bNaN\b|\[object [A-Z]\w+\]|\{[a-z_]{1,20}\}|\bnull\b|Infinity/g);if(bad)out.push(['text','broken value in the text: '+[...new Set(bad)].join(', ')]);
 const words=new Set(text.match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g)||[]);
 // no visible text has snake_case words: any one is a key (even one removed from the dictionary)
 const raw=[...words];if(raw.length)out.push(['text','translation key shown raw: '+raw.join(', ')]);
 const pl=text.match(/(^|[^\d,.])1 (cartes|exemplaires|résultats|alertes|relevés|copies|cards|results|alerts|readings|entries|entrées|jours|days)\b/gi);if(pl)out.push(['plural','wrong plural: '+[...new Set(pl.map(s=>s.trim()))].join(' | ')]);
 // a sign left alone where a value should follow (« + » with an empty price); +/− stepper buttons are real controls
 for(const el of all)if(shown(el)&&!el.closest('button,[role=button]')&&/^[+−]$/.test((el.innerText||'').trim()))out.push(['text','lone sign « '+el.innerText.trim()+' » (value missing): '+desc(el.parentElement)]);
 if(safe){const leak=text.match(/\d[\d   .,]*\s?[€$]|[€$]\s?\d|[+−-]\d+[,.]\d+\s?%/g);if(leak)out.push(['safe','price shown in Mode Safe: '+[...new Set(leak)].slice(0,8).join(' | ')])}
 return out;
}"""

def run(selftest_patch=None, combos=None, datasets=('normal',), slow_only=False, timing=True, variants=None):
    issues, seen = [], set()
    def add(where, cat, msg):
        k = (cat, msg if cat not in ('overflow', 'textcut', 'ellipsis', 'textspill') else re.sub(r'\d+', '#', msg), where)
        if k in seen: return
        seen.add(k); issues.append((where, cat, msg))
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def page(vw, vh, settings, coll, extra_css='', slow=False, user=False):
            ctx = b.new_context(viewport={'width': vw, 'height': vh}, device_scale_factor=1, has_touch=vw < 800, is_mobile=vw < 800)
            pg = ctx.new_page(); pg.errs = []
            pg.on('pageerror', lambda e: pg.errs.append(str(e)))
            def router(route):
                u = route.request.url
                if u.startswith('http://127.0.0.1'):
                    if selftest_patch and '/app.js' in u:
                        r = route.fetch(); body = r.text()
                        for a, z in selftest_patch.get('js', []):
                            assert a in body, 'selftest patch not found: ' + a[:60]; body = body.replace(a, z, 1)
                        return route.fulfill(response=r, body=body)
                    return route.continue_()
                if 'api.tcgdex.net' in u: return tcgdex(route)
                return route.abort()
            pg.route('**/*', router)
            seed = {'pf_collection': coll, 'pf_tour': 1, 'pf_news': 99, 'pf_settings': {'lastRefresh': 9e12, **settings}}
            pg.add_init_script(CHART_STUB + 'if(!sessionStorage.getItem("seeded")){sessionStorage.setItem("seeded",1);' +
                               ''.join(f'localStorage.setItem({json.dumps(k)},{json.dumps(json.dumps(v))});' for k, v in seed.items()) + '}')
            if slow: ctx.new_cdp_session(pg).send('Emulation.setCPUThrottlingRate', {'rate': 6})
            pg.goto(BASE + '#collection')
            pg.wait_for_function('!document.getElementById("splash")', timeout=20000)
            css = extra_css + (selftest_patch or {}).get('css', '')
            if css: pg.add_style_tag(content=css)
            if user:
                pg.evaluate("""()=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:[{d:'2026-06-01',v:5},{d:'2026-09-01',v:7}],error:null}),
                  maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null}),delete:()=>q,in:()=>q};
                  sb={from:()=>q,rpc:async()=>({error:null}),auth:{signOut:async()=>{}},functions:{invoke:async()=>({data:{sent:1}})}};
                  user={id:'u-test',email:'collectionneur.avec.une.adresse.tres.longue@exemple-de-domaine.fr'};renderShell();render()}""")
            return ctx, pg

        def check(pg, where, safe):
            pg.wait_for_timeout(450)
            for cat, msg in pg.evaluate(DETECT, safe): add(where, cat, msg)
            for e in pg.errs: add(where, 'js', e)
            pg.errs.clear()
            for x in json.loads(pg.evaluate("localStorage.getItem('pf_errlog')||'[]'")): add(where, 'js', 'error journal: ' + x['m'] + ' @ ' + x['s'])
            pg.evaluate("localStorage.removeItem('pf_errlog')")

        def screens(pg, where, safe, data):
            def tab(h):
                pg.evaluate(f"closeModal();location.hash='#{h}'"); pg.wait_for_timeout(500); check(pg, f'{where} | {h}', safe)
            def modal(name, js, after=None):
                pg.evaluate('closeModal()'); pg.wait_for_timeout(150)
                pg.evaluate(js); pg.wait_for_timeout(600)
                if after: after()
                check(pg, f'{where} | {name}', safe)
            for h in ['collection', 'add', 'wishlist', 'evolution', 'data']: tab(h)
            if data == 'empty': return
            pg.evaluate("location.hash='#collection'"); pg.wait_for_timeout(400)
            modal('card sheet', "openEntry('u100')")
            def hist():
                if safe:   # Mode Safe: the price block, and so the history button, is not shown at all
                    if pg.locator('#shHist').count(): add(where, 'safe', 'history button shown in Mode Safe')
                    return
                pg.click('#shHist'); pg.wait_for_function("document.querySelector('.sh-hbody')&&!document.querySelector('.sh-hload')", timeout=8000)
            if data == 'normal':
                modal('card sheet + history (v-149)', "openEntry('u5')", hist)
                modal('card sheet (no price)', "openEntry('u101')")
                modal('card sheet (Magic)', "openEntry('u105')")
                modal('card sheet (One Piece)', "openEntry('u106')")
                modal('card sheet (manual card)', "openEntry('u107')")
                modal('card sheet (wishlist)', "openEntry('u103')")
                modal('suspect prices', 'openSuspectList()')
                modal('good deals threshold', 'openDealSheet()')
                modal('share image', "openShareSheet('img')", lambda: pg.wait_for_selector('.sh-imgbox img', timeout=15000))
                modal('share link', "openShareSheet('link')")
                modal('login', 'openLogin()'); modal('sign-up', 'openSignup()'); modal('forgot password', 'openForgot()'); modal('new password', 'openRecovery()')
                modal('manual cards', 'openManualList()'); modal('cards without picture', 'openNoImgList()')
                modal('refresh journal', 'openRefreshLog()'); modal('error journal', 'openErrLog()')
                modal('game list', 'openGameView()')
                modal('update bar', "showUpdateBar()")
                pg.evaluate("document.querySelector('.upd-bar')?.remove()")
                modal('guided tour', "closeModal();location.hash='#collection';setTimeout(tourStart,50)", lambda: pg.wait_for_timeout(900))
                pg.evaluate("document.querySelectorAll('.tour,.tour-ov').forEach(x=>x.remove())")

        if slow_only: combos = []
        for (vw, vh, label) in combos:
            for theme, lang, safe in (variants or [(th, la, sa) for th in ['dark', 'light'] for la in ['fr', 'en'] for sa in [False, True]]):
                if True:
                    if True:
                        for data in datasets:
                            coll = {'normal': NORMAL, 'empty': [], 'big': BIG}[data]
                            where = f'{label} {theme} {lang}{" safe" if safe else ""}{"" if data == "normal" else " [" + data + "]"}'
                            ctx, pg = page(vw, vh, {'lang': lang, 'theme': theme, 'hidePrices': safe}, coll)
                            try: screens(pg, where, safe, data)
                            except Exception as ex: add(where, 'run', 'test could not finish: ' + str(ex).split('\n')[0])
                            if data == 'normal' and not safe and theme == 'dark':   # signed-in screens (fake account)
                                ctx.close(); ctx, pg = page(vw, vh, {'lang': lang, 'theme': theme, 'pushOn': 'u-test', 'notif': True}, coll, user=True)
                                try:
                                    pg.evaluate("location.hash='#data'"); pg.wait_for_timeout(500); check(pg, where + ' | settings (signed in)', safe)
                                    pg.evaluate('openAccount()'); pg.wait_for_timeout(500); check(pg, where + ' | account', safe)
                                    pg.evaluate("closeModal();location.hash='#collection'"); pg.wait_for_timeout(300)
                                    pg.evaluate("openEntry('u5')"); pg.wait_for_timeout(500); pg.click('#shHist')
                                    pg.wait_for_function("document.querySelector('.sh-hbody')&&!document.querySelector('.sh-hload')", timeout=8000)
                                    check(pg, where + ' | history with server readings', safe)
                                except Exception as ex: add(where, 'run', 'signed-in test could not finish: ' + str(ex).split('\n')[0])
                            ctx.close()

        # ---- timing-dependent scenarios, normal speed and on a 6× slower device ----
        for slow in ([False, True] if timing and (not selftest_patch or selftest_patch.get('timing')) else []):
            where = 'timing' + (' (CPU ×6)' if slow else '')
            ctx, pg = page(412, 915, {'lang': 'fr'}, NORMAL, slow=slow)
            try:
                pg.evaluate("openEntry('u5')"); pg.wait_for_selector('#ov'); pg.go_back(); pg.wait_for_timeout(1200)
                if pg.locator('#ov').count() or pg.evaluate('location.hash') != '#collection': add(where, 'nav', 'back button: sheet not closed or left Collection')
                pg.evaluate("openEntry('u5')"); pg.wait_for_selector('#mclose'); pg.click('#mclose'); pg.click('#tabbar a[href="#wishlist"]'); pg.wait_for_timeout(1500)
                if pg.evaluate('location.hash') != '#wishlist': add(where, 'nav', 'closing a sheet then changing tab at once: the tab change was lost (' + pg.evaluate('location.hash') + ')')
                pg.evaluate("location.hash='#collection'"); pg.wait_for_timeout(600)
                for i in range(3):   # quick open / close / reopen
                    pg.evaluate("openEntry('u5')"); pg.wait_for_timeout(60); pg.evaluate('closeModal()'); pg.wait_for_timeout(60)
                pg.wait_for_timeout(1500)
                if pg.evaluate('location.hash') != '#collection': add(where, 'nav', 'quick open/close: ended on ' + pg.evaluate('location.hash'))
                pg.evaluate("openEntry('u5')"); pg.wait_for_timeout(1200)
                pg.locator('[data-qdel]').first.click(); pg.wait_for_timeout(300)
                q1 = pg.evaluate("collection.find(e=>e.uid==='u5')?.qty")
                pg.click('.toast-act'); pg.wait_for_timeout(500)
                if pg.evaluate("collection.find(e=>e.uid==='u5')?.qty") != (q1 or 0) + 1: add(where, 'undo', f'remove one copy then Undo: qty {q1} → not restored')
                for e in pg.errs: add(where, 'js', e)
            except Exception as ex: add(where, 'run', 'test could not finish: ' + str(ex).split('\n')[0])
            ctx.close()
        b.close()
    return issues

def report(issues, title):
    print(f'\n===== {title}: {len(issues)} point(s) =====')
    by = {}
    for w, c, m in issues: by.setdefault((c, m), []).append(w)
    for (c, m), ws in sorted(by.items()):
        print(f'[{c}] {m}\n      in: ' + ' ; '.join(ws))

COMBOS = [(320, 568, 'small phone'), (412, 915, 'phone'), (1366, 800, 'PC')]
if SELFTEST:
    LONGSET = 'Extension au nom vraiment très très long pour tester les débordements'
    CASES = {
        'overflow': {'css': '.coll-head{width:130vw}'},
        'textcut': {'css': '.tile .meta{white-space:nowrap!important;overflow:hidden!important;text-overflow:clip!important}'},
        'ellipsis': {'css': '.upd-bar{left:50%!important;right:auto!important;width:auto!important;max-width:50vw!important}.upd-bar>span{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;min-width:0}'},   # the real bug of 22 nov.
        'textspill': {'css': '.tile .nm{white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important;word-break:normal!important;overflow-wrap:normal!important}'},
        'text': {'js': [("nav_wish:'Wishlist',", ''), ("nav_wish:'Wishlist',", '')]},
        'plural': {'js': [("s=s.replace(/\\(s\\)/g,one?'':'s')", "s=s.replace(/\\(s\\)/g,'s')")]},
        'safe': {'js': [("const fmtEur=v=>settings.hidePrices?'':", "const fmtEur=v=>false?'':")]},
        'js': {'js': [('function viewWish(m){', 'function viewWish(m){null.x;')]},
        'lonesign': {'js': [('<b>${fmtEur(tt.value)}</b>', '<b>+</b>')], 'cat': 'text'},
        'undo': {'js': [('fn:()=>{c.qty++;c.upd=Date.now();', 'fn:()=>{c.upd=Date.now();')], 'timing': True},
    }
    bad = 0
    for cat, patch in [(c, x) for c, x in CASES.items() if '--only' not in ARGS or c == ARGS[ARGS.index('--only') + 1]]:
        got = run(patch, combos=[] if patch.get('timing') else [(412, 915, 'phone')], variants=[('dark', 'fr', cat == 'safe')])
        hit = [i for i in got if i[1] == patch.get('cat', cat) and (cat != 'lonesign' or 'lone sign' in i[2])]
        print(('caught ' if hit else 'MISSED ') + f'{cat:10} ' + (hit[0][2][:110] if hit else ''))
        bad += not hit
    print('\nselftest: ' + ('every detector caught its bug' if not bad else f'{bad} detector(s) missed their bug'))
    sys.exit(1 if bad else 0)

def static_checks():
    """Checks outside the screens: app and server compute the same value; the notification badge is a white silhouette."""
    out = []
    import subprocess
    entries = [e for e in NORMAL if not e.get('manualCard')]
    node = subprocess.run(['node', '--input-type=module', '-e', "import {entryValue} from './supabase/functions/notify-prices/src/prices.js';"
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(e=>entryValue(e,0.9)))))"],
        input=json.dumps(entries), capture_output=True, text=True, cwd=ROOT)
    srv_vals = json.loads(node.stdout)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox']); pg = b.new_page()
        pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())
        pg.add_init_script(CHART_STUB); pg.goto(BASE + '#data'); pg.wait_for_function('typeof entryValue==="function"')
        app_vals = pg.evaluate('l=>{USD_EUR=0.9;return l.map(e=>entryValue(cleanEntry(e)))}', entries); b.close()
    for e, a, s_ in zip(entries, app_vals, srv_vals):
        if a != s_: out.append(('static', 'parity', f'value differs app/server for {e["name"]}: app {a}, server {s_}'))
    from PIL import Image
    im = Image.open(f'{ROOT}/icons/badge-96.png').convert('RGBA'); px = [p for p in im.getdata() if p[3] > 20]
    if im.size != (96, 96) or not px or any(min(p[:3]) < 200 for p in px) or len(px) > 96 * 96 * 0.8:
        out.append(('static', 'icon', 'badge-96.png is not a white silhouette on transparent 96×96'))
    return out

t0 = time.time()
issues = run(combos=COMBOS[1:2] if QUICK else COMBOS, datasets=('normal',) if QUICK else ('normal', 'empty'))
if not QUICK: issues += run(combos=[(320, 568, 'small phone'), (1366, 800, 'PC')], datasets=('big',), timing=False)
issues += static_checks()
report(issues, f'Contrôle béton ({int(time.time() - t0)} s)')
srv.shutdown()
sys.exit(1 if issues else 0)
