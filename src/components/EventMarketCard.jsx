import React, { useState, useEffect } from 'react';
import { getThemeClasses } from '../utils/theme';
import { formatCurrency } from '../utils/formatters';
import { useAppContext } from '../context/AppContext';
import { lmsrPrices, lmsrBuyCost, lmsrSellRefund, getTotalInvested } from '../utils/calculations';
import { formatCountdown } from '../utils/marketHours';
import { EVENT_AMM_LIQUIDITY } from '../constants/economy';

// Long-term event-share market card. Each outcome is a share that pays $1 if it
// is the confirmed result. Prices come from the house AMM (LMSR) and players can
// buy or sell any time, except when the market is frozen during chapter review.
const EventMarketCard = ({ market, position, onBuy, onSell, isGuest, isHalted = false, isAdmin = false, onHide }) => {
  const { darkMode, userData } = useAppContext();
  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

  const colorBlindMode = userData?.colorBlindMode || false;
  const outcomeColors = [
    colorBlindMode
      ? { border: 'border-teal-600', text: 'text-teal-500', fill: 'bg-teal-500', bg: 'bg-teal-600' }
      : { border: 'border-green-600', text: 'text-green-500', fill: 'bg-green-500', bg: 'bg-green-600' },
    colorBlindMode
      ? { border: 'border-purple-600', text: 'text-purple-500', fill: 'bg-purple-500', bg: 'bg-purple-600' }
      : { border: 'border-red-600', text: 'text-red-500', fill: 'bg-red-500', bg: 'bg-red-600' },
    { border: 'border-blue-600', text: 'text-blue-500', fill: 'bg-blue-500', bg: 'bg-blue-600' },
    { border: 'border-amber-600', text: 'text-amber-500', fill: 'bg-amber-500', bg: 'bg-amber-600' },
    { border: 'border-cyan-600', text: 'text-cyan-500', fill: 'bg-cyan-500', bg: 'bg-cyan-600' },
    { border: 'border-violet-600', text: 'text-violet-500', fill: 'bg-violet-500', bg: 'bg-violet-600' },
  ];

  const outcomes = market.outcomes || ['Yes', 'No'];
  const b = market.b || EVENT_AMM_LIQUIDITY;
  const q = (Array.isArray(market.q) && market.q.length === outcomes.length)
    ? market.q
    : outcomes.map(() => 0);
  const prices = lmsrPrices(q, b);

  const resolved = !!market.resolved;
  const winning = market.outcome;

  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState('buy');
  const [shares, setShares] = useState(10);
  const [showTrade, setShowTrade] = useState(false);

  // Announced-but-locked window: visible with a countdown, no trading until opensAt.
  const [nowTs, setNowTs] = useState(Date.now());
  const notYetOpen = !resolved && !!market.opensAt && nowTs < market.opensAt;
  useEffect(() => {
    if (!notYetOpen) return undefined;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [notYetOpen]);

  const ownedFor = (o) => (position?.shares?.[o]) || 0;
  const positionValue = outcomes.reduce((sum, o, i) => sum + ownedFor(o) * prices[i], 0);
  const hasPosition = outcomes.some(o => ownedFor(o) > 0);

  // Long-term markets are capped at what the user has invested in stocks (same
  // rule as weekly bets and ladder deposits), enforced on the server. Mirror it
  // here so the limit shows instead of bouncing off a server error. Only
  // unsettled positions count, matching the backend.
  const totalInvested = getTotalInvested(userData?.holdings, userData?.costBasis, userData?.shorts);
  const activeEventCost = Object.values(userData?.eventPositions || {}).reduce(
    (sum, p) => sum + (p && !p.settled ? (p.costBasis || 0) : 0), 0
  );
  const eventRoom = Math.max(0, totalInvested - activeEventCost);
  const noInvestment = totalInvested <= 0;

  const qty = Number(shares) || 0;
  const ownedSelected = ownedFor(outcomes[selected]);
  const preview = qty > 0
    ? (mode === 'buy' ? lmsrBuyCost(q, b, selected, qty) : lmsrSellRefund(q, b, selected, qty))
    : 0;
  const exceedsCap = mode === 'buy' && qty > 0 && preview > eventRoom + 1e-9;
  const canSubmit = qty > 0
    && (mode === 'buy' ? (!noInvestment && !exceedsCap) : qty <= ownedSelected);

  const submit = () => {
    if (!canSubmit) return;
    if (mode === 'buy') onBuy(market.id, outcomes[selected], qty);
    else onSell(market.id, outcomes[selected], qty);
    setShowTrade(false);
    setShares(10);
  };

  return (
    <div className={`${cardClass} border rounded-sm p-4`}>
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔮</span>
          <span className={`text-xs font-semibold uppercase ${resolved ? 'text-amber-500' : notYetOpen ? 'text-blue-500' : isHalted ? 'text-red-500' : 'text-orange-500'}`}>
            {resolved ? 'Resolved' : notYetOpen ? 'Coming Soon' : isHalted ? 'Closed' : 'Long-Term'}
          </span>
        </div>
        {!resolved && (
          <span className={`text-xs ${mutedClass}`}>Settles when confirmed</span>
        )}
      </div>

      <h3 className={`font-semibold mb-3 ${textClass}`}>{market.question}</h3>

      {/* Outcome prices */}
      {!notYetOpen && (
      <div className="space-y-2 mb-3">
        {outcomes.map((o, i) => {
          const colors = outcomeColors[i % outcomeColors.length];
          const isWinner = resolved && o === winning;
          return (
            <div key={o} className="flex items-center gap-2">
              <div className={`w-28 sm:w-36 text-xs font-semibold ${colors.text} ${isWinner ? 'underline' : ''}`} title={o}>
                {o} {isWinner && '✓'}
              </div>
              <div className="flex-1 h-4 bg-zinc-800 rounded-sm overflow-hidden">
                <div className={`h-full ${colors.fill} transition-all`} style={{ width: `${Math.round(prices[i] * 100)}%` }} />
              </div>
              <div className={`w-10 text-xs text-right ${mutedClass}`}>{Math.round(prices[i] * 100)}¢</div>
            </div>
          );
        })}
      </div>
      )}

      {/* Your position */}
      {!notYetOpen && hasPosition && (
        <div className={`mb-3 p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
          <div className={`text-xs ${mutedClass} mb-1`}>Your shares</div>
          {outcomes.map((o, i) => ownedFor(o) > 0 && (
            <div key={o} className="flex justify-between text-xs">
              <span className={outcomeColors[i % outcomeColors.length].text}>{ownedFor(o)} × {o}</span>
              {resolved
                ? <span className={mutedClass}>{o === winning ? `Won ${formatCurrency(ownedFor(o))}` : 'Expired'}</span>
                : <span className={mutedClass}>{formatCurrency(ownedFor(o) * prices[i])}</span>}
            </div>
          ))}
          {!resolved && (
            <div className={`text-xs mt-1 ${mutedClass}`}>
              Position value: <span className="text-orange-500 font-semibold">{formatCurrency(positionValue)}</span>
            </div>
          )}
        </div>
      )}

      {/* Resolved banner */}
      {resolved && (
        <div className={`text-center py-2 rounded-sm ${outcomeColors[Math.max(0, outcomes.indexOf(winning)) % outcomeColors.length].bg} bg-opacity-20`}>
          <span className={`font-semibold ${outcomeColors[Math.max(0, outcomes.indexOf(winning)) % outcomeColors.length].text}`}>
            Outcome: {winning}
          </span>
        </div>
      )}

      {/* Trade panel */}
      {!resolved && notYetOpen && (
        <div className={`text-center py-2 text-sm ${mutedClass} bg-zinc-800/50 rounded-sm`}>
          🔒 Opens in {formatCountdown(market.opensAt - nowTs)}
        </div>
      )}

      {!resolved && !notYetOpen && isHalted && (
        <div className={`text-center py-2 text-sm ${mutedClass} bg-zinc-800/50 rounded-sm`}>
          🔒 Closed for chapter review. Trading reopens at 21:00 UTC.
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
              const colors = outcomeColors[i % outcomeColors.length];
              return (
                <button
                  key={o}
                  onClick={() => setSelected(i)}
                  className={`py-2 px-2 text-sm font-semibold rounded-sm border-2 transition-all truncate ${
                    selected === i ? `${colors.bg} border-transparent text-white` : `${colors.border} ${colors.text} hover:opacity-80`
                  }`}
                >
                  {o} · {Math.round(prices[i] * 100)}¢
                </button>
              );
            })}
          </div>

          {/* Buy / Sell toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('buy')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${mode === 'buy' ? 'bg-orange-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
            >
              Buy
            </button>
            <button
              onClick={() => setMode('sell')}
              disabled={ownedSelected <= 0}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm disabled:opacity-40 ${mode === 'sell' ? 'bg-orange-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
            >
              Sell
            </button>
          </div>

          {/* Shares input */}
          <div>
            <div className={`text-xs ${mutedClass} mb-1`}>Shares</div>
            <div className="flex gap-2">
              {[5, 10, 25, 50].map(n => (
                <button
                  key={n}
                  onClick={() => setShares(n)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${shares === n ? 'bg-orange-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="0"
              value={shares || ''}
              onChange={(e) => setShares(e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0))}
              className={`w-full mt-2 px-3 py-2 text-sm rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'}`}
              placeholder="Custom amount..."
            />
            {mode === 'sell' && (
              <div className={`text-xs ${mutedClass} mt-1`}>You own {ownedSelected} {outcomes[selected]} shares</div>
            )}
          </div>

          {qty > 0 && (
            <div className={`text-sm ${mutedClass}`}>
              {mode === 'buy' ? 'Cost' : 'You receive'}:{' '}
              <span className="text-orange-500 font-semibold">{formatCurrency(preview)}</span>
            </div>
          )}

          {mode === 'buy' && (noInvestment ? (
            <div className="text-xs text-red-500">Invest in stocks before buying prediction shares.</div>
          ) : (
            <div className={`text-xs ${exceedsCap ? 'text-red-500' : mutedClass}`}>
              Limit left: <span className="font-semibold">{formatCurrency(eventRoom)}</span> · capped at what you've invested in stocks
            </div>
          ))}

          <div className="flex gap-2">
            <button
              onClick={() => { setShowTrade(false); setShares(10); }}
              className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="flex-1 py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50"
            >
              {mode === 'buy' ? 'Buy' : 'Sell'}
            </button>
          </div>
        </div>
      )}

      {isAdmin && resolved && onHide && (
        <button
          onClick={() => onHide(market.id)}
          className={`w-full mt-2 py-1 text-xs rounded-sm ${darkMode ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'}`}
        >
          Hide from feed
        </button>
      )}
    </div>
  );
};

export default EventMarketCard;
