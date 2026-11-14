// Recruiting rewards. Shared rule module (see src/rules/ladder.ts for what that
// means): the invite card shows these numbers and the server pays by them.
//
// A player shares a link carrying their name. Someone who signs up through it
// is their recruit. Nothing is paid at sign-up: the recruiter's reward and the
// recruit's bonus both land only once the recruit has linked Discord (one
// Discord is one account forever) and kept playing, which is what makes a farm
// of throwaway accounts worthless. "Kept playing" can be shown three ways
// (Darth YG, 2026-11-14: check-ins alone are easy to miss): check-ins,
// finished missions, or trades.

import { toMs, type TimeLike } from './activity';

/** Cash to the recruiter for each recruit who sticks. */
export const RECRUITER_REWARD = 10000;
/** Cash to the recruit at the same moment. */
export const RECRUIT_BONUS = 2500;
/** Any ONE of these shows the recruit kept playing. */
export const RECRUIT_MIN_CHECKINS = 7;
/** Missions finished by hand (the Mission Rookie achievement's count). */
export const RECRUIT_MIN_MISSIONS = 10;
/** Trades made (the 20-trade achievement's count). */
export const RECRUIT_MIN_TRADES = 20;
/** The recruit's account must be at least this old. */
export const RECRUIT_MIN_AGE_DAYS = 14;
/**
 * Recruits a recruiter can be paid for in one week. The rest roll over: they
 * are queued and paid in a later week, and a queued recruit never expires.
 */
export const RECRUIT_WEEKLY_CAP = 5;
/** A recruit who has not qualified by now never will. */
export const RECRUIT_EXPIRY_DAYS = 60;
/** How long a clicked invite link is remembered in the browser. */
export const RECRUIT_LINK_MEMORY_DAYS = 30;

export const RECRUIT_REF_PARAM = 'ref';
/** The recruiters board: its getLeaderboard sort and its `leaderboard/{key}` doc. One board, never split by crew. */
export const RECRUITS_SORT = 'recruits';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A name as it may appear in an invite link (same shape as a username). */
export const isRecruitRef = (ref: unknown): ref is string =>
  typeof ref === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(ref);

/**
 * A link to `path` on the site that credits `displayName` as the recruiter.
 * Without a usable name (a guest) it is the plain address.
 */
export const inviteLink = (displayName: unknown, path = '/'): string =>
  `https://stockism.app${path}${isRecruitRef(displayName) ? `?${RECRUIT_REF_PARAM}=${displayName}` : ''}`;

/** Which week a payout falls in, for the weekly cap. Weeks turn over Thursday 00:00 UTC. */
export const recruitWeek = (nowMs: number): number => Math.floor(nowMs / (7 * DAY_MS));

export interface RecruitProgress {
  totalCheckins?: number;
  totalMissionsCompleted?: number;
  totalTrades?: number;
  discordId?: string | null;
  isBanned?: boolean;
  isBot?: boolean;
}

/** Check-ins, missions, or trades: any one of the three counts. */
export const recruitPlayedEnough = (recruit: RecruitProgress): boolean =>
  (recruit.totalCheckins || 0) >= RECRUIT_MIN_CHECKINS ||
  (recruit.totalMissionsCompleted || 0) >= RECRUIT_MIN_MISSIONS ||
  (recruit.totalTrades || 0) >= RECRUIT_MIN_TRADES;

/** The same three ways, as words for the invite card and the board. */
export const RECRUIT_PLAY_TEXT = `${RECRUIT_MIN_CHECKINS} check-ins, ${RECRUIT_MIN_MISSIONS} missions, or ${RECRUIT_MIN_TRADES} trades`;

/** Recruiter achievements, by recruits paid for. Ids match src/constants/achievements.ts. */
export const RECRUITER_TIERS = [
  { id: 'RECRUITER', recruits: 1 },
  { id: 'RECRUITER_BRONZE', recruits: 3 },
  { id: 'RECRUITER_SILVER', recruits: 5 },
  { id: 'RECRUITER_GOLD', recruits: 10 },
] as const;

/** The recruiter achievements a player with `paid` recruits has earned. */
export const recruiterAchievements = (paid: number): string[] =>
  RECRUITER_TIERS.filter((t) => paid >= t.recruits).map((t) => t.id);

/** Has the recruit done enough for both sides to be paid? */
export function recruitQualifies(recruit: RecruitProgress, signedUpAt: TimeLike, nowMs: number): boolean {
  if (recruit.isBanned || recruit.isBot || !recruit.discordId) return false;
  if (!recruitPlayedEnough(recruit)) return false;
  return nowMs - toMs(signedUpAt) >= RECRUIT_MIN_AGE_DAYS * DAY_MS;
}

export const recruitExpired = (signedUpAt: TimeLike, nowMs: number): boolean =>
  nowMs - toMs(signedUpAt) > RECRUIT_EXPIRY_DAYS * DAY_MS;
