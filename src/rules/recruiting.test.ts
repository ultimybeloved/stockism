import { describe, it, expect } from 'vitest';
import {
  isRecruitRef,
  inviteLink,
  recruitQualifies,
  recruitExpired,
  recruitWeek,
  RECRUIT_MIN_CHECKINS,
  RECRUIT_MIN_AGE_DAYS,
  RECRUIT_EXPIRY_DAYS,
} from './recruiting';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 30);
const ready = { totalCheckins: RECRUIT_MIN_CHECKINS, discordId: '123' };
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

  it('never pays for a banned account or a bot', () => {
    expect(recruitQualifies({ ...ready, isBanned: true }, oldEnough, NOW)).toBe(false);
    expect(recruitQualifies({ ...ready, isBot: true }, oldEnough, NOW)).toBe(false);
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
