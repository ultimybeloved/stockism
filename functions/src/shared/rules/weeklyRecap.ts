// GENERATED from src/rules/weeklyRecap.ts by `npm run sync:chars`. Do not edit.
// The Weekly Slip: the summary each player gets at the Thursday reopen of the week
// that just ended. Shared rule module: the server works it out once at the
// reopen (functions/src/market/crewRankings.ts), sends the bell and stores it
// on the user doc as `weeklyRecap`, which the home card and Missions page draw.
//
// Net worth change is split into what trading made and what came in free
// (check-ins, missions, dividends...), the same split the growth missions use.

import { round2 } from './money';
import type { WeeklyProgress } from './missionProgress';

export interface WeeklyRecap {
  /** The mission week this sums up (its start date, missionWeekId). */
  weekId: string;
  netWorth: number;
  /** Net worth change from trading, and as a percent of where the week started. */
  trading: number;
  tradingPct: number;
  /** Free money that came in (grantedValue growth). */
  rewards: number;
  /** The held stock that moved most since last week's reopen. */
  mover: { ticker: string; move: number } | null;
  missions: number;
  /** UTC dates with a counted trade, and with a check-in. */
  tradingDays: string[];
  checkinDays: string[];
  rivalry: { crew: string; opponents: string[]; won: boolean; qualified: boolean } | null;
}

export interface RecapInput {
  weekId: string;
  /** Net worth now, at live prices (netEquityAt), long-term market positions included. */
  netWorth: number;
  /**
   * The long-term market positions inside netWorth. The week's starting value
   * (startPortfolioValue) never counted them, so they stay out of the trading
   * change; counted, a player holding $20k of them read +$20k every week.
   */
  eventValue?: number;
  grantedValue: number;
  holdings: Record<string, number> | undefined;
  wp: WeeklyProgress | undefined;
  crew: string | null;
  qualified: boolean;
  rivalry: { won: boolean; opponents: string[] } | null;
  /** Prices at last week's reopen, and now. */
  openPrices: Record<string, number>;
  prices: Record<string, number>;
}

/** The week's summary, or null when there is nothing to say (no starting value recorded). */
export function computeWeeklyRecap(r: RecapInput): WeeklyRecap | null {
  const wp = r.wp;
  if (!wp || wp.startPortfolioValue === undefined) return null;
  const start = (wp.startPortfolioValue || 0) - (wp.startMarginUsed || 0);
  const change = r.netWorth - (r.eventValue || 0) - start;
  const rewards = Math.max(0, r.grantedValue - (wp.startGrantedValue ?? r.grantedValue));
  const trading = change - rewards;

  let mover: WeeklyRecap['mover'] = null;
  for (const [ticker, shares] of Object.entries(r.holdings || {})) {
    const p0 = r.openPrices[ticker];
    const p1 = r.prices[ticker];
    if (!(shares > 0) || !p0 || !p1) continue;
    const move = (p1 / p0 - 1) * 100;
    if (!mover || Math.abs(move) > Math.abs(mover.move)) mover = { ticker, move };
  }
  if (mover && Math.abs(mover.move) < 0.5) mover = null;

  return {
    weekId: r.weekId,
    netWorth: round2(r.netWorth),
    trading: round2(trading),
    tradingPct: start > 0 ? round2((trading / start) * 100) : 0,
    rewards: round2(rewards),
    mover: mover && { ticker: mover.ticker, move: round2(mover.move) },
    missions: Object.values(wp.claimed || {}).filter(Boolean).length + (wp.dailyClaims || 0),
    tradingDays: Object.keys(wp.tradingDays || {}).sort(),
    checkinDays: Object.keys(wp.checkinDays || {}).sort(),
    rivalry:
      r.crew && r.rivalry
        ? { crew: r.crew, opponents: r.rivalry.opponents, won: r.rivalry.won, qualified: r.qualified }
        : null,
  };
}
