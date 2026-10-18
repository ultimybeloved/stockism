// Player file, security tab: sign-in details, Discord account age, the
// connections they've traded from, watchlist status and the alerts that
// mention them.
import type { ReactNode } from 'react';
import { discordCreatedAtMs } from '../../../../rules/welcome';
import { int, utc } from '../../utils/termFormat';
import { Empty, Panel, PlayerLink, Tag } from '../shell/ui';
import { t } from '../shell/terminal';
import type { PlayerFileResponse } from '../../../../api/adminPanelTypes';

const s = (v: unknown) => (v == null ? '' : String(v));

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 py-1 border-b border-[var(--t-line)] text-sm">
    <span className={t.muted}>{label}</span>
    <span className={`${t.num} text-right break-all`}>{children}</span>
  </div>
);

const PlayerSecurity = ({ file }: { file: PlayerFileResponse }) => {
  const u = file.user;
  const a = file.auth;
  const discordAge = u.discordId ? discordCreatedAtMs(String(u.discordId)) : null;

  // Connections seen on their recent trades, most used first.
  const ips: Record<string, { count: number; last: number }> = {};
  for (const tr of [...file.trades, ...file.eventTrades]) {
    const ip = s(tr.ip);
    if (!ip) continue;
    const at = Number(tr.timestamp) || 0;
    const row = (ips[ip] ||= { count: 0, last: 0 });
    row.count++;
    row.last = Math.max(row.last, at);
  }
  const ipRows = Object.entries(ips).sort((x, y) => y[1].count - x[1].count);
  const signupIp = s(u.signupIp).replace(/_/g, '.');
  const watched = file.watched as Record<string, unknown> | null;

  // Every Discord that came off this account: self-unlinks leave a binding,
  // admin unlinks and moves leave an admin history entry.
  const field = (v: unknown, k: string) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : null);
  const pastDiscords = [
    ...(file.pastDiscords || []).map((b) => ({
      id: s(b.id),
      name: s(b.discordUsername),
      at: Number(b.boundAt) || 0,
      how: 'they unlinked',
    })),
    ...file.adminActions
      .filter((x) => x.action === 'unlink_discord' || x.action === 'move_discord_link')
      .map((x) => ({
        id: s(field(x.before, 'discordId') || field(x.before, 'targetDiscordId')),
        name: s(field(x.before, 'discordUsername')),
        at: Number(x.at) || 0,
        how: x.action === 'unlink_discord' ? 'admin unlinked' : 'admin moved',
      })),
  ]
    .filter((d) => d.id)
    .sort((x, y) => y.at - x.at);

  return (
    <div className="grid grid-cols-3 gap-3">
      <Panel title="Sign-in">
        {a ? (
          <>
            <Fact label="Email">{a.email || '-'}</Fact>
            <Fact label="Email verified">{a.emailVerified ? 'yes' : 'no'}</Fact>
            <Fact label="Signs in with">{a.providers.join(', ') || '-'}</Fact>
            <Fact label="Account created">{utc(a.createdAt)}</Fact>
            <Fact label="Last sign-in">{utc(a.lastSignInAt)}</Fact>
            <Fact label="Last token refresh">{utc(a.lastRefreshAt)}</Fact>
            <Fact label="Sign-in disabled">{a.disabled ? 'yes' : 'no'}</Fact>
          </>
        ) : (
          <Empty>No sign-in record</Empty>
        )}
        <Fact label="Signup connection">{signupIp || '-'}</Fact>
      </Panel>

      <Panel title="Discord">
        {u.discordId ? (
          <>
            <Fact label="Username">{u.discordUsername ? `@${u.discordUsername}` : '-'}</Fact>
            <Fact label="ID">{s(u.discordId)}</Fact>
            <Fact label="Discord account made">{utc(discordAge)}</Fact>
            <Fact label="Account age">
              {discordAge ? `${int(Math.floor((Date.now() - discordAge) / 86400000))} days` : '-'}
            </Fact>
            <Fact label="Bot uses">{int(file.discordActivity?.total)}</Fact>
            <Fact label="Last bot use">{utc(file.discordActivity?.lastAt)}</Fact>
          </>
        ) : (
          <p className={`text-sm ${t.muted}`}>Not linked.</p>
        )}
        <Fact label="Starting cash unlocked">{u.startingCashUnlocked === false ? 'no' : 'yes'}</Fact>
        <Fact label="Must link Discord to trade">{u.requiresDiscordLink ? 'yes' : 'no'}</Fact>
        <p className={`text-xs ${t.muted} mt-3 mb-1`}>Past Discord links</p>
        {pastDiscords.length ? (
          pastDiscords.map((d) => (
            <Fact key={`${d.id}-${d.at}`} label={`${d.name ? `@${d.name}` : d.id} (${d.how})`}>
              {d.name ? `${d.id}, ` : ''}
              {utc(d.at)}
            </Fact>
          ))
        ) : (
          <p className={`text-sm ${t.muted}`}>None.</p>
        )}
      </Panel>

      <Panel title="Watchlist">
        {watched ? (
          <>
            <div className="mb-2">
              <Tag tone="red">watched</Tag>
            </div>
            <Fact label="Reason">{s(watched.reason) || '-'}</Fact>
            <Fact label="Added">{utc(watched.addedAt)}</Fact>
            <Fact label="Known connections">{Array.isArray(watched.knownIPs) ? watched.knownIPs.length : '-'}</Fact>
            <Fact label="Linked accounts">
              {Array.isArray(watched.linkedAccounts) ? watched.linkedAccounts.length : '-'}
            </Fact>
            <Fact label="Still active">{watched.isActive === false ? 'no' : 'yes'}</Fact>
          </>
        ) : (
          <p className={`text-sm ${t.muted}`}>Not on the watchlist.</p>
        )}
      </Panel>

      <Panel title={`Connections used on recent trades (${ipRows.length})`} pad={false} className="col-span-1">
        {ipRows.length === 0 ? (
          <Empty>None recorded</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={t.th}>Connection</th>
                <th className={`${t.th} text-right`}>Trades</th>
                <th className={t.th}>Last</th>
              </tr>
            </thead>
            <tbody>
              {ipRows.map(([ip, r]) => (
                <tr key={ip} className={t.row}>
                  <td className={`${t.td} ${t.num}`}>
                    {ip} {ip === signupIp && <Tag>signup</Tag>}
                  </td>
                  <td className={`${t.td} ${t.num} text-right`}>{r.count}</td>
                  <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(r.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Alerts that mention them (${file.watchAlerts.length})`} pad={false} className="col-span-2">
        {file.watchAlerts.length === 0 ? (
          <Empty>None</Empty>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {[...file.watchAlerts]
                  .sort((x, y) => (Number(y.timestamp) || 0) - (Number(x.timestamp) || 0))
                  .map((al) => {
                    const other = s(al.watchedUID) === file.uid ? s(al.relatedUID) : s(al.watchedUID);
                    return (
                      <tr key={al.id} className={t.row}>
                        <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(al.timestamp)}</td>
                        <td className={t.td}>
                          <Tag tone={al.reviewed ? 'dim' : 'amber'}>{s(al.type).replace(/_/g, ' ')}</Tag>
                        </td>
                        <td className={t.td}>{other ? <PlayerLink uid={other} /> : null}</td>
                        <td className={`${t.td} whitespace-normal text-xs ${t.muted}`}>{s(al.details)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};

export default PlayerSecurity;
