import { useNavigate } from 'react-router-dom';
import CheckInButton from '../../missions/components/CheckInButton';
import { useSession, useMarket } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { CHARACTER_MAP } from '../../../characters';
import { calculateMarginStatus } from '../../../utils/calculations';
import { streakSaverActive } from '../../../rules/economy';
import type { UserData } from '../../../types';

interface YouCardProps {
  activeUserData: UserData;
  portfolioValue: number;
  isGuest: boolean;
  checkinLoading: boolean;
  onCheckin: () => void;
  onShowLogin: () => void;
  onShowPortfolio: () => void;
  onShowBailout: () => void;
}

const HOLDINGS_SHOWN = 4;

/**
 * The player's corner of the home page in one card: portfolio value and its
 * change, cash (and margin), the daily check-in, and the biggest holdings as
 * chips that open their stock.
 */
const YouCard = ({
  activeUserData,
  portfolioValue,
  isGuest,
  checkinLoading,
  onCheckin,
  onShowLogin,
  onShowPortfolio,
  onShowBailout,
}: YouCardProps) => {
  const { userData, getColorBlindColors } = useSession();
  const { prices, priceHistory } = useMarket();
  const { cardClass, mutedClass } = themeClasses;
  const navigate = useNavigate();
  const textClass = 'light:text-zinc-900 dark:text-zinc-100';
  const cash = activeUserData.cash || 0;
  const negative = userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500';

  const dayAgo = activeUserData.portfolioSnapshot24h?.value ?? null;
  const change24h = dayAgo ? portfolioValue - dayAgo : null;
  const monthAgo = activeUserData.portfolioSnapshot30d?.value ?? null;
  const pct30d = monthAgo && monthAgo > 0 ? ((portfolioValue - monthAgo) / monthAgo) * 100 : null;

  const holdings = Object.entries(activeUserData.holdings || {})
    .filter(([, shares]) => shares > 0)
    .map(([ticker, shares]) => {
      const character = CHARACTER_MAP[ticker];
      const price = prices[ticker] || character?.basePrice || 0;
      const avg = activeUserData.costBasis?.[ticker] || character?.basePrice || price;
      return { ticker, shares, value: price * shares, pl: (price - avg) * shares };
    })
    .sort((a, b) => b.value - a.value);
  const margin = activeUserData.marginEnabled ? calculateMarginStatus(activeUserData, prices, priceHistory) : null;

  return (
    <div className={`${cardClass} border rounded-sm p-4 mb-4 ${cash < 0 ? 'border-red-500' : ''}`}>
      <button type="button" onClick={() => !isGuest && onShowPortfolio()} className="w-full text-left group">
        <div className="flex items-center justify-between">
          <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Portfolio value</p>
          {!isGuest && <span className="text-xs text-orange-500 group-hover:underline">Open ›</span>}
        </div>
        <p className={`text-3xl font-bold tabular-nums ${textClass}`}>{formatCurrency(portfolioValue)}</p>
        <p className="text-xs tabular-nums">
          {change24h !== null && dayAgo && (
            <span className={`mr-3 ${getColorBlindColors(change24h >= 0).text}`}>
              {change24h >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(change24h))} (
              {formatChange((change24h / dayAgo) * 100)}) 24h
            </span>
          )}
          {pct30d !== null && (
            <span className={getColorBlindColors(pct30d >= 0).text}>
              {pct30d >= 0 ? '▲' : '▼'} {formatChange(pct30d)} 30d
            </span>
          )}
          {isGuest && <span className={mutedClass}>Your starting cash when you sign up</span>}
        </p>
      </button>

      <div className="mt-3 pt-3 border-t flex items-baseline justify-between light:border-amber-200 dark:border-zinc-800">
        <span className={`text-xs font-semibold uppercase ${mutedClass}`}>Cash</span>
        <span className={`text-lg font-bold tabular-nums ${cash < 0 ? negative : textClass}`}>
          {cash < 0 ? '-' : ''}
          {formatCurrency(Math.abs(cash))}
        </span>
      </div>
      {margin && cash >= 0 && (
        <div className={`text-xs flex justify-between ${mutedClass}`}>
          <span>
            Margin <span className="text-amber-500 font-semibold">{margin.tierName}</span>
          </span>
          <span>
            <span className="text-amber-500 font-semibold">{formatCurrency(margin.availableMargin)}</span> available
            {(activeUserData.marginUsed || 0) > 0 && (
              <span className="text-orange-500"> · {formatCurrency(activeUserData.marginUsed)} owed</span>
            )}
          </span>
        </div>
      )}
      {cash < 0 && !activeUserData.isBankrupt && (
        <p className="mt-1 text-xs text-amber-500">Sell or close a position to clear this.</p>
      )}
      {activeUserData.isBankrupt && (
        <button
          onClick={onShowBailout}
          className={`mt-2 w-full py-1.5 text-xs font-semibold rounded-sm text-white ${userData?.colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'}`}
        >
          Wiped out: request a bailout
        </button>
      )}

      <CheckInButton
        isGuest={isGuest}
        lastCheckin={userData?.lastCheckin}
        checkinStreak={userData?.checkinStreak || 0}
        streakSaver={streakSaverActive(userData)}
        onCheckin={onCheckin}
        onSignIn={onShowLogin}
        loading={checkinLoading}
      />

      {holdings.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {holdings.slice(0, HOLDINGS_SHOWN).map((h) => (
            <button
              key={h.ticker}
              onClick={() => navigate(`/stock/${h.ticker}`)}
              className="px-2 py-1 rounded-sm border text-xs tabular-nums transition-colors light:border-amber-200 light:hover:bg-amber-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <span className={`font-semibold ${textClass}`}>${h.ticker}</span>{' '}
              <span className={getColorBlindColors(h.pl >= 0).text}>
                {h.pl >= 0 ? '+' : '-'}
                {formatCurrency(Math.abs(h.pl))}
              </span>
            </button>
          ))}
          {holdings.length > HOLDINGS_SHOWN && (
            <button onClick={onShowPortfolio} className="px-2 py-1 text-xs text-orange-500 hover:underline">
              +{holdings.length - HOLDINGS_SHOWN} more
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default YouCard;
