import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';

// Limit-order / stop-loss toggles and their price + partial-fill settings.
// Only rendered for buy/sell (short/cover don't support pending orders).
const LimitOrderControls = ({
  action,
  price,
  isLimitOrder, setIsLimitOrder,
  isStopLoss, setIsStopLoss,
  limitPrice, setLimitPrice,
  allowPartialFills, setAllowPartialFills,
}) => {
  const { darkMode } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);

  return (
    <>
      <div className="mb-4 space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isLimitOrder}
            onChange={(e) => {
              setIsLimitOrder(e.target.checked);
              if (e.target.checked) {
                setIsStopLoss(false);
                setLimitPrice(price.toFixed(2));
              }
            }}
            className="w-4 h-4"
          />
          <span className={`text-sm font-semibold ${textClass}`}>Place as limit order</span>
        </label>
        {action === 'sell' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isStopLoss}
              onChange={(e) => {
                setIsStopLoss(e.target.checked);
                if (e.target.checked) {
                  setIsLimitOrder(false);
                  setLimitPrice(price.toFixed(2));
                }
              }}
              className="w-4 h-4"
            />
            <span className={`text-sm font-semibold ${textClass}`}>Place as stop loss</span>
          </label>
        )}
        <p className={`text-xs ${mutedClass} ml-6`}>
          {isStopLoss
            ? 'Auto-sells when price drops to your stop price (30-day expiration)'
            : isLimitOrder
              ? 'Order will execute when price conditions are met (30-day expiration)'
              : action === 'sell'
                ? 'Limit order sells when price rises. Stop loss sells when price drops.'
                : 'Order will execute when price drops to your limit price.'}
        </p>
      </div>

      {(isLimitOrder || isStopLoss) && (
        <div className={`p-3 rounded-sm mb-4 space-y-3 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
          <div>
            <label className={`block text-sm font-semibold mb-1 ${textClass}`}>
              {isStopLoss ? 'Stop Price' : 'Limit Price'}
              <span className={`ml-2 text-xs ${mutedClass}`}>
                (Current: {formatCurrency(price)})
              </span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="0.00"
              className={`w-full px-3 py-2 border rounded-sm ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`}
            />
            <p className={`text-xs ${mutedClass} mt-1`}>
              {isStopLoss
                ? 'Sells when price drops to or below this price'
                : action === 'buy' || action === 'cover'
                  ? 'Order executes when price drops to or below this price'
                  : 'Order executes when price rises to or above this price'}
            </p>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allowPartialFills}
                onChange={(e) => setAllowPartialFills(e.target.checked)}
                className="w-4 h-4"
              />
              <span className={`text-sm ${textClass}`}>Allow partial fills</span>
            </label>
            <p className={`text-xs ${mutedClass} mt-1 ml-6`}>
              If unchecked, order only executes if all shares can be traded
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default LimitOrderControls;
