// The parts of the translation that the rules engine and the server use too, without the dictionary.

// '{n} 張' with { n: 3 } → '3 張'
export function fill(s, params) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
}

// Marks a string as a key, read in the reader's language later (gettext's N_()): the rules engine
// and the workshop's checks keep their messages in Chinese, the page shows them through t().
export const N_ = (key) => key;

// A message to translate later: its key, its parameters and its text in Chinese.
export function msg(key, params) {
  return { key, params: params || null, text: params ? fill(key, params) : key };
}
