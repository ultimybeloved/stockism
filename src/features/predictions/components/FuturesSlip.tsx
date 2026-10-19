// The bet slip for a futures market. Buying takes a dollar amount and turns it
// into as many whole shares as it covers; selling takes a share count.
import { useState } from 'react';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { lmsrBuyCost, lmsrSellRefund, maxAffordableShares } from '../../../utils/calculations';
import { EVENT_AMM_LIQUIDITY } from '../../../constants/economy';
import type { EventMarketDoc, EventPosition } from '../../../types';
import SlipAmount from './SlipAmount';
import { SlipNote, SlipTotal } from './SlipParts';

type TradeShares = (marketId: string, outcome: string, shares: number) => Promise<unknown>;

interface FuturesSlipProps {
  market: EventMarketDoc;
  option: string;
  position?: EventPosition;
  startOnSell?: boolean;
  /** Most they can spend: cash, capped by the shared side-game limit. */
  budget: number;
  /** Nothing invested in stocks yet, so nothing may be spent here. */
  noInvestment: boolean;
  onBuy: TradeShares;
  onSell: TradeShares;
  onDone: () => void;
}

const FuturesSlip = ({
  market: m,
  option,
  position,
  startOnSell,
  budget,
  noInvestment,
  onBuy,
  onSell,
  onDone,
}: FuturesSlipProps) => {
  const { mutedClass } = themeClasses;
  const owned = position?.shares?.[option] || 0;
  const [mode, setMode] = useState<'buy' | 'sell'>(startOnSell && owned > 0 ? 'sell' : 'buy');
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);

  const outcomes = m.outcomes || ['Yes', 'No'];
  const i = outcomes.indexOf(option);
  const q = Array.isArray(m.q) && m.q.length === outcomes.length ? m.q : outcomes.map(() => 0);
  const b = m.b || EVENT_AMM_LIQUIDITY;

  const buying = mode === 'buy';
  const shares = buying ? maxAffordableShares(q, b, i, Math.min(amount, budget)) : amount;
  const cost = buying && shares > 0 ? lmsrBuyCost(q, b, i, shares) : 0;
  const refund = !buying && shares > 0 ? lmsrSellRefund(q, b, i, shares) : 0;

  const submit = async () => {
    if (!(shares > 0) || busy) return;
    setBusy(true);
    try {
      if (await (buying ? onBuy : onSell)(m.id, option, shares)) onDone();
    } finally {
      setBusy(false);
    }
  };
  const switchTo = (next: 'buy' | 'sell') => {
    setMode(next);
    setAmount(0);
  };

  return (
    <>
      <div
        role="radiogroup"
        aria-label="Buy or sell"
        className="mt-3 grid grid-cols-2 border rounded-sm overflow-hidden text-sm font-bold light:border-indigo-300 dark:border-indigo-800"
      >
        {(['buy', 'sell'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mode === v}
            onClick={() => switchTo(v)}
            disabled={v === 'sell' && owned <= 0}
            className={`py-2 capitalize disabled:opacity-40 ${mode === v ? 'bg-indigo-600 text-white' : 'light:text-zinc-700 light:hover:bg-indigo-50 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}
          >
            {v}
          </button>
        ))}
      </div>

      {buying && noInvestment ? (
        <SlipNote>You can trade up to what you have invested in stocks. Buy some stocks first.</SlipNote>
      ) : (
        <>
          <SlipAmount
            key={mode}
            label={buying ? 'Amount' : 'Shares to sell'}
            value={amount}
            onChange={setAmount}
            max={buying ? budget : owned}
            dollars={buying}
            tone="futures"
          />
          {buying ? (
            <SlipTotal label="Potential payout" value={formatCurrency(shares)}>
              {shares > 0
                ? `${shares.toLocaleString('en-US')} shares at ${Math.round((cost / shares) * 100)}¢ avg. price, ${formatCurrency(cost)} total`
                : amount > 0
                  ? 'Not enough for one share.'
                  : null}
            </SlipTotal>
          ) : (
            <SlipTotal label="You receive" value={formatCurrency(refund)}>
              You own {owned.toLocaleString('en-US')} {option} shares.
            </SlipTotal>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!(shares > 0) || busy}
            className="mt-3 w-full py-3 font-bold text-white rounded-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Processing...' : buying ? 'Buy shares' : 'Sell shares'}
          </button>
        </>
      )}
      <p className={`text-xs mt-2 ${mutedClass}`}>
        Prices move with every trade. Sell any time before the market settles.
      </p>
    </>
  );
};

export default FuturesSlip;
