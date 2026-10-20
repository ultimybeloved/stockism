// @vitest-environment jsdom
// A Futures position shows what the player paid, not just what it's worth now
// (the 2026-10-19 redesign dropped it once).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

import FuturesMarket from './FuturesMarket';
import type { EventMarketDoc } from '../../../types';

const market = {
  id: 'm1',
  question: 'Does Gun return?',
  outcomes: ['Yes', 'No'],
  q: [0, 0],
  b: 1000,
} as EventMarketDoc;

afterEach(cleanup);

describe('FuturesMarket position', () => {
  it('shows the price paid per share for a single outcome', () => {
    render(
      <FuturesMarket
        market={market}
        position={{ shares: { Yes: 1000 }, costBasis: 300 }}
        pick={null}
        onPick={() => {}}
      />,
    );
    // Even odds price Yes at 50¢, so 1,000 shares bought at 30¢ are up $200.
    expect(screen.getByText(/You paid \$300\.00 \(30¢ a share\), worth \$500\.00 now/)).toBeInTheDocument();
    expect(screen.getByText('(+$200.00)')).toBeInTheDocument();
  });

  it('shows only the total when both outcomes are held', () => {
    render(
      <FuturesMarket
        market={market}
        position={{ shares: { Yes: 100, No: 100 }, costBasis: 120 }}
        pick={null}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText(/You paid \$120\.00, worth \$100\.00 now/)).toBeInTheDocument();
    expect(screen.getByText('(-$20.00)')).toBeInTheDocument();
  });
});
