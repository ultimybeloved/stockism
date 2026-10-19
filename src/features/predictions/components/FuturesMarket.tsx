// A futures market: outcome shares priced by the house market maker. A share
// pays $1 if its outcome is confirmed, so a 27¢ share pays about 3.7x.
import { useEffect, useState } from 'react';
import { themeClasses } from '../../../utils/theme';
import { formatCompactCurrency, formatCurrency, formatMultiplier } from '../../../utils/formatters';
import { formatCountdown } from '../../../utils/marketHours';
import { lmsrPrices } from '../../../utils/calculations';
import { EVENT_AMM_LIQUIDITY } from '../../../constants/economy';
import type { EventMarketDoc, EventPosition } from '../../../types';
import { samePick, type SlipPick } from '../types';
import AnswerLine from './AnswerLine';

/** Outcome prices (0 to 1) for a market, in outcome order. */
export const futuresPrices = (m: EventMarketDoc): number[] => {
  const outcomes = m.outcomes || ['Yes', 'No'];
  const q = Array.isArray(m.q) && m.q.length === outcomes.length ? m.q : outcomes.map(() => 0);
  return lmsrPrices(q, m.b || EVENT_AMM_LIQUIDITY);
};

interface FuturesMarketProps {
  market: EventMarketDoc;
  position?: EventPosition;
  pick: SlipPick | null;
  onPick: (pick: SlipPick) => void;
}

const FuturesMarket = ({ market: m, position, pick, onPick }: FuturesMarketProps) => {
  const { textClass, mutedClass } = themeClasses;
  const outcomes = m.outcomes || ['Yes', 'No'];
  const prices = futuresPrices(m);

  // Announced but not trading yet: a countdown and nothing to tap.
  const [now, setNow] = useState(Date.now());
  const opensIn = m.opensAt ? m.opensAt - now : 0;
  useEffect(() => {
    if (opensIn <= 0) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [opensIn]);

  const held = outcomes.filter((o) => (position?.shares?.[o] || 0) > 0);
  const worth = outcomes.reduce((s, o, i) => s + (position?.shares?.[o] || 0) * (prices[i] ?? 0), 0);

  return (
    <article
      className={`border rounded-sm overflow-hidden light:bg-white light:border-indigo-200 dark:bg-zinc-900 dark:border-indigo-900 ${opensIn > 0 ? 'opacity-75' : ''}`}
    >
      <header className="px-3.5 pt-3 pb-2.5">
        <h3 className={`font-semibold leading-snug ${textClass}`}>{m.question}</h3>
        <p className={`text-xs mt-0.5 tabular-nums ${mutedClass}`}>
          {opensIn > 0 ? `Opens in ${formatCountdown(opensIn)}` : `${formatCompactCurrency(m.volume || 0)} volume`}
        </p>
      </header>
      {opensIn <= 0 &&
        outcomes.map((o, i) => {
          const price = prices[i] ?? 0;
          return (
            <AnswerLine
              key={o}
              tone="futures"
              name={o}
              share={Math.round(price * 100)}
              odds={price > 0 ? formatMultiplier(1 / price) : null}
              mine={held.includes(o)}
              picked={samePick(pick, 'futures', m.id, o)}
              onPick={() => onPick({ kind: 'futures', id: m.id, option: o })}
            />
          );
        })}
      {held.length > 0 && (
        <p className="px-3.5 py-2.5 text-xs tabular-nums border-t light:border-indigo-100 light:bg-indigo-50 dark:border-zinc-800 dark:bg-indigo-950/30">
          <span className={mutedClass}>Your position: </span>
          <b className={textClass}>
            {held.map((o) => `${(position?.shares?.[o] || 0).toLocaleString('en-US')} ${o} shares`).join(', ')}
          </b>
          <span className={mutedClass}>, worth {formatCurrency(worth)}. </span>
          <button
            type="button"
            onClick={() => onPick({ kind: 'futures', id: m.id, option: held[0]!, sell: true })}
            className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Sell
          </button>
        </p>
      )}
    </article>
  );
};

export default FuturesMarket;
