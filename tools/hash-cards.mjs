// Computes the fingerprint of every card picture (Pokémon FR/EN/JA from TCGdex, One Piece from OPTCG API,
// Magic from Scryfall: one per artwork, the app then tells the printings apart)
// and writes them to hashes/*.json, used by the app's scan. Run daily by .github/workflows/hashes.yml.
// Incremental: cards already fingerprinted are kept; a run stops after TIME_BUDGET and the next one continues.
import fs from 'fs';
import zlib from 'zlib';
import sharp from 'sharp';
import { toGray, fingerprint } from './phash.mjs';

const TIME_BUDGET = (+process.env.TIME_BUDGET_MIN || 80) * 60e3, CONC = 12, t0 = Date.now();
const OUT = 'hashes'; fs.mkdirSync(OUT, { recursive: true });
const status = { started: new Date().toISOString(), sets: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(u, tries = 3) { for (let i = 0; ; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Gleamvault-hashes/1.0 (github.com/AJ2chart/pokefolio)', Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json() } catch (e) { if (i >= tries - 1) throw e; await sleep(1500 * (i + 1)) } } }
async function fp(url, game) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Gleamvault-hashes/1.0' } }); if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return fingerprint(toGray(data, info.width, info.height), info.width, info.height, game);
}
async function run(key, game, list) {   // list: [{id, url}]
  const file = `${OUT}/${key}.json`;
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { h: {} };
  const h = old.h || {}, todo = list.filter(c => c.url && !h[c.id]);
  const st = status.sets[key] = { cards: list.length, withPicture: list.filter(c => c.url).length, before: Object.keys(h).length, added: 0, errors: 0, sampleErrors: [] };
  let i = 0;
  async function worker() { while (i < todo.length && Date.now() - t0 < TIME_BUDGET) { const c = todo[i++]; try { h[c.id] = await fp(c.url, game); st.added++ } catch (e) { st.errors++; if (st.sampleErrors.length < 5) st.sampleErrors.push(c.id + ': ' + e.message) } } }
  await Promise.all(Array.from({ length: CONC }, worker));
  st.after = Object.keys(h).length; st.remaining = todo.length - st.added - st.errors;
  // rewrite the table only when it changed: the app downloads it again only when its date changes (mobile data)
  if (st.added || !old.updated) fs.writeFileSync(file, JSON.stringify({ v: 1, game, updated: new Date().toISOString(), h }));
  st.updated = st.added || !old.updated ? new Date().toISOString() : old.updated;
}
async function main() {
  for (const lang of ['fr', 'en', 'ja']) {
    try { const cards = await getJSON(`https://api.tcgdex.net/v2/${lang}/cards`); await run('pk-' + lang, 'pk', cards.map(c => ({ id: c.id, url: c.image ? c.image + '/low.webp' : '' }))) }
    catch (e) { status.sets['pk-' + lang] = { error: String(e.message || e) } }
  }
  try { const cards = await getJSON('https://optcgapi.com/api/allSetCards/'); await run('op', 'op', cards.filter(c => c.card_image_id).map(c => ({ id: c.card_image_id, url: c.card_image || '' }))) }
  catch (e) { status.sets.op = { error: String(e.message || e) } }
  // Magic: Scryfall bulk file « unique artwork » (one card per illustration), paper cards only, small pictures (146×204)
  try {
    const meta = await getJSON('https://api.scryfall.com/bulk-data/unique_artwork');
    const dl = meta.download_uri || meta.download_url || Object.entries(meta).find(([k, v]) => /download/i.test(k) && typeof v === 'string')?.[1];
    if (!dl) throw new Error('no download link, keys: ' + Object.keys(meta).join(','));
    // the bulk file comes gzipped without a Content-Encoding header: unpack it ourselves
    const raw = Buffer.from(await (await fetch(dl, { headers: { 'User-Agent': 'Gleamvault-hashes/1.0 (github.com/AJ2chart/pokefolio)' } })).arrayBuffer());
    const cards = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('utf8'));
    const SKIP = new Set(['art_series', 'token', 'double_faced_token', 'emblem', 'vanguard', 'planar', 'scheme', 'reversible_card']);
    const list = cards.filter(c => (c.games || []).includes('paper') && !SKIP.has(c.layout) && !c.digital)
      .map(c => ({ id: c.id, url: (c.image_uris || c.card_faces?.[0]?.image_uris || {}).small || '' }));
    await run('mg', 'mg', list);
  } catch (e) { status.sets.mg = { error: String(e.message || e) } }
  status.minutes = Math.round((Date.now() - t0) / 6e4); fs.writeFileSync(`${OUT}/status.json`, JSON.stringify(status, null, 1));
}
main().catch(e => { status.fatal = String(e.stack || e); fs.writeFileSync(`${OUT}/status.json`, JSON.stringify(status, null, 1)); process.exit(1) });
