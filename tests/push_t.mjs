// Tests of the daily price notifications (supabase/functions/notify-prices/src), with a fake database / network / clock.
// Run: node tests/push_t.mjs   (exit code 0 = everything passed)
import assert from 'node:assert/strict';
import { runDaily, runTest, hitsFor, message } from '../supabase/functions/notify-prices/src/core.js';
import { entryValue, dealDrop } from '../supabase/functions/notify-prices/src/prices.js';
import { encrypt, makeVapid, vapidKey, vapidAuth, b64u } from '../supabase/functions/notify-prices/src/webpush.js';

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('OK   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };
const DAY = 864e5, NOW = Date.parse('2026-11-25T08:00:00Z');
const tcg = v => ({ variants: { normal: true }, pricing: { cardmarket: { trend: v, avg1: v, avg7: v, avg30: v, updated: '2026-11-25' } } });

function fakeIo({ subs, colls, prices, lastRun = 0, state = {}, status = 201 }) {
  const io = { sent: [], deleted: [], hist: [], state: { ...state }, lastRun,
    now: () => NOW, sleep: async () => {}, usdEur: async () => 0.9,
    json: async url => { const id = decodeURIComponent(url.split('/cards/')[1] || ''); if (!(id in prices)) throw new Error('404'); return prices[id]; },
    getLastRun: async () => io.lastRun, setLastRun: async t => { io.lastRun = t; },
    listSubs: async () => subs, getAllCollections: async () => new Map(Object.entries(colls)),
    saveHistory: async rows => { io.hist.push(...rows); }, pruneHistory: async () => {},
    getStates: async ids => new Map(ids.map(u => [u, io.state[u] || {}])), setState: async (u, n) => { io.state[u] = n; },
    deleteSub: async ep => { io.deleted.push(ep); }, send: async (s, p) => { io.sent.push({ to: s.endpoint, p }); return typeof status === 'function' ? status(s) : status; } };
  return io;
}
const wish = (uid, cardId, first, extra = {}) => ({ uid, cardId, lang: 'fr', name: 'Carte ' + uid, status: 'wish', variant: 'normal', price: { value: first }, hist: [{ d: '2026-11-01', v: first }, { d: '2026-11-10', v: first }], ...extra });
const sub = (u, ep, extra = {}) => ({ endpoint: 'https://push.example/' + ep, user_id: u, p256dh: 'x', auth: 'y', deal_pct: 10, lang: 'fr', ...extra });

await test('good deal at the user threshold → one notification; same crossing next day → none', async () => {
  const io = fakeIo({ subs: [sub('u1', 'a')], colls: { u1: [wish('w1', 'sv01-001', 10)] }, prices: { 'sv01-001': tcg(8.5) } });
  let r = await runDaily(io);
  assert.equal(r.sent, 1); assert.match(io.sent[0].p.body, /−15 %/); assert.equal(io.sent[0].p.title, 'Bonne affaire');
  io.lastRun = NOW - 21 * 3600e3; io.sent = [];
  r = await runDaily(io); assert.equal(r.sent, 0, 'notified twice for the same crossing');
});
await test('drop below the threshold (−5 % with a 10 % setting) → nothing', async () => {
  const io = fakeIo({ subs: [sub('u1', 'a')], colls: { u1: [wish('w1', 'sv01-001', 10)] }, prices: { 'sv01-001': tcg(9.5) } });
  assert.equal((await runDaily(io)).sent, 0);
});
await test('bell threshold on an owned card → « Alerte de prix »', async () => {
  const e = { uid: 'o1', cardId: 'sv01-002', lang: 'fr', name: 'Owned', status: 'owned', variant: 'normal', alert: { dir: 'above', price: 20 } };
  const io = fakeIo({ subs: [sub('u1', 'a')], colls: { u1: [e] }, prices: { 'sv01-002': tcg(25) } });
  await runDaily(io); assert.equal(io.sent.length, 1); assert.equal(io.sent[0].p.title, 'Alerte de prix'); assert.match(io.sent[0].p.url, /open=o1#collection/);
});
await test('run at most once every 20 h, whoever calls it', async () => {
  const io = fakeIo({ subs: [], colls: {}, prices: {}, lastRun: NOW - 3 * 3600e3 });
  assert.deepEqual(await runDaily(io), { skipped: true });
});
await test('device gone (410) → removed, other device still notified', async () => {
  const io = fakeIo({ subs: [sub('u1', 'old'), sub('u1', 'new', { lang: 'en' })], colls: { u1: [wish('w1', 'sv01-001', 10)] }, prices: { 'sv01-001': tcg(5) }, status: s => s.endpoint.endsWith('old') ? 410 : 201 });
  const r = await runDaily(io); assert.equal(r.gone, 1); assert.equal(r.sent, 1); assert.deepEqual(io.deleted, ['https://push.example/old']);
  assert.equal(io.sent[1].p.title, 'Good deal', 'English device gets English');
});
await test('several cards → one grouped notification, plural right, « and N more »', async () => {
  const list = [1, 2, 3, 4, 5].map(i => wish('w' + i, 'sv01-00' + i, 10));
  const io = fakeIo({ subs: [sub('u1', 'a')], colls: { u1: list }, prices: Object.fromEntries(list.map(e => [e.cardId, tcg(5)])) });
  await runDaily(io); assert.equal(io.sent.length, 1); assert.equal(io.sent[0].p.title, '5 cartes à surveiller'); assert.match(io.sent[0].p.body, /et 2 autres$/);
  assert.match(message([{ ...hitsFor(list.slice(0, 1), new Map([['fr:sv01-001', tcg(5)]]), 10, 0.9, '2026-11-25')[0] }, { kind: 'deal', uid: 'z', name: 'Z', value: 1, pct: -50, wish: true }, { kind: 'deal', uid: 'y', name: 'Y', value: 1, pct: -50, wish: true }, { kind: 'deal', uid: 'x', name: 'X', value: 1, pct: -50, wish: true }], 'fr').body, /et 1 autre$/);
});
await test('extreme data: very long name cut, broken entries and manual cards ignored, source down for a card', async () => {
  const long = wish('w1', 'sv01-001', 10, { name: 'N'.repeat(500) });
  const junk = [null, 42, { uid: 'm', cardId: 'manual-1', manualCard: true, status: 'wish', lang: 'fr' }, { uid: 'b', cardId: '<script>', lang: 'fr', status: 'wish' }, wish('w9', 'sv09-999', 10)];
  const io = fakeIo({ subs: [sub('u1', 'a')], colls: { u1: [long, ...junk] }, prices: { 'sv01-001': tcg(1) } });
  const r = await runDaily(io); assert.equal(r.sent, 1); assert.ok(io.sent[0].p.body.length < 120, 'long name not shortened');
});
await test('history: one reading per card version and day, notification cards first', async () => {
  const own = { uid: 'o', cardId: 'sv01-001', lang: 'fr', name: 'A', status: 'owned', variant: 'reverse' };
  const io = fakeIo({ subs: [], colls: { u1: [wish('w1', 'sv01-001', 10), own], u2: [] }, prices: { 'sv01-001': { variants: { normal: true }, pricing: { cardmarket: { trend: 3, 'trend-holo': 7, updated: 'x' } } } } });
  await runDaily(io);
  assert.deepEqual(io.hist.map(h => h.k).sort(), ['fr:sv01-001:normal', 'fr:sv01-001:reverse']); assert.equal(io.hist.find(h => h.k.endsWith('reverse')).v, 7);
});
await test('« Send a test »: only the caller\'s devices', async () => {
  const io = fakeIo({ subs: [sub('u1', 'a'), sub('u2', 'b')], colls: {}, prices: {} });
  assert.deepEqual(await runTest(io, 'u1'), { sent: 1 }); assert.equal(io.sent[0].to, 'https://push.example/a');
  assert.deepEqual(await runTest(io, 'nobody'), { sent: 0, reason: 'no_device' });
});
await test('value rule: manual > my price (follows the market) > suspicious price replaced by TCGplayer', async () => {
  assert.equal(entryValue({ manual: 99, price: { value: 1 } }, 0.9), 99);
  assert.equal(entryValue({ myPrice: { v: 50, est: 40 }, price: { value: 48 } }, 0.9), 60);
  assert.equal(entryValue({ rarity: 'Illustration spéciale rare', price: { value: 0.43 }, tcp: { normal: { marketPrice: 60 } }, variant: 'normal', cardId: 'sv01-1' }, 0.9), 54);
  assert.equal(dealDrop({ hist: [] }, 5, '2026-11-25'), 0, 'no history → no deal');
});
await test('Web Push: encrypted body layout and VAPID header (RFC 8291 / 8292)', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64u.enc(await crypto.subtle.exportKey('raw', ua.publicKey)), auth = b64u.enc(crypto.getRandomValues(new Uint8Array(16)));
  const body = await encrypt('{"title":"t"}', p256dh, auth);
  assert.equal(body[20], 65, 'key id length'); assert.equal(body.length, 16 + 4 + 1 + 65 + 13 + 1 + 16);
  const v = await makeVapid(), h = await vapidAuth('https://fcm.googleapis.com/fcm/send/x', 'https://a.b/', v.pub, await vapidKey(v.pub, v.priv), NOW);
  assert.match(h, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
  assert.equal(JSON.parse(atob(h.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aud, 'https://fcm.googleapis.com');
});
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
