'use strict';
// Price history, per-ticker stats, daily closes, neglect floors, IPO jumps, the index.

const admin = require('firebase-admin');
const { IPO_PRICE_JUMP, NEGLECT_FLOOR_MIN, NEGLECT_FLOOR_MAX, MIN_PRICE } = require('./constants');
const { indexFromStored } = require('./indexMaintenance');
const { round2 } = require('./money');
const { isRosterTicker } = require('./roster');
const db = admin.firestore();

// Apply the +15% price jump + launch for any IPO that has ended (or sold out)
// but hasn't jumped yet. Shared by the 5-minute scheduler (predictions.js) and
// the pre-market auction (marketOrders.js) — the auction runs it FIRST so the
// jump and the auction's opening prices can never fight over the same ticker.
// Returns [{ ticker, newPrice, sharesSold, ipoTotalShares }] for callers to announce.
// Live price-chart history lives in its own doc (market/priceHistory, shape
// { [ticker]: [{ timestamp, price, source? }] }) so the hot market/current doc
// every client subscribes to stays small. Older points are archived (never
// deleted) to market/current/price_history/{ticker} by archiving.js.
const priceHistoryRef = () => db.collection('market').doc('priceHistory');

// Append history points for one or more tickers. Works inside a transaction
// (pass it) or standalone (pass null). set+merge creates the doc if missing.
const appendPriceHistory = (transaction, points) => {
  const updates = {};
  for (const [ticker, point] of Object.entries(points)) {
    updates[ticker] = admin.firestore.FieldValue.arrayUnion(point);
  }
  if (transaction) {
    transaction.set(priceHistoryRef(), updates, { merge: true });
    return null;
  }
  return priceHistoryRef().set(updates, { merge: true });
};

// ============================================
// PER-TICKER STATS
// ============================================
// Running totals and records that cannot be reconstructed after the fact. Live
// price history keeps only PRICE_HISTORY_LIVE_MAX points per ticker, so an
// all-time high that scrolls out of that window is gone for good unless it was
// written down when it happened.
//
// Flow stats live on their own document rather than market/current: every
// client subscribes to that doc on every page load and none of this is needed
// to render the site. The all-time high/low marks are the exception — they go
// on market/current because they are worth showing on a stock page.
const tickerStatsRef = () => db.collection('market').doc('tickerStats');

// One calendar month of closing prices per document, shape
// { closes: { 'YYYY-MM-DD': { [ticker]: price } } }. Chunked by month from the
// start on purpose: the live price-history doc hit Firestore's 40k index-entry
// limit once and took trading down with it.
const dailyClosesRef = (monthId) => db.collection('market').doc('current').collection('daily_closes').doc(monthId);

const monthIdOf = (ms) => new Date(ms).toISOString().slice(0, 7);
const dayIdOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Fold one fill into a ticker's running totals.
 *
 * Buying and covering push money into a stock, selling and shorting pull it
 * out, so netFlow reads as directional pressure rather than raw volume. Price
 * alone cannot tell a real rally from three players trading with each other.
 */
const buildTickerFlowUpdate = ({ ticker, action, amount, totalValue, now }) => {
  const direction = action === 'buy' || action === 'cover' ? 1 : -1;
  return {
    [ticker]: {
      trades: admin.firestore.FieldValue.increment(1),
      shares: admin.firestore.FieldValue.increment(amount || 0),
      netFlow: admin.firestore.FieldValue.increment(direction * (totalValue || 0)),
      lastTradedAt: now,
    },
  };
};

/**
 * Dotted-path updates moving the all-time high/low marks for any ticker whose
 * price has passed them. Returns {} when nothing moved so callers can skip the
 * write entirely.
 *
 * Guarded by isRosterTicker: the price map can outlive the roster, and a stock
 * no player can see should not be setting records.
 */
const buildExtremeUpdates = (prices, ath = {}, atl = {}) => {
  const updates = {};
  for (const [ticker, price] of Object.entries(prices || {})) {
    if (!(price > 0) || !isRosterTicker(ticker)) continue;
    if (!(ath[ticker] > 0) || price > ath[ticker]) updates[`ath.${ticker}`] = price;
    if (!(atl[ticker] > 0) || price < atl[ticker]) updates[`atl.${ticker}`] = price;
  }
  return updates;
};

/**
 * Total shares short per ticker, plus when it was measured.
 *
 * Recomputed in full each time rather than incremented on every short and
 * cover: a counter maintained across four fill paths plus forced covers plus
 * bailouts would drift, and a drifted count silently switches the neglect decay
 * on or off for a stock. This rides the margin scanner, which already loads
 * every open short position every 30 minutes, so it costs no extra reads.
 */
const writeShortInterest = async (totals, now = Date.now()) =>
  tickerStatsRef().set(
    {
      shortInterest: totals,
      shortInterestAt: now,
    },
    { merge: true },
  );

/**
 * The price a neglected stock stops falling at, as a fraction of its basePrice.
 *
 * Deliberately opaque. A fixed fraction becomes public knowledge the first time
 * someone notices two dead stocks halting at the same percentage, and then every
 * floor on the board is known in advance. This is stable for a given character
 * and trade count, so it is reproducible and testable, but not guessable.
 *
 * Mixing in the lifetime trade count is what re-evaluates a stock: a character
 * who draws a burst of attention and then goes quiet again lands on a different
 * floor the second time rather than returning to the old one.
 */
const neglectFloorFraction = (ticker, tradeCount = 0) => {
  // FNV-1a. Not for security, just a good spread from a short string.
  const seed = `${ticker}:${tradeCount}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const t = h / 0xffffffff;
  return NEGLECT_FLOOR_MIN + t * (NEGLECT_FLOOR_MAX - NEGLECT_FLOOR_MIN);
};

/** The floor as an actual price. Never below MIN_PRICE. */
const neglectFloorPrice = (character, tradeCount = 0) =>
  Math.max(MIN_PRICE, round2((character?.basePrice || 0) * neglectFloorFraction(character?.ticker || '', tradeCount)));

/**
 * Write one day's closing prices. Idempotent: a re-run for the same day
 * overwrites that day rather than appending a second copy of it.
 */
const recordDailyCloses = async (prices, now = Date.now()) => {
  const closes = {};
  for (const [ticker, price] of Object.entries(prices || {})) {
    if (!(price > 0) || !isRosterTicker(ticker)) continue;
    closes[ticker] = price;
  }
  if (!Object.keys(closes).length) return 0;
  await dailyClosesRef(monthIdOf(now)).set(
    {
      month: monthIdOf(now),
      closes: { [dayIdOf(now)]: closes },
      updatedAt: now,
    },
    { merge: true },
  );
  return Object.keys(closes).length;
};

const applyDueIPOJumps = async () => {
  const ipoRef = db.collection('market').doc('ipos');
  const marketRef = db.collection('market').doc('current');
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const ipoSnap = await transaction.get(ipoRef);
    if (!ipoSnap.exists) return [];

    const ipos = ipoSnap.data().list || [];
    const updatedList = [...ipos];
    const notifications = [];
    const marketUpdates = {};
    const historyPoints = {};
    const tickersToLaunch = [];

    for (let i = 0; i < ipos.length; i++) {
      const ipo = ipos[i];
      const soldOut = ipo.sharesRemaining !== undefined && ipo.sharesRemaining <= 0;
      if ((now >= ipo.ipoEndsAt || soldOut) && !ipo.priceJumped) {
        const newPrice = round2(ipo.basePrice * (1 + IPO_PRICE_JUMP));
        marketUpdates[`prices.${ipo.ticker}`] = newPrice;
        historyPoints[ipo.ticker] = { timestamp: now, price: newPrice };
        tickersToLaunch.push(ipo.ticker);
        updatedList[i] = { ...ipo, priceJumped: true };

        const ipoTotalShares = ipo.totalShares || 150;
        notifications.push({
          ticker: ipo.ticker,
          newPrice,
          sharesSold: ipoTotalShares - (ipo.sharesRemaining || 0),
          ipoTotalShares,
        });
      }
    }

    if (tickersToLaunch.length > 0) {
      transaction.update(marketRef, {
        ...marketUpdates,
        launchedTickers: admin.firestore.FieldValue.arrayUnion(...tickersToLaunch),
      });
      appendPriceHistory(transaction, historyPoints);
      transaction.update(ipoRef, { list: updatedList });
    }

    return notifications;
  });
};

// Admin price protection: true if this ticker was manually set by an admin
// (a priceHistory point tagged source 'admin_adjust') within `windowMs`.
// Automated price movers (bots, market maker) use this to skip protected
// tickers so they can't undo an admin adjustment. Assumes priceHistory is
// in chronological order (it is — entries are appended).
const isPriceProtected = (priceHistory, ticker, windowMs, now = Date.now()) => {
  const hist = (priceHistory && priceHistory[ticker]) || [];
  const cutoff = now - windowMs;
  for (let i = hist.length - 1; i >= 0; i--) {
    const entry = hist[i];
    if (!entry || entry.timestamp < cutoff) break; // older than window — stop scanning
    if (entry.source === 'admin_adjust') return true;
  }
  return false;
};

// What a chapter review did to each stock, split by cause.
//
// The market is halted for the whole window, so every price move inside it is
// the admin's doing. It is just not all deliberate: adjusting one stock drags
// every stock linked to it, and those knock-on moves land on the chart looking
// exactly like trading. $GAP picked up 3.8% from $JIN, $SHNG and $FIST before it
// was touched directly on 2026-08-20, on top of the 4.75% that was actually set,
// and players read the gap as off-hours trading.
//
// Per ticker: directChange is what the admin typed into the price tool,
// trailingChange is what linked stocks pushed onto it, percentChange is the
// whole window (what the chart shows). A stock that only trailed is included —
// it moved, and until now nothing anywhere said why.
//
// `fallbackPrices` is the pre-halt snapshot, used as the opening price for a
// stock with no surviving point from before the window.
//
// Keep in sync with computeReviewChange in src/utils/marketHours.js.
const getReviewWindowChanges = (priceHistory, start, end, fallbackPrices = {}) => {
  const changes = {};

  // Timestamp -> the ticker whose hand adjustment started that cascade. Every
  // stock a single adjustment drags is written with the adjustment's own
  // timestamp, so the shared timestamp is the link back to the cause. Nothing
  // extra has to be stored, and old history attributes correctly too.
  const rootByTimestamp = new Map();
  for (const [ticker, history] of Object.entries(priceHistory || {})) {
    if (!Array.isArray(history)) continue;
    for (const entry of history) {
      if (!entry || entry.source !== 'admin_adjust') continue;
      if (entry.timestamp < start || entry.timestamp > end) continue;
      rootByTimestamp.set(entry.timestamp, ticker);
    }
  }

  for (const [ticker, history] of Object.entries(priceHistory || {})) {
    if (!Array.isArray(history) || history.length === 0) continue;

    // The price carried into the review, plus every point the review moved it.
    let openPrice = fallbackPrices[ticker];
    const moves = [];
    for (const entry of history) {
      if (!entry || typeof entry.price !== 'number') continue;
      if (entry.timestamp < start) {
        openPrice = entry.price;
        continue;
      }
      if (entry.timestamp > end) break;
      moves.push(entry);
    }
    if (moves.length === 0 || !(openPrice > 0)) continue;

    // Each move is measured against the price right before it, so the two
    // causes compound the same way the prices actually did.
    let directFactor = 1;
    let trailingFactor = 1;
    let from = openPrice;
    let collapsed = false;
    const drivers = new Set();
    for (const entry of moves) {
      // A collapsed point is the review's whole move rolled into one, so the
      // detail it was built from is gone and the split cannot be rebuilt from
      // it. Leave the stock out rather than reporting the lot as hand-set.
      if (entry.collapsed) {
        collapsed = true;
        break;
      }
      if (from > 0) {
        if (entry.source === 'admin_adjust') directFactor *= entry.price / from;
        else if (entry.source === 'trailing') {
          trailingFactor *= entry.price / from;
          const root = rootByTimestamp.get(entry.timestamp);
          if (root) drivers.add(root);
        }
        // Anything else (the 20:56 opening auction) counts toward the total only.
      }
      from = entry.price;
    }
    if (collapsed) continue;
    if (directFactor === 1 && trailingFactor === 1) continue;

    // The total is the two halves compounded, NOT open-to-close. Something other
    // than the review can move a price inside the window — 50 untagged points
    // turned up in the 2026-08-20 halt with no trade behind them — and letting
    // that leak into the headline made it disagree with its own breakdown.
    // This reports what the REVIEW did, which is the question the tab answers.
    const reviewFactor = directFactor * trailingFactor;
    changes[ticker] = {
      oldPrice: openPrice,
      newPrice: Math.round(openPrice * reviewFactor * 100) / 100,
      percentChange: (reviewFactor - 1) * 100,
      directChange: (directFactor - 1) * 100,
      trailingChange: (trailingFactor - 1) * 100,
      drivers: [...drivers],
    };
  }

  return changes;
};

/**
 * The market index right now, plus the prices behind it. Two reads.
 *
 * Season tiers are scored against this line, so it has to be the same
 * divisor-adjusted number the daily job records rather than a fresh average.
 * @returns {Promise<{prices: Object, value: number}>}
 */
const readIndexNow = async () => {
  const [marketSnap, idxSnap] = await Promise.all([
    db.collection('market').doc('current').get(),
    db.collection('market').doc('indexHistory').get(),
  ]);
  const prices = marketSnap.exists ? marketSnap.data().prices || {} : {};
  return { prices, value: indexFromStored(prices, idxSnap.exists ? idxSnap.data() : null) };
};

module.exports = {
  priceHistoryRef,
  appendPriceHistory,
  tickerStatsRef,
  dailyClosesRef,
  monthIdOf,
  dayIdOf,
  buildTickerFlowUpdate,
  buildExtremeUpdates,
  writeShortInterest,
  neglectFloorFraction,
  neglectFloorPrice,
  recordDailyCloses,
  applyDueIPOJumps,
  isPriceProtected,
  getReviewWindowChanges,
  readIndexNow,
};
