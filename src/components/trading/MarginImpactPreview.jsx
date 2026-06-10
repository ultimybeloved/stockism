import React from 'react';
import { useAppContext } from '../../context/AppContext';
import { formatCurrency } from '../../utils/formatters';
import { calculateMarginStatus } from '../../utils/calculations';
import {
  MARGIN_WARNING_THRESHOLD,
  MARGIN_DANGER_THRESHOLD,
  MARGIN_CALL_THRESHOLD,
  MARGIN_INTEREST_RATE
} from '../../constants';

// Shows how a buy that dips into borrowed money changes the user's margin.
// Returns null for pure-cash buys, so the parent can always render it.
const MarginImpactPreview = ({ cost, userCash }) => {
  const { darkMode, userData, prices, priceHistory } = useAppContext();

  const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
  if (!marginStatus.enabled) return null;

  const borrowed = Math.min(
    Math.max(0, cost - userCash),
    marginStatus.availableMargin
  );
  if (borrowed < 0.01) return null;

  const { grossValue, marginUsed, maxBorrowable, equityRatio } = marginStatus;

  // Mirrors the backend buy: cash drops by (cost - borrowed) and holdings rise
  // by cost, so gross value rises by exactly the borrowed amount.
  const grossAfter = grossValue + borrowed;
  const equityAfter = grossAfter > 0
    ? (grossAfter - (marginUsed + borrowed)) / grossAfter
    : 0;
  const limitPct = maxBorrowable > 0
    ? Math.min(100, ((marginUsed + borrowed) / maxBorrowable) * 100)
    : 100;

  const pct = (ratio) => `${Math.round(ratio * 100)}%`;

  const afterColor = equityAfter <= MARGIN_DANGER_THRESHOLD
    ? 'text-red-500'
    : equityAfter <= MARGIN_WARNING_THRESHOLD
      ? 'text-yellow-500'
      : darkMode ? 'text-zinc-100' : 'text-slate-900';

  const mutedClass = darkMode ? 'text-zinc-400' : 'text-slate-500';

  return (
    <div className="p-3 rounded-sm mb-4 border border-orange-500/50 bg-orange-500/10">
      <div className="flex justify-between items-center text-sm mb-1">
        <span className="text-orange-500 font-semibold">Buying on margin</span>
        <span className="text-orange-500 font-bold">{formatCurrency(borrowed)} borrowed</span>
      </div>
      <div className={`flex justify-between text-xs ${mutedClass} mb-1`}>
        <span>Margin limit used</span>
        <span>{Math.round(limitPct)}% of {formatCurrency(maxBorrowable)}</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className={mutedClass}>Equity ratio after this buy</span>
        <span className="font-semibold">
          <span className={mutedClass}>{pct(equityRatio)}</span>
          <span className={mutedClass}> &rarr; </span>
          <span className={afterColor}>{pct(equityAfter)}</span>
        </span>
      </div>
      <p className={`text-xs ${mutedClass} mt-1`}>
        Borrowed cash accrues {(MARGIN_INTEREST_RATE * 100).toFixed(1)}% interest daily. A margin call hits if your equity ratio falls to {Math.round(MARGIN_CALL_THRESHOLD * 100)}%.
      </p>
    </div>
  );
};

export default MarginImpactPreview;
