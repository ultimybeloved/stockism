import { getThemeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';
import { useAppContext } from '../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// Confirmation step for weekly prediction bets.
const BetConfirmModal = ({ confirmation, onConfirm, onCancel, loading }) => {
  useEscapeKey(onCancel);
  const { darkMode } = useAppContext();
  const { borderClass, chipClass, overlayClass, modalShellClass } = getThemeClasses(darkMode);

  return (
    <div className={`${overlayClass} z-[60]`} onClick={onCancel}>
      <div
        className={`${modalShellClass} max-w-sm p-5`}
        onClick={e => e.stopPropagation()}
      >
        <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>
          Confirm Bet
        </h3>
        <div className={`space-y-2 mb-5 ${darkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
          <div className="mb-3">
            <span className={`text-sm ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Question:</span>
            <p className={`font-medium ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>{confirmation.question}</p>
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
            className={`flex-1 py-2 rounded-sm font-semibold ${chipClass} ${darkMode ? 'hover:bg-zinc-700' : 'hover:bg-slate-300'} disabled:opacity-50`}
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
