import { describe, it, expect } from 'vitest';
import {
  isRecruitRef,
  inviteLink,
  recruitQualifies,
  recruitExpired,
  recruitWeek,
  RECRUIT_MIN_CHECKINS,
  RECRUIT_MIN_AGE_DAYS,
  RECRUIT_MIN_DISCORD_AGE_DAYS,
  discordCreatedMs,
  RECRUIT_EXPIRY_DAYS,
  RECRUIT_MIN_MISSIONS,
  RECRUIT_MIN_TRADES,
  RECRUIT_TRADES_MIN_CHECKINS,
  RECRUITER_TIERS,
  recruiterAchievements,
} from './recruiting';
import { ACHIEVEMENTS } from '../constants/achievements';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 30);
const ready = { totalCheckins: RECRUIT_MIN_CHECKINS, discordId: '100000000000000000' };
const oldEnough = NOW - RECRUIT_MIN_AGE_DAYS * DAY;

describe('recruit invite links', () => {
  it('accepts only username-shaped names', () => {
    expect(isRecruitRef('big_deal_fan')).toBe(true);
    expect(isRecruitRef('ab')).toBe(false);
    expect(isRecruitRef('a'.repeat(21))).toBe(false);
    expect(isRecruitRef('gun<script>')).toBe(false);
    expect(isRecruitRef(undefined)).toBe(false);
  });

  it('builds the link from the name', () => {
    expect(inviteLink('Gun')).toBe('https://stockism.app/?ref=Gun');
  });
});

describe('recruitQualifies', () => {
  it('pays once the recruit has linked Discord, checked in enough, and is old enough', () => {
    expect(recruitQualifies(ready, oldEnough, NOW)).toBe(true);
  });

  it('waits for each condition', () => {
    expect(recruitQualifies({ ...ready, discordId: null }, oldEnough, NOW)).toBe(false);
    expect(recruitQualifies({ ...ready, totalCheckins: RECRUIT_MIN_CHECKINS - 1 }, oldEnough, NOW)).toBe(false);
    expect(recruitQualifies(ready, oldEnough + DAY, NOW)).toBe(false);
  });

  it('waits for the Discord account itself to be old enough', () => {
    // 175928847299117063 is the example ID in Discord's own docs (2016-04-30).
    expect(new Date(discordCreatedMs('175928847299117063')!).toISOString().slice(0, 10)).toBe('2016-04-30');
    const madeAt = (ms: number) => String((BigInt(ms) - 1420070400000n) << 22n);
    const tooNew = madeAt(NOW - (RECRUIT_MIN_DISCORD_AGE_DAYS - 1) * DAY);
    const justOld = madeAt(NOW - (RECRUIT_MIN_DISCORD_AGE_DAYS + 1) * DAY);
    expect(recruitQualifies({ ...ready, discordId: tooNew }, oldEnough, NOW)).toBe(false);
    expect(recruitQualifies({ ...ready, discordId: justOld }, oldEnough, NOW)).toBe(true);
    expect(recruitQualifies({ ...ready, discordId: 'not-a-discord-id' }, oldEnough, NOW)).toBe(false);
  });

  it('never pays for a banned account or a bot', () => {
    expect(recruitQualifies({ ...ready, isBanned: true }, oldEnough, NOW)).toBe(false);
    expect(recruitQualifies({ ...ready, isBot: true }, oldEnough, NOW)).toBe(false);
  });
});

describe('ways to show a recruit kept playing', () => {
  const idle = { discordId: ready.discordId };
  it('takes check-ins, missions, or trades', () => {
    expect(recruitQualifies(idle, oldEnough, NOW)).toBe(false);
    expect(recruitQualifies({ ...idle, totalCheckins: RECRUIT_MIN_CHECKINS }, oldEnough, NOW)).toBe(true);
    expect(recruitQualifies({ ...idle, totalMissionsCompleted: RECRUIT_MIN_MISSIONS }, oldEnough, NOW)).toBe(true);
    const traded = { ...idle, totalTrades: RECRUIT_MIN_TRADES, totalCheckins: RECRUIT_TRADES_MIN_CHECKINS };
    expect(recruitQualifies(traded, oldEnough, NOW)).toBe(true);
  });

  it('does not take trades alone, however many', () => {
    expect(recruitQualifies({ ...idle, totalTrades: 500 }, oldEnough, NOW)).toBe(false);
    const oneDay = { ...idle, totalTrades: 500, totalCheckins: RECRUIT_TRADES_MIN_CHECKINS - 1 };
    expect(recruitQualifies(oneDay, oldEnough, NOW)).toBe(false);
  });

  it('does not add partial progress together', () => {
    const almost = {
      ...idle,
      totalCheckins: RECRUIT_MIN_CHECKINS - 1,
      totalMissionsCompleted: RECRUIT_MIN_MISSIONS - 1,
      totalTrades: RECRUIT_MIN_TRADES - 1,
    };
    expect(recruitQualifies(almost, oldEnough, NOW)).toBe(false);
  });

  it('still needs Discord and the account age', () => {
    expect(recruitQualifies({ totalTrades: 500, totalCheckins: 5 }, oldEnough, NOW)).toBe(false);
    expect(recruitQualifies({ ...idle, totalTrades: 500, totalCheckins: 5 }, oldEnough + DAY, NOW)).toBe(false);
  });
});

describe('recruiter achievements', () => {
  it('come at 1, 3, 5, and 10 recruits', () => {
    expect(recruiterAchievements(0)).toEqual([]);
    expect(recruiterAchievements(1)).toEqual(['RECRUITER']);
    expect(recruiterAchievements(4)).toEqual(['RECRUITER', 'RECRUITER_BRONZE']);
    expect(recruiterAchievements(5)).toHaveLength(3);
    expect(recruiterAchievements(10)).toHaveLength(RECRUITER_TIERS.length);
  });

  it('are all real achievements', () => {
    for (const tier of RECRUITER_TIERS) expect(Object.keys(ACHIEVEMENTS)).toContain(tier.id);
  });
});

describe('recruit clocks', () => {
  it('expires a recruit who took too long', () => {
    expect(recruitExpired(NOW - RECRUIT_EXPIRY_DAYS * DAY, NOW)).toBe(false);
    expect(recruitExpired(NOW - (RECRUIT_EXPIRY_DAYS + 1) * DAY, NOW)).toBe(true);
  });

  it('turns the week over every seven days', () => {
    expect(recruitWeek(NOW + 7 * DAY)).toBe(recruitWeek(NOW) + 1);
    expect(recruitWeek(NOW + DAY)).toBe(recruitWeek(NOW));
  });
});
