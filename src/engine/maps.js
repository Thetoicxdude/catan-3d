// Map definitions. Every island the game can be played on — the standard one, the larger ones, the
// scenarios, maps players make — is one of these: which hexes there are, what terrain they draw from,
// and how numbers and harbors are dealt. The geometry (intersections, paths, coast) and the board are
// computed from it (geometry.js, board.js), so a new map needs no change to the engine.
//
//   tiles    hexes in axial coordinates {q, r, t}: t = '?' (drawn from the pool), a terrain
//            ('forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'), or 'sea'; the order of
//            the list fixes the hex ids (and through them the ids of intersections and paths)
//   pool     how many of each terrain the '?' tiles draw from
//   numbers  the number tokens dealt to the drawn land tiles
//   spiral   the official spiral token order (A, B, C…), for maps that are a hexagon (`radius`)
//   harbors  types: the harbor tokens; gaps: coastal paths between one harbor and the next, walking
//            round the coast (their sum is the number of coastal paths); group: only the coast of that
//            group's land
//
// Maps with sea inside them (Seafarers) also have:
//   tiles[].g  the group a tile belongs to; a group's '?' tiles draw from groups[g].pool (which may
//            hold 'sea') and its land takes groups[g].numbers
//   pirate   [q, r] of the sea hex the pirate starts on
//   setup    { group }: the opening settlements go on that group's island(s) (without it: on any
//            island; the islands a player starts on are that player's home islands)
//   robber   { number }: with no desert, the robber starts on the hex with that number
//   vp       the victory points the map is played to
//   rules    { seafarers: true } (ships, the pirate, gold fields, the longest trade route), turns (5–6)
//   isleBonus  points for a player's first settlement on each island other than the home island(s)
//   harbors.perIsland  the harbors are shared among the islands by the length of their coasts
//   fog      { pool, numbers }: what the 'fog' tiles hide (drawn when they are discovered)

// a hexagonal island, in the order the original board listed its hexes (row by row, north to south)
function hexagon(radius) {
  const tiles = [];
  for (let r = -radius; r <= radius; r++) for (let q = -radius; q <= radius; q++) if (Math.abs(q + r) <= radius) tiles.push({ q, r, t: '?' });
  return tiles;
}

export const BASE4 = Object.freeze({
  id: 'base-4',
  name: '標準島嶼',
  players: [2, 4],
  // laid out by the original generator, so a seed gives the same island it always did
  legacy: true,
  radius: 2,
  tiles: hexagon(2),
  pool: { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 },
  numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  spiral: [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11],
  harbors: { types: ['any', 'any', 'any', 'any', 'wood', 'brick', 'wool', 'grain', 'ore'], gaps: [3, 3, 4, 3, 3, 4, 3, 3, 4] },
});

// The 5–6 player island (rows of 3-4-5-6-5-4-3 hexes) with the extension's pieces: more of every
// terrain, number token and harbor, a larger bank and development deck, and the paired-turn rule.
function rows(spec) {
  const tiles = [];
  for (const [r, q0, q1] of spec) for (let q = q0; q <= q1; q++) tiles.push({ q, r, t: '?' });
  return tiles;
}

export const BASE6 = Object.freeze({
  id: 'base-6',
  name: '大島嶼',
  players: [5, 6],
  tiles: rows([
    [-3, 0, 2],
    [-2, -1, 2],
    [-1, -2, 2],
    [0, -3, 2],
    [1, -3, 1],
    [2, -3, 0],
    [3, -3, -1],
  ]),
  pool: { forest: 6, pasture: 6, fields: 6, hills: 5, mountains: 5, desert: 2 },
  numbers: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
  harbors: {
    types: ['any', 'any', 'any', 'any', 'any', 'wool', 'wool', 'wood', 'brick', 'grain', 'ore'],
    gaps: [3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3],
  },
  bank: 24,
  dev: { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 },
  // turns: 'paired' (the current official rule) or 'sbp' (the older special building phase)
  rules: { turns: 'paired' },
});

// Seafarers, scenario 1 — Heading for New Shores (3–4 players, 14 points). The main island (laid out
// like the standard island) on the west, a channel of sea, and to the east an area of 13 positions where
// small islands, two gold fields among them, come out differently every game. Drawn row by row with
// odd rows shifted half a hex east (offset rows → axial), centred on the origin.
// `groups`: the group each kind of tile belongs to ('S' is sea, 'F' fog — hidden until explored —, any
// other kind is drawn from a pool).
function offsetRows(rows, shiftQ = 0, shiftR = 0, groups = { S: 'main', M: 'main', I: 'isles' }) {
  const tiles = [];
  rows.forEach((row, r) => {
    for (const [c, kind] of row) {
      const t = { q: c - (r - (r & 1)) / 2 + shiftQ, r: r + shiftR, t: kind === 'S' ? 'sea' : kind === 'F' ? 'fog' : '?' };
      if (groups[kind]) t.g = groups[kind];
      tiles.push(t);
    }
  });
  return tiles;
}

export const SEA1 = Object.freeze({
  id: 'sea-1',
  name: '航海家：駛向新海岸',
  players: [3, 4],
  vp: 14,
  tiles: offsetRows(
    [
      [[0, 'S'], [1, 'M'], [2, 'M'], [3, 'M'], [4, 'S'], [5, 'I'], [6, 'I']],
      [[0, 'M'], [1, 'M'], [2, 'M'], [3, 'M'], [4, 'S'], [5, 'I'], [6, 'I']],
      [[0, 'M'], [1, 'M'], [2, 'M'], [3, 'M'], [4, 'M'], [5, 'S'], [6, 'I'], [7, 'I']],
      [[0, 'M'], [1, 'M'], [2, 'M'], [3, 'M'], [4, 'S'], [5, 'I'], [6, 'I']],
      [[0, 'S'], [1, 'M'], [2, 'M'], [3, 'M'], [4, 'S'], [5, 'I'], [6, 'I']],
      [[1, 'S'], [2, 'S'], [3, 'S'], [4, 'I'], [5, 'I'], [6, 'I']],
    ],
    -2,
    -3,
  ),
  groups: {
    main: {
      pool: { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 },
      numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    },
    isles: {
      pool: { sea: 4, gold: 2, fields: 1, hills: 2, mountains: 2, pasture: 1, forest: 1 },
      numbers: [2, 3, 4, 5, 6, 8, 9, 10, 11],
    },
  },
  // the main island's coast, with the standard island's spacing
  harbors: { types: ['any', 'any', 'any', 'any', 'wood', 'brick', 'wool', 'grain', 'ore'], gaps: [3, 3, 4, 3, 3, 4, 3, 3, 4], group: 'main' },
  pirate: [2, -1],
  setup: { group: 'main' },
  isleBonus: 2,
  rules: { seafarers: true },
});

// Seafarers, scenario 2 — The Four Islands (3–4 players, 13 points). Four islands of five or six
// provinces with channels between them; no desert and no gold. The opening settlements may go on any
// island: the one or two islands a player starts on are that player's home islands, and the first
// settlement on each of the others earns 2 points. The robber starts on the 12 (there is no desert),
// the pirate in the middle of the sea; nine harbors, shared among the islands by the length of
// their coasts.
const L = 'L';
export const SEA2 = Object.freeze({
  id: 'sea-2',
  name: '航海家：四座島嶼',
  players: [3, 4],
  vp: 13,
  tiles: offsetRows(
    [
      [[0, L], [1, L], [2, L], [3, L], [4, 'S'], [5, L], [6, L]],
      [[0, 'S'], [1, L], [2, L], [3, 'S'], [4, L], [5, L], [6, L]],
      [[0, L], [1, 'S'], [2, 'S'], [3, 'S'], [4, L], [5, 'S'], [6, 'S']],
      [[0, L], [1, L], [2, 'S'], [3, 'S'], [4, 'S'], [5, L], [6, L]],
      [[0, L], [1, L], [2, 'S'], [3, L], [4, L], [5, L], [6, L]],
    ],
    -2,
    -2,
    {},
  ),
  pool: { forest: 5, pasture: 5, fields: 5, hills: 4, mountains: 4 },
  numbers: [2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12],
  harbors: { types: ['any', 'any', 'any', 'any', 'wood', 'brick', 'wool', 'grain', 'ore'], perIsland: true },
  robber: { number: 12 },
  pirate: [0, 0],
  isleBonus: 2,
  rules: { seafarers: true },
});

// Seafarers, scenario 3 — The Fog Islands (3–4 players, 12 points). Two islands on the west, the upper
// and the lower, where the opening settlements go; to the east twelve hexes lie in fog. A road or ship
// reaching an intersection beside a hidden hex discovers it: what it is comes from the fog's own pile
// (land, gold or sea, drawn with the game's dice, so nobody knows it before), land gets a number from
// the fog's own tokens, and the discoverer receives one resource of that land (gold: any one). The
// robber starts on the 12; no points for islands.
const F = 'F';
export const SEA3 = Object.freeze({
  id: 'sea-3',
  name: '航海家：霧島',
  players: [3, 4],
  vp: 12,
  tiles: offsetRows(
    [
      [[0, 'S'], [1, L], [2, L], [3, L], [4, 'S'], [5, F], [6, F]],
      [[0, L], [1, L], [2, L], [3, L], [4, 'S'], [5, F], [6, F]],
      [[0, 'S'], [1, L], [2, L], [3, 'S'], [4, 'S'], [5, F], [6, F]],
      [[0, 'S'], [1, 'S'], [2, 'S'], [3, L], [4, 'S'], [5, F], [6, F]],
      [[0, L], [1, L], [2, L], [3, L], [4, 'S'], [5, F], [6, F]],
      [[0, 'S'], [1, L], [2, L], [3, L], [4, 'S'], [5, F], [6, F]],
    ],
    -2,
    -3,
    {},
  ),
  pool: { forest: 4, pasture: 4, fields: 3, hills: 3, mountains: 3 },
  numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 12],
  // what the fog hides, and the numbers its land takes
  fog: { pool: { sea: 2, gold: 2, fields: 2, hills: 2, mountains: 2, pasture: 1, forest: 1 }, numbers: [3, 4, 5, 6, 8, 9, 10, 11, 11, 12] },
  harbors: { types: ['any', 'any', 'any', 'any', 'wood', 'brick', 'wool', 'grain', 'ore'], perIsland: true },
  robber: { number: 12 },
  pirate: [1, 0],
  rules: { seafarers: true },
});

export const MAPS = { [BASE4.id]: BASE4, [BASE6.id]: BASE6, [SEA1.id]: SEA1, [SEA2.id]: SEA2, [SEA3.id]: SEA3 };
export const DEFAULT_MAP = BASE4.id;
// the maps a game can be started on, in the order the menus list them
export const MAP_LIST = [BASE4, BASE6, SEA1, SEA2, SEA3];

// a map by its id (or a definition passed through as it is); unknown ids fall back to the standard map
export function mapDef(m) {
  if (m && typeof m === 'object' && Array.isArray(m.tiles)) return m;
  return MAPS[m] || BASE4;
}

export function registerMap(def) {
  MAPS[def.id] = def;
  return def;
}
