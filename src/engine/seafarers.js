// Seafarers rules (the parts that are not in the base game): ships, moving a ship, the pirate, gold
// fields, the longest trade route (roads and ships together), islands and their bonus points.
// The engine (engine.js) calls these when the game's rules say `seafarers`. Every function works on a
// state or a view; the geometry is the map in play (GEO).
//
// A sea path holds a ship; a coastal path (land on one side) a road or a ship; an inland path a road.
// The frame round the map is sea: the paths along the map's edge are coastal (or at sea).
// Ships are in st.ships (one entry per path, the owner or -1), beside the roads in st.edges.
import { GEO } from './geometry.js';

export const SHIP_COST = { wood: 1, wool: 1 };
export const SHIPS = 15;

const cache = new WeakMap();

// What the board says about land and sea (a tile drawn from a pool that holds sea can come out as
// sea, so this follows the board, not just the map), worked out once per board:
//   land[h]      1 for a land hex
//   island[h]    the island (connected land) a land hex belongs to, -1 for sea
//   vIsland[v]   the island an intersection is on (-1: open sea)
//   vLand[v]     land hexes at an intersection; coast[v]: 1 or 2 of them (the shore)
//   eLand[e]     land hexes beside a path, eSea[e] sea beside it (sea hexes, or the frame round the map)
//   home         the islands the opening settlements go on (the map's setup group), as a Set
export function seaInfo(board, geo = GEO) {
  let info = cache.get(board.hexes);
  if (info && info.geo === geo) return info;
  const tiles = geo.def.tiles;
  const land = board.hexes.map((h) => (h.terrain === 'sea' ? 0 : 1));
  const island = new Array(geo.hexes.length).fill(-1);
  let n = 0;
  for (const h of geo.hexes) {
    if (!land[h.id] || island[h.id] >= 0) continue;
    const stack = [h.id];
    island[h.id] = n;
    while (stack.length) {
      const id = stack.pop();
      for (const nb of geo.hexes[id].neighbors) {
        if (!land[nb] || island[nb] >= 0) continue;
        island[nb] = n;
        stack.push(nb);
      }
    }
    n++;
  }
  const vLand = geo.vertices.map((v) => v.hexes.reduce((k, id) => k + land[id], 0));
  const vIsland = geo.vertices.map((v) => {
    const l = v.hexes.find((id) => land[id]);
    return l === undefined ? -1 : island[l];
  });
  const coast = vLand.map((k) => (k > 0 && k < 3 ? 1 : 0));
  const eLand = geo.edges.map((e) => e.hexes.reduce((k, id) => k + land[id], 0));
  // (a path at the edge of the map has the frame on its other side, and the frame is sea)
  const eSea = geo.edges.map((e) => 2 - eLand[e.id]);
  const group = geo.def.setup && geo.def.setup.group;
  const home = new Set();
  geo.hexes.forEach((h) => {
    if (land[h.id] && (!group || tiles[h.id].g === group)) home.add(island[h.id]);
  });
  info = { geo, land, island, islands: n, vLand, vIsland, coast, eLand, eSea, home };
  cache.set(board.hexes, info);
  return info;
}

// a path a road may take: land on at least one side; one a ship may take: sea on at least one side
export const roadEdge = (st, e) => seaInfo(st.board).eLand[e] > 0;
export const shipEdge = (st, e) => seaInfo(st.board).eSea[e] > 0;

// the paths round the pirate's hex: no new ship there, and the ships there stay put
export function pirateEdges(st) {
  const h = st.board.pirate;
  return h == null || h < 0 ? [] : GEO.hexes[h].edges;
}

// May p build a ship on path e? (connected to p's coastal building, or to p's ship through an
// intersection no opponent holds)
export function shipLegal(st, p, e) {
  if (st.ships[e] !== -1 || st.edges[e] !== -1 || !shipEdge(st, e)) return false;
  if (pirateEdges(st).includes(e)) return false;
  for (const v of GEO.edges[e].v) {
    const b = st.vertices[v];
    if (b && b.p === p) return true;
    if (b) continue;
    for (const e2 of GEO.vertices[v].edges) if (e2 !== e && st.ships[e2] === p) return true;
  }
  return false;
}

export function legalShipEdges(st, p) {
  const out = [];
  for (let e = 0; e < GEO.edges.length; e++) if (shipLegal(st, p, e)) out.push(e);
  return out;
}

// p's ships that may be moved this turn: not built this turn, not beside the pirate, with an open end
// (an intersection where p has nothing else: no building, road or other ship)
export function movableShips(st, p) {
  const out = [];
  const near = new Set(pirateEdges(st));
  const fresh = new Set(st.newShips || []);
  for (let e = 0; e < GEO.edges.length; e++) {
    if (st.ships[e] !== p || near.has(e) || fresh.has(e)) continue;
    const open = GEO.edges[e].v.some((v) => {
      const b = st.vertices[v];
      if (b && b.p === p) return false;
      return !GEO.vertices[v].edges.some((e2) => e2 !== e && (st.ships[e2] === p || st.edges[e2] === p));
    });
    if (open) out.push(e);
  }
  return out;
}

// where the ship on `from` may go (with it lifted off the board)
export function shipTargets(st, p, from) {
  const was = st.ships[from];
  st.ships[from] = -1;
  try {
    return legalShipEdges(st, p).filter((e) => e !== from);
  } finally {
    st.ships[from] = was;
  }
}

// players the pirate may rob on sea hex `hex`: those with a ship beside it and a card in hand
export function pirateVictims(st, hex, p, handSize) {
  const set = new Set();
  for (const e of GEO.hexes[hex].edges) {
    const q = st.ships[e];
    if (q >= 0 && q !== p) set.add(q);
  }
  return [...set].filter((q) => handSize(st, q) > 0).sort((a, b) => a - b);
}

// The longest trade route: roads and ships, a single branch; going from a road to a ship (or back)
// only at p's own settlement or city, and never through another player's building.
export function tradeRouteFor(st, p) {
  const kind = (e) => (st.edges[e] === p ? 1 : st.ships && st.ships[e] === p ? 2 : 0);
  const used = new Uint8Array(GEO.edges.length);
  const starts = new Set();
  for (let e = 0; e < GEO.edges.length; e++) {
    if (kind(e)) {
      starts.add(GEO.edges[e].v[0]);
      starts.add(GEO.edges[e].v[1]);
    }
  }
  let best = 0;
  const dfs = (v, len, came) => {
    if (len > best) best = len;
    const b = st.vertices[v];
    if (len > 0 && b && b.p !== p) return;
    const own = !!(b && b.p === p);
    for (const e of GEO.vertices[v].edges) {
      const k = kind(e);
      if (!k || used[e]) continue;
      if (came && k !== came && !own) continue;
      used[e] = 1;
      const [a, c] = GEO.edges[e].v;
      dfs(a === v ? c : a, len + 1, k);
      used[e] = 0;
    }
  };
  for (const v of starts) dfs(v, 0, 0);
  return best;
}
