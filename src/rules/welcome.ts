// The Discord welcome week: `/welcome`, run in the official Stockism server once
// a day for seven days, pays out WELCOME_STREAK_TOTAL on top of the starting
// cash. Linking Discord ($3,000) plus the week makes a $10,000 start (Darth YG,
// 2026-10-14). Shared rule module (see src/rules/ladder.ts): the site's
// progress card and the bot pay from the same table.
//
// Shape, and why:
//   * Day 1 is a welcome gift, then the reward climbs every day and peaks on
//     day 7. A rising track gives each day a reason to come back, and a big
//     finish is what gets remembered. Shrinking rewards teach people that
//     coming back is worth less each time.
//   * A missed day pauses the week, it never resets it. Resetting works on
//     veterans and makes newcomers quit.
//   * One week per Discord account and one per Stockism account, forever, so
//     relinking can't run it twice.

export const WELCOME_STREAK_REWARDS = [1000, 700, 800, 900, 1000, 1100, 1500] as const;
export const WELCOME_STREAK_DAYS = WELCOME_STREAK_REWARDS.length;
export const WELCOME_STREAK_TOTAL = WELCOME_STREAK_REWARDS.reduce((s, r) => s + r, 0);

// A Discord account younger than this can't run the week: a fresh Discord is
// the cheap half of an alt.
export const WELCOME_MIN_DISCORD_AGE_DAYS = 30;

/** users/{uid}.welcomeStreak (server-written), mirrored in welcomeStreaks/{discordId}. */
export interface WelcomeStreakState {
  /** Days claimed so far, 0-7. */
  day: number;
  /** UTC day (YYYY-MM-DD) of the last claim. */
  lastClaimDay: string | null;
  discordId?: string;
}

export type WelcomeClaim =
  { ok: true; day: number; reward: number; done: boolean } | { ok: false; reason: 'done' | 'claimed_today' };

/** What a `/welcome` run on `today` (UTC YYYY-MM-DD) does. Pure. */
export function welcomeClaim(state: WelcomeStreakState | null | undefined, today: string): WelcomeClaim {
  const claimed = state?.day || 0;
  if (claimed >= WELCOME_STREAK_DAYS) return { ok: false, reason: 'done' };
  if (state?.lastClaimDay === today) return { ok: false, reason: 'claimed_today' };
  const day = claimed + 1;
  return { ok: true, day, reward: WELCOME_STREAK_REWARDS[day - 1]!, done: day === WELCOME_STREAK_DAYS };
}

/** When a Discord account was created, from its ID (a Discord snowflake). */
export const discordCreatedAtMs = (discordId: string) => Number(BigInt(discordId) >> 22n) + 1420070400000;

/** "■■■□□□□": days claimed out of seven. */
export const welcomeTrack = (claimed: number) =>
  '■'.repeat(Math.min(claimed, WELCOME_STREAK_DAYS)) + '□'.repeat(Math.max(0, WELCOME_STREAK_DAYS - claimed));
