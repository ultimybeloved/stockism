import { useState } from 'react';
import { SHORT_MARGIN_REQUIREMENT, MAX_TRADES_PER_TICKER_24H } from '../../constants';
import { formatCurrency } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';
import { getDynamicPrices, getMaxShares, getTradeCount } from '../../utils/tradeLimits';
import { createLimitOrderFunction } from '../../firebase';
import MarginImpactPreview from '../trading/MarginImpactPreview';
import TradeAmountInput from '../trading/TradeAmountInput';
import LimitOrderControls from '../trading/LimitOrderControls';
import { isWeeklyHalt, getMarketClosedState } from '../../utils/marketHours';
import { useAppContext } from '../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const TradeActionModal = ({ character, action, price, holdings, shortPosition, userCash, onTrade, onClose, defaultToLimitOrder = false, haltInfo }) => {
  useEscapeKey(onClose);
  const { darkMode, userData, prices, priceHistory, showNotification, marketData } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [amount, setAmount] = useState(1);
  const [partialShares, setPartialShares] = useState(false);
  const [isLimitOrder, setIsLimitOrder] = useState(defaultToLimitOrder === 'limit' || defaultToLimitOrder === true);
  const [isStopLoss, setIsStopLoss] = useState(defaultToLimitOrder === 'stopLoss');
  const [limitPrice, setLimitPrice] = useState((price || 0).toFixed(2));
  const [allowPartialFills, setAllowPartialFills] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { textClass, mutedClass, overlayClass, modalShellClass } = getThemeClasses(darkMode);

  // Color blind friendly colors for price indicators (bid/ask displays)
  const getColors = (isPositive) => {
    if (colorBlindMode) {
      return isPositive
        ? { text: 'text-teal-400', bg: 'bg-teal-600', bgHover: 'hover:bg-teal-700' }
        : { text: 'text-purple-400', bg: 'bg-purple-600', bgHover: 'hover:bg-purple-700' };
    } else {
      return isPositive
        ? { text: 'text-green-400', bg: 'bg-green-600', bgHover: 'hover:bg-green-700' }
        : { text: 'text-red-400', bg: 'bg-red-600', bgHover: 'hover:bg-red-700' };
    }
  };

  const maxSharesFractional = getMaxShares({ action, character, price, holdings, shortPosition, userCash, userData, prices, priceHistory });
  const maxSharesWhole = Math.floor(maxSharesFractional);
  // Active margin lock on this ticker (for the sell-side note below).
  const _mLock = userData?.marginLockup?.[character.ticker];
  const marginLockedShares = _mLock && Date.now() < (_mLock.until || 0) ? (_mLock.shares || 0) : 0;
  const marginLockHours = marginLockedShares > 0 ? Math.max(1, Math.ceil((_mLock.until - Date.now()) / 3600000)) : 0;
  // Selling/covering: always allow full fractional position — prevents getting stuck
  // with unsellable dust shares when partial toggle is off.
  const maxShares = (partialShares || action === 'sell' || action === 'cover')
    ? maxSharesFractional
    : maxSharesWhole;
  const { bid, ask, spread } = getDynamicPrices(character, price, amount || 1, action, userData);

  const getActionConfig = () => {
    const buyColors = getColors(true);   // Buy colors (green/teal)
    const sellColors = getColors(false); // Sell colors (red/purple)

    switch (action) {
      case 'buy':
        return {
          title: 'Buy',
          colors: buyColors,
          buttonStyle: 'solid',
          price: ask,
          total: ask * (amount || 1),
          label: 'Cost',
          disabled: maxShares === 0
        };
      case 'sell':
        return {
          title: 'Sell',
          colors: sellColors,
          buttonStyle: 'solid',
          price: bid,
          total: bid * (amount || 1),
          label: 'Revenue',
          disabled: holdings < (amount || 1)
        };
      case 'short':
        return {
          title: 'Short',
          colors: {
            text: 'text-orange-400',
            border: 'border-orange-500',
            bg: darkMode ? 'hover:bg-orange-900/30' : 'hover:bg-orange-50'
          },
          buttonStyle: 'outline',
          price: bid,
          total: bid * (amount || 1) * SHORT_MARGIN_REQUIREMENT,
          label: 'Margin Required',
          disabled: maxShares === 0
        };
      case 'cover': {
        const isV2 = shortPosition?.system === 'v2';
        const coverShares = amount || 1;
        let coverTotal;
        let coverLabel;
        if (isV2 && shortPosition) {
          // v2: show estimated return (margin back + P&L)
          const costBasis = shortPosition.costBasis || shortPosition.entryPrice || 0;
          const totalMargin = shortPosition.margin || 0;
          const marginBack = shortPosition.shares > 0 ? (totalMargin / shortPosition.shares) * coverShares : 0;
          const profit = (costBasis - ask) * coverShares;
          coverTotal = marginBack + profit;
          coverLabel = 'Est. Return';
        } else {
          coverTotal = ask * coverShares;
          coverLabel = 'Cost to Cover';
        }
        return {
          title: 'Cover Short',
          colors: {
            text: 'text-blue-400',
            border: 'border-blue-500',
            bg: darkMode ? 'hover:bg-blue-900/30' : 'hover:bg-blue-50'
          },
          buttonStyle: 'outline',
          price: ask,
          total: coverTotal,
          label: coverLabel,
          disabled: !shortPosition || shortPosition.shares < (amount || 1)
        };
      }
      default:
        return { title: '', colors: { text: 'text-gray-400', bg: 'bg-gray-600', bgHover: 'hover:bg-gray-700' }, buttonStyle: 'solid', price: 0, total: 0, label: '', disabled: true };
    }
  };

  const config = getActionConfig();

  const isHalted = haltInfo && haltInfo.resumeAt && Date.now() < haltInfo.resumeAt;
  const marketClosed = getMarketClosedState(marketData).closed;
  const tradeCount = getTradeCount(userData, character.ticker, action);

  const handleSubmit = async () => {
    const minAmount = (partialShares || action === 'sell' || action === 'cover') ? 0.01 : 1;
    if (config.disabled || amount < minAmount || amount > maxShares || submitting) return;

    if (isHalted) {
      showNotification('error', `$${character.ticker} trading is halted (circuit breaker). Please wait.`);
      return;
    }

    if (isLimitOrder || isStopLoss) {
      // Block limit order creation during trading halt
      if (isWeeklyHalt()) {
        showNotification('error', 'Market is closed for chapter review. Orders cannot be created during trading halt.');
        return;
      }

      // Handle limit order / stop loss creation
      const priceNum = parseFloat(limitPrice);
      if (isNaN(priceNum) || priceNum <= 0) {
        showNotification('error', `Please enter a valid ${isStopLoss ? 'stop' : 'limit'} price`);
        return;
      }

      if (priceNum > price * 10) {
        showNotification('error', `${isStopLoss ? 'Stop' : 'Limit'} price cannot exceed 10x current price`);
        return;
      }

      const orderType = isStopLoss ? 'STOP_LOSS' : action.toUpperCase();

      setSubmitting(true);
      try {
        await createLimitOrderFunction({
          ticker: character.ticker,
          type: orderType,
          shares: Math.round(parseFloat(amount) * 100) / 100,
          limitPrice: priceNum,
          allowPartialFills
        });

        showNotification('success', `${isStopLoss ? 'Stop loss' : 'Limit order'} created! View your orders in Portfolio.`);
        onClose();
      } catch (error) {
        console.error('Error creating order:', error);
        showNotification('error', `Failed to create order: ${error.message}`);
      } finally {
        setSubmitting(false);
      }
    } else {
      // Handle immediate trade
      onTrade(character.ticker, action, amount);
      onClose();
    }
  };

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div className={`${modalShellClass} p-4 max-w-md`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className={`text-lg font-bold ${textClass}`}>{config.title} ${character.ticker}</h3>
            <p className={`text-sm ${mutedClass}`}>{character.name}</p>
          </div>
          <button onClick={onClose} className={`${mutedClass} hover:text-orange-500`}>✕</button>
        </div>

        {/* Price info */}
        <div className={`p-3 rounded-sm mb-4 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
          <div className="flex justify-between items-center text-sm mb-2">
            <span className={mutedClass}>Market Price</span>
            <span className={`font-bold ${textClass}`}>{formatCurrency(price)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <div>
              <div className={mutedClass}>Bid</div>
              <div className={`${getColors(false).text} font-semibold`}>{formatCurrency(bid)}</div>
            </div>
            <div className="text-center">
              <div className={mutedClass}>Spread</div>
              <div className={mutedClass}>{(price > 0 ? (spread / price * 100) : 0).toFixed(2)}%</div>
            </div>
            <div className="text-right">
              <div className={mutedClass}>Ask</div>
              <div className={`${getColors(true).text} font-semibold`}>{formatCurrency(ask)}</div>
            </div>
          </div>
        </div>

        <TradeAmountInput
          action={action}
          amount={amount} setAmount={setAmount}
          partialShares={partialShares} setPartialShares={setPartialShares}
          maxShares={maxShares}
          marginLockedShares={marginLockedShares}
          marginLockHours={marginLockHours}
        />

        {/* Limit / stop-loss options (only for buy/sell — short/cover not supported) */}
        {(action === 'buy' || action === 'sell') && (
          <LimitOrderControls
            action={action}
            price={price}
            isLimitOrder={isLimitOrder} setIsLimitOrder={setIsLimitOrder}
            isStopLoss={isStopLoss} setIsStopLoss={setIsStopLoss}
            limitPrice={limitPrice} setLimitPrice={setLimitPrice}
            allowPartialFills={allowPartialFills} setAllowPartialFills={setAllowPartialFills}
          />
        )}

        {/* Total (only show for immediate trades) */}
        {!isLimitOrder && !isStopLoss && (
          <div className={`p-3 rounded-sm mb-4 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
            <div className="flex justify-between items-center">
              <span className={`text-sm ${mutedClass}`}>{config.label}</span>
              <span className={`text-lg font-bold ${config.colors.text}`}>
                {formatCurrency(config.total)}
              </span>
            </div>
          </div>
        )}

        {/* Margin usage preview (immediate buys that dip into borrowed money) */}
        {action === 'buy' && !isLimitOrder && !isStopLoss && (
          <MarginImpactPreview cost={config.total} userCash={userCash} />
        )}

        {/* Trade count warnings (rolling 24h per-ticker cap) */}
        {tradeCount >= MAX_TRADES_PER_TICKER_24H ? (
          <div className="mb-3 p-2 rounded-sm bg-red-900/40 border border-red-500/50 text-red-300 text-xs font-semibold text-center">
            Daily trading limit reached for ${character.ticker} ({tradeCount}/{MAX_TRADES_PER_TICKER_24H} {action}s used)
          </div>
        ) : tradeCount >= 7 ? (
          <div className="mb-3 p-2 rounded-sm bg-yellow-900/30 border border-yellow-500/40 text-yellow-400 text-xs text-center">
            {tradeCount}/{MAX_TRADES_PER_TICKER_24H} {action}s used on ${character.ticker} (rolling 24h)
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={marketClosed || config.disabled || amount < ((partialShares || action === 'sell' || action === 'cover') ? 0.01 : 1) || amount > maxShares || submitting || ((isLimitOrder || isStopLoss) && (!limitPrice || parseFloat(limitPrice) <= 0))}
            className={`flex-1 py-3 text-sm font-semibold uppercase rounded-sm ${
              config.buttonStyle === 'outline'
                ? `border-2 ${config.colors.border} ${config.colors.text} ${config.colors.bg}`
                : `${config.colors.bg} ${config.colors.bgHover} text-white`
            } disabled:opacity-50`}
          >
            {marketClosed ? 'Market Closed' : submitting ? 'Creating...' : isStopLoss ? 'Create Stop Loss' : isLimitOrder ? `Create Limit ${config.title}` : config.title}
          </button>
          <button
            onClick={onClose}
            className={`px-4 py-3 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradeActionModal;
