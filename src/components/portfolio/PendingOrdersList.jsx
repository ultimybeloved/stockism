import { useState } from 'react';
import { getThemeClasses } from '../../utils/theme';
import { CHARACTER_MAP } from '../../characters';

// Pending limit / stop-loss orders section of the portfolio modal (renders nothing
// when there are no pending orders).
const PendingOrdersList = ({ orders, prices, onCancel, loadingOrders, darkMode }) => {
  // Two-step cancel so a stray tap can't kill an order.
  const [confirmingId, setConfirmingId] = useState(null);
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  if (!orders || orders.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className={`text-lg font-bold ${textClass}`}>Pending Orders</h3>
        <span className={`text-sm px-2 py-0.5 rounded ${darkMode ? 'bg-blue-900 text-blue-200' : 'bg-blue-100 text-blue-700'}`}>
          {orders.length}
        </span>
      </div>
      <div className="space-y-3">
        {orders.map(order => {
          const character = CHARACTER_MAP[order.ticker];
          const currentPrice = prices[order.ticker] || 0;
          const isClose = order.limitPrice > 0 && Math.abs(currentPrice - order.limitPrice) / order.limitPrice < 0.05;

          return (
            <div
              key={order.id}
              className={`p-3 border rounded-sm ${darkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-300'}`}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className={`font-bold ${textClass}`}>
                    <span className={`${
                      order.type === 'BUY' || order.type === 'COVER'
                        ? 'text-green-500'
                        : order.type === 'STOP_LOSS'
                          ? 'text-orange-500'
                          : 'text-red-500'
                    }`}>
                      {order.type === 'STOP_LOSS' ? 'STOP LOSS' : order.type}
                    </span>
                    {' '}
                    {order.shares} ${order.ticker}
                  </div>
                  <div className={`text-xs ${mutedClass}`}>{character?.name}</div>
                </div>
                {confirmingId === order.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setConfirmingId(null); onCancel(order.id); }}
                      disabled={loadingOrders}
                      className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmingId(null)}
                      disabled={loadingOrders}
                      className={`px-2 py-1 text-xs font-semibold rounded-sm disabled:opacity-50 ${darkMode ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingId(order.id)}
                    disabled={loadingOrders}
                    className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className={mutedClass}>{order.type === 'STOP_LOSS' ? 'Stop Price' : 'Limit Price'}</div>
                  <div className={`font-bold ${textClass}`}>${order.limitPrice.toFixed(2)}</div>
                </div>
                <div>
                  <div className={mutedClass}>Current Price</div>
                  <div className={`font-bold ${isClose ? 'text-orange-500' : textClass}`}>
                    ${currentPrice.toFixed(2)}
                    {isClose && ' ⚠️'}
                  </div>
                </div>
              </div>

              {order.status === 'PARTIALLY_FILLED' && (
                <div className={`mt-2 text-xs ${mutedClass}`}>
                  Filled: {order.filledShares}/{order.shares} shares
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PendingOrdersList;
