import { useTradeAsPlayer } from '../../../hooks/admin/useTradeAsPlayer';
import { formatCurrency } from '../../../utils/formatters';

// Admin → Users → one player: place a real trade on their account.
const UserTradeAs = ({ mutedClass, inputClass, selectedUser }) => {
  const { ticker, setTicker, action, setAction, amount, setAmount, busy, result, error, place } = useTradeAsPlayer(selectedUser);

  return (
    <div className="mb-4">
      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Trade as this player</h4>
      <div className="flex gap-2 flex-wrap items-center">
        <select value={action} onChange={(e) => setAction(e.target.value)} className={inputClass}>
          <option value="sell">Sell</option>
          <option value="buy">Buy</option>
          <option value="cover">Cover</option>
          <option value="short">Short</option>
        </select>
        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Shares" className={`w-24 ${inputClass}`} />
        <input type="text" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker" className={`w-24 ${inputClass}`} />
        <button
          onClick={place}
          disabled={busy || !ticker.trim() || !(Number(amount) > 0)}
          className="px-3 py-1 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Placing…' : 'Place trade'}
        </button>
      </div>
      <p className={`text-xs ${mutedClass} mt-1`}>
        A real trade on their account, under every normal rule. Logged as placed by the admin.
      </p>
      {result && (
        <p className="text-xs text-green-500 mt-1">
          {result.action} {result.amount} ${result.ticker} at {formatCurrency(result.price)} ({formatCurrency(result.total)}).
        </p>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
};

export default UserTradeAs;
