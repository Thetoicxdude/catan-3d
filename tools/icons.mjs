// Picks the game's icons out of the Game Icons set (https://game-icons.net, CC BY 3.0: Lorc, Delapouite
// and other contributors) and writes them to src/ui/gameicons.js, so the page carries only what it uses.
//   npm pack @iconify-json/game-icons && tar -xzf iconify-json-game-icons-*.tgz
//   node tools/icons.mjs package/icons.json
import { readFileSync, writeFileSync } from 'node:fs';

const USED = [
  // home: the ways to play, the corner medals, the account
  'crossed-swords', 'tower-flag', 'open-gate', 'scroll-unfurled', 'rule-book', 'cog', 'visored-helm', 'laurels-trophy',
  // the action bar and the top bar
  'rolling-dices', 'stone-path', 'house', 'castle', 'card-draw', 'trade', 'card-pick', 'player-next', 'hourglass', 'talk',
  'mounted-knight', 'laurel-crown', 'card-random', 'exit-door', 'meeple-group', 'hooded-figure', 'anchor',
];

const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const name of USED) {
  const ic = src.icons[name];
  if (!ic) throw new Error('no icon ' + name);
  // every icon is a single path filled with currentColor on a 512 × 512 grid
  const d = /\sd="([^"]+)"/.exec(ic.body);
  if (!d) throw new Error('unexpected icon body ' + name);
  out[name] = d[1];
}
const js = `// Icons from Game Icons (https://game-icons.net) by Lorc, Delapouite and other contributors,
// CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Picked by tools/icons.mjs; each is one
// path on a 512 × 512 grid.
export const GAME_ICONS = ${JSON.stringify(out, null, 0).replace(/","/g, '",\n  "').replace('{"', '{\n  "').replace('"}', '"\n}')};

export const ICON_CREDIT = '圖示：game-icons.net（Lorc、Delapouite 等作者，CC BY 3.0）';

// a filled icon in the colour of the text around it
export function gameIcon(name, size = 24, cls = 'gi') {
  const d = GAME_ICONS[name];
  if (!d) return '';
  return \`<svg class="\${cls}" width="\${size}" height="\${size}" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="\${d}"/></svg>\`;
}
`;
writeFileSync(new URL('../src/ui/gameicons.js', import.meta.url), js);
console.log('wrote', Object.keys(out).length, 'icons,', (js.length / 1024).toFixed(1), 'KB');
