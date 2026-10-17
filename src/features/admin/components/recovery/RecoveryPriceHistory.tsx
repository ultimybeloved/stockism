// Extracted from RecoveryTab.jsx, which was past the 400-line component limit.
import type { AdminCommonProps } from '../types';
import type { useAdminRecoveryTools } from '../../hooks/useAdminRecoveryTools';
import type { Character } from '../../../../characters';
import type { PriceMap } from '../../../../types';
import AdminIcon from '../AdminIcon';

const RecoveryPriceHistory = ({
  textClass,
  mutedClass,
  inputClass,
  tradeFilterTicker,
  setTradeFilterTicker,
  sortedCharacters,
  prices,
  selectedTickerHistory,
  setSelectedTickerHistory,
  getPriceHistoryForTicker,
}: AdminCommonProps &
  Pick<
    ReturnType<typeof useAdminRecoveryTools>,
    'selectedTickerHistory' | 'setSelectedTickerHistory' | 'getPriceHistoryForTicker'
  > & {
    tradeFilterTicker: string;
    setTradeFilterTicker: (ticker: string) => void;
    sortedCharacters: Character[];
    prices: PriceMap;
  }) => (
  <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
    <h3 className={`font-semibold mb-2 ${textClass}`}>
      <AdminIcon name="inspect" />
      Price History
    </h3>

    {/* Ticker selector for investigation */}
    <div className="mb-3">
      <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Investigate Ticker</label>
      <div className="flex gap-2">
        <select
          aria-label="Ticker to investigate"
          value={tradeFilterTicker}
          onChange={(e) => {
            setTradeFilterTicker(e.target.value);
            setSelectedTickerHistory([]);
          }}
          className={`flex-1 px-3 py-2 border rounded-sm ${inputClass}`}
        >
          <option value="">-- Select Ticker --</option>
          {sortedCharacters.map((c) => (
            <option key={c.ticker} value={c.ticker}>
              {c.name} (${c.ticker}) - ${(prices[c.ticker] || c.basePrice).toFixed(2)}
            </option>
          ))}
        </select>
        <button
          onClick={async () => {
            if (tradeFilterTicker) {
              const history = await getPriceHistoryForTicker(tradeFilterTicker);
              setSelectedTickerHistory(history);
            }
          }}
          disabled={!tradeFilterTicker}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          Load History
        </button>
      </div>
    </div>

    {/* Price History Display */}
    {selectedTickerHistory.length > 0 && (
      <div className="p-3 rounded-sm mb-3 light:bg-slate-100 dark:bg-slate-800">
        <div className="flex justify-between items-center mb-2">
          <span className={`text-sm font-semibold ${textClass}`}>
            ${tradeFilterTicker} Price History ({selectedTickerHistory.length} entries)
          </span>
        </div>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {selectedTickerHistory
            .slice()
            .reverse()
            .slice(0, 1000)
            .map((h, i, arr) => {
              const prevPrice = arr[i + 1]?.price;
              const change = prevPrice ? ((h.price - prevPrice) / prevPrice) * 100 : 0;
              return (
                <div
                  key={i}
                  className="text-xs flex justify-between items-center py-1.5 px-2 rounded light:bg-white dark:bg-slate-700"
                >
                  <span className={mutedClass}>{new Date(h.timestamp).toLocaleString()}</span>
                  <div className="flex items-center gap-3">
                    <span className={`font-semibold ${textClass}`}>${h.price.toFixed(2)}</span>
                    {change !== 0 && (
                      <span className={`font-semibold ${change > 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {change > 0 ? '+' : ''}
                        {change.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    )}
  </div>
);

export default RecoveryPriceHistory;
