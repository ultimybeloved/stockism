// How far a player's orders move the market, as a fraction of their impact.
// 1 for everyone except admin-confirmed manipulators, who get a random factor
// between CONFIRMED_MANIPULATOR_MARKET_MOVE_MIN and _MAX, new for every order.
// They are charged the full impact either
// way; only the price the market is left at changes.
//
// INTERNAL MODULE: used by every fill lane that a player's own order drives
// (executeTrade, limitOrderFill, marketOpenStopLoss). The opening auction nets
// everyone's demand into one move, so it has no single trader to scale.
//
// Read OUTSIDE the trade transaction and cached per instance for a few minutes,
// so a trade costs no extra read and the confirm list never joins a
// transaction's read set. A new confirmation takes effect within CACHE_MS.
import * as admin from 'firebase-admin';
import { CONFIRMED_MANIPULATOR_MARKET_MOVE_MAX, CONFIRMED_MANIPULATOR_MARKET_MOVE_MIN } from './rules/impact';
import { reportError } from './sentry';

const CACHE_MS = 5 * 60_000;
let cache: { at: number; uids: Set<string> } | null = null;

const loadConfirmedUids = async (): Promise<Set<string>> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.uids;
  try {
    const snap = await admin.firestore().collection('botState').doc('manipulators').get();
    cache = { at: Date.now(), uids: new Set(Object.keys(snap.data()?.uids || {})) };
  } catch (err) {
    // A failed read must never block trading: fall back to the last list, or none.
    reportError(err, { where: 'loadConfirmedUids' });
    cache = { at: Date.now(), uids: cache?.uids || new Set() };
  }
  return cache.uids;
};

/** The market-move factor for one of this player's orders. */
export const marketMoveFactor = async (uid: string | null | undefined): Promise<number> => {
  if (!uid || !(await loadConfirmedUids()).has(uid)) return 1;
  const span = CONFIRMED_MANIPULATOR_MARKET_MOVE_MAX - CONFIRMED_MANIPULATOR_MARKET_MOVE_MIN;
  return CONFIRMED_MANIPULATOR_MARKET_MOVE_MIN + Math.random() * span;
};

/** Test hook: forget the cached list. */
export const resetMarketMoveCache = () => {
  cache = null;
};
