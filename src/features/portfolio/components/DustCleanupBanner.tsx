import { useState } from 'react';
import { formatCurrency } from '../../../utils/formatters';

interface DustCleanupBannerProps {
  count: number;
  total: number;
  sweeping: boolean;
  onConfirm: () => void;
}

// Small banner shown above the long-positions list when the user has tiny
// (sub-$5) positions. Two-step confirm so it can't be hit by accident.
const DustCleanupBanner = ({ count, total, sweeping, onConfirm }: DustCleanupBannerProps) => {
  const [confirming, setConfirming] = useState(false);

  const secondaryBtn =
    'light:bg-slate-200 light:text-slate-600 light:hover:bg-slate-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600';

  return (
    <div className="mb-3 p-3 rounded-sm border flex items-center justify-between gap-3 light:border-amber-200 light:bg-amber-50 dark:border-zinc-700 dark:bg-zinc-800/60">
      <div>
        <p className="text-sm font-semibold light:text-slate-700 dark:text-zinc-200">
          {count} tiny position{count === 1 ? '' : 's'} worth about {formatCurrency(total)}
        </p>
        <p className="text-xs light:text-slate-500 dark:text-zinc-400">
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
