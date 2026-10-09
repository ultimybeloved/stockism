// Season money maths: margin averaged over the season, and money that came in
// (grants, dividends, ladder flows). Re-exported by seasonTiers.ts. INTERNAL
// MODULE: exports no Cloud Functions.
import { round2 } from '../shared/money';
import type { MarginTally, SeasonBaseline, UserData } from '../shared/types';
import { marginDollarDays } from '../shared/rules/seasonMoney';
// The maths itself is the shared rule module the season card runs too. What
// stays here writes the tally and reads server-only counters.
export * from '../shared/rules/seasonMoney';

// Every writer of marginUsed spreads in seasonMarginUpdate. The weekly
// checkpoint re-syncs it too, so a writer that misses it only drifts until
// Thursday.

/**
 * The update that records margin debt changing to `newAmount`: closes the
 * running span and opens a new one. {} for a player outside any season.
 */
export const seasonMarginUpdate = (
  userData: UserData | null | undefined,
  newAmount: number | null | undefined,
  now = Date.now(),
): { seasonMargin?: MarginTally } => {
  const seasonId = userData?.seasonBaseline?.seasonId;
  if (!seasonId) return {};
  return {
    seasonMargin: {
      seasonId,
      dd: round2(marginDollarDays(userData, seasonId, now)),
      amount: round2(Math.max(0, newAmount || 0)),
      at: now,
    },
  };
};

/** Ladder + prediction flows since pinning. */
export const sideFlowsSince = (userData: UserData | null | undefined) => {
  const b: Partial<SeasonBaseline> = userData?.seasonBaseline || {};
  return (
    (userData?.ladderFlowValue || 0) -
    (b.ladderFlow || 0) +
    ((userData?.predictionFlowValue || 0) - (b.predictionFlow || 0))
  );
};

/** The grantedDays counter since pinning, or undefined for an old baseline. */
export const grantedDaysSince = (userData: UserData | null | undefined): number | undefined => {
  const pinned = userData?.seasonBaseline?.grantedDays;
  return pinned === undefined ? undefined : (userData!.grantedDays || 0) - pinned;
};

/** A fresh tally, for a player being pinned (or re-pinned) now. */
export const freshMarginTally = (
  seasonId: string,
  marginUsed: number | null | undefined,
  now: number,
): MarginTally => ({
  seasonId,
  dd: 0,
  amount: round2(Math.max(0, marginUsed || 0)),
  at: now,
});
