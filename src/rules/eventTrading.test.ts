import { describe, it, expect } from 'vitest';
import { eventTradingClosed, lastHaltStart } from './eventTrading';

const THU_HALT = Date.UTC(2026, 10, 5, 13, 0); // the first halt after the rule
const HOUR = 60 * 60 * 1000;

describe('eventTradingClosed', () => {
  it('finds the last Thursday 13:00 UTC', () => {
    expect(lastHaltStart(THU_HALT - 1)).toBe(THU_HALT - 7 * 24 * HOUR);
    expect(lastHaltStart(THU_HALT)).toBe(THU_HALT);
    expect(lastHaltStart(THU_HALT + 8 * HOUR)).toBe(THU_HALT);
  });
  it('leaves older markets open until the first halt', () => {
    expect(eventTradingClosed({}, THU_HALT - 1)).toBe(false);
    expect(eventTradingClosed({}, THU_HALT)).toBe(true);
  });
  it('stays shut past the 21:00 reopen until the admin reopens it', () => {
    expect(eventTradingClosed({}, THU_HALT + 9 * HOUR)).toBe(true);
    expect(eventTradingClosed({ reopenedAt: THU_HALT + HOUR }, THU_HALT + 9 * HOUR)).toBe(false);
  });
  it('shuts again at the next halt', () => {
    expect(eventTradingClosed({ reopenedAt: THU_HALT + HOUR }, THU_HALT + 7 * 24 * HOUR)).toBe(true);
  });
  it('lets a market created after the halt trade', () => {
    expect(eventTradingClosed({ opensAt: THU_HALT + 24 * HOUR }, THU_HALT + 25 * HOUR)).toBe(false);
  });
  it('a hand close beats everything', () => {
    expect(eventTradingClosed({ tradingClosed: true, reopenedAt: THU_HALT - 1 }, THU_HALT - 1)).toBe(true);
  });
});
