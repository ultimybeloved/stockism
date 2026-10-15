// Everyone who has started the /welcome week: which day they're on, whether
// they can claim today, who has gone quiet, and what it has paid out.
import { useMemo, useState } from 'react';
import { adminWelcomeTrackerFunction } from '../../../../api/callables';
import { useAdminLoad } from '../../hooks/useAdminLoad';
import { int, money, utc, utcDate } from '../../utils/termFormat';
import { Empty, Panel, PlayerLink, Stat, SubTabs, Tag } from '../shell/ui';
import { t } from '../shell/terminal';
import type { WelcomeRow, WelcomeStatus } from '../../../../api/adminPanelTypes';

const STATUS: Record<WelcomeStatus, { label: string; tone: 'green' | 'cyan' | 'amber' | 'dim' }> = {
  done: { label: 'finished', tone: 'green' },
  claimed_today: { label: 'claimed today', tone: 'cyan' },
  due_today: { label: 'can claim today', tone: 'amber' },
  paused: { label: 'paused', tone: 'dim' },
};

const Track = ({ day, days }: { day: number; days: number }) => (
  <span className="inline-flex gap-px align-middle" aria-label={`${day} of ${days} days`}>
    {Array.from({ length: days }, (_, i) => (
      <span key={i} className="w-2.5 h-3" style={{ background: i < day ? 'var(--t-amber)' : 'var(--t-line2)' }} />
    ))}
  </span>
);

const WelcomeTracker = () => {
  const { data, loading, error, load } = useAdminLoad(() => adminWelcomeTrackerFunction());
  const [filter, setFilter] = useState<'all' | WelcomeStatus>('all');

  const rows = useMemo(() => {
    const all = [...(data?.rows || [])].sort(
      (a, b) => b.day - a.day || (b.lastClaimDay || '').localeCompare(a.lastClaimDay || ''),
    );
    return filter === 'all' ? all : all.filter((r) => r.status === filter);
  }, [data, filter]);

  if (!data) return <Empty>{error ? `Could not load: ${error}` : 'Loading welcome week...'}</Empty>;

  const count = (s: WelcomeStatus) => data.rows.filter((r) => r.status === s).length;
  const paid = data.rows.reduce((s, r) => s + r.paid, 0);
  const byDay = Array.from({ length: data.days }, (_, i) => data.rows.filter((r) => r.day === i + 1).length);
  const maxDay = Math.max(1, ...byDay);

  return (
    <div className="space-y-3">
      <div className={`${t.panel} grid grid-cols-6 gap-4 p-3`}>
        <Stat
          label="Started"
          value={int(data.rows.length)}
          sub={data.linked ? `of ${int(data.linked)} linked players` : ''}
        />
        <Stat label="Finished" value={int(count('done'))} tone={t.green} />
        <Stat label="Can claim today" value={int(count('due_today'))} tone={t.amber} />
        <Stat label="Claimed today" value={int(count('claimed_today'))} tone={t.cyan} />
        <Stat label="Paused" value={int(count('paused'))} sub="missed a day or more" />
        <Stat label="Paid out" value={money(paid)} tone={t.green} />
      </div>

      <Panel title="Where everyone is">
        <div className="flex items-end gap-2 h-24">
          {byDay.map((n, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className={`${t.num} text-[11px] ${t.muted}`}>{n}</span>
              <div
                className="w-full"
                style={{ height: `${(n / maxDay) * 56}px`, background: 'var(--t-amber)', opacity: 0.85 }}
              />
              <span className={t.label}>
                Day {i + 1} · {money(data.rewards[i])}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        pad={false}
        title={
          <SubTabs
            active={filter}
            onChange={(id) => setFilter(id as typeof filter)}
            tabs={[
              { id: 'all', label: 'All', count: data.rows.length },
              { id: 'due_today', label: 'Can claim today', count: count('due_today') },
              { id: 'claimed_today', label: 'Claimed today', count: count('claimed_today') },
              { id: 'paused', label: 'Paused', count: count('paused') },
              { id: 'done', label: 'Finished', count: count('done') },
            ]}
          />
        }
        right={
          <button className={t.btn} onClick={load} disabled={loading}>
            {loading ? 'Loading' : 'Refresh'}
          </button>
        }
      >
        {rows.length === 0 ? (
          <Empty>Nobody here</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={t.th}>Player</th>
                <th className={t.th}>Discord</th>
                <th className={t.th}>Progress</th>
                <th className={t.th}>Status</th>
                <th className={t.th}>Last claim</th>
                <th className={t.th}>Started</th>
                <th className={t.th}>Finished</th>
                <th className={`${t.th} text-right`}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: WelcomeRow) => (
                <tr key={r.discordId} className={t.row}>
                  <td className={t.td}>
                    <PlayerLink uid={r.uid} name={r.displayName} />
                    {r.isBanned && (
                      <span className="ml-2">
                        <Tag tone="red">banned</Tag>
                      </span>
                    )}
                  </td>
                  <td className={`${t.td} ${t.muted}`}>{r.discordUsername || r.discordId}</td>
                  <td className={t.td}>
                    <Track day={r.day} days={data.days} />{' '}
                    <span className={`${t.num} ${t.muted} ml-1`}>
                      {r.day}/{data.days}
                    </span>
                  </td>
                  <td className={t.td}>
                    <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Tag>
                  </td>
                  <td className={`${t.td} ${t.num}`}>{r.lastClaimDay || '-'}</td>
                  <td className={`${t.td} ${t.num} ${t.muted}`}>{utcDate(r.startedAt)}</td>
                  <td className={`${t.td} ${t.num} ${t.muted}`}>{r.completedAt ? utc(r.completedAt) : '-'}</td>
                  <td className={`${t.td} ${t.num} text-right ${t.green}`}>{money(r.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
};

export default WelcomeTracker;
