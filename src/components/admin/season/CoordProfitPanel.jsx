import { useCoordProfit } from '../../../hooks/admin/useCoordProfit';
import { formatCurrency } from '../../../utils/formatters';

// Under one flagged player: what each coordinated push made them, and a way to
// take it back. Nothing happens until the admin presses Remove.
const CoordProfitPanel = ({ player, textClass, mutedClass, inputClass }) => {
  const {
    profit, amount, setAmount, memo, setMemo, preview, busy, error, done, load, checkAmount, remove,
  } = useCoordProfit(player);

  if (!profit) {
    return (
      <button onClick={load} disabled={busy} className={`text-xs underline ${mutedClass} disabled:opacity-50`}>
        {busy ? 'Working it out…' : 'What did this make them?'}
      </button>
    );
  }

  const pct = (r) => `${Math.round(r * 100)}%`;

  return (
    <div className={`text-xs ${mutedClass} mt-1 space-y-1`}>
      {profit.pushes.length === 0 && <p>No trades by them inside any flagged push.</p>}
      {profit.pushes.map((p) => (
        <div key={`${p.ticker}${p.days[0]}`}>
          <span className={`font-semibold ${textClass}`}>${p.ticker}</span> {p.days.join(', ')}: locked in{' '}
          {formatCurrency(p.lockedIn)}, gain since {formatCurrency(p.gainSince)} ({p.trades} trades)
        </div>
      ))}
      <p className={textClass}>
        Suggested: <span className="font-semibold">{formatCurrency(profit.suggested)}</span>
      </p>

      {done ? (
        <p className="text-green-500">
          Removed {formatCurrency(done.amount)}: {done.shares.map((x) => `${x.shares.toLocaleString()} $${x.ticker}`).join(', ')}
          {done.fromCash > 0 && `, ${formatCurrency(done.fromCash)} cash`}{done.toDebt > 0 && `, ${formatCurrency(done.toDebt)} to margin`}.
        </p>
      ) : profit.suggested > 0 && (
        <>
          <div className="flex gap-2 items-center flex-wrap">
            <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={`w-28 ${inputClass}`} />
            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo (why)" className={`flex-1 min-w-[8rem] ${inputClass}`} />
            <button onClick={checkAmount} disabled={busy || !(Number(amount) > 0)} className="px-2 py-1 rounded bg-slate-500 text-white disabled:opacity-50">
              Check
            </button>
            <button onClick={remove} disabled={busy || !(Number(amount) > 0) || !memo.trim()} className="px-2 py-1 rounded bg-red-600 text-white font-semibold disabled:opacity-50">
              Remove
            </button>
          </div>
          {preview && (
            <p>
              Takes {preview.shares.map((x) => `${x.shares.toLocaleString()} $${x.ticker}`).join(', ') || 'no shares'}
              {preview.fromCash > 0 && `, ${formatCurrency(preview.fromCash)} cash`}
              {preview.toDebt > 0 && `, ${formatCurrency(preview.toDebt)} added to margin`}.
              Equity after: <span className={preview.equityRatioAfter < preview.marginCallLine ? 'text-red-500 font-semibold' : textClass}>
                {pct(preview.equityRatioAfter)}
              </span>{preview.equityRatioAfter < preview.marginCallLine && ` (under the ${pct(preview.marginCallLine)} margin-call line; they'll be told to sell)`}.
            </p>
          )}
        </>
      )}
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
};

export default CoordProfitPanel;
