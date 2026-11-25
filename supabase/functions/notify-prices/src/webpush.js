// Web Push sending with the platform's own crypto (Web Crypto), no third-party package:
// payload encryption « aes128gcm » (RFC 8291 / RFC 8188) and the VAPID signature that identifies the sender (RFC 8292).
// Works the same in the Supabase function (Deno) and in the tests (Node).

const enc = new TextEncoder();
export const b64u = {
  enc: buf => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: str => { const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); },
};
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

// VAPID keys: public = uncompressed P-256 point (65 bytes), private = its 32-byte scalar, both base64url
export async function makeVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { pub: b64u.enc(await crypto.subtle.exportKey('raw', k.publicKey)), priv: (await crypto.subtle.exportKey('jwk', k.privateKey)).d };
}
export async function vapidKey(pub, priv) {
  const P = b64u.dec(pub);
  if (P.length !== 65 || P[0] !== 4) throw new Error('VAPID public key must be 65 bytes (uncompressed)');
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u.enc(P.slice(1, 33)), y: b64u.enc(P.slice(33)), d: priv, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
export async function vapidAuth(endpoint, subject, pub, key, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));   // raw r||s = JOSE format
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${pub}`;
}

// Encrypts for one subscription (keys p256dh + auth given by the browser). Returns the request body.
export async function encrypt(payload, p256dh, authSecret, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const ua = b64u.dec(p256dh), auth = b64u.dec(authSecret);
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = cat(typeof payload === 'string' ? enc.encode(payload) : payload, new Uint8Array([2]));   // single record: delimiter 0x02, no padding
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// Sends one notification. Returns the HTTP status (201 = accepted; 404 / 410 = this subscription no longer exists).
export async function sendPush(fetchFn, sub, payload, vapid, ttl = 12 * 3600) {
  const body = await encrypt(JSON.stringify(payload), sub.p256dh, sub.auth);
  const r = await fetchFn(sub.endpoint, { method: 'POST', body, headers: {
    TTL: String(ttl), Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: await vapidAuth(sub.endpoint, vapid.subject, vapid.pub, vapid.key) } });
  return r.status;
}
