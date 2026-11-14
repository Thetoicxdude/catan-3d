// The game's two languages: English (the default) and Traditional Chinese (Settings → Language).
//
// The Chinese text in the code is the key: t('交易') is '交易' in Chinese and EN['交易'] ('Trade') in
// English. Placeholders are written {name}: t('{who} 擲出 {n}', { who, n }). An English entry may be a
// function of the parameters (plurals: '{n} 張' → n === 1 ? '1 card' : `${n} cards`).
//
// The language is set once, when the settings are read (changing it reloads the page), so nothing may be
// translated while the modules load: a module-level table of words is made with names(), which reads
// each word in the language of the moment. test/i18n.mjs checks that every Chinese string in src/ goes
// through t() (or names()) and that every key has its English.
import { EN } from './en.js';
import { fill } from './fill.js';

export { fill, N_, msg } from './fill.js';

let lang = 'en';
export function setLang(l) {
  lang = l === 'zh' ? 'zh' : 'en';
}
export function getLang() {
  return lang;
}
export const isZh = () => lang === 'zh';

const warned = new Set();
export function t(key, params) {
  let s = key;
  // a key may carry a context after §, for words that need different English in different places:
  // t('發展卡§bar') is 發展卡 in Chinese, EN['發展卡§bar'] in English
  const ctx = key.indexOf('§');
  if (ctx >= 0 && lang !== 'en') s = key.slice(0, ctx);
  if (lang === 'en') {
    const v = EN[key];
    if (v === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        if (typeof console !== 'undefined') console.warn('[i18n] no English for:', key);
      }
    } else s = typeof v === 'function' ? v(params || {}) : v;
  }
  return params ? fill(s, params) : s;
}

// A word that may be a key or may be a player's own: the name of a built-in map, a default nation's
// name, a word the server stored. Kept as it is when it is not a key.
export function tx(s) {
  if (lang === 'en' && typeof s === 'string' && typeof EN[s] === 'string') return EN[s];
  return s;
}

// The key whose English is s (a default name saved in English, read again in Chinese), or s itself.
export function untx(s) {
  if (typeof s !== 'string') return s;
  for (const [k, v] of Object.entries(EN)) if (v === s) return k;
  return s;
}

// A table whose values are keys, each read in the language of the moment: names({ wood: '木材' }).wood.
export function names(table) {
  const out = {};
  for (const [k, v] of Object.entries(table)) {
    Object.defineProperty(out, k, { enumerable: true, get: () => t(v) });
  }
  return out;
}

// The words of a rule error, a host's refusal or the server's answer: { key, params } (RuleError) or a
// plain message (itself a key when it came from our own code).
export function terr(e) {
  if (!e) return '';
  if (typeof e === 'string') return tx(e);
  if (e.key) return t(e.key, e.params || undefined);
  return tx(e.message || String(e));
}

// The first letter of a sentence, plain or HTML, in capitals ("you rolled 8" → "You rolled 8"): in
// English a sentence may begin with "you" or a lower-case word put in by a placeholder.
export function cap(html) {
  if (lang !== 'en' || !html) return html;
  const s = String(html);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<') {
      const j = s.indexOf('>', i);
      if (j < 0) return s;
      i = j;
    } else if (c === '&') {
      const j = s.indexOf(';', i);
      if (j < 0 || j - i > 10) return s;
      i = j;
    } else if (/\s/.test(c)) continue;
    else return c === c.toUpperCase() ? s : s.slice(0, i) + c.toUpperCase() + s.slice(i + 1);
  }
  return s;
}

// A list of words: 木材、磚塊 / Lumber, Brick.
export function list(parts) {
  // i18n-keep: the Chinese list mark itself
  return parts.join(lang === 'en' ? ', ' : '、');
}

// A name inside a sentence: lower case in English ('Road' → 'a road').
export function low(s) {
  return lang === 'en' ? String(s).toLowerCase() : s;
}

// For the English entries: the word for n of something.
export const plural = (n, one, many) => (Number(n) === 1 ? one : many);
