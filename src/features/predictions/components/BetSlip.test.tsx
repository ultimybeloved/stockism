// @vitest-environment jsdom
// The bet slip decides whether a bet can be placed at all and what it promises.
// Betting has to close with the market (a prediction made during chapter review
// once kept a live bet button through the halt), and the payout it quotes has to
// be the one for the exact stake.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('../../../context/AppContext', () => ({
  useTheme: () => ({ darkMode: false }),
  useSession: () => ({ userData: {} }),
  useMarket: () => ({ marketData: {} }),
}));

import BetSlip, { type BetSlipProps } from './BetSlip';
import type { PredictionDoc } from '../../../types';

const HOUR = 60 * 60 * 1000;
const question: PredictionDoc = {
  id: 'p1',
  question: 'Does Jake win the duel?',
  options: ['Yes', 'No'],
  pools: { Yes: 1000, No: 0 },
  endsAt: Date.now() + 24 * HOUR,
};

const renderSlip = (props: Partial<BetSlipProps> = {}) => {
  const onBet = vi.fn().mockResolvedValue(true);
  const onDone = vi.fn();
  render(
    <BetSlip
      pick={{ kind: 'weekly', id: 'p1', option: 'No' }}
      question={question}
      available={10_000}
      noInvestment={false}
      isGuest={false}
      closedReason={null}
      onBet={onBet}
      onBuy={vi.fn()}
      onSell={vi.fn()}
      onPick={vi.fn()}
      onDone={onDone}
      {...props}
    />,
  );
  return { onBet, onDone };
};

afterEach(cleanup);

describe('BetSlip', () => {
  it('quotes the payout for the exact stake and places the bet', async () => {
    const { onBet, onDone } = renderSlip();
    fireEvent.change(screen.getByLabelText('Stake'), { target: { value: '500' } });
    // 500 into the empty side of a 1000 pot: 500/500 of 1500.
    expect(screen.getByText('$1,500.00')).toBeInTheDocument();
    expect(screen.getByText(/Odds 3\.00x/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Place bet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onBet).toHaveBeenCalledWith('p1', 'No', 500);
  });

  it('never takes more than the player has available', () => {
    renderSlip({ available: 300 });
    fireEvent.change(screen.getByLabelText('Stake'), { target: { value: '5000' } });
    expect(screen.getByLabelText('Stake')).toHaveValue('300');
  });

  it('shows the reason instead of the form while betting is closed', () => {
    renderSlip({ closedReason: 'Betting is closed for chapter review.' });
    expect(screen.getByText(/closed for chapter review/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Place bet' })).not.toBeInTheDocument();
  });

  it('will not switch an existing bet to another answer', () => {
    renderSlip({ userBet: { option: 'Yes', amount: 100 } });
    expect(screen.getByText(/Bets are final/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Place bet' })).not.toBeInTheDocument();
  });

  it('asks guests to sign in', () => {
    renderSlip({ isGuest: true });
    expect(screen.getByText(/Sign in to place bets/)).toBeInTheDocument();
  });

  it('waits for a pick', () => {
    renderSlip({ pick: null, question: null });
    expect(screen.getByText(/Pick an answer/)).toBeInTheDocument();
  });
});
