// "Your history with $X": every buy, sell, short and cover the player made in
// one stock, newest first, with the totals and the profit booked on sells.
import { useSession } from '../../../context/AppContext';
import { useStockTrades } from '../hooks/usePlayerTrades';
import { summarizeStock } from '../utils/tradeSummary';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { formatShares } from '../utils/shared';
import { formatTimestamp, getTradeProfit, SOURCE_LABELS } from '../../../utils/tradeHistory';

const ACTION_LABEL: Record<string, string> = {
  buy: 'Bought',
  sell: 'Sold',
  short: 'Shorted',
  cover: 'Covered',
  margin_call_cover: 'Force covered',
};

const StockHistory = ({ ticker }: { ticker: string }) => {
  const { user, getColorBlindColors } = useSession();
  const { trades, loading, limited } = useStockTrades(user?.uid, ticker);
  const { textClass, mutedClass } = themeClasses;
  const s = summarizeStock(trades);

  const stat = (label: string, value: string, cls = textClass) => (
    <div>
      <div className={`text-[11px] uppercase ${mutedClass}`}>{label}</div>
      <div className={`text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );

  return (
    <div>
      <h4 className={`text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Your history with ${ticker}</h4>
      {loading ? (
        <p className={`text-sm ${mutedClass}`}>Loading...</p>
      ) : trades.length === 0 ? (
        <p className={`text-sm ${mutedClass}`}>No trades found.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {stat('Bought', `${formatShares(s.bought)} sh`)}
            {stat('Sold', `${formatShares(s.sold)} sh`)}
            {stat(
              'Booked',
              `${s.realized >= 0 ? '+' : ''}${formatCurrency(s.realized)}`,
              getColorBlindColors(s.realized >= 0).text,
            )}
            {stat(
              'Since',
              s.first
                ? new Date(s.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                : '-',
            )}
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y light:divide-amber-100 dark:divide-zinc-800 text-sm">
            {[...trades].reverse().map((t) => {
              const pl = getTradeProfit(t);
              const total = t.totalValue ?? t.price * t.amount;
              return (
                <li key={t.id} className="py-1.5 flex items-center gap-3">
                  <span className={`w-28 shrink-0 text-xs ${mutedClass}`}>{formatTimestamp(t.timestamp)}</span>
                  <span className={`flex-1 min-w-0 ${textClass}`}>
                    {ACTION_LABEL[t.action] || t.action} {formatShares(t.amount)} @ {formatCurrency(t.price)}
                    {t.source && SOURCE_LABELS[t.source] && (
                      <span className={`ml-1 text-[11px] ${mutedClass}`}>({SOURCE_LABELS[t.source]})</span>
                    )}
                  </span>
                  <span
                    className={`text-right text-xs whitespace-nowrap ${pl ? getColorBlindColors(pl.amount >= 0).text : mutedClass}`}
                  >
                    {pl
                      ? `${pl.amount >= 0 ? '+' : ''}${formatCurrency(pl.amount)} (${formatChange(pl.percent)})`
                      : formatCurrency(total)}
                  </span>
                </li>
              );
            })}
          </ul>
          {limited && <p className={`mt-1 text-[11px] ${mutedClass}`}>Showing your latest 40 trades in this stock.</p>}
        </>
      )}
    </div>
  );
};

export default StockHistory;
