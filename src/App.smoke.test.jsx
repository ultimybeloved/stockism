// @vitest-environment jsdom
// Smoke test: App must mount and render the home page without crashing.
// Exists because a hook-ordering bug (reading `user` before useAuthUser
// declared it) shipped in July 2026 with all unit tests green — nothing
// actually rendered <App /> itself.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('./firebase', () => ({
  auth: {},
  db: {},
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
  onAuthStateChanged: vi.fn((auth, cb) => { cb(null); return () => {}; }),
  applyActionCode: vi.fn(),
  signInWithCustomToken: vi.fn(),
  signOut: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendEmailVerification: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  updateDoc: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(),
  Timestamp: { fromDate: vi.fn(() => ({})) },
}));

import App from './App';

afterEach(cleanup);

describe('App smoke', () => {
  it('mounts and renders the home page as a guest', async () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByText(/Browsing as guest/i)).toBeInTheDocument();
  });
});
