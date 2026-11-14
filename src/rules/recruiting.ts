// Recruiting rewards. Shared rule module (see src/rules/ladder.ts for what that
// means): the invite card shows these numbers and the server pays by them.
//
// A player shares a link carrying their name. Someone who signs up through it
// is their recruit. Nothing is paid at sign-up: the recruiter's reward and the
// recruit's bonus both land only once the recruit has linked Discord (one
// Discord is one account forever) and kept playing, which is what makes a farm
// of throwaway accounts worthless.

import { toMs, type TimeLike } from './activity';

/** Cash to the recruiter for each recruit who sticks. */
export const RECRUITER_REWARD = 10000;
/** Cash to the recruit at the same moment. */
export const RECRUIT_BONUS = 2500;
/** Daily check-ins the recruit needs. One a day, so this is days played. */
export const RECRUIT_MIN_CHECKINS = 7;
/** The recruit's account must be at least this old. */
export const RECRUIT_MIN_AGE_DAYS = 14;
/** Recruits a recruiter can be paid for in one week. The rest wait their turn. */
export const RECRUIT_WEEKLY_CAP = 5;
/** A recruit who has not qualified by now never will. */
export const RECRUIT_EXPIRY_DAYS = 60;
/** How long a clicked invite link is remembered in the browser. */
export const RECRUIT_LINK_MEMORY_DAYS = 30;

export const RECRUIT_REF_PARAM = 'ref';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A name as it may appear in an invite link (same shape as a username). */
export const isRecruitRef = (ref: unknown): ref is string =>
  typeof ref === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(ref);

export const inviteLink = (displayName: string): string =>
  `https://stockism.app/?${RECRUIT_REF_PARAM}=${encodeURIComponent(displayName)}`;

/** Which week a payout falls in, for the weekly cap. Weeks turn over Thursday 00:00 UTC. */
export const recruitWeek = (nowMs: number): number => Math.floor(nowMs / (7 * DAY_MS));

export interface RecruitProgress {
  totalCheckins?: number;
  discordId?: string | null;
  isBanned?: boolean;
  isBot?: boolean;
}

/** Has the recruit done enough for both sides to be paid? */
export function recruitQualifies(recruit: RecruitProgress, signedUpAt: TimeLike, nowMs: number): boolean {
  if (recruit.isBanned || recruit.isBot || !recruit.discordId) return false;
  if ((recruit.totalCheckins || 0) < RECRUIT_MIN_CHECKINS) return false;
  return nowMs - toMs(signedUpAt) >= RECRUIT_MIN_AGE_DAYS * DAY_MS;
}

export const recruitExpired = (signedUpAt: TimeLike, nowMs: number): boolean =>
  nowMs - toMs(signedUpAt) > RECRUIT_EXPIRY_DAYS * DAY_MS;
