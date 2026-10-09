import { EVENT_OPENING_ODDS_MIN_PCT, EVENT_OPENING_ODDS_MAX_PCT } from '../../../constants/economy';

// Opening odds for the filled-in option slots. Returns { pcts } (null = even
// odds) or { error }. Entered odds must all be present, in range, and sum to 100.
export const resolveOpeningOdds = (
  pairs: { name: string; pct: string }[],
): { pcts: number[] | null; error?: undefined } | { pcts?: undefined; error: string } => {
  const entered = pairs.filter((p) => p.pct !== '' && p.pct !== null && p.pct !== undefined);
  if (entered.length === 0) return { pcts: null };
  if (entered.length < pairs.length) {
    return { error: 'Set an opening % for every option (or clear them all for even odds).' };
  }
  const pcts = pairs.map((p) => Number(p.pct));
  if (pcts.some((n) => !Number.isFinite(n) || n < EVENT_OPENING_ODDS_MIN_PCT || n > EVENT_OPENING_ODDS_MAX_PCT)) {
    return {
      error: `Each opening % must be between ${EVENT_OPENING_ODDS_MIN_PCT} and ${EVENT_OPENING_ODDS_MAX_PCT}.`,
    };
  }
  const sum = pcts.reduce((a, c) => a + c, 0);
  if (Math.abs(sum - 100) > 0.01) {
    return { error: `Opening odds must total 100% (currently ${Math.round(sum * 100) / 100}%).` };
  }
  return { pcts };
};
