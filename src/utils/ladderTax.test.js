import { describe, it, expect } from 'vitest';
import { calculateLadderWithdrawTax } from './ladderTax';

const base = { totalDeposited: 0, principalWithdrawn: 0, profitWithdrawn: 0, hasRecentDeposit: false };

describe('calculateLadderWithdrawTax', () => {
  it('taxes pure principal at the flat 5% fee', () => {
    const r = calculateLadderWithdrawTax({ ...base, amount: 1000, totalDeposited: 1000 });
    expect(r.principalPart).toBe(1000);
    expect(r.profitPart).toBe(0);
    expect(r.principalFee).toBe(50);
    expect(r.profitTax).toBe(0);
    expect(r.rushSurcharge).toBe(0);
    expect(r.totalTax).toBe(50);
    expect(r.netReceived).toBe(950);
  });

  it('treats the free starting balance as profit (first bracket)', () => {
    // Never deposited: the $500 starting balance is all profit.
    const r = calculateLadderWithdrawTax({ ...base, amount: 500 });
    expect(r.principalPart).toBe(0);
    expect(r.profitPart).toBe(500);
    expect(r.profitTax).toBe(75); // 15%
    expect(r.netReceived).toBe(425);
  });

  it('crosses brackets within one withdrawal', () => {
    const r = calculateLadderWithdrawTax({ ...base, amount: 2000 });
    // 1000 * 0.15 + 1000 * 0.30
    expect(r.profitTax).toBe(450);
  });

  it('continues brackets across withdrawals so splitting does not dodge them', () => {
    const first = calculateLadderWithdrawTax({ ...base, amount: 800 });
    expect(first.profitTax).toBe(120); // all 15%
    const second = calculateLadderWithdrawTax({ ...base, amount: 400, profitWithdrawn: 800 });
    // 200 at 15% + 200 at 30%
    expect(second.profitTax).toBe(90);
    const combined = calculateLadderWithdrawTax({ ...base, amount: 1200 });
    expect(first.profitTax + second.profitTax).toBe(combined.profitTax);
  });

  it('applies the top bracket past $5,000 lifetime profit', () => {
    const r = calculateLadderWithdrawTax({ ...base, amount: 100, profitWithdrawn: 6000 });
    expect(r.profitTax).toBe(45);
  });

  it('adds the rush surcharge on the whole amount when a recent deposit exists', () => {
    const calm = calculateLadderWithdrawTax({ ...base, amount: 1000, totalDeposited: 1000 });
    const rushed = calculateLadderWithdrawTax({ ...base, amount: 1000, totalDeposited: 1000, hasRecentDeposit: true });
    expect(rushed.rushSurcharge).toBe(150);
    expect(rushed.totalTax - calm.totalTax).toBe(150);
    expect(rushed.netReceived).toBe(800);
  });

  it('splits a mixed withdrawal into principal and profit parts', () => {
    // Deposited 1000, already pulled 700 of it back: 300 basis remains.
    const r = calculateLadderWithdrawTax({ ...base, amount: 500, totalDeposited: 1000, principalWithdrawn: 700 });
    expect(r.principalPart).toBe(300);
    expect(r.profitPart).toBe(200);
    expect(r.principalFee).toBe(15);
    expect(r.profitTax).toBe(30);
  });

  it('treats everything as profit once the basis is exhausted', () => {
    const r = calculateLadderWithdrawTax({ ...base, amount: 250, totalDeposited: 1000, principalWithdrawn: 1000 });
    expect(r.principalPart).toBe(0);
    expect(r.profitPart).toBe(250);
  });

  it('rounds each component up to the cent and keeps the breakdown consistent', () => {
    // principalPart 0.10 -> fee 0.005 ceils to 0.01
    const r = calculateLadderWithdrawTax({ ...base, amount: 0.10, totalDeposited: 0.10 });
    expect(r.principalFee).toBe(0.01);
    expect(r.totalTax).toBe(0.01);
    expect(r.netReceived).toBe(0.09);

    const mixed = calculateLadderWithdrawTax({ ...base, amount: 333.33, totalDeposited: 100, hasRecentDeposit: true });
    expect(Math.round((mixed.principalFee + mixed.profitTax + mixed.rushSurcharge) * 100) / 100).toBe(mixed.totalTax);
    expect(Math.round((mixed.netReceived + mixed.totalTax) * 100) / 100).toBe(mixed.grossAmount);
  });

  it('does not ceil a phantom cent from floating point noise', () => {
    // 1000 * 0.05 = 50.00000000000001 in FP; must stay 50, not 50.01
    const r = calculateLadderWithdrawTax({ ...base, amount: 1000, totalDeposited: 1000 });
    expect(r.principalFee).toBe(50);
    // 110 * 0.15 = 16.499999999999996; ceil must give 16.5, not 16.51
    const p = calculateLadderWithdrawTax({ ...base, amount: 110 });
    expect(p.profitTax).toBe(16.5);
  });

  it('tolerates missing lifetime counters (legacy docs)', () => {
    const r = calculateLadderWithdrawTax({
      amount: 100,
      totalDeposited: undefined,
      principalWithdrawn: undefined,
      profitWithdrawn: undefined,
      hasRecentDeposit: false,
    });
    expect(r.principalPart).toBe(0);
    expect(r.profitPart).toBe(100);
    expect(r.profitTax).toBe(15);
  });
});
