import { useState } from 'react';
import { executeTradeFunction } from '../../firebase';

// The admin placing a real trade on a player's account. It goes through
// executeTrade like any other trade, so every rule, limit and price effect
// applies; the server only accepts actAsUid from the admin.
export function useTradeAsPlayer(selectedUser) {
  const [ticker, setTicker] = useState('');
  const [action, setAction] = useState('sell');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const place = async () => {
    const t = ticker.trim().toUpperCase().replace(/^\$/, '');
    const n = Number(amount);
    if (!t || !(n > 0)) return;
    if (!confirm(`Place a REAL ${action.toUpperCase()} of ${n} $${t} on ${selectedUser.displayName}'s account?\n\nIt moves the price like any trade and can't be undone.`)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await executeTradeFunction({ ticker: t, action, amount: n, actAsUid: selectedUser.id });
      setResult({ ticker: t, action, amount: n, price: data.executionPrice, total: data.totalCost });
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
    setBusy(false);
  };

  return { ticker, setTicker, action, setAction, amount, setAmount, busy, result, error, place };
}
