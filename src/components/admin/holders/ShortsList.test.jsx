// @vitest-environment jsdom
// The admin short view is the only place a human can see who is short a ticker
// and how close they are to being force-covered, so the risk states are pinned
// here rather than left to a render nobody checks until it breaks.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

import ShortsList from './ShortsList';
import PositionSummary from './PositionSummary';

const theme = { darkMode: false, textClass: 'text-slate-900', mutedClass: 'text-slate-500' };

const short = (over = {}) => ({
  userId: 'u1',
  displayName: 'Shorty',
  shares: 10,
  entryPrice: 100,
  value: 900,
  margin: 1000,
  pnl: 100,
  equityRatio: 0.8,
  liquidationPrice: 150,
  isAtRisk: false,
  isCritical: false,
  ...over,
});

afterEach(cleanup);

describe('ShortsList', () => {
  it('renders nothing when nobody is short', () => {
    const { container } = render(<ShortsList {...theme} shortsData={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each short with its size and P&L', () => {
    render(<ShortsList {...theme} shortsData={[short(), short({ userId: 'u2', displayName: 'Bear', shares: 4, pnl: -50 })]} />);
    expect(screen.getByText(/Short Positions \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Shorty/)).toBeInTheDocument();
    expect(screen.getByText('+$100.00')).toBeInTheDocument();
    expect(screen.getByText('-$50.00')).toBeInTheDocument();
  });

  it('shows the force-cover price and equity so an admin can see how close it is', () => {
    render(<ShortsList {...theme} shortsData={[short()]} />);
    expect(screen.getByText(/Force-covers at \$150\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Equity 80%/)).toBeInTheDocument();
  });

  it('flags an at-risk position', () => {
    render(<ShortsList {...theme} shortsData={[short({ isAtRisk: true })]} />);
    expect(screen.getByText('AT RISK')).toBeInTheDocument();
    expect(screen.queryByText('LIQUIDATING')).not.toBeInTheDocument();
  });

  it('flags a position the server is about to force-cover', () => {
    render(<ShortsList {...theme} shortsData={[short({ isAtRisk: true, isCritical: true })]} />);
    expect(screen.getByText('LIQUIDATING')).toBeInTheDocument();
  });

  it('survives a position with no risk numbers', () => {
    render(<ShortsList {...theme} shortsData={[short({ equityRatio: null, liquidationPrice: null })]} />);
    expect(screen.getByText(/Shorty/)).toBeInTheDocument();
  });
});

describe('PositionSummary', () => {
  const holders = [{ userId: 'a', shares: 100, value: 9000 }, { userId: 'b', shares: 50, value: 4500 }];

  it('totals the long side', () => {
    const { container } = render(<PositionSummary {...theme} holdersData={holders} shortsData={[]} />);
    expect(within(container).getByText('150')).toBeInTheDocument();
    expect(within(container).getByText('$13500.00')).toBeInTheDocument();
  });

  it('hides the net line when nobody is short', () => {
    render(<PositionSummary {...theme} holdersData={holders} shortsData={[]} />);
    expect(screen.queryByText(/Net Shares/)).not.toBeInTheDocument();
  });

  it('shows net exposure once shorts exist', () => {
    render(<PositionSummary {...theme} holdersData={holders} shortsData={[short({ shares: 40, value: 3600 })]} />);
    expect(screen.getByText(/Net Shares/)).toBeInTheDocument();
    expect(screen.getByText('110')).toBeInTheDocument(); // 150 long - 40 short
  });

  it('reports more shorts than longs as a negative net', () => {
    render(<PositionSummary {...theme} holdersData={[]} shortsData={[short({ shares: 25, value: 2250 })]} />);
    expect(screen.getByText('-25')).toBeInTheDocument();
  });
});
