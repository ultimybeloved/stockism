import React, { useState, useEffect } from 'react';
import { CHARACTER_MAP } from '../../characters';
import {
  BASE_IMPACT,
  BASE_LIQUIDITY,
  BID_ASK_SPREAD,
  MIN_PRICE,
  SHORT_MARGIN_REQUIREMENT
} from '../../constants';
import { formatCurrency } from '../../utils/formatters';
import { calculatePortfolioValue } from '../../utils/calculations';
import { createLimitOrderFunction } from '../../firebase';
import { isWeeklyHalt } from '../../utils/marketHours';
import { useAppContext } from '../../context/AppContext';

// Helper functions from App.jsx
const calculatePriceImpact = (currentPrice, shares, liquidity = BASE_LIQUIDITY) => {
  const impact = currentPrice * BASE_IMPACT * Math.sqrt(shares / liquidity);
  return impact;
};

const getBidAskPrices = (midPrice) => {
  const halfSpread = midPrice * BID_ASK_SPREAD / 2;
  return {
    bid: midPrice - halfSpread,
    ask: midPrice + halfSpread,
    spread: halfSpread * 2
  };
};

const getCurrentPrice = (ticker, priceHistory, prices) => {
  const history = priceHistory?.[ticker];
  if (history && history.length > 0) {
    return history[history.length - 1].price;
  }
  return prices?.[ticker] || 0;
};

const calculateMarginStatus = (userData, prices, priceHistory = {}) => {
  if (!userData || !userData.marginEnabled) {
    return {
      enabled: false,
      availableMargin: 0
    };
  }

  const cash = userData.cash || 0;
  const marginUsed = userData.marginUsed || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  // Get tier multiplier
  let tierMultiplier = 0.25;
  if (peakPortfolio >= 30000) tierMultiplier = 0.75;
  else if (peakPortfolio >= 15000) tierMultiplier = 0.50;
  else if (peakPortfolio >= 7500) tierMultiplier = 0.35;

  const maxBorrowable = Math.max(0, cash * tierMultiplier);
  const availableMargin = Math.max(0, maxBorrowable - marginUsed);

  return {
    enabled: true,
    availableMargin: Math.round(availableMargin * 100) / 100
  };
};

const TradeActionModal = ({ character, action, price, holdings, shortPosition, userCash, userData, prices, onTrade, onClose, darkMode, priceHistory, colorBlindMode = false, user, defaultToLimitOrder = false }) => {
  const { showNotification } = useAppContext();
  const [amount, setAmount] = useState(1);
  const [isLimitOrder, setIsLimitOrder] = useState(defaultToLimitOrder);
  const [limitPrice, setLimitPrice] = useState(price.toFixed(2));
  const [allowPartialFills, setAllowPartialFills] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

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

  // Calculate dynamic prices
  const getDynamicPrices = (amt, act) => {
    const liquidity = character.liquidity || BASE_LIQUIDITY;
    const impact = calculatePriceImpact(price, amt, liquidity);

    if (act === 'buy' || act === 'cover') {
      const newMid = price + impact;
      return getBidAskPrices(newMid);
    } else {
      const newMid = Math.max(MIN_PRICE, price - impact);
      return getBidAskPrices(newMid);
    }
  };

  // Get buying power
  const getBuyingPower = () => {
    let buyingPower = userCash;
    if (userData && prices) {
      const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
      if (marginStatus.enabled && marginStatus.availableMargin > 0) {
        const maxMarginUsable = Math.min(userCash, marginStatus.availableMargin);
        buyingPower += maxMarginUsable;
      }
    }
    return buyingPower;
  };

  // Calculate max shares for this specific action
  const getMaxShares = () => {
    if (action === 'buy') {
      const buyingPower = getBuyingPower();
      if (buyingPower <= 0) return 0;
      let low = 1, high = Math.floor(buyingPower / (price * 0.5)), maxAffordable = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const { ask } = getDynamicPrices(mid, 'buy');
        const cost = ask * mid;
        if (cost <= buyingPower) {
          maxAffordable = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return Math.max(0, maxAffordable);
    } else if (action === 'sell') {
      return holdings || 0;
    } else if (action === 'short') {
      // Max short is capped by portfolio equity (prevents leverage spiral)
      const portfolioEquity = userData && prices ? calculatePortfolioValue(userData, prices) : userCash;
      if (portfolioEquity <= 0) return 0;

      // Total short margin (existing + new) can't exceed portfolio equity
      const shorts = userData?.shorts || {};
      const existingShortMargin = Object.values(shorts).reduce((sum, pos) =>
        sum + (pos && pos.shares > 0 ? (pos.margin || 0) : 0), 0);
      const availableForShorts = Math.max(0, portfolioEquity - existingShortMargin);
      if (availableForShorts <= 0) return 0;

      const marginPerShare = price * SHORT_MARGIN_REQUIREMENT;
      const maxByEquity = Math.floor(availableForShorts / marginPerShare);
      // v2: must also have enough cash for the margin deposit
      const maxByCash = marginPerShare > 0 ? Math.floor(userCash / marginPerShare) : 0;
      const maxAffordable = Math.min(maxByEquity, maxByCash);
      return Math.max(0, Math.min(maxAffordable, 10000));
    } else if (action === 'cover') {
      return shortPosition?.shares || 0;
    }
    return 1;
  };

  const maxShares = getMaxShares();
  const { bid, ask, spread } = getDynamicPrices(amount || 1, action);

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

  const handleSubmit = async () => {
    if (config.disabled || amount < 1 || amount > maxShares || submitting) return;

    if (isLimitOrder) {
      // Block limit order creation during trading halt
      if (isWeeklyHalt()) {
        showNotification('error', 'Market is closed for chapter review. Limit orders cannot be created during trading halt.');
        return;
      }

      // Handle limit order creation
      const priceNum = parseFloat(limitPrice);
      if (isNaN(priceNum) || priceNum <= 0) {
        showNotification('error', 'Please enter a valid limit price');
        return;
      }

      if (priceNum > price * 10) {
        showNotification('error', 'Limit price cannot exceed 10x current price');
        return;
      }

      setSubmitting(true);
      try {
        await createLimitOrderFunction({
          ticker: character.ticker,
          type: action.toUpperCase(),
          shares: parseInt(amount),
          limitPrice: priceNum,
          allowPartialFills
        });

        showNotification('success', 'Limit order created! View your orders in Portfolio.');
        onClose();
      } catch (error) {
        console.error('Error creating limit order:', error);
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`${cardClass} border rounded-sm p-4 max-w-md w-full`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className={`text-lg font-bold ${textClass}`}>{config.title} ${character.ticker}</h3>
            <p className={`text-sm ${mutedClass}`}>{character.name}</p>
          </div>
          <button onClick={onClose} className={`${mutedClass} hover:text-orange-600`}>✕</button>
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

        {/* Amount input */}
        <div className="mb-4">
          <label className={`block text-sm font-semibold mb-2 ${textClass}`}>Shares</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAmount(Math.max(0, (amount || 1) - 1))}
              className={`px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}
            >
              -
            </button>
            <input
              type="number"
              min="0"
              max={maxShares}
              value={amount === '' ? '' : amount}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setAmount('');
                } else {
                  const num = parseInt(val);
                  if (!isNaN(num)) {
                    setAmount(Math.min(maxShares, Math.max(0, num)));
                  }
                }
              }}
              onBlur={() => {
                if (amount === '' || amount < 0) {
                  setAmount(maxShares > 0 ? 1 : 0);
                }
              }}
              className={`flex-1 text-center py-2 rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`}
            />
            <button
              onClick={() => setAmount(Math.min(maxShares, (amount || 0) + 1))}
              className={`px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}
            >
              +
            </button>
            <button
              onClick={() => setAmount(maxShares)}
              className={`px-3 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-teal-700 hover:bg-teal-600 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}
              disabled={maxShares === 0}
            >
              Max
            </button>
          </div>
          {maxShares === 0 && (
            <p className="text-xs text-red-500 mt-1">
              {action === 'sell' ? 'No shares owned' : action === 'cover' ? 'No short position' : 'Insufficient funds'}
            </p>
          )}
          {maxShares > 0 && (
            <p className={`text-xs ${mutedClass} mt-1`}>Max: {maxShares} shares</p>
          )}
        </div>

        {/* Limit Order Checkbox */}
        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isLimitOrder}
              onChange={(e) => {
                setIsLimitOrder(e.target.checked);
                if (e.target.checked) {
                  setLimitPrice(price.toFixed(2));
                }
              }}
              className="w-4 h-4"
            />
            <span className={`text-sm font-semibold ${textClass}`}>Place as limit order</span>
          </label>
          <p className={`text-xs ${mutedClass} mt-1 ml-6`}>
            Order will execute when price conditions are met (30-day expiration)
          </p>
        </div>

        {/* Limit Order Settings */}
        {isLimitOrder && (
          <div className={`p-3 rounded-sm mb-4 space-y-3 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
            <div>
              <label className={`block text-sm font-semibold mb-1 ${textClass}`}>
                Limit Price
                <span className={`ml-2 text-xs ${mutedClass}`}>
                  (Current: {formatCurrency(price)})
                </span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="0.00"
                className={`w-full px-3 py-2 border rounded-sm ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`}
              />
              <p className={`text-xs ${mutedClass} mt-1`}>
                {action === 'buy' || action === 'cover'
                  ? 'Order executes when price drops to or below this price'
                  : 'Order executes when price rises to or above this price'}
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowPartialFills}
                  onChange={(e) => setAllowPartialFills(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className={`text-sm ${textClass}`}>Allow partial fills</span>
              </label>
              <p className={`text-xs ${mutedClass} mt-1 ml-6`}>
                If unchecked, order only executes if all shares can be traded
              </p>
            </div>
          </div>
        )}

        {/* Total (only show for immediate trades) */}
        {!isLimitOrder && (
          <div className={`p-3 rounded-sm mb-4 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
            <div className="flex justify-between items-center">
              <span className={`text-sm ${mutedClass}`}>{config.label}</span>
              <span className={`text-lg font-bold ${config.colors.text}`}>
                {formatCurrency(config.total)}
              </span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={config.disabled || amount < 1 || amount > maxShares || submitting || (isLimitOrder && (!limitPrice || parseFloat(limitPrice) <= 0))}
            className={`flex-1 py-3 text-sm font-semibold uppercase rounded-sm ${
              config.buttonStyle === 'outline'
                ? `border-2 ${config.colors.border} ${config.colors.text} ${config.colors.bg}`
                : `${config.colors.bg} ${config.colors.bgHover} text-white`
            } disabled:opacity-50`}
          >
            {submitting ? 'Creating...' : isLimitOrder ? `Create Limit ${config.title}` : config.title}
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
