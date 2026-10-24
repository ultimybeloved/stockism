// The Weekly Slip: the bell notification each player gets at the Thursday reopen,
// summing up the week that just ended. INTERNAL MODULE, pure
// (weeklyRecap.test.ts); runWeeklyCrewRankings sends it. The numbers come from
// the shared rule (shared/rules/weeklyRecap.ts), which the home card draws too.

import { CHARACTER_MAP } from '../shared/characters';
import { type WeeklyRecap } from '../shared/rules/weeklyRecap';

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const signed = (n: number) => `${n >= 0 ? '+' : '-'}${money(n)}`;
const pctText = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/** The bell's lines for a week's recap. */
export function recapLines(r: WeeklyRecap, crewName: (id: string) => string): string[] {
  const lines = [
    `Net worth ${money(r.netWorth)}: ${signed(r.trading)} from trading (${pctText(r.tradingPct)})` +
      (r.rewards >= 1 ? `, plus ${money(r.rewards)} in rewards.` : '.'),
  ];
  if (r.mover) {
    const name = CHARACTER_MAP[r.mover.ticker]?.name || r.mover.ticker;
    lines.push(`Biggest mover you hold: ${name} ($${r.mover.ticker}) ${pctText(r.mover.move)}.`);
  }
  if (r.missions > 0) lines.push(`Missions finished: ${r.missions}.`);
  if (r.rivalry) {
    const { crew, opponents, won, qualified } = r.rivalry;
    const vs = opponents.map(crewName).join(' and ');
    lines.push(
      won
        ? `${crewName(crew)} beat ${vs}${qualified ? ', and you finished your 5' : ''}.`
        : `${crewName(crew)} lost to ${vs}${qualified ? ', but you finished your 5' : ''}.`,
    );
  }
  return lines;
}
