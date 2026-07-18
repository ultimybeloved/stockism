import CheckInButton from '../CheckInButton';
import PredictionsTeaser from '../PredictionsTeaser';
import MarketIndex from '../MarketIndex';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { formatCurrency, formatChange } from '../../utils/formatters';
import { CHARACTER_MAP } from '../../characters';
import { calculateMarginStatus } from '../../utils/calculations';

// Right-hand dashboard rail on the home page: cash / portfolio / holdings
// stat cards, predictions teaser, and the market index chart.
const DashboardRail = ({
  activeUserData,
  portfolioValue,
  isGuest,
  checkinLoading,
  onCheckin,
  onShowLogin,
  onShowPortfolio,
  onShowBailout,
}) => {
  const { darkMode, userData, prices, priceHistory, predictions, getColorBlindColors } = useAppContext();
  const { cardClass, mutedClass } = getThemeClasses(darkMode);
  const textClass = darkMode ? 'text-zinc-100' : 'text-zinc-900';

  return (
    <aside className="lg:order-2 lg:w-96 2xl:w-[30rem] lg:shrink-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pl-1">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 gap-4 mb-4">
        <div className={`${cardClass} border rounded-sm p-4 ${(activeUserData.cash || 0) < 0 ? (userData?.colorBlindMode ? 'border-purple-500' : 'border-red-500') : ''}`}>
          <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Cash</p>
          <p className={`text-2xl font-bold ${(activeUserData.cash || 0) < 0 ? (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500') : isGuest ? mutedClass : textClass}`}>
            {(activeUserData.cash || 0) < 0 ? '-' : ''}{formatCurrency(Math.abs(activeUserData.cash || 0))}
          </p>
          {isGuest && (
            <p className={`text-xs ${mutedClass}`}>Your starting cash when you sign up</p>
          )}
          {(activeUserData.cash || 0) < 0 && !activeUserData.isBankrupt && (
            <p className="mt-2 text-xs text-amber-500">
              Sell or close a position to clear this.
            </p>
          )}
          {activeUserData.isBankrupt && (
            <button
              onClick={onShowBailout}
              className={`mt-2 w-full py-1.5 text-xs font-semibold rounded-sm text-white ${userData?.colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              💸 Wiped Out - Request Bailout
            </button>
          )}
          {(activeUserData.cash || 0) >= 0 && activeUserData.marginEnabled && (() => {
            const marginStatus = calculateMarginStatus(activeUserData, prices, priceHistory);
            return (
              <div className="text-xs mt-1 space-y-0.5">
                <div className={mutedClass}>
                  Tier: <span className="text-amber-500 font-semibold">{marginStatus.tierName}</span>
                </div>
                <div className={mutedClass}>
                  Available: <span className="text-amber-500 font-semibold">{formatCurrency(marginStatus.availableMargin)}</span>
                  <span className={mutedClass}> (of {formatCurrency(marginStatus.maxBorrowable)} max)</span>
                </div>
                {activeUserData.marginUsed > 0 && (
                  <div className="text-orange-500">
                    Used: {formatCurrency(activeUserData.marginUsed)} debt • 0.5% daily
                  </div>
                )}
              </div>
            );
          })()}
          <CheckInButton
            isGuest={isGuest}
            lastCheckin={userData?.lastCheckin}
            checkinStreak={userData?.checkinStreak || 0}
            onCheckin={onCheckin}
            onSignIn={onShowLogin}
            darkMode={darkMode}
            loading={checkinLoading}
          />
        </div>
        <div className={`${cardClass} border rounded-sm p-4 cursor-pointer hover:border-orange-600`} onClick={() => !isGuest && onShowPortfolio()}>
          <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Portfolio Value</p>
          <p className={`text-2xl font-bold ${textClass}`}>{formatCurrency(portfolioValue)}</p>
          {(() => {
            const snap24h = activeUserData.portfolioSnapshot24h;
            const value24hAgo = snap24h?.value ?? null;

            const change24h = value24hAgo ? portfolioValue - value24hAgo : 0;
            const changePercent24h = value24hAgo && value24hAgo > 0 ? ((change24h / value24hAgo) * 100) : 0;

            const colors24h = getColorBlindColors(change24h >= 0);

            // Rolling 30-day change — far more meaningful than total % since the
            // account started. Uses the approximate 30d reference snapshot.
            const snap30d = activeUserData.portfolioSnapshot30d;
            const value30dAgo = snap30d?.value ?? null;
            const changePercent30d = value30dAgo && value30dAgo > 0 ? (((portfolioValue - value30dAgo) / value30dAgo) * 100) : null;
            const colors30d = getColorBlindColors((changePercent30d ?? 0) >= 0);

            return (
              <>
                {value24hAgo && (
                  <p className={`text-xs ${colors24h.text}`}>
                    {change24h >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(change24h))} ({formatChange(changePercent24h)}) 24h
                  </p>
                )}
                <p className={`text-xs ${changePercent30d != null ? colors30d.text : mutedClass}`}>
                  {changePercent30d != null && (changePercent30d >= 0 ? '▲ ' : '▼ ')}
                  {changePercent30d != null ? `${formatChange(changePercent30d)} 30d` : ''}
                  {!isGuest && <span className="text-orange-500 ml-2">→ View chart</span>}
                </p>
              </>
            );
          })()}
        </div>
        <div className={`${cardClass} border rounded-sm p-4`}>
          <div className="flex justify-between items-start mb-2">
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Holdings</p>
            {!isGuest && (
              <button
                onClick={onShowPortfolio}
                className="text-xs text-orange-500 hover:text-orange-500"
              >
                View All →
              </button>
            )}
          </div>
          {(() => {
            const holdings = activeUserData.holdings || {};
            const costBasis = activeUserData.costBasis || {};
            const holdingsArray = Object.entries(holdings)
              .filter(([_, shares]) => shares > 0)
              .map(([ticker, shares]) => {
                const character = CHARACTER_MAP[ticker];
                const currentPrice = prices[ticker] || character?.basePrice || 0;
                const avgCost = costBasis[ticker] || character?.basePrice || currentPrice;
                const value = currentPrice * shares;
                const totalCost = avgCost * shares;
                const unrealizedPL = value - totalCost;
                return { ticker, shares, value, unrealizedPL, character };
              })
              .sort((a, b) => b.value - a.value);

            const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + h.unrealizedPL, 0);
            const topHoldings = holdingsArray.slice(0, 3);

            if (holdingsArray.length === 0) {
              return (
                <p className={`text-sm ${mutedClass}`}>No holdings yet</p>
              );
            }

            return (
              <div className="space-y-2">
                {topHoldings.map(h => {
                  const plColors = getColorBlindColors(h.unrealizedPL >= 0);
                  return (
                    <div key={h.ticker} className="flex justify-between items-center text-xs">
                      <span className={textClass}>${h.ticker} × {h.shares}</span>
                      <span className={plColors.text}>
                        {h.unrealizedPL >= 0 ? '+' : ''}{formatCurrency(h.unrealizedPL)}
                      </span>
                    </div>
                  );
                })}
                <div className={`pt-2 border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
                  <div className="flex justify-between items-center text-xs">
                    <span className={mutedClass}>Total Unrealized P/L:</span>
                    <span className={`font-bold ${getColorBlindColors(totalUnrealizedPL >= 0).text}`}>
                      {totalUnrealizedPL >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedPL)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs mt-1">
                    <span className={mutedClass}>{holdingsArray.length} position{holdingsArray.length !== 1 ? 's' : ''}</span>
                    <span className={mutedClass}>{Object.values(holdings).reduce((a, b) => a + b, 0)} total shares</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <PredictionsTeaser predictions={predictions} />

      <MarketIndex
        prices={prices}
        priceHistory={priceHistory}
        darkMode={darkMode}
        colorBlindMode={userData?.colorBlindMode}
      />
    </aside>
  );
};

export default DashboardRail;
