import { describe, it, expect } from 'vitest';
import { parseCashInput, describeCashChange } from './adminCash';

describe('parseCashInput', () => {
  it('adds on a leading +', () => {
    expect(parseCashInput('+500', 1000)).toEqual({
      ok: true, mode: 'add', amount: 500, before: 1000, after: 1500,
    });
  });

  it('subtracts on a leading -', () => {
    expect(parseCashInput('-250', 1000)).toEqual({
      ok: true, mode: 'subtract', amount: 250, before: 1000, after: 750,
    });
  });

  it('sets on a bare number', () => {
    expect(parseCashInput('500', 1000)).toEqual({
      ok: true, mode: 'set', amount: 500, before: 1000, after: 500,
    });
  });

  it('is the difference between set and add that matters most', () => {
    expect(parseCashInput('500', 1000).after).toBe(500);
    expect(parseCashInput('+500', 1000).after).toBe(1500);
  });

  it('handles decimals and whitespace', () => {
    expect(parseCashInput('  +12.50  ', 0.25)).toMatchObject({ amount: 12.5, after: 12.75 });
    expect(parseCashInput('.5', 0)).toMatchObject({ mode: 'set', amount: 0.5 });
  });

  it('rounds to cents rather than drifting', () => {
    expect(parseCashInput('+0.1', 0.2).after).toBe(0.3);
  });

  it('refuses to go negative instead of clamping to zero', () => {
    const r = parseCashInput('-2000', 1000);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('only have $1000.00');
  });

  it('allows landing exactly on zero', () => {
    expect(parseCashInput('-1000', 1000)).toMatchObject({ ok: true, after: 0 });
  });

  it('rejects junk that parseFloat would half-accept', () => {
    for (const bad of ['5o0', '+ +5', 'abc', '', '   ', '+', '-', '1,000', '5e3', '--5']) {
      expect(parseCashInput(bad, 1000).ok).toBe(false);
    }
  });

  it('treats a missing balance as zero', () => {
    expect(parseCashInput('+100', undefined)).toMatchObject({ before: 0, after: 100 });
    expect(parseCashInput('+100', NaN)).toMatchObject({ before: 0, after: 100 });
  });
});

describe('describeCashChange', () => {
  it('reads as plain English', () => {
    expect(describeCashChange({ mode: 'set', amount: 500 }, 'Stitch'))
      .toBe("Set Stitch's cash to $500.00");
    expect(describeCashChange({ mode: 'add', amount: 500 }, 'Stitch'))
      .toBe("Add $500.00 to Stitch's cash");
    expect(describeCashChange({ mode: 'subtract', amount: 500 }, 'Stitch'))
      .toBe("Subtract $500.00 from Stitch's cash");
  });
});
