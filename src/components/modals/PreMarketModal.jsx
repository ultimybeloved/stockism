import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db, createPreMarketOrderFunction, cancelPreMarketOrderFunction } from '../../firebase';
import { formatCurrency } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';
import { calculatePriceImpactDollars, getBidAskPrices } from '../../utils/calculations';
import { getPreMarketTimeRemaining, formatCountdown, isPreMarketLockout } from '../../utils/marketHours';
import { PRE_MARKET_MAX_BUY_BUFFER } from '../../constants/economy';
import { useAppContext } from '../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const PreMarketModal = ({ character, price, holdings, userCash, initialAction = 'buy', onClose }) => {
  useEscapeKey(onClose);
  const { darkMode, user, showNotification } = useAppContext();
  const [action, setAction] = useState(initialAction);
  const [shares, setShares] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [allOrders, setAllOrders] = useState([]);
  const [countdown, setCountdown] = useState('');

  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

  // Countdown to 21:00 UTC
  useEffect(() => {
    const tick = () => {
      const ms = getPreMarketTimeRemaining();
      if (ms <= 0) { onClose(); return; }
      setCountdown(formatCountdown(ms));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [onClose]);

  // Live listener — all PENDING pre-market orders for this ticker today
  useEffect(() => {
    const preMarketStart = new Date();
    preMarketStart.setUTCHours(20, 30, 0, 0);
    const q = query(
      collection(db, 'preMarketOrders'),
      where('ticker', '==', character.ticker),
      where('status', '==', 'PENDING'),
      where('createdAt', '>=', Timestamp.fromDate(preMarketStart))
    );
    const unsub = onSnapshot(q, snap =>
      setAllOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, [character.ticker]);

  // Compute indicative opening price from all currently queued orders
  const getIndicativePrice = () => {
    const totalBuy = allOrders.filter(o => o.action === 'buy').reduce((s, o) => s + o.shares, 0);
    const totalSell = allOrders.filter(o => o.action === 'sell').reduce((s, o) => s + o.shares, 0);
    const net = totalBuy - totalSell;
    if (Math.abs(net) < 0.01) return price;
    const impactDollars = calculatePriceImpactDollars(price, Math.abs(net));
    return net > 0
      ? Math.min(price + impactDollars, price * 1.05)
      : Math.max(0.01, Math.max(price - impactDollars, price * 0.95));
  };

  const indicativePrice = getIndicativePrice();
  const { bid, ask } = getBidAskPrices(indicativePrice, character.isETF);
  const locked = isPreMarketLockout();
  const myOrders = allOrders.filter(o => o.userId === user?.uid);
  const myActionOrder = myOrders.find(o => o.action === action);
  // Buys leave headroom for the opening price to move up (impact cap + spread),
  // so a max order can't become unaffordable at the opening ask.
  const maxShares = action === 'buy'
    ? (price > 0 ? Math.floor(userCash / (price * PRE_MARKET_MAX_BUY_BUFFER) * 100) / 100 : 0)
    : (holdings || 0);

  const handleSubmit = async () => {
    if (submitting || shares <= 0 || shares > maxShares) return;
    setSubmitting(true);
    try {
      await createPreMarketOrderFunction({ ticker: character.ticker, action, shares, allowPartialFills: true });
      showNotification('success', `${action === 'buy' ? 'Buy' : 'Sell'} order queued for the opening auction!`);
    } catch (err) {
      showNotification('error', err.message || 'Failed to queue order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (orderId) => {
    setCancelling(orderId);
    try {
      await cancelPreMarketOrderFunction({ orderId });
      showNotification('success', 'Order cancelled');
    } catch (err) {
      showNotification('error', err.message || 'Failed to cancel order');
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`${cardClass} border rounded-sm p-4 max-w-md w-full`} onClick={e => e.stopPropagation()}>

        <div className="flex justify-between items-start mb-3">
          <div>
            <h3 className={`text-lg font-bold ${textClass}`}>Pre-Market Queue</h3>
            <p className={`text-sm ${mutedClass}`}>{character.name} (${character.ticker})</p>
          </div>
          <button onClick={onClose} className={`${mutedClass} hover:text-orange-600`}>✕</button>
        </div>

        <div className={`p-3 rounded-sm mb-3 text-xs ${darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-600'}`}>
          All queued orders execute at the same opening price. Submitting early gives no advantage.
          Buys fill as many shares as your cash allows at that price.
          <span className="block mt-1 font-semibold">
            {locked ? 'Orders locked. Market opens in ' : 'Market opens in '}{countdown}
          </span>
          {locked && (
            <span className="block mt-0.5 text-yellow-400 font-semibold">The queue is closed. Queued orders will execute before the open.</span>
          )}
        </div>

        <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
          <div className="flex justify-between text-sm">
            <span className={mutedClass}>Current price</span>
            <span className={`font-bold ${textClass}`}>{formatCurrency(price)}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className={mutedClass}>Indicative open price</span>
            <span className={`font-bold ${indicativePrice > price ? 'text-green-400' : indicativePrice < price ? 'text-red-400' : textClass}`}>
              {formatCurrency(indicativePrice)}
            </span>
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className={mutedClass}>Indicative bid / ask</span>
            <span className={mutedClass}>{formatCurrency(bid)} / {formatCurrency(ask)}</span>
          </div>
          <p className={`text-xs mt-1 ${mutedClass}`}>
            Based on {allOrders.length} queued order{allOrders.length !== 1 ? 's' : ''} (updates live)
          </p>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={() => setAction('buy')}
            className={`flex-1 py-2 text-sm font-semibold rounded-sm ${action === 'buy' ? 'bg-green-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-200 text-slate-600'}`}>
            Buy
          </button>
          <button onClick={() => setAction('sell')}
            className={`flex-1 py-2 text-sm font-semibold rounded-sm ${action === 'sell' ? 'bg-red-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-200 text-slate-600'}`}>
            Sell
          </button>
        </div>

        {myActionOrder ? (
          <div className={`mb-3 p-2 rounded-sm text-xs ${darkMode ? 'bg-yellow-900/30 border border-yellow-600/40 text-yellow-300' : 'bg-yellow-50 border border-yellow-300 text-yellow-800'}`}>
            You already have a {action} order queued ({myActionOrder.shares} shares). Cancel it below to replace it.
          </div>
        ) : locked ? (
          <div className={`mb-3 p-2 rounded-sm text-xs ${darkMode ? 'bg-yellow-900/30 border border-yellow-600/40 text-yellow-300' : 'bg-yellow-50 border border-yellow-300 text-yellow-800'}`}>
            New orders are closed for this open. The queue reopens next Thursday at 20:30 UTC.
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className={`text-sm font-semibold ${textClass}`}>Shares</label>
                <span className={`text-xs ${mutedClass}`}>Max: {maxShares}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShares(s => Math.max(0.01, Math.round((s - 1) * 100) / 100))}
                  className={`px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>−</button>
                <input type="number" min="0.01" max={maxShares} step="1" value={shares}
                  onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) setShares(Math.min(maxShares, Math.max(0.01, Math.round(n * 100) / 100))); }}
                  className={`flex-1 text-center py-2 rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`}
                />
                <button onClick={() => setShares(s => Math.min(maxShares, Math.round((s + 1) * 100) / 100))}
                  className={`px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>+</button>
                <button onClick={() => setShares(maxShares)} disabled={maxShares === 0}
                  className={`px-3 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-teal-700 hover:bg-teal-600 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'} disabled:opacity-50`}>
                  Max
                </button>
              </div>
              {maxShares === 0 && (
                <p className="text-xs text-red-500 mt-1">{action === 'sell' ? 'No shares owned' : 'Insufficient funds'}</p>
              )}
            </div>

            <button onClick={handleSubmit}
              disabled={submitting || shares <= 0 || shares > maxShares || maxShares === 0}
              className={`w-full py-3 text-sm font-semibold rounded-sm mb-3 ${action === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} text-white disabled:opacity-50`}>
              {submitting ? 'Queuing...' : `Queue ${action === 'buy' ? 'Buy' : 'Sell'} for Market Open`}
            </button>
          </>
        )}

        {myOrders.length > 0 && (
          <div className={`border-t pt-3 mb-3 ${darkMode ? 'border-zinc-700' : 'border-slate-200'}`}>
            <p className={`text-xs font-semibold mb-2 ${mutedClass}`}>Your queued orders</p>
            {myOrders.map(o => (
              <div key={o.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className={textClass}>
                  <span className={o.action === 'buy' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                    {o.action.toUpperCase()}
                  </span>
                  {' '}{o.shares} shares @ {formatCurrency(o.action === 'buy' ? ask : bid)} est.
                </span>
                {locked ? (
                  <span className={`text-xs px-2 py-1 ${darkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Locked</span>
                ) : (
                  <button onClick={() => handleCancel(o.id)} disabled={cancelling === o.id}
                    className={`text-xs px-2 py-1 rounded ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'} disabled:opacity-50`}>
                    {cancelling === o.id ? '…' : 'Cancel'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose} className={`w-full py-2 text-sm ${mutedClass} hover:text-orange-600`}>Close</button>
      </div>
    </div>
  );
};

export default PreMarketModal;
