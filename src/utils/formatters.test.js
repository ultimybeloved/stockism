import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatChange,
  formatNumber,
  formatTimeRemaining,
  round2,
  round3,
} from './formatters';

// ─── formatCurrency ────────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats a normal value with thousands separator and 2 decimals', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats negatives', () => {
    expect(formatCurrency(-50)).toBe('-$50.00');
  });

  it('coerces a numeric string', () => {
    expect(formatCurrency('100')).toBe('$100.00');
  });

  it('falls back to $0.00 for NaN / undefined / null', () => {
    expect(formatCurrency(NaN)).toBe('$0.00');
    expect(formatCurrency(undefined)).toBe('$0.00');
    expect(formatCurrency(null)).toBe('$0.00');
  });
});

// ─── formatChange ──────────────────────────────────────────────────────────────

describe('formatChange', () => {
  it('prefixes a + for positive and zero', () => {
    expect(formatChange(5)).toBe('+5.00%');
    expect(formatChange(0)).toBe('+0.00%');
  });

  it('keeps the minus sign for negatives', () => {
    expect(formatChange(-3.2)).toBe('-3.20%');
  });

  it('treats NaN / undefined as zero', () => {
    expect(formatChange(NaN)).toBe('+0.00%');
    expect(formatChange(undefined)).toBe('+0.00%');
  });
});

// ─── formatNumber ──────────────────────────────────────────────────────────────

describe('formatNumber', () => {
  it('leaves numbers under 1,000 as-is', () => {
    expect(formatNumber(500)).toBe('500');
    expect(formatNumber(999)).toBe('999');
  });

  it('uses K for thousands', () => {
    expect(formatNumber(1500)).toBe('1.5K');
  });

  it('uses M for millions', () => {
    expect(formatNumber(2500000)).toBe('2.5M');
  });

  it('treats NaN as zero', () => {
    expect(formatNumber(NaN)).toBe('0');
  });
});

// ─── formatTimeRemaining ─────────────────────────────────────────────────────────

describe('formatTimeRemaining', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it('returns "Ended" at or below zero', () => {
    expect(formatTimeRemaining(0)).toBe('Ended');
    expect(formatTimeRemaining(-100)).toBe('Ended');
  });

  it('shows days and hours when over a day', () => {
    expect(formatTimeRemaining(2 * DAY + 5 * HOUR)).toBe('2d 5h');
  });

  it('shows hours and minutes when under a day', () => {
    expect(formatTimeRemaining(3 * HOUR + 10 * 60 * 1000)).toBe('3h 10m');
  });

  it('shows only minutes when under an hour', () => {
    expect(formatTimeRemaining(45 * 60 * 1000)).toBe('45m');
  });
});

// ─── round2 / round3 ──────────────────────────────────────────────────────────

describe('round2 / round3', () => {
  it('round2 rounds to 2 decimals', () => {
    expect(round2(1.236)).toBe(1.24);
    expect(round2(1.234)).toBe(1.23);
  });

  it('round3 rounds to 3 decimals', () => {
    expect(round3(1.2346)).toBe(1.235);
  });
});
