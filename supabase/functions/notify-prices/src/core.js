// Daily price notifications (« bonnes affaires » of the wishlist + the bell thresholds), one grouped notification per user.
// Everything outside (database, network, push sending, clock) comes in through `io`, so the same code runs in the
// Supabase function and in the tests.
import { gameOf, mgPricing, opPricing, valueToday, dealDrop, alertHit, cardDayValue } from './prices.js';

const TCGDEX = 'https://api.tcgdex.net/v2', SCRY = 'https://api.scryfall.com', OPAPI = 'https://optcgapi.com/api';
export const UA = 'Gleamvault/1.0 (+https://aj2chart.github.io/pokefolio/)';
const RUN_GAP = 20 * 3600e3;   // the daily job runs at most once every 20 h, whoever calls it
const HIST_MAX = 2000, HIST_KEEP_DAYS = 1100;   // history: at most 2 000 cards fetched a run; readings kept about 3 years

const T = {
  fr: { one_deal: (n, p, v) => `${n} : −${p} % depuis son ajout à ta wishlist (${v})`, one_below: (n, a, v) => `${n} est passée sous ${a} (${v})`, one_above: (n, a, v) => `${n} a dépassé ${a} (${v})`,
    many: n => `${n} cartes à surveiller`, title1: 'Bonne affaire', titleA: 'Alerte de prix', more: n => `et ${n} autre${n > 1 ? 's' : ''}`,
    test_t: 'Gleamvault', test_b: 'Les notifications fonctionnent sur cet appareil ✓' },
  en: { one_deal: (n, p, v) => `${n}: −${p}% since you added it to your wishlist (${v})`, one_below: (n, a, v) => `${n} went below ${a} (${v})`, one_above: (n, a, v) => `${n} went above ${a} (${v})`,
    many: n => `${n} cards to look at`, title1: 'Good deal', titleA: 'Price alert', more: n => `and ${n} more`,
    test_t: 'Gleamvault', test_b: 'Notifications work on this device ✓' },
};
const eur = (v, lang) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' }).format(v);
const short = s => { s = String(s || '').trim(); return s.length > 40 ? s.slice(0, 39) + '…' : s; };

export function message(hits, lang) {
  const L = T[lang] || T.fr, line = h => h.kind === 'deal' ? L.one_deal(short(h.name), Math.round(-h.pct), eur(h.value, lang))
    : (h.dir === 'below' ? L.one_below : L.one_above)(short(h.name), eur(h.price, lang), eur(h.value, lang));
  if (hits.length === 1) {
    const h = hits[0];
    return { title: h.kind === 'deal' ? L.title1 : L.titleA, body: line(h), url: `./?open=${encodeURIComponent(h.uid)}#${h.wish ? 'wishlist' : 'collection'}`, tag: 'gv-prices' };
  }
  const shown = hits.slice(0, 3).map(line), rest = hits.length - shown.length;
  return { title: L.many(hits.length), body: shown.join('\n') + (rest > 0 ? '\n' + L.more(rest) : ''), url: hits.every(h => h.wish) ? './#wishlist' : './#collection', tag: 'gv-prices' };
}

// Today's prices of the cards that matter, each card fetched once whatever the number of users holding it
export async function fetchDetails(keys, io) {
  const out = new Map(); let opRows = null, scryLast = 0;
  const scry = async url => { const w = scryLast + 110 - Date.now(); if (w > 0) await io.sleep(w); scryLast = Date.now(); return io.json(url, { Accept: 'application/json', 'User-Agent': UA }); };
  const queue = [...keys];
  const worker = async () => {
    while (queue.length) {
      const k = queue.shift(), i = k.indexOf(':'), lang = k.slice(0, i), id = k.slice(i + 1);
      try {
        const g = gameOf(id);
        if (g === 'pk') out.set(k, await io.json(`${TCGDEX}/${lang}/cards/${encodeURIComponent(id)}`, { 'User-Agent': UA }));
        else if (g === 'mg') {
          const c = await scry(`${SCRY}/cards/${encodeURIComponent(id.slice(3))}`);
          let pc = c;
          if (!(+c.prices?.eur > 0 || +c.prices?.eur_foil > 0) && c.lang !== 'en') { try { pc = await scry(`${SCRY}/cards/${encodeURIComponent(c.set)}/${encodeURIComponent(c.collector_number)}`); } catch (_) { } }
          out.set(k, mgPricing(c, pc));
        } else {
          if (!opRows) opRows = io.json(`${OPAPI}/allSetCards/`, { 'User-Agent': UA }).then(r => new Map((Array.isArray(r) ? r : []).map(x => [x.card_image_id, x])));
          const row = (await opRows).get(id.slice(3));
          if (row) out.set(k, opPricing(row));
        }
      } catch (_) { /* source down for this card: no notification about it today */ }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

// Which cards cross a threshold today, for one user (collection as synced by the app)
export function hitsFor(collection, details, dealPct, usdEur, todayStr) {
  const hits = [];
  for (const e of Array.isArray(collection) ? collection : []) {
    if (!e || typeof e !== 'object' || e.manualCard || typeof e.uid !== 'string') continue;
    const wish = e.status === 'wish';
    if (!wish && !e.alert) continue;
    const d = details.get(e.lang + ':' + e.cardId);
    if (!d) continue;
    const { value } = valueToday(e, d, usdEur);
    if (value == null) continue;
    if (alertHit(e, value)) hits.push({ kind: 'alert', uid: e.uid, name: e.name, value, price: e.alert.price, dir: e.alert.dir, wish });
    else if (wish) { const pct = dealDrop(e, value, todayStr); if (pct <= -dealPct) hits.push({ kind: 'deal', uid: e.uid, name: e.name, value, pct, wish }); }
  }
  return hits;
}

const okEntry = e => e && typeof e === 'object' && !e.manualCard && typeof e.lang === 'string' && typeof e.cardId === 'string' && /^[\w:.-]{1,80}$/.test(e.cardId) && /^(fr|en|ja)$/.test(e.lang);

export async function runDaily(io) {
  const now = io.now(), last = await io.getLastRun();
  if (last && now - last < RUN_GAP) return { skipped: true };
  await io.setLastRun(now);
  const subs = await io.listSubs();
  const byUser = new Map(); for (const s of subs) { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id).push(s); }
  const users = [...byUser.keys()];
  // every account's cards (for the history), each card fetched once for everybody; notification cards first
  const all = await io.getAllCollections(), state = await io.getStates(users);
  const keys = new Set(), versions = new Map();
  for (const u of users) for (const e of all.get(u) || []) if (okEntry(e) && (e.status === 'wish' || e.alert)) keys.add(e.lang + ':' + e.cardId);
  for (const list of all.values()) for (const e of list || []) if (okEntry(e)) {
    const k = e.lang + ':' + e.cardId; if (keys.size < HIST_MAX) keys.add(k);
    if (!versions.has(k)) versions.set(k, new Set()); versions.get(k).add(['normal', 'holo', 'reverse', 'foil'].includes(e.variant) ? e.variant : 'normal');
  }
  const [details, usdEur] = await Promise.all([fetchDetails(keys, io), io.usdEur()]);
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const rows = [];
  for (const [k, d] of details) for (const v of versions.get(k) || ['normal']) { const val = cardDayValue(d, v, usdEur); if (val > 0 && val < 1e7) rows.push({ k: k + ':' + v, d: todayStr, v: val }); }
  if (rows.length) await io.saveHistory(rows);
  await io.pruneHistory(new Date(now - HIST_KEEP_DAYS * 864e5).toISOString().slice(0, 10));
  const data = all;
  let sent = 0, gone = 0;
  for (const u of users) {
    const mine = byUser.get(u), pct = Math.min(25, Math.max(5, Math.max(...mine.map(s => +s.deal_pct || 5))));
    const hits = hitsFor(data.get(u), details, pct, usdEur, todayStr);
    const before = state.get(u) || {}, now_ = {};
    for (const h of hits) now_[h.uid] = h.kind;
    const fresh = hits.filter(h => before[h.uid] !== h.kind);   // notified once per crossing; a card back above the line can notify again later
    await io.setState(u, now_);
    if (!fresh.length) continue;
    for (const s of mine) {
      const st = await io.send(s, message(fresh, s.lang === 'en' ? 'en' : 'fr'));
      if (st === 404 || st === 410) { await io.deleteSub(s.endpoint); gone++; } else if (st >= 200 && st < 300) sent++;
    }
  }
  return { users: users.length, cards: keys.size, hist: rows.length, sent, gone };
}

// « Send a test » from the app: only to the devices of the signed-in user, at most once a minute
export async function runTest(io, userId) {
  const subs = (await io.listSubs()).filter(s => s.user_id === userId);
  if (!subs.length) return { sent: 0, reason: 'no_device' };
  let sent = 0;
  for (const s of subs) {
    const L = T[s.lang === 'en' ? 'en' : 'fr'];
    const st = await io.send(s, { title: L.test_t, body: L.test_b, url: './#data', tag: 'gv-test' });
    if (st === 404 || st === 410) await io.deleteSub(s.endpoint); else if (st >= 200 && st < 300) sent++;
  }
  return { sent };
}
