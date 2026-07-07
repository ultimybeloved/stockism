// @vitest-environment jsdom
// Characterization test: pins how AdminPanel renders and wires its 13 tabs
// today, so its state/handlers can be extracted into hooks without changing
// behavior. Every tab must render its signature content after a pill click,
// and a few interactive paths are exercised end-to-end against mocks.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('./firebase', () => {
  const fn = () => vi.fn(async () => ({ data: {} }));
  return {
  db: {},
  broadcastNotificationFunction: fn(),
  triggerManualBackupFunction: fn(),
  listBackupsFunction: fn(),
  restoreBackupFunction: fn(),
  banUserFunction: fn(),
  ipoAnnouncementAlertFunction: fn(),
  removeAchievementFunction: fn(),
  reinstateUserFunction: fn(),
  adminSetCashFunction: fn(),
  adminTransferToLadderFunction: fn(),
  adminSetDiscordWallFunction: fn(),
  repairSpikeVictimsFunction: fn(),
  renameTickerFunction: fn(),
  setMarketHaltFunction: fn(),
  addWatchedUserFunction: fn(),
  removeWatchedUserFunction: fn(),
  linkAltAccountFunction: fn(),
  addWatchedIPFunction: fn(),
  getWatchlistFunction: fn(),
  getRecentSignupReportFunction: fn(),
  diagnoseTickerRollbackFunction: fn(),
  recoverTickerFunction: fn(),
  auditUserDropsFunction: fn(),
  runDividendPayoutNowFunction: fn(),
  auditUsernamesFunction: fn(),
  reconstructPortfolioHistoryFunction: fn(),
  triggerEventSettlementsFunction: fn(),
  cancelEventMarketFunction: fn(),
  initNewCharacterPricesFunction: fn(),
  };
});

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  collection: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [], empty: true, forEach: () => {} })),
  deleteDoc: vi.fn(async () => {}),
  arrayUnion: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

import AdminPanel from './AdminPanel';
import { ADMIN_UIDS } from './constants';

const ADMIN_UID = ADMIN_UIDS[0];

const renderPanel = (overrides = {}) =>
  render(
    <AdminPanel
      user={{ uid: ADMIN_UID }}
      predictions={[]}
      prices={{ JAKE: 50, GUN: 120 }}
      darkMode={false}
      marketData={{ marketHalted: false }}
      onClose={vi.fn()}
      {...overrides}
    />
  );

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('AdminPanel', () => {
  it('blocks non-admin users', () => {
    renderPanel({ user: { uid: 'random-user' } });
    expect(screen.getByText(/Admin Access Required/)).toBeInTheDocument();
    expect(screen.queryByText(/Admin Panel/)).not.toBeInTheDocument();
  });

  it('renders the header, price button, and all 13 tab pills', () => {
    renderPanel();
    expect(screen.getByText(/Admin Panel/)).toBeInTheDocument();
    expect(screen.getByText(/Adjust Prices/)).toBeInTheDocument();
    for (const label of ['Users', 'Trades', 'Holders', 'Market', 'Stats', 'IPO',
      'Bets', 'Dividends', 'Bots', 'Badges', 'Watchlist', 'Diagnostics', 'Recovery']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('shows the Users tab by default with the search box', () => {
    renderPanel();
    expect(screen.getByPlaceholderText(/Search by name, ID, or Discord/)).toBeInTheDocument();
  });

  it('renders each tab\'s signature content when its pill is clicked', async () => {
    renderPanel();
    const cases = [
      ['Trades', /Trade Feed/],
      ['Holders', /Search Characters/],
      ['Market', /Market Controls/],
      ['Stats', /Financials/],
      ['IPO', /Create New IPO/],
      ['Bets', /Create New Prediction/],
      ['Dividends', /Dividend Controls/],
      ['Bots', /No bots found|Active Bots/],
      ['Badges', /Achievement Badges/],
      ['Watchlist', /Add User to Watchlist/],
      ['Diagnostics', /Drop Audit/],
      ['Recovery', /Bankrupt Users/],
    ];
    for (const [label, content] of cases) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^\\S+ ${label}`) }));
      expect(await screen.findByText(content)).toBeInTheDocument();
    }
  });

  it('opens the price adjustment modal, selects a character, and previews a change', () => {
    renderPanel();
    fireEvent.click(screen.getByText(/Adjust Prices/));
    expect(screen.getByText(/Adjust Character Prices/)).toBeInTheDocument();

    // Narrow the list to one character and select it
    fireEvent.change(screen.getByPlaceholderText(/Search by name or ticker/), {
      target: { value: 'JAKE' },
    });
    fireEvent.click(screen.getByText('$JAKE'));
    expect(screen.getByText('+25%')).toBeInTheDocument();

    // Custom percent shows a live preview against the current price (50)
    fireEvent.change(screen.getByPlaceholderText(/Custom %/), { target: { value: '10' } });
    expect(screen.getByText(/Preview: \$50\.00 → \$55\.00/)).toBeInTheDocument();
  });

  it('rejects halting the market without a reason', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Market/ }));
    fireEvent.click(await screen.findByText('Halt Market'));
    expect(await screen.findByText(/Please enter a halt reason/)).toBeInTheDocument();
    const { setMarketHaltFunction } = await import('./firebase');
    expect(setMarketHaltFunction).not.toHaveBeenCalled();
  });

  it('halts the market through the cloud function when a reason is given', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Market/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Halt reason/), {
      target: { value: 'test emergency' },
    });
    fireEvent.click(screen.getByText('Halt Market'));
    expect(await screen.findByText(/Market halted/)).toBeInTheDocument();
    const { setMarketHaltFunction } = await import('./firebase');
    expect(setMarketHaltFunction).toHaveBeenCalledWith({ halted: true, reason: 'test emergency' });
  });

  it('loads the watchlist when the tab is opened', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Watchlist/ }));
    const { getWatchlistFunction } = await import('./firebase');
    expect(getWatchlistFunction).toHaveBeenCalled();
    expect(await screen.findByText(/Username Integrity/)).toBeInTheDocument();
  });

  it('shows the unresolved-predictions badge on the Bets pill', () => {
    renderPanel({
      predictions: [
        { id: 'p1', question: 'Q1', resolved: false, cancelled: false, options: ['Yes', 'No'] },
        { id: 'p2', question: 'Q2', resolved: true, cancelled: false, options: ['Yes', 'No'] },
      ],
    });
    expect(screen.getByRole('button', { name: /Bets \(1\)/ })).toBeInTheDocument();
  });
});
