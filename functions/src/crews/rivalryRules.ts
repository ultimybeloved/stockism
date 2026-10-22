// Crew Rivalry pairing and scoring. INTERNAL MODULE, pure (unit-tested in
// rivalryRules.test.ts). The weekly job is in rivalries.ts.

/**
 * This week's matches: crews sorted by last week's active players and paired
 * with the closest one that wasn't their opponent last week. An odd crew out
 * joins the last match as a 3-way.
 */
export function pairCrews(
  crewIds: string[],
  activeCounts: Record<string, number>,
  lastOpponents: Record<string, string[]> = {},
): string[][] {
  const queue = [...crewIds].sort((a, b) => (activeCounts[b] || 0) - (activeCounts[a] || 0) || a.localeCompare(b));
  const matches: string[][] = [];
  while (queue.length >= 2) {
    const a = queue.shift()!;
    const fresh = queue.findIndex((b) => !(lastOpponents[a] || []).includes(b));
    const [b] = queue.splice(fresh === -1 ? 0 : fresh, 1);
    matches.push([a, b!]);
  }
  if (queue.length === 1 && matches.length > 0) matches[matches.length - 1]!.push(queue[0]!);
  return matches;
}

/** Each crew's opponents in a set of matches. */
export const opponentsOf = (matches: string[][] = []) => {
  const out: Record<string, string[]> = {};
  for (const m of matches) for (const c of m) out[c] = m.filter((o) => o !== c);
  return out;
};

export interface RivalryTally {
  active: number;
  qualified: number;
}

export const rivalryScore = (t: RivalryTally | undefined) => (t && t.active > 0 ? t.qualified / t.active : 0);

/** The crews that won a match: the best score, if anyone scored. Ties all win. */
export function matchWinners(match: string[], tallies: Record<string, RivalryTally>) {
  const scores = match.map((c) => Math.round(rivalryScore(tallies[c]) * 1e6));
  const best = Math.max(...scores);
  return best > 0 ? match.filter((_, i) => scores[i] === best) : [];
}
