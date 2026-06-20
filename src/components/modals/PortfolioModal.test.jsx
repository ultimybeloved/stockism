// @vitest-environment jsdom
// Characterization test: captures how PortfolioModal renders today so the
// component can be split into sub-components without changing behavior.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const h = vi.hoisted(() => ({ ctx: {} }));

vi.mock('../../firebase', () => ({ db: {} }));
vi.mock('../LimitOrders', () => ({ default: () => null }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  updateDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [], empty: true })),
}));
vi.mock('../../context/AppContext', () => ({ useAppContext: () => h.ctx }));

import PortfolioModal from './PortfolioModal';

const baseCtx = () => ({
  darkMode: false,
  user: { uid: 'test-uid' },
  userData: { colorBlindMode: false },
  prices: { JAKE: 50, GAP: 80 },
  priceHistory: {},
  holdings: { JAKE: 10 },
  shorts: { GAP: { shares: 5, costBasis: 100, margin: 500, system: 'v2' } },
  costBasis: { JAKE: 40 },
  activeIPOs: [],
  showNotification: vi.fn(),
});

const noop = () => {};

afterEach(cleanup);

describe('PortfolioModal', () => {
  it('renders the header, value, and long/short tabs (short behind its tab)', async () => {
    h.ctx = baseCtx();
    render(<PortfolioModal currentValue={1000} onClose={noop} onTrade={noop} />);

    expect(await screen.findByText(/Your Portfolio/)).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();

    // Chart section
    expect(screen.getByText(/Hide Chart/)).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();

    // Long tab is the default — its holding shows, the short does not yet
    expect(screen.getByText('$JAKE')).toBeInTheDocument();
    expect(screen.queryByText('$GAP')).not.toBeInTheDocument();

    // Switching to the Short tab reveals the short position
    fireEvent.click(screen.getByRole('button', { name: /Short/ }));
    expect(screen.getByText('$GAP')).toBeInTheDocument();
    expect(screen.getByText('SHORT')).toBeInTheDocument();
  });

  it('expands a long position to reveal its stats and sell controls', async () => {
    h.ctx = baseCtx();
    render(<PortfolioModal currentValue={1000} onClose={noop} onTrade={noop} />);

    fireEvent.click(await screen.findByText('$JAKE'));
    expect(screen.getByText('Avg Cost / Share')).toBeInTheDocument();
    expect(screen.getByText('Sell All')).toBeInTheDocument();
    expect(screen.getByText('Stop Loss')).toBeInTheDocument();
  });

  it('expands a short position to reveal its stats and cover controls', async () => {
    h.ctx = baseCtx();
    render(<PortfolioModal currentValue={1000} onClose={noop} onTrade={noop} />);

    fireEvent.click(await screen.findByRole('button', { name: /Short/ }));
    fireEvent.click(screen.getByText('$GAP'));
    expect(screen.getByText('Entry Price')).toBeInTheDocument();
    expect(screen.getByText('Margin Posted')).toBeInTheDocument();
    expect(screen.getByText('Cover All')).toBeInTheDocument();
  });

  it('shows the empty state when there are no positions', async () => {
    h.ctx = { ...baseCtx(), holdings: {}, shorts: {}, activeIPOs: [] };
    render(<PortfolioModal currentValue={0} onClose={noop} onTrade={noop} />);

    expect(await screen.findByText(/No positions yet/)).toBeInTheDocument();
  });
});
