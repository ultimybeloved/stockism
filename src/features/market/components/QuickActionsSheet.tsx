// Phones: press and hold a stock to get its actions as big buttons, instead of
// hunting for the small star and bell on the card.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SheetHandle from '../../../shared/components/SheetHandle';
import TradeLauncher from '../../trading/components/TradeLauncher';
import { useSheetRef } from '../../../shared/hooks/useSwipeToClose';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { useSession, useMarket } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { getMarketClosedState } from '../../../utils/marketHours';
import { getWatchlists } from '../utils/watchlists';
import type { Character } from '../../../characters';
import type { TradeAction } from '../../../types';

interface QuickActionsSheetProps {
  character: Character;
  onClose: () => void;
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  onViewChart: (character: Character, timeRange: string) => void;
  onToggleWatchlist?: (ticker: string) => void;
  onSetAlert?: (ticker: string) => void;
}

const QuickActionsSheet = ({
  character,
  onClose,
  onTrade,
  onViewChart,
  onToggleWatchlist,
  onSetAlert,
}: QuickActionsSheetProps) => {
  const navigate = useNavigate();
  const { user, userData, getColorBlindColors } = useSession();
  const { prices, marketData } = useMarket();
  const [action, setAction] = useState<TradeAction | null>(null);
  const sheetRef = useSheetRef(onClose);
  useEscapeKey(onClose, !action);
  const { sheetOverlayClass, sheetShellClass, textClass, mutedClass, ghostBtnClass } = themeClasses;

  const ticker = character.ticker;
  const held = userData?.holdings?.[ticker] || 0;
  const shorted = (userData?.shorts?.[ticker]?.shares || 0) > 0;
  const watched = (userData?.watchlist || []).includes(ticker);
  const manyLists = getWatchlists(userData).length > 1;
  const halted = Date.now() < (marketData?.haltedTickers?.[ticker]?.resumeAt ?? 0);
  const canTrade = !!user && !halted && !getMarketClosedState(marketData).closed;

  if (action) {
    return <TradeLauncher character={character} action={action} onTrade={onTrade} onClose={onClose} />;
  }

  const tradeBtn = (a: TradeAction, label: string, cls: string, enabled: boolean) => (
    <button
      type="button"
      disabled={!canTrade || !enabled}
      onClick={() => setAction(a)}
      className={`py-3 text-sm font-semibold uppercase rounded-sm disabled:opacity-40 ${cls}`}
    >
      {label}
    </button>
  );
  const plainBtn = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={`py-3 text-sm font-semibold rounded-sm border ${ghostBtnClass}`}>
      {label}
    </button>
  );

  return (
    <div className={`${sheetOverlayClass} z-50`} onClick={onClose}>
      <div ref={sheetRef} className={`${sheetShellClass} p-4 md:max-w-sm`} onClick={(e) => e.stopPropagation()}>
        <SheetHandle />
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-orange-500 font-mono text-lg font-bold">${ticker}</h3>
            <p className={`text-sm ${mutedClass}`}>{character.name}</p>
          </div>
          <span className={`text-lg font-bold ${textClass}`}>
            {formatCurrency(prices[ticker] || character.basePrice)}
          </span>
        </div>
        {user && (
          <div className="grid grid-cols-2 gap-2 mb-2">
            {tradeBtn('buy', 'Buy', `${getColorBlindColors(true).bg} text-white`, true)}
            {tradeBtn('sell', 'Sell', `${getColorBlindColors(false).bg} text-white`, held > 0)}
            {tradeBtn('short', 'Short', 'border-2 border-orange-500 text-orange-500', true)}
            {tradeBtn('cover', 'Cover', 'border-2 border-blue-500 text-blue-500', shorted)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {plainBtn('Chart', () => {
            onClose();
            onViewChart(character, '7d');
          })}
          {plainBtn('Details', () => {
            onClose();
            navigate(`/stock/${ticker}`);
          })}
          {user &&
            onToggleWatchlist &&
            plainBtn(manyLists ? `${watched ? '★' : '☆'} Save to list` : watched ? '★ Unwatch' : '☆ Watch', () => {
              onToggleWatchlist(ticker);
              onClose();
            })}
          {user &&
            onSetAlert &&
            plainBtn('Price alert', () => {
              onClose();
              onSetAlert(ticker);
            })}
        </div>
      </div>
    </div>
  );
};

export default QuickActionsSheet;
