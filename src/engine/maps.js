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
//            round the coast (their sum is the number of coastal paths)

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

export const MAPS = { [BASE4.id]: BASE4, [BASE6.id]: BASE6 };
export const DEFAULT_MAP = BASE4.id;
// the maps a game can be started on, in the order the menus list them
export const MAP_LIST = [BASE4, BASE6];

// a map by its id (or a definition passed through as it is); unknown ids fall back to the standard map
export function mapDef(m) {
  if (m && typeof m === 'object' && Array.isArray(m.tiles)) return m;
  return MAPS[m] || BASE4;
}

export function registerMap(def) {
  MAPS[def.id] = def;
  return def;
}
