// Who uses the Discord bot and how, and who in the server never linked an
// account. Activity is recorded from 2026-10-14 on; the unlinked list needs
// the bot's Server Members Intent switched on in the Discord developer portal.
import { useMemo, useState } from 'react';
import { adminDiscordActivityFunction } from '../../../../api/callables';
import { useAdminLoad } from '../../hooks/useAdminLoad';
import { ago, int, utc, utcDate } from '../../utils/termFormat';
import { Empty, Panel, PlayerLink, Stat, SubTabs, Tag } from '../shell/ui';
import { t } from '../shell/terminal';

const label = (key: string) => (key === 'claim_daily_stock' ? 'claim drop' : key.replace(/_/g, ' '));

const DiscordActivity = () => {
  const { data, loading, error, load } = useAdminLoad(() => adminDiscordActivityFunction());
  const [tab, setTab] = useState('activity');
  const now = Date.now();

  const activity = useMemo(() => [...(data?.activity || [])].sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)), [data]);
  const commands = useMemo(() => {
    const totals: Record<string, { uses: number; people: number }> = {};
    for (const a of data?.activity || []) {
      for (const [cmd, n] of Object.entries(a.counts || {})) {
        const row = (totals[cmd] ||= { uses: 0, people: 0 });
        row.uses += n;
        row.people += 1;
      }
    }
    return Object.entries(totals).sort((a, b) => b[1].uses - a[1].uses);
  }, [data]);

  if (!data) return <Empty>{error ? `Could not load: ${error}` : 'Loading Discord activity...'}</Empty>;

  const active24h = activity.filter((a) => (a.lastAt || 0) > now - 86400000).length;
  const unlinkedUsers = activity.filter((a) => !a.linked).length;

  return (
    <div className="space-y-3">
      <div className={`${t.panel} grid grid-cols-5 gap-4 p-3`}>
        <Stat label="Server members" value={data.memberCount == null ? '?' : int(data.memberCount)} />
        <Stat label="Linked accounts" value={int(data.linkedCount)} tone={t.violet} />
        <Stat label="Used the bot" value={int(activity.length)} sub="since 2026-10-14" />
        <Stat label="Used it today" value={int(active24h)} tone={t.green} />
        <Stat label="Used it, not linked" value={int(unlinkedUsers)} tone={t.amber} />
      </div>

      <Panel
        pad={false}
        title={
          <SubTabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'activity', label: 'Who uses the bot', count: activity.length },
              { id: 'commands', label: 'Commands', count: commands.length },
              { id: 'unlinked', label: 'In the server, never linked', count: data.unlinked?.length },
            ]}
          />
        }
        right={
          <button className={t.btn} onClick={load} disabled={loading}>
            {loading ? 'Loading' : 'Refresh'}
          </button>
        }
      >
        {tab === 'activity' &&
          (activity.length === 0 ? (
            <Empty>No bot use recorded yet. Recording started 2026-10-14.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={t.th}>Discord</th>
                  <th className={t.th}>Stockism account</th>
                  <th className={`${t.th} text-right`}>Uses</th>
                  <th className={t.th}>Last used</th>
                  <th className={t.th}>Last command</th>
                  <th className={t.th}>Most used</th>
                  <th className={t.th}>First seen</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => {
                  const top = Object.entries(a.counts || {})
                    .sort((x, y) => y[1] - x[1])
                    .slice(0, 4);
                  return (
                    <tr key={a.discordId} className={t.row}>
                      <td className={t.td}>
                        {a.globalName || a.username || a.discordId}
                        {a.globalName && a.username && <span className={`ml-1.5 ${t.dim}`}>@{a.username}</span>}
                      </td>
                      <td className={t.td}>
                        {a.linked ? (
                          <PlayerLink uid={a.linked.uid} name={a.linked.displayName} />
                        ) : (
                          <Tag tone="amber">not linked</Tag>
                        )}
                      </td>
                      <td className={`${t.td} ${t.num} text-right`}>{int(a.total)}</td>
                      <td className={`${t.td} ${t.num}`} title={utc(a.lastAt)}>
                        {ago(a.lastAt, now)} ago
                      </td>
                      <td className={`${t.td} ${t.muted}`}>{label(a.lastCommand || '')}</td>
                      <td className={`${t.td} ${t.muted} text-xs`}>
                        {top.map(([cmd, n]) => `${label(cmd)} ${n}`).join(' · ')}
                      </td>
                      <td className={`${t.td} ${t.num} ${t.muted}`}>{utcDate(a.firstAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}

        {tab === 'commands' && (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={t.th}>Command or button</th>
                <th className={`${t.th} text-right`}>Uses</th>
                <th className={`${t.th} text-right`}>People</th>
              </tr>
            </thead>
            <tbody>
              {commands.map(([cmd, row]) => (
                <tr key={cmd} className={t.row}>
                  <td className={t.td}>{label(cmd)}</td>
                  <td className={`${t.td} ${t.num} text-right`}>{int(row.uses)}</td>
                  <td className={`${t.td} ${t.num} text-right`}>{int(row.people)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'unlinked' &&
          (data.unlinked == null ? (
            <div className="p-4 text-sm space-y-1">
              <p>The bot isn't allowed to list the server's members yet.</p>
              <p className={t.muted}>
                Turn on "Server Members Intent" for the updates bot in the Discord developer portal (Bot page,
                Privileged Gateway Intents), then press Refresh.
              </p>
            </div>
          ) : data.unlinked.length === 0 ? (
            <Empty>Everyone in the server has linked an account</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={t.th}>Discord</th>
                  <th className={t.th}>Username</th>
                  <th className={t.th}>Joined the server</th>
                </tr>
              </thead>
              <tbody>
                {[...data.unlinked]
                  .sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0))
                  .map((m) => (
                    <tr key={m.discordId} className={t.row}>
                      <td className={t.td}>{m.globalName || m.username}</td>
                      <td className={`${t.td} ${t.muted}`}>@{m.username}</td>
                      <td className={`${t.td} ${t.num} ${t.muted}`}>{utcDate(m.joinedAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ))}
      </Panel>
    </div>
  );
};

export default DiscordActivity;
