// The portfolio's history side: your latest trades and dividends, and the
// positions you recently sold out of with what you made or lost on them.
// The full, filterable history (with CSV export) is one click away.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../../context/AppContext';
import { useRecentTrades } from '../hooks/usePlayerTrades';
import { recentlyClosed } from '../utils/tradeSummary';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { formatShares } from '../utils/shared';
import { formatTimestamp, getTradeProfit, SOURCE_LABELS } from '../../../utils/tradeHistory';
import SegmentedSwitch from '../../../shared/components/SegmentedSwitch';

const VERB: Record<string, string> = {
  buy: 'Bought',
  sell: 'Sold',
  short: 'Shorted',
  cover: 'Covered',
  margin_call_cover: 'Force covered',
};
const SHOWN = 12;

const ActivityPanel = ({ onOpenTradeHistory }: { onOpenTradeHistory?: () => void }) => {
  const { user, holdings, getColorBlindColors } = useSession();
  const { trades, loading, limited } = useRecentTrades(user?.uid);
  const [tab, setTab] = useState<'activity' | 'closed'>('activity');
  const [more, setMore] = useState(false);
  const { textClass, mutedClass } = themeClasses;
  const closed = recentlyClosed(trades, holdings);
  const list = more ? trades : trades.slice(0, SHOWN);

  const plText = (amount: number) => `${amount >= 0 ? '+' : ''}${formatCurrency(amount)}`;

  return (
    <div>
      <div className="flex items-center gap-1 mb-3">
        <SegmentedSwitch
          label="Activity"
          size="md"
          options={[
            ['activity', 'Recent activity'],
            ['closed', `Closed (${closed.length})`],
          ]}
          value={tab}
          onChange={setTab}
        />
        {onOpenTradeHistory && (
          <button onClick={onOpenTradeHistory} className={`ml-auto text-xs ${mutedClass} hover:text-orange-500`}>
            Full history ↗
          </button>
        )}
      </div>

      {loading ? (
        <p className={`text-sm ${mutedClass}`}>Loading...</p>
      ) : tab === 'activity' ? (
        trades.length === 0 ? (
          <p className={`text-sm ${mutedClass}`}>No trades yet.</p>
        ) : (
          <>
            <ul className="divide-y light:divide-amber-100 dark:divide-zinc-800 text-sm">
              {list.map((t) => {
                if (t.action === 'dividend') {
                  const paid = (t as { totalAmount?: number }).totalAmount ?? t.totalValue ?? 0;
                  return (
                    <li key={t.id} className="py-2 flex items-center gap-3">
                      <span className={`w-28 shrink-0 text-xs ${mutedClass}`}>{formatTimestamp(t.timestamp)}</span>
                      <span className={`flex-1 ${textClass}`}>Dividends paid</span>
                      <span className={getColorBlindColors(true).text}>+{formatCurrency(paid)}</span>
                    </li>
                  );
                }
                const pl = getTradeProfit(t);
                return (
                  <li key={t.id} className="py-2 flex items-center gap-3">
                    <span className={`w-28 shrink-0 text-xs ${mutedClass}`}>{formatTimestamp(t.timestamp)}</span>
                    <span className={`flex-1 min-w-0 ${textClass}`}>
                      {VERB[t.action] || t.action} {formatShares(t.amount)}{' '}
                      <Link to={`/stock/${t.ticker}`} className="text-orange-500 font-mono hover:underline">
                        ${t.ticker}
                      </Link>{' '}
                      <span className={mutedClass}>@ {formatCurrency(t.price)}</span>
                      {t.source && SOURCE_LABELS[t.source] && (
                        <span className={`ml-1 text-[11px] ${mutedClass}`}>({SOURCE_LABELS[t.source]})</span>
                      )}
                    </span>
                    <span
                      className={`text-right whitespace-nowrap ${pl ? getColorBlindColors(pl.amount >= 0).text : mutedClass}`}
                    >
                      {pl ? plText(pl.amount) : formatCurrency(t.totalValue ?? t.price * t.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {trades.length > SHOWN && (
              <button onClick={() => setMore((m) => !m)} className={`mt-2 text-xs ${mutedClass} hover:text-orange-500`}>
                {more ? 'Show less' : `Show ${trades.length - SHOWN} more`}
              </button>
            )}
          </>
        )
      ) : closed.length === 0 ? (
        <p className={`text-sm ${mutedClass}`}>Nothing sold out of recently.</p>
      ) : (
        <ul className="divide-y light:divide-amber-100 dark:divide-zinc-800 text-sm">
          {closed.map((c) => (
            <li key={c.ticker} className="py-2 flex items-center gap-3">
              <Link to={`/stock/${c.ticker}`} className="w-16 text-orange-500 font-mono font-semibold hover:underline">
                ${c.ticker}
              </Link>
              <span className={`flex-1 text-xs ${mutedClass}`}>
                Sold {formatShares(c.sold)} · last{' '}
                {new Date(c.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <span className={getColorBlindColors(c.realized >= 0).text}>{plText(c.realized)}</span>
            </li>
          ))}
        </ul>
      )}
      {limited && !loading && (
        <p className={`mt-2 text-[11px] ${mutedClass}`}>From your last 100 trades. Full history has everything.</p>
      )}
    </div>
  );
};

export default ActivityPanel;
