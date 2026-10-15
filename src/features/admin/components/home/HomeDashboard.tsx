// The command panel's first screen: players, money today, job health, open
// alerts and the newest accounts, from one adminDashboard call.
import { adminDashboardFunction } from '../../../../api/callables';
import { useAdminLoad } from '../../hooks/useAdminLoad';
import { useAdminNav } from '../../utils/adminNav';
import { faucetsAndSinks, groupFlow } from '../../utils/moneyGroups';
import { ago, compact, int, money, signedMoney, utc } from '../../utils/termFormat';
import { Empty, Light, Panel, PlayerLink, Stat, Tag } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import type { PredictionDoc } from '../../../../types';

const share = (part: number | null, whole: number | null) =>
  part != null && whole ? `${Math.round((part / whole) * 100)}%` : '';

const HomeDashboard = ({ predictions, halted }: { predictions: PredictionDoc[]; halted: boolean }) => {
  const nav = useAdminNav();
  const { data, loading, error, load } = useAdminLoad(() => adminDashboardFunction());
  const now = Date.now();
  const overdueBets = predictions.filter(
    (p) => !p.resolved && !p.cancelled && p.type !== 'event' && (p.endsAt || 0) < now,
  );

  if (!data) {
    return <Empty>{error ? `Could not load the dashboard: ${error}` : 'Loading dashboard...'}</Empty>;
  }

  const p = data.players;
  const groups = groupFlow([data.today]);
  const { created, removed } = faucetsAndSinks(groups);
  const late = data.jobs.filter((j) => j.late);
  const waiting = [
    overdueBets.length > 0 && {
      label: `${overdueBets.length} weekly bet${overdueBets.length === 1 ? '' : 's'} past the end, not resolved`,
      go: 'predictions',
    },
    (data.alerts.open || 0) > 0 && { label: `${data.alerts.open} watchlist alerts not reviewed`, go: 'watchlist' },
    late.length > 0 && { label: `${late.length} scheduled job${late.length === 1 ? '' : 's'} overdue`, go: 'home' },
    halted && { label: 'Market is halted', go: 'market' },
  ].filter(Boolean) as { label: string; go: string }[];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className={t.label}>Updated {utc(data.generatedAt)} UTC</div>
        <button className={t.btn} onClick={load} disabled={loading}>
          {loading ? 'Loading' : 'Refresh'}
        </button>
      </div>

      <div className={`${t.panel} grid grid-cols-4 xl:grid-cols-8 gap-4 p-3`}>
        <Stat label="Players" value={int(p.total)} sub={`${int(p.banned)} banned`} />
        <Stat label="New 24h" value={int(p.signups24h)} sub={`${int(p.signups7d)} this week`} tone={t.cyan} />
        <Stat label="Active 24h" value={int(p.active24h)} sub={share(p.active24h, p.total)} tone={t.green} />
        <Stat label="Active 7d" value={int(p.active7d)} sub={share(p.active7d, p.total)} />
        <Stat label="Discord linked" value={int(p.linked)} sub={share(p.linked, p.total)} tone={t.violet} />
        <Stat
          label="Welcome week"
          value={int(data.welcome.started)}
          sub={`${int(data.welcome.done)} finished`}
          tone={t.amber}
        />
        <Stat label="Cash created today" value={compact(created)} sub="outside trading" tone={t.green} />
        <Stat label="Cash removed today" value={compact(removed)} sub="outside trading" tone={t.red} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Panel title="Needs you" className="col-span-1">
          {waiting.length === 0 ? (
            <div className="flex items-center gap-2 text-sm">
              <Light tone="green" /> All clear
            </div>
          ) : (
            <ul className="space-y-1.5">
              {waiting.map((w) => (
                <li key={w.label}>
                  <button
                    className="flex items-center gap-2 text-sm hover:text-[var(--t-amber)]"
                    onClick={() => nav.goTo(w.go)}
                  >
                    <Light tone="amber" live /> {w.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Money today (UTC)"
          className="col-span-2"
          right={
            <button className={t.btn} onClick={() => nav.goTo('money')}>
              Full report
            </button>
          }
        >
          {groups.length === 0 ? (
            <Empty>No money moved yet today</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={t.th}>Source</th>
                  <th className={`${t.th} text-right`}>In</th>
                  <th className={`${t.th} text-right`}>Out</th>
                  <th className={`${t.th} text-right`}>Net</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className={t.row}>
                    <td className={t.td}>{g.label}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.green}`}>{money(g.in)}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.red}`}>{money(g.out)}</td>
                    <td className={`${t.td} ${t.num} text-right ${signClass(g.net)}`}>{signedMoney(g.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Panel
          title={`Scheduled jobs (${data.jobs.length - late.length}/${data.jobs.length} on time)`}
          className="col-span-2"
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {data.jobs.map((j) => (
              <div key={j.job} className="flex items-center gap-2 text-xs min-w-0">
                <Light tone={j.late ? 'red' : j.last ? 'green' : 'dim'} live={j.late} />
                <span className={`truncate ${j.late ? t.red : t.text}`}>{j.label}</span>
                <span className={`ml-auto ${t.num} ${t.muted}`}>
                  {j.last ? `${ago(j.last, now)} ago` : 'no run yet'}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Newest players" pad={false}>
          <table className="w-full text-sm">
            <tbody>
              {data.newest.map((u) => (
                <tr key={u.uid} className={t.row}>
                  <td className={t.td}>
                    <PlayerLink uid={u.uid} name={u.displayName} />
                  </td>
                  <td className={`${t.td} text-right`}>
                    {u.isBanned ? <Tag tone="red">banned</Tag> : u.discordId ? <Tag tone="violet">linked</Tag> : null}
                  </td>
                  <td className={`${t.td} ${t.num} ${t.muted} text-right`}>{ago(u.createdAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
};

export default HomeDashboard;
