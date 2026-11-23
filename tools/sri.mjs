// Pins the libraries the app loads from CDNs to an exact version and computes their integrity hash (SRI):
// if a CDN file were ever altered, the browser would refuse to run it. Run by .github/workflows/sri.yml → tools/sri.json
import crypto from 'crypto';
import fs from 'fs';
const UA = { 'User-Agent': 'Gleamvault-sri/1.0 (github.com/AJ2chart/pokefolio)' };
const latest = async (pkg, major) => {
  const j = await (await fetch(`https://registry.npmjs.org/${pkg}`, { headers: UA })).json();
  const vs = Object.keys(j.versions).filter(v => v.startsWith(major + '.') && !/-/.test(v));
  vs.sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 });
  return vs.pop();
};
const sri = async url => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  const b = Buffer.from(await r.arrayBuffer());
  return { url, integrity: 'sha384-' + crypto.createHash('sha384').update(b).digest('base64'), bytes: b.length };
};
const sb = await latest('@supabase/supabase-js', 2);
const ts = await latest('tesseract.js', 5);
const out = {
  generated: new Date().toISOString(),
  supabase: { version: sb, ...(await sri(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${sb}/dist/umd/supabase.js`)) },
  tesseract: { version: ts, ...(await sri(`https://cdn.jsdelivr.net/npm/tesseract.js@${ts}/dist/tesseract.min.js`)) },
  chart: { version: '4.4.1', ...(await sri('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js')) },
};
fs.writeFileSync('tools/sri.json', JSON.stringify(out, null, 1) + '\n');
console.log(out);
