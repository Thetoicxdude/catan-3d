// Turn time limits for online games. Each opening placement (a village and its road) gets 2 minutes
// and each later turn 3 minutes; with 5–6 players the second player of a paired turn gets 90 seconds
// and each step of the special building phase 45. When a player's time runs out the host does the least it can for
// them: the computer finishes a placement, a discard, a gold field's pick or a robber move, an open offer is withdrawn,
// the dice are rolled, and the turn ends. Nothing is built or traded on anyone's behalf.
import { actorsNow, makeView } from '../engine/engine.js';
import { aiAct } from '../ai/ai.js';

export const TURN_LIMITS = { setup: 120000, play: 180000, pair: 90000, sbp: 45000 };

export function limits() {
  const t = typeof window !== 'undefined' && window.__turnMs; // test hook
  return t && typeof t === 'object' ? { ...TURN_LIMITS, ...t } : TURN_LIMITS;
}

// what the clock is counting: one opening placement, or one player's turn
export function turnKey(st) {
  if (!st || st.phase === 'over') return null;
  if (st.phase === 'setup') return `S${st.setup.i}`;
  return `P${st.turn}:${st.current}${st.sub ? st.sub.k : ''}`;
}

export function turnLimit(st) {
  const l = limits();
  if (st.phase === 'setup') return l.setup;
  return st.sub ? l[st.sub.k] || l.play : l.play;
}

// the smallest move that gets the game going again for player p, whose time is up
export function timeoutAction(st, p, mem, rnd) {
  if (st.phase === 'over') return null;
  const ai = () => aiAct(makeView(st, p), p, mem || {}, rnd);
  const pd = st.pending;
  // (a pick owed comes first, even in the opening: gold found in the fog)
  if (pd && (pd.type === 'discard' || pd.type === 'gold')) return pd.amounts[p] ? ai() : null;
  if (st.phase === 'setup') return st.setup.order[st.setup.i] === p ? ai() : null;
  if (st.trade) {
    if (st.trade.from === p) return { type: 'cancelOffer', p };
    if (st.trade.resp[p] === null) return { type: 'respond', p, accept: false };
    return null;
  }
  if (st.current !== p) return null;
  if (pd && (pd.type === 'robber' || pd.type === 'steal')) return ai();
  if (pd && pd.type === 'roadBuilding') return { type: 'endRoadBuilding', p };
  if (!st.rolled) return { type: 'roll', p };
  return { type: 'endTurn', p };
}

// the players the clock is waiting on (people, not the computer)
export function waitingOn(st, isPerson) {
  return actorsNow(st).filter((p) => isPerson(p));
}
