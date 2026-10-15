// Market guard: the players you have confirmed as manipulators, what the bot
// has done to their pushes, and the accounts the teaming-up scan flags most.
import { useState } from 'react';
import { adminMarketGuardFunction } from '../../../../api/callables';
import { errorMessage } from '../../../../utils/errors';
import { useAdminLoad } from '../../hooks/useAdminLoad';
import { ago, int, money2, pct, utc } from '../../utils/termFormat';
import { Empty, Panel, PlayerLink, Stat, Tag } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import type { MarketGuardResponse } from '../../../../api/adminPanelTypes';

const MarketGuard = () => {
  const { data, setData, loading, error, load } = useAdminLoad(() => adminMarketGuardFunction({ action: 'list' }));
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const setConfirmed = async (uid: string, name: string, confirmed: boolean) => {
    const question = confirmed
      ? `Confirm ${name} as a manipulator? Their trades will move prices only half to three quarters as much while they still pay full price, the bot will push back on their pumps and dumps, and the stabilizer will stop handing them profit.`
      : `Take ${name} off the confirmed list?`;
    if (!window.confirm(question)) return;
    setBusy(uid);
    setFailed(null);
    try {
      const res = await adminMarketGuardFunction({ action: 'set', uid, confirmed });
      setData(res.data as MarketGuardResponse);
    } catch (err) {
      setFailed(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Empty>{error ? `Could not load: ${error}` : 'Loading market guard...'}</Empty>;

  const names = new Map(data.confirmed.map((c) => [c.uid, c.name]));
  const day = Date.now() - 86_400_000;
  const today = data.guardLog.filter((g) => g.at >= day).length;

  return (
    <div className="space-y-3">
      <div className={`${t.panel} grid grid-cols-4 gap-4 p-3`}>
        <Stat label="Confirmed" value={int(data.confirmed.length)} tone={t.red} />
        <Stat label="Guard moves, 24h" value={int(today)} tone={t.amber} />
        <Stat label="Guard moves logged" value={int(data.guardLog.length)} sub="newest 60 kept" />
        <Stat
          label="Bots last ran"
          value={data.botsUpdatedAt ? ago(data.botsUpdatedAt) : 'not yet'}
          sub={data.botsUpdatedAt ? utc(data.botsUpdatedAt) : ''}
        />
      </div>

      {failed && <div className={`${t.panel} p-3 ${t.red} text-sm`}>{failed}</div>}

      <div className="grid grid-cols-2 gap-3 items-start">
        <Panel
          title="Confirmed manipulators"
          pad={false}
          right={
            <button className={t.btn} onClick={load} disabled={loading}>
              {loading ? 'Loading' : 'Refresh'}
            </button>
          }
        >
          {data.confirmed.length === 0 ? (
            <Empty>Nobody yet. Confirm someone from the list on the right or from their player file.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={t.th}>Player</th>
                  <th className={t.th}>Confirmed</th>
                  <th className={t.th} />
                </tr>
              </thead>
              <tbody>
                {data.confirmed.map((c) => (
                  <tr key={c.uid} className={t.row}>
                    <td className={t.td}>
                      <PlayerLink uid={c.uid} name={c.name} />
                    </td>
                    <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(c.at)}</td>
                    <td className={`${t.td} text-right`}>
                      <button
                        className={t.btn}
                        disabled={busy === c.uid}
                        onClick={() => setConfirmed(c.uid, c.name, false)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Most flagged for teaming up, last 60 days" pad={false}>
          {data.candidates.length === 0 ? (
            <Empty>No flags</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={t.th}>Player</th>
                  <th className={`${t.th} text-right`}>Flags</th>
                  <th className={`${t.th} text-right`}>Tight</th>
                  <th className={t.th}>Most often with</th>
                  <th className={t.th}>Last</th>
                  <th className={t.th} />
                </tr>
              </thead>
              <tbody>
                {data.candidates.map((c) => (
                  <tr key={c.uid} className={t.row}>
                    <td className={t.td}>
                      <PlayerLink uid={c.uid} name={c.name} />
                    </td>
                    <td className={`${t.td} ${t.num} text-right`}>{c.flags}</td>
                    <td className={`${t.td} ${t.num} text-right ${c.tight ? t.amber : t.muted}`}>{c.tight}</td>
                    <td className={`${t.td} text-xs ${t.muted} whitespace-normal`}>
                      {c.partners.map((p) => `${p.name} ${p.n}x`).join(', ')}
                    </td>
                    <td className={`${t.td} ${t.num} ${t.muted}`}>{ago(c.last)}</td>
                    <td className={`${t.td} text-right`}>
                      {c.confirmed ? (
                        <Tag tone="red">confirmed</Tag>
                      ) : (
                        <button
                          className={t.btn}
                          disabled={busy === c.uid}
                          onClick={() => setConfirmed(c.uid, c.name, true)}
                        >
                          Confirm
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title="What the guard did" pad={false}>
        {data.guardLog.length === 0 ? (
          <Empty>No guard moves yet</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={t.th}>When</th>
                <th className={t.th}>Stock</th>
                <th className={`${t.th} text-right`}>From</th>
                <th className={`${t.th} text-right`}>To</th>
                <th className={`${t.th} text-right`}>Move</th>
                <th className={t.th}>Why</th>
                <th className={t.th}>Who</th>
              </tr>
            </thead>
            <tbody>
              {data.guardLog.map((g, i) => {
                const change = g.from > 0 ? (g.to / g.from - 1) * 100 : 0;
                return (
                  <tr key={`${g.at}-${g.ticker}-${i}`} className={t.row}>
                    <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(g.at)}</td>
                    <td className={`${t.td} ${t.num}`}>${g.ticker}</td>
                    <td className={`${t.td} ${t.num} text-right`}>{money2(g.from)}</td>
                    <td className={`${t.td} ${t.num} text-right`}>{money2(g.to)}</td>
                    <td className={`${t.td} ${t.num} text-right ${signClass(change)}`}>{pct(change, 2)}</td>
                    <td className={`${t.td} ${t.muted}`}>{g.reason}</td>
                    <td className={t.td}>
                      {g.uids.map((u, j) => (
                        <span key={u}>
                          {j > 0 && ', '}
                          <PlayerLink uid={u} name={names.get(u)} />
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
};

export default MarketGuard;
