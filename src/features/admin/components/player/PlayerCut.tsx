// Player file, admin actions: cut the whole account down to a target net worth.
// Always previews first; Apply sends the same numbers for real. Everything
// shrinks by one factor (cash, shares, debt), so no price moves and no margin
// call fires. See functions/src/admin/adminEnforcement.ts.
import { useState } from 'react';
import { adminCutAccountFunction } from '../../../../api/callables';
import { errorMessage } from '../../../../utils/errors';
import { money } from '../../utils/termFormat';
import { Panel } from '../shell/ui';
import { t } from '../shell/terminal';
import type { CutAccountResponse } from '../../../../api/adminPanelTypes';

const Line = ({ label, from, to }: { label: string; from?: number; to?: number }) => (
  <div className="flex justify-between text-sm">
    <span className={t.muted}>{label}</span>
    <span className={t.num}>
      {money(from)} → <span className={t.amber}>{money(to)}</span>
    </span>
  </div>
);

const PlayerCut = ({ uid, name, onChanged }: { uid: string; name: string; onChanged: () => void }) => {
  const [target, setTarget] = useState('100000');
  const [note, setNote] = useState('');
  const [dm, setDm] = useState(true);
  const [plan, setPlan] = useState<CutAccountResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const call = async (preview: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = (await adminCutAccountFunction({ uid, target: Number(target), note, dm, preview })).data;
      if (preview) setPlan(res);
      else {
        setPlan(null);
        setDone(
          `Cut to ${money(res.after)} (-${res.dropPercent}%).${dm ? (res.dmSent ? ' DM sent.' : ' DM failed.') : ''}`,
        );
        onChanged();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!plan || plan.skipped) return;
    if (!window.confirm(`Cut ${name} from ${money(plan.before)} to ${money(plan.after)}? This cannot be undone.`))
      return;
    void call(false);
  };

  return (
    <Panel title="Cut account">
      <div className="flex gap-2 items-center flex-wrap">
        <span className={t.label}>Target net worth $</span>
        <input
          className={`${t.input} w-32`}
          value={target}
          inputMode="numeric"
          onChange={(e) => {
            setTarget(e.target.value.replace(/[^\d]/g, ''));
            setPlan(null);
          }}
        />
        <label className={`text-xs ${t.muted} flex items-center gap-1`}>
          <input type="checkbox" checked={dm} onChange={(e) => setDm(e.target.checked)} /> Discord DM too
        </label>
      </div>
      <input
        className={`${t.input} w-full mt-2`}
        placeholder="Message after the percentage (optional)"
        value={note}
        maxLength={300}
        onChange={(e) => {
          setNote(e.target.value);
          setPlan(null);
        }}
      />
      <div className="flex gap-2 mt-2">
        <button className={t.btn} disabled={busy || !(Number(target) > 0)} onClick={() => void call(true)}>
          Preview
        </button>
        <button className={t.btnDanger} disabled={busy || !plan || plan.skipped} onClick={apply}>
          Apply cut
        </button>
      </div>
      {plan?.skipped && <p className={`text-xs ${t.muted} mt-2`}>Already at or under that target.</p>}
      {plan && !plan.skipped && (
        <div className="mt-3 space-y-0.5">
          <Line label="Net worth" from={plan.before} to={plan.after} />
          <Line label="Stocks" from={plan.stocks} to={plan.newStocks} />
          <Line label="Cash" from={plan.cash} to={plan.newCash} />
          <Line label="Margin debt" from={plan.debt} to={plan.newDebt} />
          {!!plan.event && <Line label="Long-term markets (kept)" from={plan.event} to={plan.event} />}
          <p className={`text-xs ${t.muted} pt-2`}>They will see: "{plan.message}"</p>
        </div>
      )}
      {done && <p className={`text-xs ${t.green} mt-2`}>{done}</p>}
      {error && <p className={`text-xs ${t.red} mt-2`}>{error}</p>}
      <p className={`text-xs ${t.muted} mt-2`}>
        Everything shrinks by the same share, so no price moves and no margin call fires. Not available while they have
        open shorts. Logged in the money records and the admin history.
      </p>
    </Panel>
  );
};

export default PlayerCut;
