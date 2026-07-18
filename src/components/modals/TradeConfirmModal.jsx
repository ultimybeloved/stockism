import { getThemeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';
import { useAppContext } from '../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// Confirmation step for buy/sell/short/cover, shown before the trade executes.
const TradeConfirmModal = ({ confirmation, onConfirm, onCancel, loading }) => {
  useEscapeKey(onCancel);
  const { darkMode, userData } = useAppContext();
  const { borderClass, chipClass, overlayClass, modalShellClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;

  const { ticker, action, amount, total } = confirmation;
  const isDebit = action === 'buy' || action === 'short' || (action === 'cover' && total < 0);

  return (
    <div className={`${overlayClass} z-[60]`} onClick={onCancel}>
      <div
        className={`${modalShellClass} max-w-sm p-5`}
        onClick={e => e.stopPropagation()}
      >
        <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>
          Confirm {action === 'buy' ? 'Purchase' : action === 'sell' ? 'Sale' : 'Short'}
        </h3>
        <div className={`space-y-2 mb-5 ${darkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
          <div className="flex justify-between">
            <span>Stock:</span>
            <span className="font-semibold text-orange-500">${ticker}</span>
          </div>
          <div className="flex justify-between">
            <span>Action:</span>
            <span className={`font-semibold ${action === 'buy' || action === 'cover' ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
              {action.toUpperCase()}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Shares:</span>
            <span className="font-semibold">{amount}</span>
          </div>
          <div className="flex justify-between">
            <span>{action === 'short' ? 'Margin/Share:' : 'Est. Price/Share:'}</span>
            <span className="font-semibold">{formatCurrency(Math.abs(total) / amount)}</span>
          </div>
          <div className={`flex justify-between pt-2 border-t ${borderClass}`}>
            <span className="font-semibold">{action === 'short' ? 'Margin Cost:' : action === 'cover' ? (total < 0 ? 'Est. Cost:' : 'Est. Return:') : 'Est. Total:'}</span>
            <span className={`font-bold ${
              isDebit
                ? (colorBlindMode ? 'text-purple-500' : 'text-red-500') : (colorBlindMode ? 'text-teal-500' : 'text-green-500')
            }`}>
              {action === 'buy' || action === 'short'
                ? '-' : total < 0 ? '-' : '+'}{formatCurrency(Math.abs(total))}
            </span>
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
            className={`flex-1 py-2 rounded-sm font-semibold text-white ${
              action === 'buy' || action === 'cover'
                ? (colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700')
                : (colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700')
            } disabled:opacity-50`}
          >
            {loading ? 'Executing...' : `Confirm ${action.charAt(0).toUpperCase() + action.slice(1)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradeConfirmModal;
