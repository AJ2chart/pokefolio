// Card value, exactly as the app computes it (app.js: pickPrice, tcpMarket, priceCheck, entryValue, wishDeal).
// Kept as a copy so the daily server job needs no code fetched at run time; tests/push_t.py checks that both give
// the same results on the same cards. If the app's price logic changes, change it here too.

export function pickPrice(pricing, variant, hasNormal) {
  const cm = pricing?.cardmarket;
  if (!cm) return null;
  const useHolo = (variant === 'reverse' || ((variant === 'holo' || variant === 'foil') && hasNormal)) && (cm['trend-holo'] > 0 || cm['avg7-holo'] > 0);
  const f = k => { const v = cm[useHolo ? k + '-holo' : k]; return v == null || v === 0 ? null : v; };
  const p = { trend: f('trend'), low: f('low'), avg1: f('avg1'), avg7: f('avg7'), avg30: f('avg30'), updated: cm.updated };
  const vals = [p.trend, p.avg1, p.avg7, p.avg30].filter(v => v > 0).sort((a, b) => a - b);
  p.value = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : p.low;
  if (p.value != null) p.value = Math.round(p.value * 100) / 100;
  return p.value == null ? null : p;
}

export function tcpMarket(tcp, variant) {
  if (!tcp) return null;
  const order = { holo: ['holofoil', 'holo'], foil: ['holofoil', 'foil'], reverse: ['reverse-holofoil', 'reverseHolofoil', 'reverse'], normal: ['normal'] }[variant] || ['normal'];
  const pick = k => { const v = tcp[k]; return v && typeof v === 'object' ? (v.marketPrice || v.midPrice || null) : null; };
  for (const k of order) { const v = pick(k); if (v) return v; }
  for (const k of Object.keys(tcp)) { const v = pick(k); if (v) return v; }
  return null;
}

const RAR_FLOORS = [[/special|spéciale|hyper|gold|dorée|mega.?hyper|ace spec/i, 3], [/illustration|ultra|secret|shiny|chromatique|full ?art|rainbow|arc-en-ciel/i, 0.8]];
export function rarityFloor(r) { for (const [re, f] of RAR_FLOORS) if (re.test(r || '')) return f; return 0; }
export const gameOf = id => { id = String(id || ''); return id.startsWith('mg:') ? 'mg' : id.startsWith('op:') ? 'op' : 'pk'; };

export function priceCheck(e, usdEur) {
  const cm = e.price?.value; if (!(cm > 0)) return null;
  const floor = gameOf(e.cardId) === 'mg' ? (/numérotée|serialized/i.test(e.rarity || '') ? 20 : 0) : rarityFloor(e.rarity);
  const usd = tcpMarket(e.tcp, e.variant), tp = usd ? Math.round(usd * usdEur * 100) / 100 : null;
  const low = floor && cm < floor, far = tp && tp >= 2 && cm < tp / 5;
  if (!low && !far) return null;
  return { cm, floor, alt: tp && tp >= Math.max(floor, cm * 5, 1) ? tp : null };
}
export const myValue = (mp, est) => mp.est > 0 && est > 0 ? Math.round(est * mp.v / mp.est * 100) / 100 : mp.v;
export const tcpOnly = (e, usdEur) => { if (e.price?.value > 0) return null; const u = tcpMarket(e.tcp, e.variant); return u > 0 ? Math.round(u * usdEur * 100) / 100 : null; };
export function entryValue(e, usdEur) {
  if (e.manual > 0) return e.manual;
  if (e.myPrice?.v > 0) return myValue(e.myPrice, e.price?.value);
  const chk = priceCheck(e, usdEur); if (chk) return chk.alt;
  return e.price?.value ?? tcpOnly(e, usdEur);
}

// Magic (Scryfall) and One Piece (OPTCG) answers turned into the same shape as TCGdex (prices part only, like mgToDetail / opToDetail)
export function mgPricing(c, pc) {
  const p = pc.prices || {}, f = c.finishes || [];
  const hasN = f.length ? f.includes('nonfoil') : c.nonfoil !== false, hasF = f.length ? (f.includes('foil') || f.includes('etched')) : !!c.foil;
  const eur = +p.eur || null, eurF = +p.eur_foil || +p.eur_etched || null;
  return { variants: { normal: hasN, foil: hasF },
    pricing: { cardmarket: { trend: hasN ? eur : eurF, 'trend-holo': eurF, updated: new Date().toISOString() },
      tcgplayer: { normal: +p.usd ? { marketPrice: +p.usd } : null, holofoil: +(p.usd_foil || p.usd_etched) ? { marketPrice: +(p.usd_foil || p.usd_etched) } : null } } };
}
export function opPricing(row) {
  const mp = row && row.market_price != null ? +row.market_price : null;
  return { variants: { normal: true }, pricing: { tcgplayer: { normal: mp > 0 ? { marketPrice: mp } : null } } };
}

// Today's value of a card: the stored entry with today's prices put in (as the app's refresh does), then the app's value rule.
// A source that answers without a price keeps the last known one (the app keeps it 14 days; one day here is enough).
export function valueToday(e, detail, usdEur) {
  const p = detail ? pickPrice(detail.pricing, e.variant, detail.variants?.normal) : null;
  const tcp = detail?.pricing?.tcgplayer || null, tcpOk = !!tcp && Object.values(tcp).some(v => v);
  const e2 = { ...e, price: p || e.price, tcp: tcpOk ? tcp : e.tcp };
  return { value: entryValue(e2, usdEur), cm: e2.price?.value ?? null };
}

// Wishlist « good deal » (app.js wishDeal): today's value against the first known price of the card, at least dealPct % lower.
// The app needs two history points; today's price counts as one when the history doesn't have today yet.
export function dealDrop(e, value, todayStr) {
  if (value == null) return null;
  const hist = Array.isArray(e.hist) ? e.hist : [];
  const h0 = hist.find(x => x && x.v > 0)?.v;
  const points = hist.length + (hist.length && hist[hist.length - 1].d === todayStr ? 0 : 1);
  return h0 && points > 1 ? (value - h0) / h0 * 100 : 0;
}
// The day's price of a card version for the history (same as the app's history: Cardmarket estimate; cards with only a
// TCGplayer price — One Piece — get it converted to euros, so they have a history too)
export function cardDayValue(detail, variant, usdEur) {
  const p = pickPrice(detail?.pricing, variant, detail?.variants?.normal);
  if (p?.value > 0) return p.value;
  const u = tcpMarket(detail?.pricing?.tcgplayer, variant);
  return u > 0 ? Math.round(u * usdEur * 100) / 100 : null;
}
export function alertHit(e, value) {
  const a = e.alert; if (!a || !(a.price > 0) || value == null) return false;
  return a.dir === 'below' ? value <= a.price : a.dir === 'above' ? value >= a.price : false;
}
