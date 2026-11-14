// The Thursday "Week in Review" post: one embed that tells the week's story.
// It replaced the separate Weekly Market Report and Weekly Leaderboard posts
// (Darth YG, 2026-11-14: four posts in 15 minutes was noise). Pure, so the
// wording can be tested without Discord or the database.

export interface WeekMover {
  ticker: string;
  price: number;
  priceWeekAgo: number;
  change: number;
}

export interface WeekInReviewData {
  /** Unix seconds; Discord shows it in each reader's own time zone. */
  weekEndUnix: number;
  trades: number;
  volume: number;
  activePlayers: number;
  activeWindowDays: number;
  gainers: WeekMover[];
  losers: WeekMover[];
  /** Players by weekly percent gain, net of free money (the Top Gainers board). */
  climbers: { name: string; percent: number }[];
  /** Players by net worth. */
  portfolios: { name: string; worth: number }[];
  /** Crew ids that won last week's rivalry. */
  rivalryWinners: string[];
  /** Recruiters paid for a recruit this week, with their running total. */
  recruiters: { name: string; total: number }[];
  featured: { name: string; price: number; salePrice: number } | null;
}

type Icon =
  | 'chart'
  | 'rocket'
  | 'chart_down'
  | 'fire'
  | 'trophy'
  | 'swords'
  | 'party'
  | 'shop'
  | 'trade'
  | 'rank1'
  | 'rank2'
  | 'rank3'
  | 'rank4'
  | 'rank5';

const RANKS = ['rank1', 'rank2', 'rank3', 'rank4', 'rank5'] as const;
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const moverLine = (m: WeekMover) =>
  `**${m.ticker}** $${m.priceWeekAgo.toFixed(2)} → $${m.price.toFixed(2)} (${signedPct(m.change)})`;

export function weekInReviewEmbed(
  d: WeekInReviewData,
  icon: (name: Icon) => string,
  crewLabel: (crewId: string) => string,
) {
  const fields: { name: string; value: string; inline: boolean }[] = [
    {
      name: `${icon('rocket')} Stocks That Ran`,
      value: d.gainers.slice(0, 3).map(moverLine).join('\n') || 'None',
      inline: false,
    },
    {
      name: `${icon('chart_down')} Stocks That Fell`,
      value: d.losers.slice(0, 3).map(moverLine).join('\n') || 'None',
      inline: false,
    },
  ];

  if (d.climbers.length > 0)
    fields.push({
      name: `${icon('fire')} Top Climbers`,
      value: d.climbers
        .slice(0, 5)
        .map((c, i) => `${i + 1}. **${c.name}** ${signedPct(c.percent)}`)
        .join('\n'),
      inline: true,
    });

  fields.push({
    name: `${icon('trophy')} Top Portfolios`,
    value:
      d.portfolios
        .slice(0, 5)
        .map((p, i) => `${icon(RANKS[i]!)} **${p.name}** ${dollars(p.worth)}`)
        .join('\n') || 'None',
    inline: true,
  });

  if (d.rivalryWinners.length > 0)
    fields.push({
      name: `${icon('swords')} Rivalry Winners`,
      value: d.rivalryWinners.map(crewLabel).join('\n'),
      inline: false,
    });

  if (d.recruiters.length > 0)
    fields.push({
      name: `${icon('party')} Recruiters This Week`,
      value: d.recruiters
        .slice(0, 5)
        .map((r) => `**${r.name}** (${r.total} ${r.total === 1 ? 'recruit' : 'recruits'} so far)`)
        .join('\n'),
      inline: false,
    });

  if (d.featured)
    fields.push({
      name: `${icon('shop')} Featured in the Shop This Week`,
      value: `**${d.featured.name}**: ${dollars(d.featured.salePrice)} (normally ${dollars(d.featured.price)}). 25% off until the next Thursday reopen.`,
      inline: false,
    });

  fields.push({
    name: `${icon('trade')} The Week in Numbers`,
    value: `${d.trades.toLocaleString('en-US')} trades, ${dollars(d.volume)} traded, and ${d.activePlayers} players active in the last ${d.activeWindowDays} days`,
    inline: false,
  });

  return {
    title: `${icon('chart')} Week in Review`,
    description: `Week ending <t:${d.weekEndUnix}:D>. Top Climbers is by percent, so any size of account can make it.`,
    color: 0x4ecdc4,
    fields,
    footer: { text: 'Full boards: stockism.app/leaderboard' },
  };
}
