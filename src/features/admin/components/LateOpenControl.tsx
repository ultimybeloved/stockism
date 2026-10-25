import { useState } from 'react';
import { useMarket } from '../../../context/AppContext';
import { adminDelayOpenFunction } from '../../../api/callables';
import { errorMessage } from '../../../utils/errors';
import { formatDateTime } from '../../../utils/localTime';

// Push today's reopen back when the chapter is late (functions/src/market/delayedOpen).
// The pre-market queue, the opening auction and the reopen posts all move with it.
export default function LateOpenControl({ mutedClass }: { mutedClass: string }) {
  const { marketData } = useMarket();
  const [minutes, setMinutes] = useState('120');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const openAt = marketData?.delayedOpen?.openAt;
  const today = openAt && new Date(openAt).toDateString() === new Date().toDateString();

  const submit = async (mins: number) => {
    setBusy(true);
    setNote('');
    try {
      const res = await adminDelayOpenFunction({ minutes: mins });
      setNote(res.data.openAt ? `Market now opens ${formatDateTime(res.data.openAt)}.` : 'Delay canceled.');
    } catch (err) {
      setNote(errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
      <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Late Open</h4>
      <p className={`text-xs mb-3 ${mutedClass}`}>
        Thursdays only, before pre-market starts. Pushes the reopen back; pre-market opens 30 minutes before the new
        time.
        {today && ` Set: opens ${formatDateTime(openAt)}.`}
      </p>
      <div className="flex gap-2 items-center">
        <input
          aria-label="Minutes late"
          type="number"
          min={5}
          max={160}
          step={5}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="w-24 p-2 rounded-sm border text-sm light:bg-white light:border-slate-300 light:text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
        />
        <span className={`text-sm ${mutedClass}`}>minutes</span>
        <button
          onClick={() => submit(Number(minutes))}
          disabled={busy}
          className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-sm hover:bg-amber-700 disabled:opacity-50"
        >
          Delay Open
        </button>
        {today && (
          <button
            onClick={() => submit(0)}
            disabled={busy}
            className="px-4 py-2 bg-slate-600 text-white text-sm font-semibold rounded-sm hover:bg-slate-700 disabled:opacity-50"
          >
            Cancel Delay
          </button>
        )}
      </div>
      {note && <p className={`text-sm mt-2 ${mutedClass}`}>{note}</p>}
    </div>
  );
}
