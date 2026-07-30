// @vitest-environment jsdom
// Guards the payout odds shown on each option. The previewed multiplier must always
// equal what claimPredictionPayout actually pays (functions/services/predictions.js),
// so a formula change on either side should break this test.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const h = vi.hoisted(() => ({ ctx: {}, halted: false }));
vi.mock('../context/AppContext', () => ({ useAppContext: () => h.ctx }));
// Pinned rather than read off the real clock: these odds assertions would
// otherwise fail every Thursday between 13:00 and 21:00 UTC, when the card
// swaps the bet UI for the chapter-review notice.
vi.mock('../utils/marketHours', async (importOriginal) => ({
  ...(await importOriginal()),
  isWeeklyHalt: () => h.halted,
}));

import PredictionCard from './PredictionCard';

const baseCtx = () => ({ darkMode: false, userData: { colorBlindMode: false }, marketData: {} });
h.ctx = baseCtx();

const HOUR = 60 * 60 * 1000;

const makePrediction = (pools, overrides = {}) => ({
  id: 'p1',
  question: 'Does Jake win the duel?',
  options: Object.keys(pools),
  pools,
  endsAt: Date.now() + 24 * HOUR,
  resolved: false,
  ...overrides,
});

const renderCard = (prediction, props = {}) =>
  render(<PredictionCard prediction={prediction} betLimit={1000} {...props} />);

afterEach(() => { cleanup(); h.halted = false; h.ctx = baseCtx(); });

describe('PredictionCard payout odds', () => {
  it('pays the underdog more than the favorite', () => {
    renderCard(makePrediction({ Yes: 900, No: 100 }));
    // Default preview bet is $50.
    // Yes: 50 * 1050 / 950 = 55.26 -> 1.11x   No: 50 * 1050 / 150 = 350 -> 7.00x
    expect(screen.getByText('1.11x')).toBeInTheDocument();
    expect(screen.getByText('7.00x')).toBeInTheDocument();
  });

  it('quotes about 2x when the pool is even', () => {
    renderCard(makePrediction({ Yes: 500, No: 500 }));
    expect(screen.getAllByText('1.91x')).toHaveLength(2);
  });

  it('drops the multiplier as the bet size grows', () => {
    renderCard(makePrediction({ Yes: 1000, No: 0 }));
    // A $50 bet into the empty side returns 21x, but $500 only returns 3x. Quoting
    // odds against the actual stake is what stops the card over-promising.
    expect(screen.getByText('21.0x')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /place bet/i }));
    fireEvent.change(screen.getByPlaceholderText(/custom amount/i), { target: { value: '500' } });

    expect(screen.queryByText('21.0x')).not.toBeInTheDocument();
    expect(screen.getByText('3.00x')).toBeInTheDocument();
  });

  it('shows a note instead of odds when nobody has bet', () => {
    renderCard(makePrediction({ Yes: 0, No: 0 }));
    expect(screen.getByText(/no bets yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/1\.00x/)).not.toBeInTheDocument();
  });

  it('hides odds once the prediction is resolved', () => {
    renderCard(makePrediction({ Yes: 900, No: 100 }, { resolved: true, outcomes: ['No'] }));
    expect(screen.queryByText(/x$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/payout on a/i)).not.toBeInTheDocument();
  });

  it('hides odds after betting has ended', () => {
    renderCard(makePrediction({ Yes: 900, No: 100 }, { endsAt: Date.now() - HOUR }));
    expect(screen.queryByText('7.00x')).not.toBeInTheDocument();
  });

  it('shows the multiplier on an existing bet', () => {
    // The stake is already in the pool here, so 100/300 of a 1000 pool = 333.33 (3.33x).
    renderCard(makePrediction({ Yes: 300, No: 700 }), {
      userBet: { option: 'Yes', amount: 100 },
    });
    expect(screen.getByText(/3\.33x/)).toBeInTheDocument();
  });
});

// Betting has to close with the market. A prediction created during chapter
// review used to keep a live Place Bet button all the way through the halt.
describe('PredictionCard while betting is closed', () => {
  it('replaces the bet button with the chapter-review notice', () => {
    h.halted = true;
    renderCard(makePrediction({ Yes: 500, No: 500 }));
    expect(screen.getByText(/closed for chapter review/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /place bet/i })).not.toBeInTheDocument();
  });

  it('names the reason during an admin halt', () => {
    h.ctx = { ...baseCtx(), marketData: { marketHalted: true, haltReason: 'Emergency maintenance' } };
    renderCard(makePrediction({ Yes: 500, No: 500 }));
    expect(screen.getByText(/Emergency maintenance/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /place bet/i })).not.toBeInTheDocument();
  });

  it('still shows the odds so people can see where the pool stands', () => {
    h.halted = true;
    renderCard(makePrediction({ Yes: 900, No: 100 }));
    expect(screen.getByText('7.00x')).toBeInTheDocument();
  });

  it('leaves the bet button alone when the market is open', () => {
    renderCard(makePrediction({ Yes: 500, No: 500 }));
    expect(screen.getByRole('button', { name: /place bet/i })).toBeInTheDocument();
    expect(screen.queryByText(/closed for chapter review/i)).not.toBeInTheDocument();
  });
});
