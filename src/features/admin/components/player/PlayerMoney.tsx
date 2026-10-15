// Player file, money tab: every recorded cash change (the ledger, newest 400),
// filterable by source, plus the per-source totals and gifts.
import { useMemo, useState } from 'react';
import { LEDGER_GROUPS, ledgerTypeInfo } from '../../../../rules/ledgerFlow';
import { int, money, money2, signedMoney, utc } from '../../utils/termFormat';
import { Empty, Panel, PlayerLink } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import type { PlayerFileResponse } from '../../../../api/adminPanelTypes';

const s = (v: unknown) => (v == null ? '' : String(v));

const PlayerMoney = ({ file }: { file: PlayerFileResponse }) => {
  const [group, setGroup] = useState('all');
  const [hideTrades, setHideTrades] = useState(true);

  const rows = useMemo(
    () =>
      file.ledger.filter((e) => {
        const info = ledgerTypeInfo(s(e.type));
        if (hideTrades && group === 'all' && info.group === 'trading' && s(e.type).startsWith('trade_')) return false;
        return group === 'all' || info.group === group;
      }),
    [file.ledger, group, hideTrades],
  );

  const totals = useMemo(() => {
    const out: Record<string, { label: string; in: number; out: number; count: number }> = {};
    for (const e of file.ledger) {
      if ((s(e.account) || 'cash') !== 'cash') continue;
      const type = s(e.type);
      const row = (out[type] ||= { label: ledgerTypeInfo(type).label, in: 0, out: 0, count: 0 });
      const a = Number(e.amount) || 0;
      if (a > 0) row.in += a;
      else row.out -= a;
      row.count++;
    }
    return Object.values(out).sort((a, b) => Math.abs(b.in - b.out) - Math.abs(a.in - a.out));
  }, [file.ledger]);

  const oldest = file.ledger[file.ledger.length - 1];

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-2 space-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          <button className={group === 'all' ? t.btnGo : t.btn} onClick={() => setGroup('all')}>
            All
          </button>
          {LEDGER_GROUPS.map((g) => (
            <button key={g.id} className={group === g.id ? t.btnGo : t.btn} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
          <label className={`ml-auto flex items-center gap-1.5 text-xs ${t.muted}`}>
            <input type="checkbox" checked={hideTrades} onChange={(e) => setHideTrades(e.target.checked)} />
            Hide stock trades under All
          </label>
        </div>
        <Panel pad={false} title={`Money record (${rows.length} shown)`}>
          {rows.length === 0 ? (
            <Empty>Nothing recorded</Empty>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--t-panel)]">
                  <tr>
                    <th className={t.th}>When (UTC)</th>
                    <th className={t.th}>What</th>
                    <th className={t.th}>Ref</th>
                    <th className={t.th}>Account</th>
                    <th className={`${t.th} text-right`}>Amount</th>
                    <th className={`${t.th} text-right`}>Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className={t.row}>
                      <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(e.timestamp)}</td>
                      <td className={t.td}>{ledgerTypeInfo(s(e.type)).label}</td>
                      <td className={`${t.td} ${t.muted} max-w-[14rem] truncate`}>{s(e.ref)}</td>
                      <td className={`${t.td} ${t.muted}`}>{s(e.account) || 'cash'}</td>
                      <td className={`${t.td} ${t.num} text-right ${signClass(Number(e.amount))}`}>
                        {signedMoney(e.amount)}
                      </td>
                      <td className={`${t.td} ${t.num} text-right ${t.muted}`}>
                        {e.cashAfter == null ? '' : money2(e.cashAfter)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <p className={`text-xs ${t.dim}`}>
          The money record began 2026-10-10.{' '}
          {file.ledger.length >= 400 ? `Showing the newest 400 entries, back to ${utc(oldest?.timestamp)}.` : ''}
        </p>
      </div>

      <div className="space-y-3">
        <Panel title="Cash by source (shown entries)" pad={false}>
          <table className="w-full text-sm">
            <tbody>
              {totals.map((r) => (
                <tr key={r.label} className={t.row}>
                  <td className={t.td}>{r.label}</td>
                  <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{int(r.count)}</td>
                  <td className={`${t.td} ${t.num} text-right ${signClass(r.in - r.out)}`}>
                    {signedMoney(r.in - r.out)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={`Gifts sent (${file.giftsSent.length})`} pad={false}>
          {file.giftsSent.length === 0 ? (
            <Empty>None</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {file.giftsSent.map((g) => (
                  <tr key={g.id} className={t.row}>
                    <td className={t.td}>
                      {s(g.itemName)} to <PlayerLink uid={s(g.toUid)} name={s(g.toName)} />
                    </td>
                    <td className={`${t.td} ${t.num} text-right`}>{money(g.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title={`Gifts received (${file.giftsReceived.length})`} pad={false}>
          {file.giftsReceived.length === 0 ? (
            <Empty>None</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {file.giftsReceived.map((g) => (
                  <tr key={g.id} className={t.row}>
                    <td className={t.td}>
                      {s(g.itemName)} from <PlayerLink uid={s(g.fromUid)} name={s(g.fromName)} />
                    </td>
                    <td className={`${t.td} ${t.num} text-right`}>{money(g.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
};

export default PlayerMoney;
