// @vitest-environment jsdom
// Characterization tests for LadderGame, written BEFORE the split so the
// extraction can be verified against today's behavior. Covers: board render,
// guest + tutorial gates, a full play round (animation timers included),
// and the transfer/leaderboard/stats modals.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

const h = vi.hoisted(() => ({ ctx: {}, docs: {} }));

vi.mock('../context/AppContext', () => ({
  useAppContext: () => h.ctx,
}));

vi.mock('../firebase', () => ({
  db: {},
  playLadderGameFunction: vi.fn(async () => ({ data: {} })),
  depositToLadderGameFunction: vi.fn(async () => ({ data: {} })),
  withdrawFromLadderGameFunction: vi.fn(async () => ({ data: {} })),
  getLadderLeaderboardFunction: vi.fn(async () => ({ data: { leaderboard: [] } })),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, col, id) => ({ col, id })),
  onSnapshot: vi.fn((ref, cb) => {
    const data = h.docs[ref.col];
    cb({ exists: () => data != null, data: () => data });
    return () => {};
  }),
  updateDoc: vi.fn(async () => {}),
}));

vi.mock('./LadderTutorialModal', () => ({
  default: () => <div data-testid="ladder-tutorial" />,
}));

import LadderGame from './LadderGame';
import {
  playLadderGameFunction,
  depositToLadderGameFunction,
  withdrawFromLadderGameFunction,
  getLadderLeaderboardFunction,
} from '../firebase';

describe('LadderGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.ctx = {
      user: { uid: 'u1' },
      userData: {
        ladderTutorial2Completed: true,
        holdings: { XIAO: 10 },
        costBasis: { XIAO: 50 },
        shorts: {},
      },
      showNotification: vi.fn(),
    };
    h.docs = {
      ladderGameUsers: {
        balance: 100, gamesPlayed: 10, wins: 6, currentStreak: 2, bestStreak: 4,
        totalDeposited: 100, principalWithdrawn: 0, profitWithdrawn: 0, recentDeposits: [],
      },
      ladderGame: { history: [
        { result: 'odd', oddPct: 60, evenPct: 40 },
        { result: 'even', oddPct: 45, evenPct: 55 },
      ] },
      users: { cash: 2500 },
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the board: instruction, balance, buttons, history, banners', () => {
    render(<LadderGame onClose={vi.fn()} />);
    expect(screen.getByText('Choose a ladder')).toBeInTheDocument();
    expect(screen.getByText('$100')).toBeInTheDocument(); // ladder balance
    expect(screen.getByText('Transfer')).toBeInTheDocument();
    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    expect(screen.getByText('My Stats')).toBeInTheDocument();
    expect(screen.getByText(/Purchase ratio changeable/i)).toBeInTheDocument();
    expect(screen.getByText(/CHOOSE ODDS/)).toBeInTheDocument(); // init banner
    expect(screen.getAllByText('X')).toHaveLength(2); // two ladder start buttons
    expect(screen.getByText('O')).toBeInTheDocument(); // history circles
    expect(screen.getByText('E')).toBeInTheDocument();
    // ODD/EVEN locked until a side is picked
    expect(screen.getByText('ODD')).toBeDisabled();
    expect(screen.getByText('EVEN')).toBeDisabled();
  });

  it('prompts guests to sign in instead of playing', () => {
    h.ctx.user = null;
    render(<LadderGame onClose={vi.fn()} />);
    expect(screen.getByText('$500')).toBeInTheDocument(); // default balance
    fireEvent.click(screen.getAllByText('X')[0]);
    expect(h.ctx.showNotification).toHaveBeenCalledWith('info', 'Sign in to play the ladder game!');
    expect(screen.getByText('ODD')).toBeDisabled();
  });

  it('shows the tutorial on mount when not completed', () => {
    h.ctx.userData = { ...h.ctx.userData, ladderTutorial2Completed: false };
    render(<LadderGame onClose={vi.fn()} />);
    expect(screen.getByTestId('ladder-tutorial')).toBeInTheDocument();
  });

  it('selecting a side updates the instruction and unlocks ODD/EVEN', () => {
    render(<LadderGame onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByText('X')[0]);
    expect(screen.getByText('Choose odds or evens')).toBeInTheDocument();
    expect(screen.getByText('ODD')).not.toBeDisabled();
    // Clicking the same side again deselects
    fireEvent.click(screen.getAllByText('X')[0]);
    expect(screen.getByText('Choose a ladder')).toBeInTheDocument();
    expect(screen.getByText('ODD')).toBeDisabled();
  });

  it('plays a round: calls the server, deducts the bet immediately, animates to the result', async () => {
    vi.useFakeTimers();
    playLadderGameFunction.mockResolvedValueOnce({
      data: { rungs: [2, 5, 8], result: 'odd', won: true, payout: 2, newBalance: 101, currentStreak: 3 },
    });
    render(<LadderGame onClose={vi.fn()} />);

    fireEvent.click(screen.getAllByText('X')[0]); // left side
    fireEvent.click(screen.getByText('ODD'));
    await act(async () => { await Promise.resolve(); });

    expect(playLadderGameFunction).toHaveBeenCalledWith({ startSide: 'left', bet: 'odd', amount: 1 });
    expect(screen.getByText('$99')).toBeInTheDocument(); // bet deducted up front

    // Walk the animation forward until the result banner appears
    for (let i = 0; i < 60 && !screen.queryByText('+$2'); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(screen.getByText('+$2')).toBeInTheDocument();
    // Once the round ends, the balance re-syncs from the Firestore listener
    expect(screen.getByText('$100')).toBeInTheDocument();
    expect(screen.getByText('Choose a ladder')).toBeInTheDocument();
  });

  it('shows a notification when the server rejects a play', async () => {
    playLadderGameFunction.mockRejectedValueOnce(new Error('Insufficient balance'));
    render(<LadderGame onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByText('X')[1]); // right side
    fireEvent.click(screen.getByText('EVEN'));
    await waitFor(() => {
      expect(h.ctx.showNotification).toHaveBeenCalledWith('error', 'Insufficient balance');
    });
  });

  it('transfer modal: shows cash, invested-based deposit cap, and deposits', async () => {
    render(<LadderGame onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Transfer'));
    expect(screen.getByText(/Available: \$2,500\.00/)).toBeInTheDocument();
    // invested = 10 shares * $50 basis = $500; cap = min(10000, 500) - 100 balance = 400
    expect(screen.getByText(/You can add up to \$400\.00 more\. Deposits are capped at your \$500\.00 invested\./)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Deposit'));
    await waitFor(() => {
      expect(depositToLadderGameFunction).toHaveBeenCalledWith({ amount: 50 });
      expect(h.ctx.showNotification).toHaveBeenCalledWith('success', 'Successfully deposited $50');
    });
  });

  it('withdraw tab: prefills full balance, previews tax, and withdraws', async () => {
    withdrawFromLadderGameFunction.mockResolvedValueOnce({
      data: { grossAmount: 100, totalTax: 5, netReceived: 95 },
    });
    render(<LadderGame onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Transfer'));
    fireEvent.click(screen.getByText('withdraw'));

    expect(screen.getByDisplayValue('100')).toBeInTheDocument(); // prefilled with balance
    // $100 is all principal -> 5% fee = $5, receive $95
    expect(screen.getByText(/Fee on your own money back \(5%\): -\$5\.00/)).toBeInTheDocument();
    expect(screen.getByText(/You receive \$95\.00/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Withdraw'));
    await waitFor(() => {
      expect(withdrawFromLadderGameFunction).toHaveBeenCalledWith({ amount: 100 });
      expect(h.ctx.showNotification).toHaveBeenCalledWith('success', 'Withdrew $100.00. Tax was $5.00. You received $95.00.');
    });
  });

  it('leaderboard modal loads and lists players', async () => {
    getLadderLeaderboardFunction.mockResolvedValueOnce({
      data: { leaderboard: [{ username: 'Alice', balance: 5000, winRate: 60 }] },
    });
    render(<LadderGame onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Leaderboard'));
    expect(await screen.findByText(/#1 Alice/)).toBeInTheDocument();
    expect(screen.getByText('$5,000 (60%)')).toBeInTheDocument();
  });

  it('stats modal shows games, win rate, and streaks', () => {
    render(<LadderGame onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('My Stats'));
    expect(screen.getByText('Games Played')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument(); // 6 wins / 10 games
    expect(screen.getByText('Current Streak')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Best Streak')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('View Guide')).toBeInTheDocument();
  });
});
