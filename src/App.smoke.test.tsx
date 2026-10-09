// @vitest-environment jsdom
// Smoke test: App must mount and render the home page without crashing.
// Exists because a hook-ordering bug (reading `user` before useAuthUser
// declared it) shipped in July 2026 with all unit tests green — nothing
// actually rendered <App /> itself.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('./firebase', () => ({ auth: {}, db: {} }));
vi.mock('./api/callables', () => ({
  executeTradeFunction: vi.fn(),
  achievementAlertFunction: vi.fn(),
  deleteAccountFunction: vi.fn(),
  claimPredictionPayoutFunction: vi.fn(),
  chargeMarginInterestFunction: vi.fn(),
  syncPortfolioFunction: vi.fn(),
  createPriceAlertFunction: vi.fn(),
  deletePriceAlertFunction: vi.fn(),
  cancelPreMarketOrderFunction: vi.fn(),
  changeDisplayNameFunction: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((auth, cb) => {
    cb(null);
    return () => {};
  }),
  applyActionCode: vi.fn(),
  signInWithCustomToken: vi.fn(),
  signOut: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendEmailVerification: vi.fn(),
}));
// Live subscriptions by doc path, so a test can push a snapshot.
const listeners = new Map<string, (snap: unknown) => void>();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  updateDoc: vi.fn(),
  onSnapshot: vi.fn((ref: unknown, cb: (snap: unknown) => void) => {
    if (typeof ref === 'string') listeners.set(ref, cb);
    return () => {};
  }),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(),
  Timestamp: { fromDate: vi.fn(() => ({})) },
}));

// Counts renders: App is the only caller of useMarketAccess, every market
// reader calls useMarket.
const calls = vi.hoisted(() => ({ access: 0, market: 0 }));
vi.mock('./context/AppContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('./context/AppContext')>();
  return {
    ...real,
    useMarketAccess: () => {
      calls.access++;
      return real.useMarketAccess();
    },
    useMarket: () => {
      calls.market++;
      return real.useMarket();
    },
  };
});

import App from './App';
import MarketDataProvider from './app/MarketDataProvider';
import { CHARACTERS } from './characters';

// Mounted the way main.tsx mounts it.
const mountApp = () =>
  render(
    <MemoryRouter>
      <MarketDataProvider>
        <App />
      </MarketDataProvider>
    </MemoryRouter>,
  );

const marketSnap = (prices: Record<string, number>) => ({ exists: () => true, data: () => ({ prices }) });

afterEach(cleanup);

describe('App smoke', () => {
  it('mounts and renders the home page as a guest', async () => {
    mountApp();
    expect(await screen.findByText(/Browsing as guest/i)).toBeInTheDocument();
  });

  it('a price tick re-renders market readers, not App', async () => {
    mountApp();
    await screen.findByText(/Browsing as guest/i);
    const ticker = CHARACTERS[0].ticker;
    const tick = listeners.get('market/current');
    expect(tick).toBeDefined();
    act(() => tick!(marketSnap({ [ticker]: 10 })));
    const before = { ...calls };
    act(() => tick!(marketSnap({ [ticker]: 11 })));
    expect(calls.access).toBe(before.access);
    expect(calls.market).toBeGreaterThan(before.market);
  });
});
