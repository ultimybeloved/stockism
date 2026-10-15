// Player file, trades tab: stock trades (newest 300) with a ticker filter and
// per-ticker totals, plus long-term market trades.
import { useMemo, useState } from 'react';
import { int, money, money2, signedMoney, utc } from '../../utils/termFormat';
import { Empty, Panel, Tag } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import type { PlayerFileResponse } from '../../../../api/adminPanelTypes';

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => Number(v) || 0;

const PlayerTrades = ({ file }: { file: PlayerFileResponse }) => {
  const [ticker, setTicker] = useState('');
  const rows = useMemo(() => file.trades.filter((r) => !ticker || s(r.ticker) === ticker), [file.trades, ticker]);

  const byTicker = useMemo(() => {
    const out: Record<string, { trades: number; bought: number; sold: number }> = {};
    for (const r of file.trades) {
      const row = (out[s(r.ticker)] ||= { trades: 0, bought: 0, sold: 0 });
      row.trades++;
      const value = n(r.totalValue) || n(r.price) * n(r.amount);
      if (['buy', 'cover'].includes(s(r.action))) row.bought += value;
      else row.sold += value;
    }
    return Object.entries(out).sort((a, b) => b[1].trades - a[1].trades);
  }, [file.trades]);

  return (
    <div className="grid grid-cols-3 gap-3">
      <Panel
        className="col-span-2"
        pad={false}
        title={`Stock trades (${rows.length}${file.trades.length >= 300 ? ', newest 300' : ''})`}
        right={
          ticker && (
            <button className={t.btn} onClick={() => setTicker('')}>
              Show all tickers
            </button>
          )
        }
      >
        {rows.length === 0 ? (
          <Empty>No trades</Empty>
        ) : (
          <div className="max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--t-panel)]">
                <tr>
                  {['When (UTC)', 'Action', 'Ticker', 'Shares', 'Price', 'Total', 'Impact', 'Cash after', 'How'].map(
                    (h, i) => (
                      <th key={h} className={`${t.th} ${i >= 3 && i <= 7 ? 'text-right' : ''}`}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const buy = ['buy', 'cover'].includes(s(r.action));
                  return (
                    <tr key={r.id} className={t.row}>
                      <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(r.timestamp)}</td>
                      <td className={`${t.td} t-mono uppercase text-xs ${buy ? t.green : t.red}`}>{s(r.action)}</td>
                      <td className={t.td}>
                        <button className="hover:text-[var(--t-green)]" onClick={() => setTicker(s(r.ticker))}>
                          ${s(r.ticker)}
                        </button>
                      </td>
                      <td className={`${t.td} ${t.num} text-right`}>{int(r.amount)}</td>
                      <td className={`${t.td} ${t.num} text-right`}>{money2(r.price)}</td>
                      <td className={`${t.td} ${t.num} text-right`}>{money(r.totalValue)}</td>
                      <td className={`${t.td} ${t.num} text-right ${t.muted}`}>
                        {r.priceImpact ? `${(n(r.priceImpact) * 100).toFixed(2)}%` : ''}
                      </td>
                      <td className={`${t.td} ${t.num} text-right ${t.muted}`}>
                        {r.cashAfter == null ? '' : money2(r.cashAfter)}
                      </td>
                      <td className={t.td}>{r.source ? <Tag>{s(r.source)}</Tag> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="space-y-3">
        <Panel title="By ticker" pad={false}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={t.th}>Ticker</th>
                <th className={`${t.th} text-right`}>Trades</th>
                <th className={`${t.th} text-right`}>Bought</th>
                <th className={`${t.th} text-right`}>Sold</th>
              </tr>
            </thead>
            <tbody>
              {byTicker.map(([tk, r]) => (
                <tr key={tk} className={`${t.row} cursor-pointer`} onClick={() => setTicker(tk)}>
                  <td className={t.td}>${tk}</td>
                  <td className={`${t.td} ${t.num} text-right`}>{r.trades}</td>
                  <td className={`${t.td} ${t.num} text-right ${t.green}`}>{money(r.bought)}</td>
                  <td className={`${t.td} ${t.num} text-right ${t.red}`}>{money(r.sold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title={`Long-term market trades (${file.eventTrades.length})`} pad={false}>
          {file.eventTrades.length === 0 ? (
            <Empty>None</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {[...file.eventTrades]
                  .sort((a, b) => n(b.timestamp) - n(a.timestamp))
                  .map((r) => {
                    const cash = s(r.action) === 'buy' ? -n(r.cash) : n(r.cash);
                    return (
                      <tr key={r.id} className={t.row}>
                        <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(r.timestamp)}</td>
                        <td className={t.td}>
                          {s(r.action)} {n(r.shares).toFixed(0)} "{s(r.outcome)}"
                        </td>
                        <td className={`${t.td} ${t.num} text-right ${signClass(cash)}`}>{signedMoney(cash)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
};

export default PlayerTrades;
