import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { BAILOUT_CASH } from '../../../constants';
import { useSession } from '../../../context/AppContext';

import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';

// Bankruptcy bailout confirmation — destructive last resort (clears holdings,
// permanent crew exile), so the consequences are spelled out before confirming.
interface BailoutModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const BailoutModal = ({ onConfirm, onCancel, loading }: BailoutModalProps) => {
  useEscapeKey(onCancel);
  const { userData } = useSession();
  const { ghostBtnClass, overlayClass, modalShellClass } = themeClasses;
  const colorBlindMode = userData?.colorBlindMode || false;

  return (
    <div className={`${overlayClass} z-50`} onClick={onCancel}>
      <div className={`${modalShellClass} max-w-md p-6`} onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">💸</div>
          <h2 className="text-xl font-bold light:text-slate-900 dark:text-zinc-100">Bankruptcy Bailout</h2>
        </div>

        <div
          className={`p-4 rounded-sm mb-4 ${colorBlindMode ? 'light:bg-purple-50 light:border light:border-purple-200 dark:bg-purple-900/30 dark:border dark:border-purple-700' : 'light:bg-red-50 light:border light:border-red-200 dark:bg-red-900/30 dark:border dark:border-red-700'}`}
        >
          <p
            className={`text-center font-semibold ${colorBlindMode ? 'light:text-purple-600 dark:text-purple-400' : 'light:text-red-600 dark:text-red-400'}`}
          >
            You are {formatCurrency(Math.abs(userData?.cash || 0))} in debt
          </p>
        </div>

        <div className="text-sm light:text-slate-600 dark:text-zinc-300 mb-4 space-y-2">
          <p>
            Accept a bailout to clear your debt and restart with{' '}
            <strong className={colorBlindMode ? 'text-teal-500' : 'text-green-500'}>
              {formatCurrency(BAILOUT_CASH)}
            </strong>
            .
          </p>
          <p className="text-amber-500 font-semibold">⚠️ Consequences:</p>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              You will be <strong>removed from your crew</strong> and can't rejoin it for <strong>30 days</strong>
            </li>
            <li>All holdings and shorts will be cleared</li>
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className={`flex-1 py-2 rounded-sm border ${ghostBtnClass} disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2 rounded-sm text-white font-semibold ${colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50`}
          >
            {loading ? 'Processing...' : 'Accept Bailout'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BailoutModal;
