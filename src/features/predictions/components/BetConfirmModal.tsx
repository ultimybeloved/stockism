import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';

import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';

export interface BetConfirmation {
  predictionId: string;
  option: string;
  amount: number;
  question?: string;
}

interface BetConfirmModalProps {
  confirmation: BetConfirmation;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

// Confirmation step for weekly prediction bets.
const BetConfirmModal = ({ confirmation, onConfirm, onCancel, loading }: BetConfirmModalProps) => {
  useEscapeKey(onCancel);
  const { borderClass, chipClass, overlayClass, modalShellClass } = themeClasses;

  return (
    <div className={`${overlayClass} z-[60]`} onClick={onCancel}>
      <div className={`${modalShellClass} max-w-sm p-5`} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4 light:text-slate-900 dark:text-zinc-100">Confirm Bet</h3>
        <div className="space-y-2 mb-5 light:text-slate-700 dark:text-zinc-300">
          <div className="mb-3">
            <span className="text-sm light:text-slate-500 dark:text-zinc-400">Question:</span>
            <p className="font-medium light:text-slate-900 dark:text-zinc-100">{confirmation.question}</p>
          </div>
          <div className="flex justify-between">
            <span>Your Pick:</span>
            <span className="font-semibold text-orange-500">"{confirmation.option}"</span>
          </div>
          <div className={`flex justify-between pt-2 border-t ${borderClass}`}>
            <span className="font-semibold">Bet Amount:</span>
            <span className="font-bold text-red-500">-{formatCurrency(confirmation.amount)}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className={`flex-1 py-2 rounded-sm font-semibold ${chipClass} light:hover:bg-slate-300 dark:hover:bg-zinc-700 disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 rounded-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
          >
            {loading ? 'Placing Bet...' : 'Place Bet'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BetConfirmModal;
