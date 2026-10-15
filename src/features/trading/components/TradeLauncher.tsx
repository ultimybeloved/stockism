// Opens the right order form for one stock and action, reading the player's
// position and the price from context. Used wherever a trade starts outside a
// character card: the market list, the long-press menu, the desktop stock
// panel, the stock page and limit-order requests from the portfolio.
//
// During the pre-market window a plain buy or sell goes to the opening auction
// form instead, the same as on a card.
import TradeActionModal, { type OrderFormMode } from './TradeActionModal';
import PreMarketModal from './PreMarketModal';
import { useSession, useMarket } from '../../../context/AppContext';
import { isPreMarketWindow } from '../../../utils/marketHours';
import type { Character } from '../../../characters';
import type { TradeAction } from '../../../types';

interface TradeLauncherProps {
  character: Character;
  action: TradeAction;
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  onClose: () => void;
  /** Open on the limit or stop-loss form. */
  orderMode?: OrderFormMode;
}

const TradeLauncher = ({ character, action, onTrade, onClose, orderMode = false }: TradeLauncherProps) => {
  const { userData } = useSession();
  const { prices, priceHistory, marketData } = useMarket();
  const ticker = character.ticker;
  const price = priceHistory[ticker]?.at(-1)?.price ?? (prices[ticker] || character.basePrice);
  const holdings = userData?.holdings?.[ticker] || 0;
  const userCash = userData?.cash || 0;

  if (!orderMode && (action === 'buy' || action === 'sell') && isPreMarketWindow()) {
    return (
      <PreMarketModal
        character={character}
        price={price}
        holdings={holdings}
        userCash={userCash}
        initialAction={action}
        onClose={onClose}
      />
    );
  }
  return (
    <TradeActionModal
      character={character}
      action={action}
      price={price}
      holdings={holdings}
      shortPosition={userData?.shorts?.[ticker]}
      userCash={userCash}
      onTrade={onTrade}
      onClose={onClose}
      defaultToLimitOrder={orderMode}
      haltInfo={marketData?.haltedTickers?.[ticker]}
    />
  );
};

export default TradeLauncher;
