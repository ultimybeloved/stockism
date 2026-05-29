// @vitest-environment jsdom
// Characterization test: captures how ProfilePage renders today so the page can be
// split into sub-components without changing behavior.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const h = vi.hoisted(() => ({ ctx: {} }));

vi.mock('../firebase', () => ({ db: {}, changeDisplayNameFunction: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  orderBy: vi.fn(),
  query: vi.fn(),
}));
vi.mock('../components/PortfolioAnalytics', () => ({ default: () => null }));
vi.mock('../components/common/PinDisplay', () => ({ default: () => null }));
vi.mock('../context/AppContext', () => ({ useAppContext: () => h.ctx }));

import ProfilePage from './ProfilePage';

const baseCtx = () => ({
  darkMode: false,
  user: { uid: 'u1' },
  userData: {
    displayName: 'TestTrader',
    peakPortfolioValue: 5000,
    totalTrades: 42,
    predictionWins: 3,
    bets: {},
    cash: 1000,
    colorBlindMode: false,
    isPublic: false,
  },
  predictions: [],
  prices: { JAKE: 50 },
  holdings: { JAKE: 10 },
  shorts: {},
  costBasis: { JAKE: 40 },
});

const noop = () => {};

afterEach(cleanup);

describe('ProfilePage', () => {
  it('renders the main sections for a signed-in user', async () => {
    h.ctx = baseCtx();
    render(<ProfilePage onOpenCrewSelection={noop} onDeleteAccount={noop} />);

    expect(await screen.findByText('TestTrader')).toBeInTheDocument();
    expect(screen.getByText('Portfolio Value')).toBeInTheDocument();
    expect(screen.getByText(/Trading Stats/)).toBeInTheDocument();
    expect(screen.getByText(/Settings/)).toBeInTheDocument();
    expect(screen.getByText(/Past Predictions/)).toBeInTheDocument();
    expect(screen.getByText(/Delete Account/)).toBeInTheDocument();

    // Computed stats render
    expect(screen.getByText('42')).toBeInTheDocument(); // total trades
    expect(screen.getByText('$5,000.00')).toBeInTheDocument(); // peak portfolio
  });

  it('shows a sign-in prompt when logged out', () => {
    h.ctx = { ...baseCtx(), user: null, userData: null };
    render(<ProfilePage onOpenCrewSelection={noop} onDeleteAccount={noop} />);

    expect(screen.getByText(/Please sign in/)).toBeInTheDocument();
  });
});
