import { useState } from 'react';
import PixelIcon from '../../../shared/components/PixelIcon';

// Rerolls today's missions and this week's mission for $50. The first tap asks
// to confirm; tapping anywhere else backs out.
export default function RerollButton({ onReroll, loading }: { onReroll: () => unknown; loading?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      onClick={() => {
        if (!confirming) return setConfirming(true);
        setConfirming(false);
        onReroll();
      }}
      onBlur={() => setConfirming(false)}
      disabled={loading}
      className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-sm transition-colors shrink-0 ${
        loading
          ? 'opacity-50 cursor-not-allowed'
          : 'light:bg-amber-200 light:hover:bg-amber-300 light:text-amber-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200'
      }`}
      title="Reroll today's missions and this week's mission ($50)"
    >
      {loading ? (
        '...'
      ) : confirming ? (
        'Confirm reroll for $50?'
      ) : (
        <>
          <PixelIcon name="reroll" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
          Reroll $50
        </>
      )}
    </button>
  );
}
