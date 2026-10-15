// Player file, holdings tab: every stock and short at live prices, open
// orders, price alerts and long-term market positions.
import { sharesOf } from '../../../../utils/holdings';
import { money, money2, pct, signedMoney, utc } from '../../utils/termFormat';
import { Empty, Panel, Tag } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import type { PlayerFileResponse, Row } from '../../../../api/adminPanelTypes';
import type { PriceMap } from '../../../../types';

const s = (v: unknown) => (v == null ? '' : String(v));

const RowsTable = ({ rows, cols }: { rows: Row[]; cols: [string, (r: Row) => string][] }) =>
  rows.length === 0 ? (
    <Empty>None</Empty>
  ) : (
    <table className="w-full text-sm">
      <thead>
        <tr>
          {cols.map(([h]) => (
            <th key={h} className={t.th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={t.row}>
            {cols.map(([h, f]) => (
              <td key={h} className={`${t.td} ${t.num}`}>
                {f(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

const PlayerHoldings = ({ file, prices }: { file: PlayerFileResponse; prices: PriceMap }) => {
  const u = file.user;
  const locked = (ticker: string) =>
    (Number(u.ipoLockup?.[ticker]?.shares) || 0) + (Number(u.marginLockup?.[ticker]?.shares) || 0);

  const longs = Object.entries(u.holdings || {})
    .map(([ticker, h]) => {
      const shares = sharesOf(h);
      const price = prices[ticker] || 0;
      const avg = u.costBasis?.[ticker] || 0;
      const value = shares * price;
      const cost = shares * avg;
      return { ticker, shares, price, avg, value, pl: value - cost, plPct: cost ? ((value - cost) / cost) * 100 : 0 };
    })
    .filter((r) => r.shares > 0)
    .sort((a, b) => b.value - a.value);
  const longTotal = longs.reduce((sum, r) => sum + r.value, 0);

  const shorts = Object.entries(u.shorts || {})
    .filter(([, p]) => p && p.shares > 0)
    .map(([ticker, p]) => {
      const entry = p.costBasis || p.entryPrice || 0;
      const price = prices[ticker] || entry;
      return { ticker, shares: p.shares, entry, price, collateral: p.margin || 0, pl: (entry - price) * p.shares };
    });

  const events = Object.entries(u.eventPositions || {}).filter(([, p]) =>
    Object.values(p?.shares || {}).some((n) => Number(n) > 0),
  );
  const openOrders = file.limitOrders.filter((o) => ['PENDING', 'PARTIALLY_FILLED'].includes(s(o.status)));

  return (
    <div className="space-y-3">
      <Panel title={`Stocks (${longs.length}) · ${money(longTotal)}`} pad={false}>
        {longs.length === 0 ? (
          <Empty>No stocks</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['Ticker', 'Shares', 'Avg cost', 'Price', 'Value', '% of stocks', 'P&L', 'P&L %', 'Locked'].map(
                  (h, i) => (
                    <th key={h} className={`${t.th} ${i ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {longs.map((r) => (
                <tr key={r.ticker} className={t.row}>
                  <td className={`${t.td} font-semibold`}>${r.ticker}</td>
                  <td className={`${t.td} ${t.num} text-right`}>{r.shares}</td>
                  <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{money2(r.avg)}</td>
                  <td className={`${t.td} ${t.num} text-right`}>{money2(r.price)}</td>
                  <td className={`${t.td} ${t.num} text-right`}>{money(r.value)}</td>
                  <td className={`${t.td} ${t.num} text-right ${t.muted}`}>
                    {longTotal ? `${((r.value / longTotal) * 100).toFixed(1)}%` : '-'}
                  </td>
                  <td className={`${t.td} ${t.num} text-right ${signClass(r.pl)}`}>{signedMoney(r.pl)}</td>
                  <td className={`${t.td} ${t.num} text-right ${signClass(r.pl)}`}>{pct(r.plPct)}</td>
                  <td className={`${t.td} ${t.num} text-right ${t.amber}`}>{locked(r.ticker) || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-3">
        <Panel title={`Shorts (${shorts.length})`} pad={false}>
          {shorts.length === 0 ? (
            <Empty>No shorts</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['Ticker', 'Shares', 'Entry', 'Price', 'Collateral', 'P&L'].map((h, i) => (
                    <th key={h} className={`${t.th} ${i ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shorts.map((r) => (
                  <tr key={r.ticker} className={t.row}>
                    <td className={`${t.td} font-semibold`}>${r.ticker}</td>
                    <td className={`${t.td} ${t.num} text-right`}>{r.shares}</td>
                    <td className={`${t.td} ${t.num} text-right`}>{money2(r.entry)}</td>
                    <td className={`${t.td} ${t.num} text-right`}>{money2(r.price)}</td>
                    <td className={`${t.td} ${t.num} text-right`}>{money(r.collateral)}</td>
                    <td className={`${t.td} ${t.num} text-right ${signClass(r.pl)}`}>{signedMoney(r.pl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={`Long-term markets (${events.length})`} pad={false}>
          {events.length === 0 ? (
            <Empty>No open positions</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={t.th}>Market</th>
                  <th className={t.th}>Shares</th>
                  <th className={`${t.th} text-right`}>Paid</th>
                </tr>
              </thead>
              <tbody>
                {events.map(([id, p]) => (
                  <tr key={id} className={t.row}>
                    <td className={`${t.td} ${t.muted}`}>{id}</td>
                    <td className={`${t.td} ${t.num}`}>
                      {Object.entries(p.shares || {})
                        .filter(([, n]) => Number(n) > 0)
                        .map(([o, n]) => `${o} ${Number(n).toFixed(0)}`)
                        .join(' · ')}
                    </td>
                    <td className={`${t.td} ${t.num} text-right`}>{money(p.costBasis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className={`px-3 py-2 text-xs ${t.muted}`}>Sell-back value now: {money(u.eventPositionsValue)}</div>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Panel title={`Open limit orders (${openOrders.length})`} pad={false}>
          <RowsTable
            rows={openOrders}
            cols={[
              ['Type', (o) => s(o.type)],
              ['Ticker', (o) => `$${s(o.ticker)}`],
              ['Shares', (o) => `${Number(o.filledShares) || 0}/${s(o.shares)}`],
              ['Limit', (o) => money2(o.limitPrice)],
            ]}
          />
        </Panel>
        <Panel title={`Pre-market orders (${file.preMarketOrders.length})`} pad={false}>
          <RowsTable
            rows={file.preMarketOrders}
            cols={[
              ['Action', (o) => s(o.action || o.type)],
              ['Ticker', (o) => `$${s(o.ticker)}`],
              ['Shares', (o) => s(o.shares)],
              ['Status', (o) => s(o.status)],
            ]}
          />
        </Panel>
        <Panel title={`Price alerts (${file.priceAlerts.length})`} pad={false}>
          <RowsTable
            rows={file.priceAlerts}
            cols={[
              ['Ticker', (a) => `$${s(a.ticker)}`],
              ['When', (a) => `${s(a.direction)} ${money2(a.targetPrice)}`],
              ['Set', (a) => utc(a.createdAt)],
            ]}
          />
        </Panel>
      </div>
      {u.marginCallAt && (
        <div className="flex items-center gap-2 text-sm">
          <Tag tone="red">margin call</Tag> since {utc(u.marginCallAt)}
        </div>
      )}
    </div>
  );
};

export default PlayerHoldings;
