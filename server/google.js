// Checks a Google ID token ("Sign in with Google"): the signature against Google's published keys,
// then who issued it, for which site, and that it is still valid. Returns the token's claims.
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

function b64urlBytes(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function b64urlJSON(s) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
}

// Google's signing keys, kept for as long as Google says they may be cached
let cache = { keys: null, until: 0 };
export async function googleKeys(force = false) {
  if (!force && cache.keys && Date.now() < cache.until) return cache.keys;
  const res = await fetch(CERTS);
  if (!res.ok) throw new Error('google keys: ' + res.status);
  const body = await res.json();
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  cache = { keys: body.keys || [], until: Date.now() + (m ? Number(m[1]) * 1000 : 3600000) };
  return cache.keys;
}

export class TokenError extends Error {}

// getKeys(force): the signing keys (Google's, or a test set for local runs)
export async function verifyIdToken(token, clientId, getKeys = googleKeys, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096) throw new TokenError('bad token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('bad token');
  let header, claims;
  try {
    header = b64urlJSON(parts[0]);
    claims = b64urlJSON(parts[1]);
  } catch {
    throw new TokenError('bad token');
  }
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') throw new TokenError('bad token');
  let keys = await getKeys(false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Google rotates its keys: look once more
    keys = await getKeys(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new TokenError('unknown key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new TokenError('bad signature');
  const t = Math.floor(now / 1000);
  if (!ISSUERS.includes(claims.iss)) throw new TokenError('wrong issuer');
  if (claims.aud !== clientId) throw new TokenError('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp < t - 60) throw new TokenError('expired');
  if (typeof claims.iat === 'number' && claims.iat > t + 300) throw new TokenError('issued in the future');
  if (typeof claims.sub !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(claims.sub)) throw new TokenError('no subject');
  return claims;
}
