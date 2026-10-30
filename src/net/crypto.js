// End-to-end privacy for hands in online play: every seat has an ECDH P-256 key pair; the host
// derives one AES-GCM key per remote seat and encrypts that seat's hand before publishing it.
const KEY_STORE = 'catan3d-netkey-v1';
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

export function cryptoAvailable() {
  return !!subtle();
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Reuses a stored key pair (so a reloaded page can reclaim its seat), else makes a new one.
export async function loadKeyPair() {
  const S = subtle();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_STORE) || 'null');
    if (saved && saved.priv && saved.pub) {
      const priv = await S.importKey('jwk', saved.priv, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
      const pub = await S.importKey('raw', unb64(saved.pub), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
      return { priv, pub, pubB64: saved.pub };
    }
  } catch {
    /* fall through to a fresh key */
  }
  const kp = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const pubB64 = b64(await S.exportKey('raw', kp.publicKey));
  try {
    localStorage.setItem(KEY_STORE, JSON.stringify({ priv: await S.exportKey('jwk', kp.privateKey), pub: pubB64 }));
  } catch {
    /* storage unavailable: key lives for this page load only */
  }
  return { priv: kp.privateKey, pub: kp.publicKey, pubB64 };
}

const derived = new Map();
export async function sharedKey(myPriv, otherPubB64) {
  const k = otherPubB64;
  if (derived.has(k)) return derived.get(k);
  const S = subtle();
  const other = await S.importKey('raw', unb64(otherPubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await S.deriveKey({ name: 'ECDH', public: other }, myPriv, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
  derived.set(k, key);
  return key;
}

export async function seal(key, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return b64(out);
}

export async function open(key, blob) {
  const bytes = unb64(blob);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}
