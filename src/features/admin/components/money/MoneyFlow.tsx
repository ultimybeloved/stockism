// Where cash comes from and where it goes: the ledger summed by source, over
// a chosen number of days, with a daily created-vs-removed chart.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { adminMoneyFlowFunction } from '../../../../api/callables';
import { useAdminLoad } from '../../hooks/useAdminLoad';
import { faucetsAndSinks, groupFlow } from '../../utils/moneyGroups';
import { compact, int, money, signedMoney } from '../../utils/termFormat';
import { Empty, Panel, Stat } from '../shell/ui';
import { signClass, t } from '../shell/terminal';

const RANGES = [7, 14, 30, 90];

const MoneyFlow = () => {
  const [days, setDays] = useState(14);
  const { data, loading, error, load } = useAdminLoad(() => adminMoneyFlowFunction({ days }), { auto: false });
  const [open, setOpen] = useState<Record<string, boolean>>({ rewards: true });

  useEffect(() => {
    void load();
  }, [days, load]);

  const groups = useMemo(() => groupFlow(data?.days || []), [data]);
  const daily = useMemo(
    () => (data?.days || []).map((d) => ({ day: d.day, players: d.players, ...faucetsAndSinks(groupFlow([d])) })),
    [data],
  );

  if (!data) return <Empty>{error ? `Could not load: ${error}` : 'Adding up the ledger...'}</Empty>;

  const totals = faucetsAndSinks(groups);
  const peak = Math.max(1, ...daily.map((d) => Math.max(d.created, d.removed)));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {RANGES.map((r) => (
          <button key={r} className={r === days ? t.btnGo : t.btn} onClick={() => setDays(r)}>
            {r} days
          </button>
        ))}
        <span className={`ml-auto ${t.label}`}>UTC days · cash only · the money record began 2026-10-10</span>
        <button className={t.btn} onClick={load} disabled={loading}>
          {loading ? 'Loading' : 'Refresh'}
        </button>
      </div>

      <div className={`${t.panel} grid grid-cols-4 gap-4 p-3`}>
        <Stat label="Created outside trading" value={money(totals.created)} tone={t.green} />
        <Stat label="Removed outside trading" value={money(totals.removed)} tone={t.red} />
        <Stat
          label="Net new cash"
          value={signedMoney(totals.created - totals.removed)}
          tone={signClass(totals.created - totals.removed)}
        />
        <Stat label="Most players in a day" value={int(Math.max(0, ...daily.map((d) => d.players)))} />
      </div>

      <Panel title="Created vs removed, by day">
        <div className="flex items-end gap-1 h-40">
          {daily.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full group relative min-w-0">
              <div className="w-full flex items-end gap-px h-full">
                <div
                  className="flex-1"
                  style={{ height: `${(d.created / peak) * 100}%`, background: 'var(--t-green)' }}
                />
                <div
                  className="flex-1"
                  style={{ height: `${(d.removed / peak) * 100}%`, background: 'var(--t-red)' }}
                />
              </div>
              <span className={`${t.label} mt-1 truncate`}>{d.day.slice(5)}</span>
              <div className="hidden group-hover:block absolute bottom-full mb-1 z-10 px-2 py-1 text-[11px] t-mono bg-[var(--t-raise)] border border-[var(--t-line2)] whitespace-nowrap">
                {d.day}: +{compact(d.created)} / -{compact(d.removed)} · {d.players} players
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="By source" pad={false}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={t.th}>Source</th>
              <th className={`${t.th} text-right`}>Entries</th>
              <th className={`${t.th} text-right`}>Cash in</th>
              <th className={`${t.th} text-right`}>Cash out</th>
              <th className={`${t.th} text-right`}>Net</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.id}>
                <tr
                  className={`${t.row} cursor-pointer bg-[var(--t-panel2)]`}
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                >
                  <td className={`${t.td} font-semibold`}>
                    <span className={`${t.num} ${t.muted} mr-2`}>{open[g.id] ? '-' : '+'}</span>
                    {g.label}
                  </td>
                  <td className={`${t.td} ${t.num} text-right ${t.muted}`}>
                    {int(g.lines.reduce((s, l) => s + l.count, 0))}
                  </td>
                  <td className={`${t.td} ${t.num} text-right ${t.green}`}>{money(g.in)}</td>
                  <td className={`${t.td} ${t.num} text-right ${t.red}`}>{money(g.out)}</td>
                  <td className={`${t.td} ${t.num} text-right ${signClass(g.net)}`}>{signedMoney(g.net)}</td>
                </tr>
                {open[g.id] &&
                  g.lines.map((l) => (
                    <tr key={l.type} className={t.row}>
                      <td className={`${t.td} pl-9`}>{l.label}</td>
                      <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{int(l.count)}</td>
                      <td className={`${t.td} ${t.num} text-right`}>{l.in ? money(l.in) : ''}</td>
                      <td className={`${t.td} ${t.num} text-right`}>{l.out ? money(l.out) : ''}</td>
                      <td className={`${t.td} ${t.num} text-right ${signClass(l.net)}`}>{signedMoney(l.net)}</td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
};

export default MoneyFlow;
