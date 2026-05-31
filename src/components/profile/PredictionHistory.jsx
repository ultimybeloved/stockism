import { formatCurrency } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';
import { lmsrPrices } from '../../utils/calculations';
import { EVENT_AMM_LIQUIDITY } from '../../constants/economy';

// Active bets + resolved prediction history (weekly), plus long-term event positions.
const PredictionHistory = ({ userBetHistory = [], userData, darkMode }) => {
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const { predictions } = useAppContext();

  // Calculate potential payout for active bets
  const calculatePotentialPayout = (bet) => {
    if (!bet.prediction || bet.prediction.resolved) return null;

    const pools = bet.prediction.pools || {};
    const totalPool = Object.values(pools).reduce((sum, p) => sum + p, 0);
    const myPool = pools[bet.option] || 0;

    if (myPool === 0) return 0;

    const myShare = bet.amount / myPool;
    return myShare * totalPool;
  };

  const activeBets = userBetHistory.filter(b => b.prediction && !b.prediction.resolved);
  const pastBets = userBetHistory.filter(b => b.prediction?.resolved || b.paid !== undefined);

  // Long-term event-share positions
  const eventPositions = userData?.eventPositions || {};
  const eventEntries = Object.entries(eventPositions).map(([marketId, pos]) => {
    const market = predictions?.find(p => p.id === marketId && p.type === 'event');
    return { marketId, ...pos, market };
  }).filter(e => e.market && e.shares && Object.values(e.shares).some(s => s > 0))
    .sort((a, b) => (a.market?.resolved ? 1 : 0) - (b.market?.resolved ? 1 : 0));

  return (
    <>
      {/* Long-Term Positions */}
      {eventEntries.length > 0 && (
        <div>
          <h3 className={`font-semibold ${textClass} mb-2`}>🔮 Long-Term Positions</h3>
          <div className="space-y-2">
            {eventEntries.map((entry) => {
              const { marketId, market, shares, payout } = entry;
              const outcomes = market.outcomes || [];
              const b = market.b || EVENT_AMM_LIQUIDITY;
              const q = (Array.isArray(market.q) && market.q.length === outcomes.length) ? market.q : outcomes.map(() => 0);
              const prices = lmsrPrices(q, b);
              const liveValue = outcomes.reduce((s, o, i) => s + ((shares[o] || 0) * prices[i]), 0);
              const owned = outcomes.map((o) => ({ o, qty: shares[o] || 0 })).filter(x => x.qty > 0);
              const resolved = market.resolved;
              const won = resolved && payout > 0;
              return (
                <div key={marketId} className={`p-3 rounded-sm border ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                  <p className={`text-sm font-semibold ${textClass}`}>{market.question}</p>
                  <div className="flex justify-between items-center mt-1">
                    <span className={`text-xs ${mutedClass}`}>{owned.map(x => `${x.qty} ${x.o}`).join(', ')}</span>
                    {resolved ? (
                      <span className={`text-xs font-semibold ${won ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400')}`}>
                        {won ? `Won ${formatCurrency(payout)}` : 'Expired'}
                      </span>
                    ) : (
                      <span className={`text-xs ${mutedClass}`}>Value {formatCurrency(liveValue)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active Bets */}
      {activeBets.length > 0 && (
        <div>
          <h3 className={`font-semibold ${textClass} mb-2`}>🔮 Active Bets</h3>
          <div className="space-y-2">
            {activeBets.map(bet => {
              const potentialPayout = calculatePotentialPayout(bet);
              return (
                <div key={bet.predictionId} className={`p-3 rounded-sm border ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                  <p className={`text-sm font-semibold ${textClass}`}>{bet.prediction?.question || bet.question}</p>
                  <div className="flex justify-between items-center mt-2">
                    <div>
                      <span className={`text-xs ${mutedClass}`}>Your bet: </span>
                      <span className="text-orange-500 font-semibold">{formatCurrency(bet.amount)}</span>
                      <span className={`text-xs ${mutedClass}`}> on </span>
                      <span className={`text-sm font-semibold ${textClass}`}>"{bet.option}"</span>
                    </div>
                    {potentialPayout !== null && (
                      <div className="text-right">
                        <p className={`text-xs ${mutedClass}`}>Potential payout</p>
                        <p className={`font-semibold ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{formatCurrency(potentialPayout)}</p>
                      </div>
                    )}
                  </div>
                  {!bet.paid && (
                    <p className={`text-xs ${mutedClass} mt-1`}>⏳ Awaiting results...</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Past Predictions */}
      <div>
        <h3 className={`font-semibold ${textClass} mb-2`}>📜 Past Predictions</h3>
        {pastBets.length === 0 ? (
          <p className={`text-sm ${mutedClass}`}>No past predictions yet.</p>
        ) : (
          <div className="space-y-2">
            {pastBets.map(bet => {
              const won = bet.prediction?.outcome === bet.option;
              const paidOut = bet.paid === true;
              const colorBlindMode = userData?.colorBlindMode || false;
              const winBorderBg = colorBlindMode
                ? (darkMode ? 'border-teal-700 bg-teal-900/20' : 'border-teal-300 bg-teal-50')
                : (darkMode ? 'border-green-700 bg-green-900/20' : 'border-green-300 bg-green-50');
              const loseBorderBg = colorBlindMode
                ? (darkMode ? 'border-purple-700/50 bg-purple-900/10' : 'border-purple-200 bg-purple-50')
                : (darkMode ? 'border-red-700/50 bg-red-900/10' : 'border-red-200 bg-red-50');
              const winText = colorBlindMode ? 'text-teal-500' : 'text-green-500';
              const loseText = colorBlindMode ? 'text-purple-400' : 'text-red-400';

              return (
                <div key={bet.predictionId} className={`p-3 rounded-sm border ${won ? winBorderBg : loseBorderBg}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className={`text-sm font-semibold ${textClass}`}>
                        {bet.prediction?.question || bet.question || 'Past prediction (details unavailable)'}
                      </p>
                      <p className={`text-xs ${mutedClass} mt-1`}>
                        Your answer: <span className={`font-semibold ${won ? winText : loseText}`}>"{bet.option}"</span>
                        {(bet.prediction?.outcome || bet.outcome) && (
                          <span> • Correct answer: <span className="text-orange-500">"{bet.prediction?.outcome || bet.outcome}"</span></span>
                        )}
                      </p>
                    </div>
                    <div className="text-right ml-2">
                      {won ? (
                        <>
                          <p className={`${winText} font-bold`}>✓ Won</p>
                          {bet.payout && <p className={`${winText} text-sm`}>+{formatCurrency(bet.payout)}</p>}
                        </>
                      ) : (
                        <p className={`${loseText} font-semibold`}>✗ Lost</p>
                      )}
                    </div>
                  </div>
                  <div className={`text-xs mt-2 ${mutedClass}`}>
                    Bet: {formatCurrency(bet.amount)}
                    {paidOut ? (
                      <span className={`${winText} ml-2`}>✓ Paid out to winners</span>
                    ) : bet.prediction?.resolved ? (
                      <span className="text-amber-500 ml-2">⏳ Payout pending</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

export default PredictionHistory;
