// Player file, security tab: who trades alongside this player. Runs on demand
// (it reads every trade on every stock they touched), see adminCoTraders in
// functions/src/admin/adminEnforcement.ts.
import { useState } from 'react';
import { adminCoTradersFunction } from '../../../../api/callables';
import { errorMessage } from '../../../../utils/errors';
import { money } from '../../utils/termFormat';
import { Empty, Panel, PlayerLink } from '../shell/ui';
import { t } from '../shell/terminal';
import type { CoTradersResponse } from '../../../../api/adminPanelTypes';

const DAY_CHOICES = [7, 30, 90];

const PlayerCoTraders = ({ uid }: { uid: string }) => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CoTradersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setData((await adminCoTradersFunction({ uid, days })).data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const who = (p: { uid: string; name: string | null; deleted: boolean }) =>
    p.deleted ? <span className={t.dim}>(deleted {p.uid.slice(0, 6)})</span> : <PlayerLink uid={p.uid} name={p.name} />;

  return (
    <Panel
      title="Who trades with them"
      right={
        <>
          <select className={t.input} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          <button className={t.btn} disabled={busy} onClick={() => void run()}>
            {busy ? 'Checking' : 'Check'}
          </button>
        </>
      }
      pad={false}
    >
      {error && <p className={`text-xs ${t.red} p-3`}>{error}</p>}
      {!data ? (
        <Empty>Players who traded the same stock the same way within 10 minutes of them. Takes a few seconds.</Empty>
      ) : data.rows.length === 0 ? (
        <Empty>
          Nobody traded alongside them in {data.days} days ({data.trades} trades checked).
        </Empty>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <p className={`text-xs ${t.muted} px-3 pt-2`}>
            {data.trades} of their trades in {data.days} days. "Together" is how many of those someone matched; compare
            it with their own trade count to tell a shadow from someone who just trades a lot.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={t.th}>Player</th>
                <th className={t.th}>Together</th>
                <th className={t.th}>Own trades</th>
                <th className={t.th}>Shared flags</th>
                <th className={t.th}>Value</th>
                <th className={t.th}>Stocks</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.uid} className={t.row}>
                  <td className={t.td}>{who(r)}</td>
                  <td className={`${t.td} ${t.num} ${t.amber}`}>{r.matches}</td>
                  <td className={`${t.td} ${t.num}`}>{r.ownTrades}</td>
                  <td className={`${t.td} ${t.num} ${r.sharedFlags ? t.red : t.muted}`}>{r.sharedFlags}</td>
                  <td className={`${t.td} ${t.num}`}>{money(r.value)}</td>
                  <td className={`${t.td} text-xs ${t.muted}`}>{r.tickers.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.flagOnly.length > 0 && (
            <p className={`text-xs ${t.muted} p-3`}>
              Shared a coordination flag but didn&apos;t trade alongside in this window:{' '}
              {data.flagOnly.map((p, i) => (
                <span key={p.uid}>
                  {i > 0 && ', '}
                  {who(p)} x{p.sharedFlags}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
};

export default PlayerCoTraders;
