// The pure clustering behind coordDetection.js: given trade rows, which
// ticker/day/direction cells had several accounts leaning the same way hard
// enough to be worth a human look.
//
// INTERNAL MODULE — required by coordDetection.js, not listed in
// servicePaths.js. It lives apart so the thresholds can be tested without a
// database, and so the scanner file stays about reads, writes and alerts.

import {
  COORD_MIN_ACCOUNTS,
  COORD_MIN_COMBINED_IMPACT,
  COORD_MIN_EACH_IMPACT,
  COORD_TIGHT_WINDOW_MS,
  COORD_HIGH_COMBINED_IMPACT,
} from '../shared/constants';

/** One trade row as the scan reads it. */
export interface CoordRow {
  uid?: string;
  ticker?: string;
  action?: string;
  priceImpact?: unknown;
  ts?: unknown;
  source?: string | null;
}

/** One account's pressure on one cell. */
interface Participation {
  impact: number;
  trades: number;
  firstMs: number;
  lastMs: number;
}

/** One reported cluster. coordEnforcement adds `allIn` to upward ones. */
export interface Cluster {
  ticker: string;
  day: string;
  direction: string;
  combined: number;
  spreadMs: number;
  tight: boolean;
  uids: string[];
  impacts: number[];
  lastMs: number[];
  trades: number;
  severity: 'high' | 'medium';
  startedAt: number;
  allIn?: { uid: string; share: number; borrowed: number }[];
  // Display names, filled in by the scan for the alert text.
  names?: string[];
}

// Sells and shorts push down, buys and covers push up. Same mapping the trade
// engine uses (impactDirectionOf in helpers.js) — if that changes, change this
// too or the two will disagree about what a direction is.
export const DIRECTION: Record<string, 'down' | 'up'> = { sell: 'down', short: 'down', buy: 'up', cover: 'up' };

export const dayIdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Fold trade rows into { `ticker|day|direction`: { uid: {...} } }.
 *
 * Rows carrying a `source` are skipped. That marks an automated fill (limit,
 * stop_loss, premarket), which is not a decision anyone made that day, and
 * counting them would flag a player for their own stop loss firing.
 */
export function foldTrades(rows: (CoordRow | null | undefined)[] | null | undefined) {
  const cells: Record<string, Record<string, Participation>> = {};
  for (const r of rows || []) {
    // A scanner that throws takes the whole nightly job down, so a malformed
    // row is skipped rather than trusted.
    if (!r || typeof r !== 'object') continue;
    const dir = r.action === undefined ? undefined : DIRECTION[r.action];
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
export function clusterTrades(rows: (CoordRow | null | undefined)[] | null | undefined): Cluster[] {
  const cells = foldTrades(rows);
  const found: Cluster[] = [];

  for (const [key, cell] of Object.entries(cells)) {
    const [ticker, day, direction] = key.split('|') as [string, string, string];

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
    const spreadMs = starts[starts.length - 1]! - starts[0]!;
    const tight = spreadMs <= COORD_TIGHT_WINDOW_MS;

    found.push({
      ticker,
      day,
      direction,
      combined,
      spreadMs,
      tight,
      uids: players.map(([uid]) => uid),
      impacts: players.map(([, v]) => v.impact),
      // Each account's last trade in the cell, so a block can run from their
      // own last push rather than from whenever the scan happened to run.
      lastMs: players.map(([, v]) => v.lastMs),
      trades: players.reduce((sum, [, v]) => sum + v.trades, 0),
      severity: combined >= COORD_HIGH_COMBINED_IMPACT || tight ? 'high' : 'medium',
      startedAt: starts[0]!,
    });
  }

  found.sort((a, b) => b.combined - a.combined);
  return found;
}
