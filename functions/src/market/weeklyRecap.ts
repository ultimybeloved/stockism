// "Your week": the bell notification each player gets at the Thursday reopen,
// summing up the week that just ended. INTERNAL MODULE, pure
// (weeklyRecap.test.ts); runWeeklyCrewRankings sends it.
//
// Net worth change is split into what trading made and what came in free
// (check-ins, missions, dividends...), the same split the growth missions use.

import { CHARACTER_MAP } from '../shared/characters';
import { round2 } from '../shared/money';
import type { WeeklyProgress } from '../shared/rules/missionProgress';

export interface RecapRivalry {
  won: boolean;
  opponents: string[];
}

export interface RecapInput {
  /** Net worth now, at live prices (netEquityAt). */
  netWorth: number;
  grantedValue: number;
  holdings: Record<string, number> | undefined;
  wp: WeeklyProgress | undefined;
  crew: string | null;
  qualified: boolean;
  rivalry: RecapRivalry | null;
  crewName: (id: string) => string;
  /** Prices at last week's reopen, and now. */
  openPrices: Record<string, number>;
  prices: Record<string, number>;
}

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const signed = (n: number) => `${n >= 0 ? '+' : '-'}${money(n)}`;
const pctText = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/** The recap's lines, or null when there is nothing to say (no starting value recorded). */
export function buildWeeklyRecap(r: RecapInput): string[] | null {
  const wp = r.wp;
  if (!wp || wp.startPortfolioValue === undefined) return null;
  const start = (wp.startPortfolioValue || 0) - (wp.startMarginUsed || 0);
  const lines: string[] = [];

  const change = r.netWorth - start;
  const free = Math.max(0, r.grantedValue - (wp.startGrantedValue ?? r.grantedValue));
  const trading = change - free;
  const tradingPct = start > 0 ? (trading / start) * 100 : 0;
  lines.push(
    `Net worth ${money(r.netWorth)}: ${signed(trading)} from trading (${pctText(tradingPct)})` +
      (free >= 1 ? `, plus ${money(free)} in rewards.` : '.'),
  );

  // The held stock that moved most since the last reopen.
  let best: { t: string; move: number } | null = null;
  for (const [t, shares] of Object.entries(r.holdings || {})) {
    const p0 = r.openPrices[t];
    const p1 = r.prices[t];
    if (!(shares > 0) || !p0 || !p1) continue;
    const move = (p1 / p0 - 1) * 100;
    if (!best || Math.abs(move) > Math.abs(best.move)) best = { t, move };
  }
  if (best && Math.abs(best.move) >= 0.5) {
    lines.push(
      `Biggest mover you hold: ${CHARACTER_MAP[best.t]?.name || best.t} ($${best.t}) ${pctText(round2(best.move))}.`,
    );
  }

  const call = wp.call;
  if (call?.result) {
    const said = `${call.ticker} ${call.direction}`;
    lines.push(
      call.result === 'big' || call.result === 'win'
        ? `Your Call (${said}) was right: ${money(call.paid || 0)}.`
        : call.result === 'loss'
          ? `Your Call (${said}) went the other way.`
          : call.result === 'break'
            ? `Nothing moved this chapter, so your Call paid ${money(call.paid || 0)}.`
            : `Your Call (${said}) was a push.`,
    );
  }

  const finished = Object.values(wp.claimed || {}).filter(Boolean).length;
  if (finished > 0) lines.push(`Missions finished: ${finished}.`);

  if (r.crew && r.rivalry) {
    const vs = r.rivalry.opponents.map(r.crewName).join(' and ');
    lines.push(
      r.rivalry.won
        ? `${r.crewName(r.crew)} beat ${vs}${r.qualified ? ', and you finished your 5' : ''}.`
        : `${r.crewName(r.crew)} lost to ${vs}${r.qualified ? ', but you finished your 5' : ''}.`,
    );
  }
  return lines;
}
