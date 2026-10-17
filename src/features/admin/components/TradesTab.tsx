import type { AdminCommonProps } from './types';
import { TRADE_LOAD_CAP, type useAdminTrades } from '../hooks/useAdminTrades';
import type { AdminTradeType } from '../utils/adminTradeRows';
import AdminIcon from './AdminIcon';

const TYPE_BADGE: Record<AdminTradeType, string> = {
  BUY: 'BUY',
  SELL: 'SELL',
  SHORT_OPEN: 'SHORT',
  SHORT_CLOSE: 'COVER',
  LIQUIDATION: 'LIQUIDATED',
};
const TYPE_VERB: Record<AdminTradeType, string> = {
  BUY: 'bought',
  SELL: 'sold',
  SHORT_OPEN: 'shorted',
  SHORT_CLOSE: 'covered',
  LIQUIDATION: 'was liquidated',
};
// How the trade happened.
const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  limit: 'Limit order',
  stop_loss: 'Stop loss',
  premarket: 'Pre-market auction',
  admin: 'Admin act-as',
  margin_call: 'Margin call',
  ipo: 'IPO',
  bot: 'Bot',
};

const TradesTab = ({
  textClass,
  mutedClass,
  tradeTimePeriod,
  setTradeTimePeriod,
  tradeTypeFilter,
  setTradeTypeFilter,
  tradeFilterTicker,
  setTradeFilterTicker,
  tradeBotFilter,
  setTradeBotFilter,
  tradesLoading,
  tradesCapped,
  recentTrades,
  loadRecentTrades,
}: Pick<AdminCommonProps, 'textClass' | 'mutedClass'> & ReturnType<typeof useAdminTrades>) => {
  return (
    <div className="space-y-4">
      <div className="p-3 rounded-sm light:bg-yellow-50 dark:bg-yellow-900/20">
        <p className={`text-sm ${mutedClass}`}>
          <AdminIcon name="trade" />
          Every trade across all users: manual trades, limit and stop-loss fills, pre-market auction fills, IPO buys,
          forced margin closes and bot trades. Filter by time period, trade type, or ticker.
        </p>
      </div>

      {/* Filters */}
      <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Time Period */}
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>Time Period</label>
            <select
              aria-label="Time period"
              value={tradeTimePeriod}
              onChange={(e) => setTradeTimePeriod(e.target.value)}
              className="px-3 py-2 rounded-sm border text-sm light:bg-white light:border-slate-300 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            >
              <option value="24h">Last 24 Hours</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>

          {/* Trade Type */}
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>Trade Type</label>
            <select
              aria-label="Trade type"
              value={tradeTypeFilter}
              onChange={(e) => setTradeTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-sm border text-sm light:bg-white light:border-slate-300 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            >
              <option value="all">All Types</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
              <option value="SHORT_OPEN">Short Open</option>
              <option value="SHORT_CLOSE">Short Close</option>
              <option value="LIQUIDATION">Margin Liquidation</option>
            </select>
          </div>

          {/* Ticker Filter */}
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>Ticker (optional)</label>
            <input
              aria-label="Ticker"
              type="text"
              value={tradeFilterTicker}
              onChange={(e) => setTradeFilterTicker(e.target.value.toUpperCase())}
              placeholder="e.g. LUFFY"
              className="w-24 px-3 py-2 rounded-sm border text-sm light:bg-white light:border-slate-300 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            />
          </div>

          {/* Bot Filter */}
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>User Type</label>
            <select
              aria-label="User type"
              value={tradeBotFilter}
              onChange={(e) => setTradeBotFilter(e.target.value)}
              className="px-3 py-2 rounded-sm border text-sm light:bg-white light:border-slate-300 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            >
              <option value="real">Real Users Only</option>
              <option value="bots">Bots Only</option>
              <option value="all">All Trades</option>
            </select>
          </div>

          {/* Load Button */}
          <button
            onClick={() => loadRecentTrades(tradeTimePeriod, tradeTypeFilter, tradeFilterTicker, tradeBotFilter)}
            disabled={tradesLoading}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {tradesLoading ? (
              'Loading...'
            ) : (
              <>
                <AdminIcon name="inspect" />
                Load Trades
              </>
            )}
          </button>
        </div>
      </div>

      {/* Trade Stats Summary */}
      {recentTrades.length > 0 && (
        <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
          <div className="grid grid-cols-5 gap-4 text-center">
            <div>
              <p className="text-xl font-bold text-yellow-500">{recentTrades.length}</p>
              <p className={`text-xs ${mutedClass}`}>Total Trades</p>
            </div>
            <div>
              <p className="text-xl font-bold text-green-500">{recentTrades.filter((t) => t.type === 'BUY').length}</p>
              <p className={`text-xs ${mutedClass}`}>Buys</p>
            </div>
            <div>
              <p className="text-xl font-bold text-red-400">{recentTrades.filter((t) => t.type === 'SELL').length}</p>
              <p className={`text-xs ${mutedClass}`}>Sells</p>
            </div>
            <div>
              <p className="text-xl font-bold text-orange-500">
                {recentTrades.filter((t) => t.type === 'SHORT_OPEN').length}
              </p>
              <p className={`text-xs ${mutedClass}`}>Shorts Opened</p>
            </div>
            <div>
              <p className="text-xl font-bold text-purple-500">
                {recentTrades.filter((t) => t.type === 'SHORT_CLOSE').length}
              </p>
              <p className={`text-xs ${mutedClass}`}>Shorts Closed</p>
            </div>
          </div>
        </div>
      )}

      {/* Trades Feed */}
      <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
        <h3 className={`font-semibold mb-3 ${textClass}`}>Trade Feed</h3>
        {tradesCapped && (
          <p className={`text-xs mb-2 ${mutedClass}`}>
            Showing the newest {TRADE_LOAD_CAP.toLocaleString()} player trades. Pick a shorter time period or a ticker
            to see older ones.
          </p>
        )}

        {tradesLoading ? (
          <p className={`text-center ${mutedClass} py-8`}>Loading trades...</p>
        ) : recentTrades.length === 0 ? (
          <p className={`text-center ${mutedClass} py-8`}>No trades found. Click "Load Trades" to fetch.</p>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {recentTrades.map((trade) => (
              <div
                key={trade.id}
                className="p-3 rounded-sm light:bg-slate-50 dark:bg-slate-700/50 flex justify-between items-center"
              >
                <div className="flex items-center gap-3">
                  {/* Trade Type Badge */}
                  <span
                    className={`px-2 py-1 rounded text-xs font-bold ${
                      trade.type === 'BUY'
                        ? 'bg-green-500/20 text-green-500'
                        : trade.type === 'SELL'
                          ? 'bg-red-500/20 text-red-400'
                          : trade.type === 'SHORT_OPEN'
                            ? 'bg-orange-500/20 text-orange-500'
                            : trade.type === 'LIQUIDATION'
                              ? 'bg-rose-700/30 text-rose-400'
                              : 'bg-purple-500/20 text-purple-500'
                    }`}
                  >
                    {TYPE_BADGE[trade.type]}
                  </span>

                  {/* Trade Details */}
                  <div>
                    <p className={textClass}>
                      <span className="font-semibold">{trade.userName}</span>
                      {trade.isBot && (
                        <span title="Bot" className="ml-1">
                          <AdminIcon name="robot" className="w-4 h-4 inline-block align-[-3px]" />
                        </span>
                      )}
                      {trade.type === 'LIQUIDATION' ? (
                        <span className={mutedClass}> was liquidated by a margin call</span>
                      ) : (
                        <>
                          <span className={mutedClass}> {TYPE_VERB[trade.type]} </span>
                          <span className="font-bold text-cyan-500">{trade.shares}</span>
                          <span className={mutedClass}> shares of </span>
                          <span className="font-bold">${trade.ticker}</span>
                        </>
                      )}
                    </p>
                    <p className={`text-xs ${mutedClass}`}>
                      {trade.type !== 'LIQUIDATION' && <>@ ${trade.price.toFixed(2)} • </>}
                      Total: ${trade.total.toFixed(2)}
                      <span className="ml-2 px-1.5 py-0.5 rounded light:bg-slate-200 dark:bg-slate-600">
                        {SOURCE_LABEL[trade.source] || trade.source}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Timestamp */}
                <div className="text-right">
                  <p className={`text-xs ${mutedClass}`}>{new Date(trade.timestamp).toLocaleDateString()}</p>
                  <p className={`text-xs ${mutedClass}`}>{new Date(trade.timestamp).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TradesTab;
