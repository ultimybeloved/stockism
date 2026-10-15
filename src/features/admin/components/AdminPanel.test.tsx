// @vitest-environment jsdom
// Characterization test: pins how the admin command panel renders and wires
// its sections. Every section must render its signature content after a menu
// click, and a few interactive paths are exercised end-to-end against mocks.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('../../../context/AppContext', () => ({ useTheme: () => ({ darkMode: false }) }));
vi.mock('../../../firebase', () => ({ db: {} }));
vi.mock('../../../api/callables', () => {
  const fn = () => vi.fn(async () => ({ data: {} }));
  return {
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
    renameTickerFunction: fn(),
    setMarketHaltFunction: fn(),
    addWatchedUserFunction: fn(),
    removeWatchedUserFunction: fn(),
    linkAltAccountFunction: fn(),
    addWatchedIPFunction: fn(),
    getWatchlistFunction: fn(),
    getRecentSignupReportFunction: fn(),
    auditUserDropsFunction: fn(),
    runDividendPayoutNowFunction: fn(),
    auditUsernamesFunction: fn(),
    triggerEventSettlementsFunction: fn(),
    cancelEventMarketFunction: fn(),
    initNewCharacterPricesFunction: fn(),
    adminDashboardFunction: vi.fn(async () => ({
      data: {
        generatedAt: Date.now(),
        players: { total: 10, signups24h: 1, signups7d: 3, active24h: 4, active7d: 6, linked: 5, banned: 0 },
        welcome: { started: 2, done: 1 },
        alerts: { open: 0 },
        jobs: [],
        today: null,
        newest: [],
      },
    })),
    adminWelcomeTrackerFunction: vi.fn(async () => ({
      data: { rows: [], linked: 5, days: 7, rewards: [1000, 700, 800, 900, 1000, 1100, 1500], generatedAt: 0 },
    })),
    adminMoneyFlowFunction: vi.fn(async () => ({ data: { days: [], generatedAt: 0 } })),
    adminDiscordActivityFunction: vi.fn(async () => ({
      data: { activity: [], unlinked: null, memberCount: null, linkedCount: 0, generatedAt: 0 },
    })),
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
  // useAdminSeason subscribes to market/season. Hand back "no season yet" and
  // an unsubscribe, so the panel renders its pre-season state.
  onSnapshot: vi.fn((_ref, onNext) => {
    if (typeof onNext === 'function') onNext({ exists: () => false, data: () => null });
    return () => {};
  }),
}));

import AdminPanel from './AdminPanel';
import { ADMIN_UIDS } from '../../../constants';
import type { User } from 'firebase/auth';

const ADMIN_UID = ADMIN_UIDS[0];

const renderPanel = (overrides: Record<string, unknown> = {}) =>
  render(
    <AdminPanel
      user={{ uid: ADMIN_UID } as User}
      predictions={[]}
      prices={{ JAKE: 50, GUN: 120 }}
      marketData={{ marketHalted: false }}
      onClose={vi.fn()}
      {...overrides}
    />,
  );

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const SECTIONS = [
  'Home',
  'Players',
  'Welcome week',
  'Watchlist',
  'Badges',
  'Money flow',
  'Dividends',
  'Admin history',
  'Market controls',
  'Trades',
  'Holders',
  'Stats',
  'IPOs',
  'Bets and markets',
  'Discord activity',
  'Bot messages',
  'Site messages',
  'Drop audit',
  'Recovery',
];

const menu = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });

describe('AdminPanel', () => {
  it('blocks non-admin users', () => {
    renderPanel({ user: { uid: 'random-user' } });
    expect(screen.getByText(/Admin access required/)).toBeInTheDocument();
    expect(screen.queryByText('COMMAND')).not.toBeInTheDocument();
  });

  it('renders the top bar, price button and every menu section', () => {
    renderPanel();
    expect(screen.getByText('COMMAND')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adjust prices' })).toBeInTheDocument();
    expect(screen.getByLabelText('Find a player')).toBeInTheDocument();
    for (const label of SECTIONS) expect(menu(label)).toBeInTheDocument();
  });

  it('opens on the home dashboard', async () => {
    renderPanel();
    expect(await screen.findByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText('Active 24h')).toBeInTheDocument();
  });

  it("renders each section's signature content when it is picked", async () => {
    renderPanel();
    const cases: [string, RegExp][] = [
      ['Players', /All players/],
      ['Welcome week', /Where everyone is/],
      ['Money flow', /Created vs removed/],
      ['Trades', /Trade Feed/],
      ['Holders', /Search Characters/],
      ['Market controls', /Market Controls/],
      ['Stats', /Financials/],
      ['IPOs', /Create New IPO/],
      ['Bets and markets', /Create New Prediction/],
      ['Dividends', /Dividend Controls/],
      ['Badges', /Achievement Badges/],
      ['Watchlist', /Add User to Watchlist/],
      ['Discord activity', /Who uses the bot/],
      ['Drop audit', /Drop Audit/],
      ['Recovery', /Bankrupt Users/],
    ];
    for (const [label, content] of cases) {
      fireEvent.click(menu(label));
      expect((await screen.findAllByText(content))[0]).toBeInTheDocument();
    }
  });

  it('no longer has the removed tools', async () => {
    renderPanel();
    expect(screen.queryByText(/Create Bots/i)).not.toBeInTheDocument();
    fireEvent.click(menu('Recovery'));
    await screen.findByText(/Bankrupt Users/);
    for (const gone of [/Spike Victim/, /Diagnose User Accounts/, /Reconstruct Portfolio History/, /Repair Corrupted/])
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    fireEvent.click(menu('Stats'));
    await screen.findByText(/Financials/);
    for (const gone of [/Reset All Prices/, /Cleanup Base Prices/, /Sync Prices to History/])
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    fireEvent.click(menu('Market controls'));
    await screen.findByText(/Market Controls/);
    for (const gone of [/Tidy Review Chart/, /Backfill Old Fill History/])
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
  });

  it('opens the price adjustment modal, selects a character, and previews a change', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust prices' }));
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
    fireEvent.click(menu('Market controls'));
    fireEvent.click(await screen.findByText('Halt Market'));
    expect(await screen.findByText(/Please enter a halt reason/)).toBeInTheDocument();
    const { setMarketHaltFunction } = await import('../../../api/callables');
    expect(setMarketHaltFunction).not.toHaveBeenCalled();
  });

  it('halts the market through the cloud function when a reason is given', async () => {
    renderPanel();
    fireEvent.click(menu('Market controls'));
    fireEvent.change(await screen.findByPlaceholderText(/Halt reason/), {
      target: { value: 'test emergency' },
    });
    fireEvent.click(screen.getByText('Halt Market'));
    const { setMarketHaltFunction } = await import('../../../api/callables');
    await vi.waitFor(() =>
      expect(setMarketHaltFunction).toHaveBeenCalledWith({ halted: true, reason: 'test emergency' }),
    );
  });

  it('loads the watchlist when the section is opened', async () => {
    renderPanel();
    fireEvent.click(menu('Watchlist'));
    const { getWatchlistFunction } = await import('../../../api/callables');
    expect(getWatchlistFunction).toHaveBeenCalled();
    expect(await screen.findByText(/Username Integrity/)).toBeInTheDocument();
  });

  it('shows the unresolved-predictions badge on Bets and markets', () => {
    renderPanel({
      predictions: [
        { id: 'p1', question: 'Q1', resolved: false, cancelled: false, options: ['Yes', 'No'] },
        { id: 'p2', question: 'Q2', resolved: true, cancelled: false, options: ['Yes', 'No'] },
      ],
    });
    expect(menu('Bets and markets')).toHaveTextContent(/Bets and markets\s*1$/);
  });
});
