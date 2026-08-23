import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { formatShares } from '../../utils/tradeLimits';

// Shares stepper for the trade modal: +/- buttons, direct entry, Max,
// partial-share toggle, and the empty/locked hints under it.
const TradeAmountInput = ({
  action,
  amount, setAmount,
  partialShares, setPartialShares,
  maxShares,
  marginLockedShares, marginLockHours,
}) => {
  const { darkMode } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  // Exits keep six decimals: holdings pick up fractional remainders from
  // dividends and partial fills, and rounding the box to cents would make the
  // last speck of a position untypeable (and so unsellable).
  const isExit = action === 'sell' || action === 'cover';
  const roundEntered = (v) => isExit ? Math.round(v * 1e6) / 1e6 : Math.round(v * 100) / 100;
  const smallestStep = isExit ? Math.min(0.01, maxShares) : 0.01;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <label className={`text-sm font-semibold ${textClass}`}>Shares</label>
        <label className={`flex items-center gap-1.5 text-xs ${mutedClass} cursor-pointer select-none`}>
          <input
            type="checkbox"
            checked={partialShares}
            onChange={(e) => {
              setPartialShares(e.target.checked);
              if (!e.target.checked) setAmount(Math.max(1, Math.floor(amount || 1)));
            }}
            className="cursor-pointer"
          />
          Partial shares
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => partialShares
            ? setAmount(Math.round(Math.max(0, (amount || 0.1) - 0.1) * 100) / 100)
            : setAmount(Math.max(0, (amount || 1) - 1))}
          className={`px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}
        >
          -
        </button>
        <input
          type="number"
          min="0"
          max={maxShares}
          step={partialShares ? (isExit ? 'any' : '0.01') : '1'}
          value={amount === '' ? '' : amount}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '') {
              setAmount('');
            } else {
              const num = partialShares
                ? roundEntered(parseFloat(val))
                : parseInt(val);
              if (!isNaN(num)) {
                setAmount(Math.min(maxShares, Math.max(0, num)));
              }
            }
          }}
          onBlur={() => {
            if (amount === '' || amount < 0) {
              setAmount(maxShares > 0 ? (partialShares ? smallestStep : 1) : 0);
            }
          }}
          className={`flex-1 text-center py-2 rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`}
        />
        <button
          onClick={() => partialShares
            ? setAmount(Math.min(maxShares, Math.round(((amount || 0) + 0.1) * 100) / 100))
            : setAmount(Math.min(maxShares, (amount || 0) + 1))}
          className={`px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}
        >
          +
        </button>
        <button
          onClick={() => setAmount(maxShares)}
          className={`px-3 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-teal-700 hover:bg-teal-600 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}
          disabled={maxShares === 0}
        >
          Max
        </button>
      </div>
      {maxShares === 0 && (
        <p className="text-xs text-red-500 mt-1">
          {action === 'sell'
            ? (marginLockedShares > 0 ? 'Your shares are locked from a recent margin buy' : 'No shares owned')
            : action === 'cover' ? 'No short position' : 'Insufficient funds'}
        </p>
      )}
      {maxShares > 0 && (
        <p className={`text-xs ${mutedClass} mt-1`}>Max: {formatShares(maxShares)} shares</p>
      )}
      {action === 'sell' && marginLockedShares > 0 && (
        <p className="text-xs text-amber-500 mt-1">
          🔒 {formatShares(marginLockedShares)} share{marginLockedShares === 1 ? '' : 's'} locked from a margin buy (~{marginLockHours}h left)
        </p>
      )}
    </div>
  );
};

export default TradeAmountInput;
