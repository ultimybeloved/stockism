// Pure remap helpers for the ticker rename engine (tickerRename.js).
//
// INTERNAL MODULE — required by tickerRename.js, never listed in
// servicePaths.js. Split out of tickerRename.js to keep it under the service
// size limit; tickerRename.js re-exports all of this, so callers and tests are
// unchanged.
import * as admin from 'firebase-admin';

const DELETE = () => admin.firestore.FieldValue.delete();

/** A Firestore document as the rename reads it: any ticker-keyed maps and arrays. */
type Doc = Record<string, unknown>;
type Updates = Record<string, unknown>;

// No Firestore handles, no async. Everything that decides what a rename means
// lives here so it can be tested without an emulator.

/**
 * Dotted-path updates moving one key of a ticker-keyed map.
 *
 * Returns {} when the old key is absent, which is what makes every phase safe
 * to re-run: a document already migrated produces no writes the second time.
 */
export const mapMoveUpdates = (prefix: string, obj: unknown, old: string, nw: string): Updates => {
  const map = obj as Record<string, unknown> | null | undefined;
  if (!map || map[old] === undefined) return {};
  return {
    [`${prefix}.${nw}`]: map[old],
    [`${prefix}.${old}`]: DELETE(),
  };
};

/** A ticker array (launchedTickers, watchlist) with one entry swapped. */
export const remapArrayOfStrings = (arr: unknown, old: string, nw: string): unknown[] | null => {
  if (!Array.isArray(arr) || !arr.includes(old)) return null;
  // Dedupe in case both names somehow ended up present.
  const swapped = arr.map((t) => (t === old ? nw : t));
  return swapped.filter((t, i) => swapped.indexOf(t) === i);
};

/** An array of objects (transactionLog, indexHistory.constituents, ipos.list). */
export const remapObjectArray = (arr: unknown, field: string, old: string, nw: string): unknown[] | null => {
  if (!Array.isArray(arr)) return null;
  let hit = false;
  const out = arr.map((entry: Record<string, unknown> | null) => {
    if (!entry || entry[field] !== old) return entry;
    hit = true;
    return { ...entry, [field]: nw };
  });
  return hit ? out : null;
};

/**
 * Swap $OLD inside free text.
 *
 * The lookahead matters: renaming GUN must not touch "$GUNNER". Feed messages
 * read "bought 5 $GUN", and rewriting the ticker field alone would leave the
 * sentence players actually see still saying the old name.
 */
export const remapMessage = (msg: unknown, old: string, nw: string): string | null => {
  if (typeof msg !== 'string') return null;
  const swapped = msg.replace(new RegExp(`\\$${old}(?![A-Z0-9])`, 'g'), `$${nw}`);
  // Null means "nothing actually changed", so a message that only mentions
  // $GUNNER during a GUN rename is left alone instead of rewritten over itself.
  return swapped === msg ? null : swapped;
};

/**
 * Fold a new rename into the alias map, keeping every lookup one hop.
 *
 * Renaming B to C when A already points at B must leave A pointing at C, not
 * at a retired name that resolves to nothing.
 */
export const collapseAliasChain = (
  existing: Record<string, string> | null | undefined,
  old: string,
  nw: string,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(existing || {})) {
    out[from] = to === old ? nw : to;
  }
  out[old] = nw;
  return out;
};

// Every ticker-keyed map on a player document. Losing any one of these is a
// silent data loss, and three of them were missing from the original tool:
// holdingCohorts is the dividend and exit-loyalty lot ledger, drip is the
// per-ticker reinvestment toggle, and loyaltyTierNotified suppresses duplicate
// tier-up notifications — dropping its key fires a spurious one at every holder.
export const USER_TICKER_MAPS = [
  'holdings',
  'shorts',
  'costBasis',
  'lastBuyTime',
  'lowestWhileHolding',
  'shortHistory',
  'ipoPurchases',
  'lastTickerTradeTime',
  'tickerTradeHistory',
  'holdingCohorts',
  'profitByTicker',
  'marginLockup',
  'ipoLockup',
  'drip',
  'loyaltyTierNotified',
  // The buy-back block and the short-after-dump block. Dropping these lifts
  // both blocks early for anyone serving one on the renamed stock.
  'lastHeavySell',
  'lastHeavyExit',
];

// Ticker-keyed maps on market/current.
export const MARKET_TICKER_MAPS = [
  'prices',
  'volumes',
  'dailyVolumes',
  'liquidity',
  'botImpact',
  'haltedTickers',
  'ath',
  'atl',
  'breakerCounts',
];

/** Everything one player document needs changed. {} means already migrated. */
export const buildUserUpdates = (userData: Doc, old: string, nw: string) => {
  const updates: Updates = {};
  for (const mapName of USER_TICKER_MAPS) {
    Object.assign(updates, mapMoveUpdates(mapName, userData[mapName], old, nw));
  }
  const watchlist = remapArrayOfStrings(userData.watchlist, old, nw);
  if (watchlist) updates.watchlist = watchlist;

  const log = remapObjectArray(userData.transactionLog, 'ticker', old, nw);
  if (log) updates.transactionLog = log;

  return updates;
};

/** Everything market/current needs changed, alias entry included. */
export const buildMarketUpdates = (marketData: Doc, old: string, nw: string) => {
  const updates: Updates = {};
  for (const mapName of MARKET_TICKER_MAPS) {
    Object.assign(updates, mapMoveUpdates(mapName, marketData[mapName], old, nw));
  }

  const launched = remapArrayOfStrings(marketData.launchedTickers, old, nw);
  if (launched) updates.launchedTickers = launched;

  // Alert thresholds are keyed "<TICKER>_10_up". They are throttle state, not
  // history, so they are dropped rather than moved — the worst case is one
  // repeated alert.
  for (const key of Object.keys((marketData.alertedThresholds as object | undefined) || {})) {
    if (key.startsWith(`${old}_`)) updates[`alertedThresholds.${key}`] = DELETE();
  }

  updates.tickerAliases = collapseAliasChain(marketData.tickerAliases as Record<string, string> | undefined, old, nw);
  return updates;
};
