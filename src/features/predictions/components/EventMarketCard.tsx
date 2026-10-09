import { useState, useEffect } from 'react';
import { getOutcomeColor, themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { useSession } from '../../../context/AppContext';

import {
  lmsrPrices,
  lmsrBuyCost,
  lmsrSellRefund,
  getTotalInvested,
  niceStep,
  maxAffordableShares,
} from '../../../utils/calculations';
import { formatCountdown } from '../../../utils/marketHours';
import { marketTimes } from '../../../utils/localTime';
import { EVENT_AMM_LIQUIDITY } from '../../../constants/economy';
import type { EventMarketDoc, EventPosition } from '../../../types';

type TradeShares = (marketId: string, outcome: string, shares: number) => Promise<unknown>;

interface EventMarketCardProps {
  market: EventMarketDoc;
  position?: EventPosition;
  onBuy: TradeShares;
  onSell: TradeShares;
  isGuest?: boolean;
  isHalted?: boolean;
  isAdmin?: boolean;
  onHide?: (marketId: string) => void;
}

// Long-term event-share market card. Each outcome is a share that pays $1 if it
// is the confirmed result. Prices come from the house AMM (LMSR) and players can
// buy or sell any time, except when the market is frozen during chapter review.
const EventMarketCard = ({
  market,
  position,
  onBuy,
  onSell,
  isGuest,
  isHalted = false,
  isAdmin = false,
  onHide,
}: EventMarketCardProps) => {
  const { userData } = useSession();
  const { cardClass, textClass, mutedClass, subtleClass, chipClass } = themeClasses;

  const colorBlindMode = userData?.colorBlindMode || false;

  const outcomes = market.outcomes || ['Yes', 'No'];
  const b = market.b || EVENT_AMM_LIQUIDITY;
  const q = Array.isArray(market.q) && market.q.length === outcomes.length ? market.q : outcomes.map(() => 0);
  const lmsr = lmsrPrices(q, b);
  const prices = (i: number) => lmsr[i] ?? 0;

  const resolved = !!market.resolved;
  const winning = market.outcome;

  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState(10);
  const [showTrade, setShowTrade] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Announced-but-locked window: visible with a countdown, no trading until opensAt.
  const [nowTs, setNowTs] = useState(Date.now());
  const notYetOpen = !resolved && !!market.opensAt && nowTs < market.opensAt;
  useEffect(() => {
    if (!notYetOpen) return undefined;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [notYetOpen]);

  const ownedFor = (o: string) => position?.shares?.[o] || 0;
  const positionValue = outcomes.reduce((sum, o, i) => sum + ownedFor(o) * prices(i), 0);
  const hasPosition = outcomes.some((o) => ownedFor(o) > 0);

  // Long-term markets are capped at what the user has invested in stocks (same
  // rule as weekly bets and ladder deposits), enforced on the server. Mirror it
  // here so the limit shows instead of bouncing off a server error. Only
  // unsettled positions count, matching the backend.
  const totalInvested = getTotalInvested(userData?.holdings, userData?.costBasis, userData?.shorts);
  const activeEventCost = Object.values(userData?.eventPositions || {}).reduce(
    (sum, p) => sum + (p && !p.settled ? Math.max(0, p.costBasis || 0) : 0),
    0,
  );
  const eventRoom = Math.max(0, totalInvested - activeEventCost);
  const noInvestment = totalInvested <= 0;

  // The outcome buttons only ever select an index inside the list.
  const selectedOutcome = outcomes[selected]!;
  const qty = Number(shares) || 0;
  const ownedSelected = ownedFor(selectedOutcome);
  const preview =
    qty > 0 ? (mode === 'buy' ? lmsrBuyCost(q, b, selected, qty) : lmsrSellRefund(q, b, selected, qty)) : 0;
  const exceedsCap = mode === 'buy' && qty > 0 && preview > eventRoom + 1e-9;
  const canSubmit = qty > 0 && (mode === 'buy' ? !noInvestment && !exceedsCap : qty <= ownedSelected);

  // Stepper + Max bounds. Buy is limited by both cash and the invested cap; sell
  // by what you own. niceStep keeps +/- proportional to that ceiling.
  const buyBudget = Math.min(userData?.cash || 0, eventRoom);
  const maxBuyShares = maxAffordableShares(q, b, selected, buyBudget);
  const currentMax = mode === 'buy' ? maxBuyShares : ownedSelected;
  const shareStep = niceStep(currentMax, 1);

  // Wait for the trade to actually clear before closing the panel. Without this the
  // panel vanished the instant you tapped, with no sign anything happened until a
  // toast popped a second later, and a failed trade silently dropped you back to the
  // Trade button. Now the button shows progress and the panel only closes on success.
  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const res =
        mode === 'buy' ? await onBuy(market.id, selectedOutcome, qty) : await onSell(market.id, selectedOutcome, qty);
      if (res) {
        setShowTrade(false);
        setShares(10);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`${cardClass} border rounded-sm p-4`}>
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔮</span>
          <span
            className={`text-xs font-semibold uppercase ${resolved ? 'text-amber-500' : notYetOpen ? 'text-blue-500' : isHalted ? 'text-red-500' : 'text-orange-500'}`}
          >
            {resolved ? 'Resolved' : notYetOpen ? 'Coming Soon' : isHalted ? 'Closed' : 'Long-Term'}
          </span>
        </div>
        {!resolved && <span className={`text-xs ${mutedClass}`}>Settles when confirmed</span>}
      </div>

      <h3 className={`font-semibold mb-3 ${textClass}`}>{market.question}</h3>

      {/* Outcome prices */}
      {!notYetOpen && (
        <div className="space-y-2 mb-3">
          {outcomes.map((o, i) => {
            const colors = getOutcomeColor(i, colorBlindMode);
            const isWinner = resolved && o === winning;
            return (
              <div key={o} className="flex items-center gap-2">
                <div
                  className={`w-28 sm:w-36 text-xs font-semibold ${colors.text} ${isWinner ? 'underline' : ''}`}
                  title={o}
                >
                  {o} {isWinner && '✓'}
                </div>
                <div className="flex-1 h-4 rounded-sm overflow-hidden light:bg-slate-200 dark:bg-zinc-800">
                  <div
                    className={`h-full ${colors.fill} transition-all`}
                    style={{ width: `${Math.round(prices(i) * 100)}%` }}
                  />
                </div>
                <div className={`w-10 text-xs text-right ${mutedClass}`}>{Math.round(prices(i) * 100)}¢</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Your position */}
      {!notYetOpen && hasPosition && (
        <div className={`mb-3 p-2 rounded-sm ${subtleClass}`}>
          <div className={`text-xs ${mutedClass} mb-1`}>Your shares</div>
          {outcomes.map(
            (o, i) =>
              ownedFor(o) > 0 && (
                <div key={o} className="flex justify-between text-xs">
                  <span className={getOutcomeColor(i, colorBlindMode).text}>
                    {ownedFor(o)} × {o}
                  </span>
                  {resolved ? (
                    <span className={mutedClass}>
                      {o === winning ? `Won ${formatCurrency(ownedFor(o))}` : 'Expired'}
                    </span>
                  ) : (
                    <span className={mutedClass}>{formatCurrency(ownedFor(o) * prices(i))}</span>
                  )}
                </div>
              ),
          )}
          {!resolved && (
            <div className={`text-xs mt-1 ${mutedClass}`}>
              Position value: <span className="text-orange-500 font-semibold">{formatCurrency(positionValue)}</span>
            </div>
          )}
        </div>
      )}

      {/* Resolved banner */}
      {resolved && (
        <div
          className={`text-center py-2 rounded-sm ${getOutcomeColor(Math.max(0, outcomes.indexOf(winning ?? '')), colorBlindMode).bg} bg-opacity-20`}
        >
          <span
            className={`font-semibold ${getOutcomeColor(Math.max(0, outcomes.indexOf(winning ?? '')), colorBlindMode).text}`}
          >
            Outcome: {winning}
          </span>
        </div>
      )}

      {/* Trade panel */}
      {!resolved && notYetOpen && (
        <div className={`text-center py-2 text-sm ${mutedClass} light:bg-slate-200/60 dark:bg-zinc-800/50 rounded-sm`}>
          🔒 Opens in {formatCountdown(market.opensAt! - nowTs)}
        </div>
      )}

      {!resolved && !notYetOpen && isHalted && (
        <div className={`text-center py-2 text-sm ${mutedClass} light:bg-slate-200/60 dark:bg-zinc-800/50 rounded-sm`}>
          🔒 Closed for chapter review. Trading reopens {marketTimes().reopen}.
        </div>
      )}

      {!resolved && !notYetOpen && !isHalted && isGuest && (
        <div className={`text-center text-sm ${mutedClass}`}>Sign in to trade</div>
      )}

      {!resolved && !notYetOpen && !isHalted && !isGuest && !showTrade && (
        <button
          onClick={() => setShowTrade(true)}
          className="w-full py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm"
        >
          Trade
        </button>
      )}

      {!resolved && !notYetOpen && !isHalted && !isGuest && showTrade && (
        <div className="space-y-3">
          {/* Outcome selector */}
          <div className="grid grid-cols-2 gap-2">
            {outcomes.map((o, i) => {
              const colors = getOutcomeColor(i, colorBlindMode);
              return (
                <button
                  key={o}
                  onClick={() => setSelected(i)}
                  className={`py-2 px-2 text-sm font-semibold rounded-sm border-2 transition-all truncate ${
                    selected === i
                      ? `${colors.bg} border-transparent text-white`
                      : `${colors.border} ${colors.text} hover:opacity-80`
                  }`}
                >
                  {o} · {Math.round(prices(i) * 100)}¢
                </button>
              );
            })}
          </div>

          {/* Buy / Sell toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('buy')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${mode === 'buy' ? 'bg-orange-600 text-white' : chipClass}`}
            >
              Buy
            </button>
            <button
              onClick={() => setMode('sell')}
              disabled={ownedSelected <= 0}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm disabled:opacity-40 ${mode === 'sell' ? 'bg-orange-600 text-white' : chipClass}`}
            >
              Sell
            </button>
          </div>

          {/* Shares input */}
          <div>
            <div className={`text-xs ${mutedClass} mb-1`}>Shares</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShares((s) => Math.max(0, (Number(s) || 0) - shareStep))}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${chipClass} light:hover:bg-slate-300 dark:hover:bg-zinc-700`}
              >
                -{shareStep}
              </button>
              <button
                type="button"
                onClick={() => setShares((s) => Math.min(currentMax, (Number(s) || 0) + shareStep))}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${chipClass} light:hover:bg-slate-300 dark:hover:bg-zinc-700`}
              >
                +{shareStep}
              </button>
              <button
                type="button"
                onClick={() => setShares(currentMax)}
                disabled={!(currentMax > 0)}
                className="flex-1 py-1.5 text-xs font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-40"
              >
                Max
              </button>
            </div>
            <input
              type="number"
              min="0"
              value={shares || ''}
              onChange={(e) => setShares(e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full mt-2 px-3 py-2 text-sm rounded-sm border light:bg-white light:border-amber-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100"
              placeholder="Custom amount..."
            />
            {mode === 'sell' && (
              <div className={`text-xs ${mutedClass} mt-1`}>
                You own {ownedSelected} {selectedOutcome} shares
              </div>
            )}
          </div>

          {qty > 0 && (
            <div className={`text-sm ${mutedClass}`}>
              {mode === 'buy' ? 'Cost' : 'You receive'}:{' '}
              <span className="text-orange-500 font-semibold">{formatCurrency(preview)}</span>
            </div>
          )}

          {mode === 'buy' &&
            (noInvestment ? (
              <div className="text-xs text-red-500">Invest in stocks before buying prediction shares.</div>
            ) : (
              <div className={`text-xs ${exceedsCap ? 'text-red-500' : mutedClass}`}>
                Limit left: <span className="font-semibold">{formatCurrency(eventRoom)}</span> · capped at what you've
                invested in stocks
              </div>
            ))}

          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowTrade(false);
                setShares(10);
              }}
              disabled={submitting}
              className={`flex-1 py-2 text-sm font-semibold rounded-sm disabled:opacity-50 ${chipClass}`}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit || submitting}
              className="flex-1 py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50"
            >
              {submitting ? 'Processing...' : mode === 'buy' ? 'Buy' : 'Sell'}
            </button>
          </div>
        </div>
      )}

      {isAdmin && resolved && onHide && (
        <button
          onClick={() => onHide(market.id)}
          className="w-full mt-2 py-1 text-xs rounded-sm light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          Hide from feed
        </button>
      )}
    </div>
  );
};

export default EventMarketCard;
