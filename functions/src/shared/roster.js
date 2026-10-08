'use strict';
// Which tickers are real characters, and ticker aliases left behind by renames.

const { CHARACTERS, CHARACTER_MAP } = require('./characters');
const { BID_ASK_SPREAD, ETF_BID_ASK_SPREAD } = require('./constants');

// ============================================
// ROSTER GUARD
// ============================================
// market/current.prices can outlive the roster. renameTicker deletes the old
// entry, but restoring a market backup taken before a rename brings it back,
// and nothing since then removes it — DOTS survived the DOTS->CROW rename this
// way and was still being traded by bots a year later.
//
// Anything that iterates the PRICE MAP rather than CHARACTERS has to filter
// through this, or it acts on a stock no player can see: bots pick it, and it
// lands in the daily/weekly gainers, losers, and ATH lists that get posted to
// Discord. Iterating CHARACTERS directly (as the market maker does) is
// inherently safe and needs no guard.
const ROSTER_TICKERS = new Set(CHARACTERS.map((c) => c.ticker));
const isRosterTicker = (ticker) => ROSTER_TICKERS.has(ticker);

// Bid/ask spread for a ticker. ETFs trade tighter than individual characters.
// Was defined separately in marketOrders and limitOrderFill.
const spreadFor = (ticker) => (CHARACTER_MAP[ticker]?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD);

// ============================================
// TICKER ALIASES
// ============================================
// market/current.tickerAliases is a permanent { retiredTicker: currentTicker }
// map written by every rename. It exists because some records are immutable or
// not worth rewriting: bell notifications carry the ticker inside free text,
// old deep links are already out in Discord, and backups in Cloud Storage are
// frozen JSON. Resolving on read costs nothing and covers all of them.
//
// Renames collapse the chain when they are applied, so this is always one hop.
const resolveTicker = (aliases, ticker) => (aliases || {})[ticker] || ticker;

/**
 * Rewrite the keys of a ticker-keyed object through the alias map.
 *
 * Restoring a backup taken before a rename would otherwise resurrect the old
 * ticker and drop the new one — which is exactly how the DOTS orphan survived
 * a rename and was still being traded by bots a year later.
 */
const remapAliasedKeys = (obj, aliases) => {
  if (!obj || !aliases || !Object.keys(aliases).length) return obj;
  const out = {};
  for (const [ticker, value] of Object.entries(obj)) {
    out[resolveTicker(aliases, ticker)] = value;
  }
  return out;
};

module.exports = { isRosterTicker, spreadFor, resolveTicker, remapAliasedKeys };
