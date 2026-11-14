// The two languages (src/i18n): every Chinese word that can reach the screen is a key with its English.
//
//   · every Chinese string in src/ stands where a key goes — t('…'), N_('…'), msg('…'), names({ x: '…' }),
//     need(cond, '…'), new RuleError('…'), add(list, name, '…') — or under an `i18n-keep` comment (words
//     kept in Chinese on purpose: the province names the English ones are made from, the word 中文);
//   · the Chinese strings of server/ (sent to the players, translated by the page) are keys too;
//   · every key has its English in src/i18n/en.js, with the same {placeholders}.
//
// node test/i18n.mjs        (--unused lists the English entries no key in the code uses)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { EN } from '../src/i18n/en.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;
// the functions that take a key, and which argument it is
const KEY_ARG = { t: 0, N_: 0, msg: 0, need: 1, RuleError: 0, add: 2, terrKey: 0 };

function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.m?js$/.test(f)) out.push(p);
  }
  return out;
}

const problems = [];
const keys = new Map(); // key → first place it is used
const short = (s) => (s.length > 60 ? s.slice(0, 60) + '…' : s);

function check(path, server) {
  const src = readFileSync(path, 'utf8');
  const rel = relative(ROOT, path);
  const comments = [];
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: comments });
  // `i18n-keep`: the statement that starts on the comment's line or the next one keeps its Chinese
  const keepLines = new Set();
  for (const c of comments) if (/i18n-keep/.test(c.value)) keepLines.add(c.loc.end.line), keepLines.add(c.loc.end.line + 1);
  const kept = [];
  walk.full(ast, (node) => {
    if (keepLines.has(node.loc.start.line) && /Statement|Declaration|Property|Expression/.test(node.type)) kept.push([node.start, node.end]);
  });
  const isKept = (n) => kept.some(([a, b]) => n.start >= a && n.end <= b);

  const seen = (node, text, ancestors) => {
    if (!CJK.test(text) || isKept(node)) return;
    const where = `${rel}:${node.loc.start.line}`;
    if (server) {
      // the server's words are keys the page translates
      if (node.type === 'TemplateLiteral') problems.push(`${where}: a Chinese template string the page cannot translate: ${short(text)}`);
      else if (EN[text] === undefined) problems.push(`${where}: the server's words have no English: ${short(text)}`);
      else keys.has(text) || keys.set(text, where);
      return;
    }
    // climb through a ? b : c, a || b and (…) to where the value is used
    let i = ancestors.length - 1;
    let child = node;
    while (i > 0 && /ConditionalExpression|LogicalExpression|ParenthesizedExpression/.test(ancestors[i - 1].type) && ancestors[i - 1].test !== child) child = ancestors[--i];
    const parent = ancestors[i - 1];
    let ok = false;
    if (parent && (parent.type === 'CallExpression' || parent.type === 'NewExpression')) {
      const c = parent.callee;
      const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : '';
      ok = name in KEY_ARG && parent.arguments[KEY_ARG[name]] === child;
    } else if (parent && parent.type === 'Property' && parent.value === child) {
      // names({ wood: '木材' })
      const obj = ancestors[i - 2];
      const call = ancestors[i - 3];
      ok = obj && obj.type === 'ObjectExpression' && call && call.type === 'CallExpression' && call.callee.type === 'Identifier' && call.callee.name === 'names';
    }
    if (!ok) problems.push(`${where}: Chinese that is not a key: ${short(text)}`);
    else if (node.type === 'TemplateLiteral') problems.push(`${where}: a key must be a plain string ({placeholders}, not \${…}): ${short(text)}`);
    else keys.has(text) || keys.set(text, where);
  };

  // a local t (a trade, a time…) hides the translation: t('…') under it calls the wrong function
  const names = (p, out = []) => {
    if (!p) return out;
    if (p.type === 'Identifier') out.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => names(q.value || q.argument, out));
    else if (p.type === 'ArrayPattern') p.elements.forEach((q) => names(q, out));
    else if (p.type === 'AssignmentPattern') names(p.left, out);
    else if (p.type === 'RestElement') names(p.argument, out);
    return out;
  };
  const declares = (scope) => {
    if (/Function/.test(scope.type)) return scope.params.some((q) => names(q).includes('t'));
    if (scope.type === 'CatchClause') return names(scope.param).includes('t');
    const body = scope.type === 'BlockStatement' || scope.type === 'Program' ? scope.body : scope.type === 'ForStatement' ? [scope.init] : scope.type === 'ForOfStatement' || scope.type === 'ForInStatement' ? [scope.left] : [];
    return body.some((st) => st && st.type === 'VariableDeclaration' && st.declarations.some((d) => names(d.id).includes('t')));
  };
  walk.ancestor(ast, {
    CallExpression(node, _, ancestors) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 't') return;
      for (let i = ancestors.length - 2; i > 0; i--) {
        if (declares(ancestors[i])) {
          problems.push(`${rel}:${node.loc.start.line}: t() is a local variable here (line ${ancestors[i].loc.start.line}), not the translation`);
          break;
        }
      }
    },
  });

  walk.ancestor(ast, {
    Literal(node, _, ancestors) {
      if (typeof node.value === 'string') seen(node, node.value, ancestors);
    },
    TemplateLiteral(node, _, ancestors) {
      seen(node, node.quasis.map((q) => q.value.cooked).join('${}'), ancestors);
    },
  });
}

for (const p of files(join(ROOT, 'src'))) if (!p.includes(`${'i18n'}/en.js`)) check(p, false);
for (const p of files(join(ROOT, 'server'))) check(p, true);

// every key has its English, with the same placeholders
const holes = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
for (const [key, where] of keys) {
  const v = EN[key];
  if (v === undefined) {
    problems.push(`${where}: no English for: ${short(key)}`);
    continue;
  }
  const want = holes(key);
  if (typeof v === 'function') {
    for (const x of [0, 1, 2, 'Standard', 'x']) {
      const params = {};
      for (const h of want) params[h] = x;
      const got = holes(v(params));
      for (const h of got) if (!want.has(h)) problems.push(`${where}: the English of ${short(key)} has {${h}}, the key does not`);
    }
  } else {
    const got = holes(v);
    for (const h of got) if (!want.has(h)) problems.push(`${where}: the English of ${short(key)} has {${h}}, the key does not`);
    for (const h of want) if (!got.has(h)) problems.push(`${where}: the English of ${short(key)} leaves out {${h}}`);
  }
  if (typeof v === 'string' && CJK.test(v)) problems.push(`${where}: the English of ${short(key)} has Chinese in it`);
}

if (process.argv.includes('--unused')) {
  const unused = Object.keys(EN).filter((k) => !keys.has(k));
  console.log(`${unused.length} English entries no key uses:`);
  for (const k of unused) console.log('  ' + short(k));
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\ni18n: ${problems.length} problems (${keys.size} keys)`);
  process.exit(1);
}
console.log(`i18n ok: ${keys.size} keys, all with English`);
