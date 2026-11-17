// Discord call-outs: the rules, no Firestore. INTERNAL MODULE, used by
// discord/callouts.ts and recordTrade (shared/tradeRecords). Darth YG, 2026-11-17: the
// bot posts game moments as they happen so the server has something to react
// to. Three kinds: big closed wins, leaderboard shake-ups, and check-in streak
// milestones. Margin wipeouts stay anonymous (posted elsewhere, unnamed).
//
// Nothing here may reveal what anyone could trade against: a win is posted
// only once the position is fully closed, and the leaderboard and streaks are
// already public on the site.

// ── Big closed wins ─────────────────────────────────────────────────────────

/** A closing sale this profitable is posted. */
export const BIG_WIN_DOLLARS = 25_000;
/** Or this big a return, as long as it clears BIG_WIN_MIN_DOLLARS. */
export const BIG_WIN_PERCENT = 200;
export const BIG_WIN_MIN_DOLLARS = 2_500;
/** One win post per player in this long, so one trader can't fill the channel. */
export const WIN_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** At most this many win posts per run (the rest wait for the next run). */
export const WINS_PER_RUN = 3;

// Under this many shares left counts as fully out (holdings keep 4 decimals).
const CLOSED_EPSILON = 0.0001;

interface PositionBefore {
  holdings?: Record<string, number> | null;
  costBasis?: Record<string, number> | null;
  shorts?: Record<string, { shares?: number; costBasis?: number; entryPrice?: number } | null | undefined> | null;
}

export interface BigWin {
  side: 'long' | 'short';
  profit: number;
  percent: number;
}

/**
 * The win a fill closes out, or null. `before` is the player's record before
 * this fill. Only a sell that leaves no shares, or a cover that leaves no
 * short, can qualify: a partly closed position still has something riding.
 */
export const bigWinOf = (
  before: PositionBefore | null | undefined,
  ticker: string,
  action: string,
  shares: number,
  price: number,
): BigWin | null => {
  if (!before || !(shares > 0) || !(price > 0)) return null;
  let side: BigWin['side'];
  let cost: number;
  let profitPerShare: number;
  if (action === 'sell') {
    const held = before.holdings?.[ticker] || 0;
    if (held - shares > CLOSED_EPSILON) return null;
    side = 'long';
    cost = before.costBasis?.[ticker] || 0;
    profitPerShare = price - cost;
  } else if (action === 'cover') {
    const pos = before.shorts?.[ticker];
    if (!pos || (pos.shares || 0) - shares > CLOSED_EPSILON) return null;
    side = 'short';
    cost = pos.costBasis || pos.entryPrice || 0;
    profitPerShare = cost - price;
  } else {
    return null;
  }
  if (!(cost > 0)) return null;
  const profit = Math.round(profitPerShare * shares * 100) / 100;
  const percent = Math.round((profitPerShare / cost) * 1000) / 10;
  const big = profit >= BIG_WIN_DOLLARS || (profit >= BIG_WIN_MIN_DOLLARS && percent >= BIG_WIN_PERCENT);
  return big ? { side, profit, percent } : null;
};

// ── Check-in streaks ────────────────────────────────────────────────────────

/** 30, 60, 100, then every 100 days. */
export const isStreakMilestone = (streak: number) =>
  streak === 30 || streak === 60 || (streak >= 100 && streak % 100 === 0);

// ── Leaderboard shake-ups ───────────────────────────────────────────────────

/** How many places count as "the top". */
export const TOP_SIZE = 10;
/** At most this many top-10 arrivals per run. The nightly sync refreshes every
 * stored value at once and can reshuffle the board; the rest are not posted. */
export const TOP_POSTS_PER_RUN = 3;
/** A new leader has to hold #1 this long before it is posted (prices wobble). */
export const LEADER_HOLD_MS = 25 * 60 * 1000;
/** A player posted as the new #1 is not posted as #1 again for this long. */
export const LEADER_REPOST_MS = 24 * 60 * 60 * 1000;
/** A player seen in the top 10 within this long is not posted as breaking in. */
export const TOP_REENTRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface ShakeupState {
  /** The first run has nothing to compare against, so it only records. */
  seeded?: boolean;
  leader?: string | null;
  leaderSince?: number;
  /** Who the last posted #1 was, so a hand-back isn't posted as news. */
  postedLeader?: string | null;
  leaderPostedAt?: Record<string, number>;
  /** uid -> last time seen in the top 10. */
  seenTop?: Record<string, number>;
}

export type Shakeup =
  { kind: 'leader'; uid: string; previous: string | null } | { kind: 'top'; uid: string; rank: number };

/**
 * What to post this run, and the state to save. `top` is the current top,
 * best first, by uid.
 */
export const shakeups = (
  state: ShakeupState | null | undefined,
  top: string[],
  now: number,
): { posts: Shakeup[]; next: ShakeupState } => {
  const prev = state || {};
  const posts: Shakeup[] = [];
  const seenTop = { ...(prev.seenTop || {}) };
  const leaderPostedAt = { ...(prev.leaderPostedAt || {}) };
  const leader = top[0] || null;
  const leaderSince = leader && leader === prev.leader ? prev.leaderSince || now : now;
  let postedLeader = prev.postedLeader ?? prev.leader ?? null;

  if (prev.seeded) {
    if (
      leader &&
      leader !== postedLeader &&
      now - leaderSince >= LEADER_HOLD_MS &&
      !(now - (leaderPostedAt[leader] ?? -Infinity) < LEADER_REPOST_MS)
    ) {
      posts.push({ kind: 'leader', uid: leader, previous: postedLeader });
      leaderPostedAt[leader] = now;
      postedLeader = leader;
    }
    top.slice(0, TOP_SIZE).forEach((uid, i) => {
      // #1 is the leader post's job, once they have held it.
      if (i === 0) return;
      if (posts.filter((p) => p.kind === 'top').length >= TOP_POSTS_PER_RUN) return;
      if (!(now - (seenTop[uid] ?? -Infinity) < TOP_REENTRY_MS)) posts.push({ kind: 'top', uid, rank: i + 1 });
    });
  } else {
    postedLeader = leader;
  }

  for (const uid of top.slice(0, TOP_SIZE)) seenTop[uid] = now;
  // Forget anyone gone longer than the re-entry window, so the map stays small.
  for (const [uid, at] of Object.entries(seenTop)) if (now - at >= TOP_REENTRY_MS) delete seenTop[uid];
  for (const [uid, at] of Object.entries(leaderPostedAt)) if (now - at >= LEADER_REPOST_MS) delete leaderPostedAt[uid];

  return { posts, next: { seeded: true, leader, leaderSince, postedLeader, leaderPostedAt, seenTop } };
};
