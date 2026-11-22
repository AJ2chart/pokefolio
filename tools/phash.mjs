// Card picture fingerprints, shared by the GitHub job (tools/hash-cards.mjs) and the app's scan (loaded with import()).
// Same code on both sides, so a photo and the official picture of the same card get comparable fingerprints.
// A fingerprint = 64-bit perceptual hash (DCT of a 32×32 grey thumbnail), written as 16 hex characters.

// regions of the card that are hashed: the whole card (minus a thin border) and the artwork
export const REGIONS = {
  pk: { full: [0.04, 0.96, 0.03, 0.97], art: [0.08, 0.92, 0.10, 0.50] },
  op: { full: [0.04, 0.96, 0.03, 0.97], art: [0.06, 0.94, 0.08, 0.62] },
};

export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return g;
}

// area-average resize of a sub-rectangle (fractions of the picture) to W×H
export function resizeArea(g, w, h, [x0, x1, y0, y1], W, H) {
  const out = new Float32Array(W * H);
  const sx = x0 * w, sy = y0 * h, cw = (x1 - x0) * w / W, ch = (y1 - y0) * h / H;
  for (let Y = 0; Y < H; Y++) {
    const ya = sy + Y * ch, yb = ya + ch;
    for (let X = 0; X < W; X++) {
      const xa = sx + X * cw, xb = xa + cw;
      let s = 0, a = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
        if (y < 0 || y >= h) continue;
        const wy = Math.min(yb, y + 1) - Math.max(ya, y);
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          if (x < 0 || x >= w) continue;
          const wx = Math.min(xb, x + 1) - Math.max(xa, x), k = wx * wy;
          s += g[y * w + x] * k; a += k;
        }
      }
      out[Y * W + X] = a ? s / a : 0;
    }
  }
  return out;
}

const N = 32, COS = (() => { const c = new Float32Array(N * N); for (let u = 0; u < N; u++) for (let x = 0; x < N; x++) c[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)); return c; })();
// 64-bit pHash of a 32×32 thumbnail: low 8×8 DCT frequencies (DC excluded) compared with their median
export function phash32(t) {
  const rows = new Float32Array(N * 8);
  for (let y = 0; y < N; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < N; x++) s += t[y * N + x] * COS[u * N + x]; rows[y * 8 + u] = s; }
  const d = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { if (!u && !v) { d.push(null); continue } let s = 0; for (let y = 0; y < N; y++) s += rows[y * 8 + u] * COS[v * N + y]; d.push(s); }
  const vals = d.filter(x => x !== null).sort((a, b) => a - b), med = vals[vals.length >> 1];
  let hex = '';
  for (let i = 0; i < 64; i += 4) { let n = 0; for (let b = 0; b < 4; b++) n = (n << 1) | (d[i + b] !== null && d[i + b] > med ? 1 : 0); hex += n.toString(16); }
  return hex;
}

export function fingerprint(g, w, h, game = 'pk') {
  const R = REGIONS[game] || REGIONS.pk;
  return phash32(resizeArea(g, w, h, R.full, N, N)) + phash32(resizeArea(g, w, h, R.art, N, N));
}

// Hamming distance between two hex fingerprints of the same length
const POP = (() => { const p = new Uint8Array(16); for (let i = 0; i < 16; i++) p[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1); return p; })();
export function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)]; return d; }

// Where is the card in the photo? Edge density profiles → bounding box, then forced to the card ratio (63×88).
// Returns fractions [x0, x1, y0, y1] of the picture.
export function findCardBox(g, w, h) {
  const S = Math.max(1, Math.floor(Math.max(w, h) / 360)), W = Math.floor(w / S), H = Math.floor(h / S);
  const s = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s[y * W + x] = g[(y * S) * w + x * S];
  const e = new Float32Array(W * H); let sum = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, gx = s[i + 1] - s[i - 1], gy = s[i + W] - s[i - W], m = Math.abs(gx) + Math.abs(gy); e[i] = m; sum += m;
  }
  const thr = (sum / (W * H)) * 2.2;
  const xs = [], ys = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (e[y * W + x] > thr) { xs.push(x); ys.push(y); }
  if (xs.length < 50) return [0, 1, 0, 1];
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)))];
  let x0 = q(xs, 0.02) / W, x1 = q(xs, 0.98) / W, y0 = q(ys, 0.02) / H, y1 = q(ys, 0.98) / H;
  // force the card ratio around the centre of the box (in pixels)
  const cx = (x0 + x1) / 2 * w, cy = (y0 + y1) / 2 * h; let bw = (x1 - x0) * w, bh = (y1 - y0) * h;
  if (bw / bh > 63 / 88) bw = bh * 63 / 88; else bh = bw * 88 / 63;
  x0 = Math.max(0, (cx - bw / 2) / w); x1 = Math.min(1, (cx + bw / 2) / w); y0 = Math.max(0, (cy - bh / 2) / h); y1 = Math.min(1, (cy + bh / 2) / h);
  return [x0, x1, y0, y1];
}

// crop a grey picture to a box (fractions) — the result keeps the original resolution
export function crop(g, w, h, [x0, x1, y0, y1]) {
  const X0 = Math.round(x0 * w), X1 = Math.round(x1 * w), Y0 = Math.round(y0 * h), Y1 = Math.round(y1 * h), W = Math.max(1, X1 - X0), H = Math.max(1, Y1 - Y0);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = g[(Y0 + y) * w + X0 + x];
  return { g: out, w: W, h: H };
}

// fingerprints of a photo: the detected card, plus slightly tighter / looser crops (photos are never perfectly framed)
export function photoFingerprints(g, w, h, game = 'pk') {
  const box = findCardBox(g, w, h), out = [];
  const grow = ([a, b, c, d], k) => { const cx = (a + b) / 2, cy = (c + d) / 2, hw = (b - a) / 2 * k, hh = (d - c) / 2 * k; return [Math.max(0, cx - hw), Math.min(1, cx + hw), Math.max(0, cy - hh), Math.min(1, cy + hh)] };
  for (const b of [box, grow(box, 0.96), grow(box, 1.04), grow(box, 0.92)]) { const c = crop(g, w, h, b); out.push(fingerprint(c.g, c.w, c.h, game)); }
  return out;
}

// best matches of a photo among { id: fingerprint } — score = distance on the whole card + distance on the artwork (0…128, lower is better)
export function bestMatches(prints, table, n = 6) {
  const best = [];
  for (const id in table) {
    const t = table[id]; let s = 999;
    for (const p of prints) { const d = hamming(p.slice(0, 16), t.slice(0, 16)) + hamming(p.slice(16), t.slice(16)); if (d < s) s = d; }
    if (best.length < n || s < best[best.length - 1].s) { best.push({ id, s }); best.sort((a, b) => a.s - b.s); if (best.length > n) best.pop(); }
  }
  return best;
}
