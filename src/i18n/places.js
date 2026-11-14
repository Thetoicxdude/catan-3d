// The provinces' names in the reader's language. The game names its provinces in Chinese, from the parts
// in engine/board.js (NAMES: a first part and a last part for each terrain); in English the same parts
// are read from the lists below, at the same places: 黑松 + 林 → Blackpine Wood.
import { NAMES } from '../engine/board.js';
import { getLang } from './index.js';

const EN_PARTS = {
  forest: [['Blackpine', 'Spruce', 'Oak', 'Misthollow', 'Deepvale', 'Redmaple', 'Oldvine', 'Deercall', 'Wolfhowl', 'Greenoak'], ['Wood', 'Forest', 'Woodland']],
  hills: [['Redclay', 'Red Earth', 'Brownrock', 'Kilnfire', 'Brickred', 'Ruststone', 'Ochre', 'Charkiln'], ['Hill', 'Hills', 'Ridge']],
  pasture: [['Bluefleece', 'Whitefleece', 'Greenmeadow', 'Windsong', 'Idyll', 'Springgrass', 'Silverbell', 'Cloudfleece'], ['Downs', 'Pasture', 'Meadow']],
  fields: [['Goldwheat', 'Fullear', 'Golden', 'Wheatwave', 'Sweetgrain', 'Warmsun', 'Harvest', 'Amber'], ['Fields', 'Plain', 'Vale']],
  mountains: [['Ironspine', 'Greyrock', 'Snowpeak', 'Eyrie', 'Dragonspine', 'Frostedge', 'Obsidian', 'Silvervein'], ['Peak', 'Mountains', 'Range']],
  desert: [['Quicksand', 'Scorched', 'Yellowsand', 'Bonedry', 'Blaze', 'Endless'], ['Waste', 'Sands', 'Desert']],
  gold: [['Goldsand', 'Golden', 'Brightgold', 'Goldvein', 'Sunglow', 'Gemlight'], ['Valley', 'Mine', 'Diggings']],
};

const cache = new Map();
// the name of a hex of the board ({ terrain, name }) to show
export function placeName(hex) {
  if (!hex || !hex.name) return '';
  if (getLang() !== 'en') return hex.name;
  const k = hex.terrain + '|' + hex.name;
  if (!cache.has(k)) cache.set(k, english(hex.terrain, hex.name));
  return cache.get(k);
}

function english(terrain, name) {
  // the terrain may have changed since the name was given (the fog): look through every terrain's parts
  const order = [terrain, ...Object.keys(NAMES).filter((x) => x !== terrain)];
  for (const tr of order) {
    const zh = NAMES[tr];
    const en = EN_PARTS[tr];
    if (!zh || !en) continue;
    const i = zh[0].findIndex((p) => name.startsWith(p));
    if (i < 0) continue;
    const j = zh[1].indexOf(name.slice(zh[0][i].length));
    if (j >= 0) return `${en[0][i]} ${en[1][j]}`;
  }
  return name;
}
