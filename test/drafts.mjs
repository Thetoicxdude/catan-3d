// Maps drawn as a player would in the editor, for the tests: one island with a lake inside, two islands
// with a gold field (5–6 players), a long strip, an archipelago whose opening is on the largest island,
// an island of terrain picked hex by hex, and (no cap since 2026-11-20) the whole grid as one country
// and as four continents for 5–6 players. (Some draw sea, `s`, as drafts did before 2026-11-20: it is
// read as an empty cell, and a map with ships gets its sea by itself.)
const grid = (rows) => {
  // rows: strings, one character a cell ('.' none, other letters the cell's kind), odd rows half a hex east
  const cells = [];
  rows.forEach((line, r) => [...line].forEach((k, c) => k !== '.' && cells.push([c, r, k])));
  return cells;
};

export const DRAFTS = {
  ring: {
    name: '湖心島',
    kit: 4,
    vp: 10,
    ships: true,
    cells: grid(['..lllll', '.lllllll', '.llsssll', 'llsssll', '.llssll', '.lllllll', '..lllll']),
  },
  twin: {
    name: '雙子島',
    kit: 6,
    vp: 12,
    bonus: 2,
    cells: grid(['llllsllll', 'llllsllll', 'llllslgll', 'llllsllll', 'llllsllll', 'llllsllll', 'llllsllll']),
  },
  strip: {
    name: '長堤',
    kit: 4,
    vp: 10,
    cells: grid(['', '', '', 'lllllllllllll', 'llllllllllll']),
  },
  archipelago: {
    name: '群島',
    kit: 4,
    vp: 12,
    start: 'main',
    bonus: 2,
    cells: grid(['llslllsll', 'llssllsll', 'sssssssss', 'llllllsll', 'llllllssl', 'sllllllsl', 'sssssssss', 'llsllslll']),
  },
  fixed: {
    name: '火山口',
    kit: 4,
    vp: 10,
    desert: false,
    cells: grid(['.ffhh', 'fwmmp', 'phmdmw', 'wmmmf', 'pfhwp', '.hpfw']),
  },
  country: {
    name: '大國',
    kit: 4,
    vp: 14,
    cells: grid(Array.from({ length: 11 }, () => 'lllllllllllll')),
  },
  continents: {
    name: '四大洲',
    kit: 6,
    vp: 14,
    cells: grid([...Array.from({ length: 5 }, () => 'llllll.llllll'), '', ...Array.from({ length: 5 }, () => 'llllll.llllll')]),
  },
};
