// Signing in with Google (on the game's own site) and the player's record of finished campaigns.
// The page asks Google for an ID token ("Sign in with Google" button) and hands it to the site's
// server, which checks it and keeps a session cookie; nothing about the account is stored in the page.
// See server/accounts.js.
const GSI = 'https://accounts.google.com/gsi/client';

let user; // undefined: not asked yet; null: signed out
let loading = null;
let gsi = null;
let gsiReady = false;
const listeners = new Set();

// only the self-hosted site has accounts (the page there sets window.__gsi, the sign-in client id)
export function accountsAvailable() {
  return typeof window !== 'undefined' && typeof window.__gsi === 'string' && window.__gsi.length > 10 && typeof fetch === 'function';
}

export function currentUser() {
  return user || null;
}

export function onUser(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setUser(u) {
  user = u || null;
  for (const f of listeners) {
    try {
      f(user);
    } catch (e) {
      console.error(e);
    }
  }
}

async function api(path, body) {
  const res = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = new Error((data && data.message) || (data && data.error) || 'HTTP ' + res.status);
    e.status = res.status;
    e.code = data && data.error;
    throw e;
  }
  return data || {};
}

// who is signed in (asked once per page; refresh: ask again)
export function loadUser(refresh = false) {
  if (!accountsAvailable()) return Promise.resolve(null);
  if (loading && !refresh) return loading;
  loading = api('me')
    .then((d) => {
      setUser(d.user || null);
      return user;
    })
    .catch((e) => {
      console.warn('account', e);
      if (user === undefined) setUser(null);
      loading = null;
      return user;
    });
  return loading;
}

function loadGsi() {
  if (typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve(window.google.accounts.id);
  if (gsi) return gsi;
  gsi = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI;
    s.async = true;
    s.onload = () => (window.google && window.google.accounts && window.google.accounts.id ? resolve(window.google.accounts.id) : reject(new Error('Google 登入沒有正確載入')));
    s.onerror = () => {
      gsi = null;
      reject(new Error('無法連到 Google 登入，請確認網路連線後再試一次'));
    };
    document.head.appendChild(s);
  });
  return gsi;
}

// Draws Google's own sign-in button into `el`. onDone(user) after a successful sign-in; onError(message).
export async function renderSignIn(el, { onDone, onError, width = 260 } = {}) {
  const id = await loadGsi();
  if (!gsiReady) {
    gsiReady = true;
    id.initialize({
      client_id: window.__gsi,
      ux_mode: 'popup',
      auto_select: false,
      cancel_on_tap_outside: true,
      itp_support: true,
      callback: async (resp) => {
        try {
          const d = await api('login', { credential: resp && resp.credential });
          setUser(d.user || null);
          if (signInDone) signInDone(user);
        } catch (e) {
          console.warn('sign-in', e);
          if (signInError) signInError(e.status === 401 ? 'Google 的登入憑證無法驗證，請再試一次' : '登入失敗，請稍後再試');
        }
      },
    });
  }
  signInDone = onDone;
  signInError = onError;
  id.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', locale: 'zh-TW', width });
}
let signInDone = null;
let signInError = null;

export async function signOut() {
  try {
    await api('logout', {});
  } finally {
    try {
      if (window.google && window.google.accounts && window.google.accounts.id) window.google.accounts.id.disableAutoSelect();
    } catch {
      /* not loaded */
    }
    setUser(null);
  }
}

// deletes the account and its record on the server
export async function forgetMe() {
  await api('forget', {});
  setUser(null);
}

// a finished campaign (see Game.result): counted once per game on the server
export async function reportResult(r) {
  if (!accountsAvailable() || !r) return null;
  if (user === undefined) await loadUser();
  if (!user) return null;
  try {
    const d = await api('result', r);
    if (d.user) setUser(d.user);
    return d;
  } catch (e) {
    console.warn('result', e);
    if (e.status === 401) setUser(null);
    return null;
  }
}
