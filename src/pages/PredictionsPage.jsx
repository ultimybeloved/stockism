import React from 'react';
import { useAppContext } from '../context/AppContext';
import { getThemeClasses } from '../utils/theme';
import { getTotalInvested } from '../utils/calculations';
import { isWeeklyHalt } from '../utils/marketHours';
import PredictionCard from '../components/PredictionCard';
import EventMarketCard from '../components/EventMarketCard';

// Dedicated predictions page. Two sections: long-term event-share markets (the
// new AMM-priced ones) and the weekly cash predictions. Both freeze during the
// chapter-review halt so nobody can trade on an early chapter leak.
const PredictionsPage = ({
  predictions = [],
  isGuest,
  isAdmin,
  onBet,
  onRequestBet,
  onHidePrediction,
  onBuyEventShares,
  onSellEventShares,
}) => {
  const { darkMode, userData, marketData } = useAppContext();
  const { bgClass, textClass, mutedClass } = getThemeClasses(darkMode);

  const isHalted = isWeeklyHalt() || !!marketData?.marketHalted;

  // Coming-soon (announced, not yet open) first, then open, resolved last.
  const rank = (m) => (m.resolved ? 2 : (m.opensAt && Date.now() < m.opensAt ? 0 : 1));
  const byStatus = (arr) => [...arr].sort((a, b) => rank(a) - rank(b));

  const eventMarkets = byStatus(predictions.filter(p => p.type === 'event' && !p.cancelled));
  const weekly = byStatus(
    predictions.filter(p =>
      p.type !== 'event' && !p.hidden && !p.cancelled &&
      (!p.resolved || Date.now() - p.endsAt < 7 * 24 * 60 * 60 * 1000)
    )
  );

  const getUserBet = (id) => userData?.bets?.[id];
  const betLimit = Math.min(
    getTotalInvested(userData?.holdings, userData?.costBasis, userData?.shorts),
    userData?.cash || 0
  );
  const eventPositions = userData?.eventPositions || {};

  return (
    <div className={`min-h-screen ${bgClass} p-4`}>
      <div className="max-w-6xl mx-auto">
        <h1 className={`text-2xl font-bold mb-1 ${textClass}`}>🔮 Predictions</h1>
        <p className={`text-sm mb-6 ${mutedClass}`}>Bet on what happens next in the series.</p>

        {isHalted && (
          <div className={`mb-6 p-3 rounded-sm text-sm ${darkMode ? 'bg-zinc-900 border border-zinc-800 text-zinc-300' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
            🔒 Predictions are closed for chapter review. Trading reopens at 21:00 UTC.
          </div>
        )}

        {/* Long-term event markets */}
        <section className="mb-10">
          <h2 className={`text-sm font-semibold uppercase tracking-wide mb-1 ${mutedClass}`}>Long-Term Markets</h2>
          <p className={`text-xs mb-3 ${mutedClass}`}>
            Buy shares in an outcome. Sell any time before it resolves. Winning shares pay out when the series confirms it.
          </p>
          {eventMarkets.length === 0 ? (
            <p className={`text-sm ${mutedClass}`}>No long-term markets right now. Check back soon.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {eventMarkets.map(m => (
                <EventMarketCard
                  key={m.id}
                  market={m}
                  position={eventPositions[m.id]}
                  onBuy={onBuyEventShares}
                  onSell={onSellEventShares}
                  isGuest={isGuest}
                  isHalted={isHalted}
                />
              ))}
            </div>
          )}
        </section>

        {/* Weekly predictions */}
        <section className="mb-8">
          <h2 className={`text-sm font-semibold uppercase tracking-wide mb-1 ${mutedClass}`}>Weekly Predictions</h2>
          <p className={`text-xs mb-3 ${mutedClass}`}>Cash bets that resolve each week.</p>
          {weekly.length === 0 ? (
            <p className={`text-sm ${mutedClass}`}>No weekly predictions right now.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {weekly.map(p => (
                <PredictionCard
                  key={p.id}
                  prediction={p}
                  userBet={getUserBet(p.id)}
                  onBet={onBet}
                  onRequestBet={onRequestBet}
                  isGuest={isGuest}
                  betLimit={betLimit}
                  isAdmin={isAdmin}
                  onHide={onHidePrediction}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default PredictionsPage;
