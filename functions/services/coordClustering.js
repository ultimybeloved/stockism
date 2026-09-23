'use strict';
// The pure clustering behind coordDetection.js: given trade rows, which
// ticker/day/direction cells had several accounts leaning the same way hard
// enough to be worth a human look.
//
// INTERNAL MODULE — required by coordDetection.js, not listed in
// servicePaths.js. It lives apart so the thresholds can be tested without a
// database, and so the scanner file stays about reads, writes and alerts.

const {
  COORD_MIN_ACCOUNTS,
  COORD_MIN_COMBINED_IMPACT,
  COORD_MIN_EACH_IMPACT,
  COORD_TIGHT_WINDOW_MS,
  COORD_HIGH_COMBINED_IMPACT,
} = require('../constants');

// Sells and shorts push down, buys and covers push up. Same mapping the trade
// engine uses (impactDirectionOf in helpers.js) — if that changes, change this
// too or the two will disagree about what a direction is.
const DIRECTION = { sell: 'down', short: 'down', buy: 'up', cover: 'up' };

const dayIdOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Fold trade rows into { `ticker|day|direction`: { uid: {...} } }.
 *
 * Rows carrying a `source` are skipped. That marks an automated fill (limit,
 * stop_loss, premarket), which is not a decision anyone made that day, and
 * counting them would flag a player for their own stop loss firing.
 *
 * @param {Array<{uid,ticker,action,priceImpact,ts}>} rows
 */
function foldTrades(rows) {
  const cells = {};
  for (const r of rows || []) {
    // A scanner that throws takes the whole nightly job down, so a malformed
    // row is skipped rather than trusted.
    if (!r || typeof r !== 'object') continue;
    const dir = DIRECTION[r.action];
    if (!dir || !r.ticker || !r.uid || r.source) continue;
    const impact = Number(r.priceImpact) || 0;
    if (!(impact > 0)) continue;
    const ms = Number(r.ts) || 0;
    if (!ms) continue;

    const key = `${r.ticker}|${dayIdOf(ms)}|${dir}`;
    const cell = cells[key] || (cells[key] = {});
    const who = cell[r.uid] || (cell[r.uid] = { impact: 0, trades: 0, firstMs: ms, lastMs: ms });
    who.impact += impact;
    who.trades += 1;
    who.firstMs = Math.min(who.firstMs, ms);
    who.lastMs = Math.max(who.lastMs, ms);
  }
  return cells;
}

/**
 * Cells worth reporting, strongest first.
 *
 * Tightness is measured between each account's FIRST trade, so one participant
 * grinding on for hours afterwards cannot disguise the fact they all started
 * together — which is the part that is hard to do by accident.
 */
function clusterTrades(rows) {
  const cells = foldTrades(rows);
  const found = [];

  for (const [key, cell] of Object.entries(cells)) {
    const [ticker, day, direction] = key.split('|');

    // Only accounts that actually took part. One share of incidental selling is
    // not participation, and counting it drags innocent names into a cluster
    // they had nothing to do with.
    const players = Object.entries(cell)
      .filter(([, v]) => v.impact >= COORD_MIN_EACH_IMPACT)
      .sort((a, b) => b[1].impact - a[1].impact);
    if (players.length < COORD_MIN_ACCOUNTS) continue;

    const combined = players.reduce((sum, [, v]) => sum + v.impact, 0);
    if (combined < COORD_MIN_COMBINED_IMPACT) continue;

    const starts = players.map(([, v]) => v.firstMs).sort((a, b) => a - b);
    const spreadMs = starts[starts.length - 1] - starts[0];
    const tight = spreadMs <= COORD_TIGHT_WINDOW_MS;

    found.push({
      ticker, day, direction, combined, spreadMs, tight,
      uids: players.map(([uid]) => uid),
      impacts: players.map(([, v]) => v.impact),
      // Each account's last trade in the cell, so a block can run from their
      // own last push rather than from whenever the scan happened to run.
      lastMs: players.map(([, v]) => v.lastMs),
      trades: players.reduce((sum, [, v]) => sum + v.trades, 0),
      severity: (combined >= COORD_HIGH_COMBINED_IMPACT || tight) ? 'high' : 'medium',
      startedAt: starts[0],
    });
  }

  found.sort((a, b) => b.combined - a.combined);
  return found;
}

module.exports = { clusterTrades, foldTrades, dayIdOf, DIRECTION };
