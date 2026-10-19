// @vitest-environment jsdom
// The portfolio page's main view: header, positions table with details and
// history, the short tab, and the empty state.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const h = vi.hoisted(() => ({ ctx: {} }));

vi.mock('../../../firebase', () => ({ db: {} }));
vi.mock('../../../api/callables', () => ({}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  limitToLast: vi.fn(),
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  updateDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [], empty: true })),
}));
vi.mock('../../../context/AppContext', () => ({
  useTheme: () => h.ctx,
  useSession: () => h.ctx,
  useMarket: () => h.ctx,
}));

import { MemoryRouter } from 'react-router-dom';
import PortfolioView from './PortfolioView';
import { getChangeColors } from '../../../utils/theme';

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
  getColorBlindColors: (up: boolean) => getChangeColors(up, false),
});

const view = (value: number) =>
  render(
    <MemoryRouter>
      <PortfolioView currentValue={value} onTrade={noop} />
    </MemoryRouter>,
  );

const noop = () => {};

afterEach(cleanup);

describe('PortfolioView', () => {
  it('renders the header, value, and long/short tabs (short behind its tab)', async () => {
    h.ctx = baseCtx();
    view(1000);

    expect(await screen.findByText(/Your Portfolio/)).toBeInTheDocument();
    expect(screen.getAllByText('$1,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Open profit')).toBeInTheDocument();
    expect(screen.getByText('Allocation')).toBeInTheDocument();

    // Chart section
    expect(screen.getByText(/Hide Chart/)).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();

    // Long tab is the default — its holding shows, the short does not yet
    expect(screen.getAllByText('$JAKE').length).toBeGreaterThan(0);
    expect(screen.queryByText('$GAP')).not.toBeInTheDocument();

    // Switching to the Short tab reveals the short position
    fireEvent.click(screen.getByRole('radio', { name: /Short/ }));
    expect(screen.getByText('$GAP')).toBeInTheDocument();
    expect(screen.getByText('SHORT')).toBeInTheDocument();
  });

  it('expands a long position to reveal its stats and sell controls', async () => {
    h.ctx = baseCtx();
    view(1000);

    const row = (await screen.findAllByText('$JAKE')).map((el) => el.closest('tr')).find(Boolean);
    fireEvent.click(row!);
    expect(screen.getByText('Avg cost', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Sell all')).toBeInTheDocument();
    expect(screen.getByText(/Your history with \$JAKE/)).toBeInTheDocument();
  });

  it('expands a short position to reveal its stats and cover controls', async () => {
    h.ctx = baseCtx();
    view(1000);

    fireEvent.click(await screen.findByRole('radio', { name: /Short/ }));
    fireEvent.click(screen.getByText('$GAP'));
    expect(screen.getByText('Entry Price')).toBeInTheDocument();
    expect(screen.getByText('Margin Posted')).toBeInTheDocument();
    expect(screen.getByText('Cover All')).toBeInTheDocument();
  });

  it('shows the empty state when there are no positions', async () => {
    h.ctx = { ...baseCtx(), holdings: {}, shorts: {}, activeIPOs: [] };
    view(0);

    expect(await screen.findByText(/No positions yet/)).toBeInTheDocument();
  });
});
