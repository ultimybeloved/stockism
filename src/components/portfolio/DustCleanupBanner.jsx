import { useState } from 'react';
import { formatCurrency } from '../../utils/formatters';

// Small banner shown above the long-positions list when the user has tiny
// (sub-$5) positions. Two-step confirm so it can't be hit by accident.
const DustCleanupBanner = ({ count, total, sweeping, onConfirm, darkMode }) => {
  const [confirming, setConfirming] = useState(false);

  const secondaryBtn = darkMode
    ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
    : 'bg-slate-200 text-slate-600 hover:bg-slate-300';

  return (
    <div
      className={`mb-3 p-3 rounded-sm border flex items-center justify-between gap-3 ${
        darkMode ? 'border-zinc-700 bg-zinc-800/60' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div>
        <p className={`text-sm font-semibold ${darkMode ? 'text-zinc-200' : 'text-slate-700'}`}>
          {count} tiny position{count === 1 ? '' : 's'} worth about {formatCurrency(total)}
        </p>
        <p className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
          Sell them all to cash in one go. Locked shares are left alone.
        </p>
      </div>

      {confirming ? (
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onConfirm}
            disabled={sweeping}
            className="px-3 py-1.5 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
          >
            {sweeping ? 'Cleaning...' : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={sweeping}
            className={`px-3 py-1.5 text-sm font-semibold rounded-sm disabled:opacity-50 ${secondaryBtn}`}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="px-3 py-1.5 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white shrink-0"
        >
          Clean up
        </button>
      )}
    </div>
  );
};

export default DustCleanupBanner;
