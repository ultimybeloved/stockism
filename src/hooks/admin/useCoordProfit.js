import { useState } from 'react';
import { getCoordProfitFunction, adminRemoveCoordProfitFunction } from '../../firebase';

// What one flagged player's coordinated pushes made them, and removing it.
// Loads on demand: it reads the player's whole trade history.
export function useCoordProfit(player) {
  const [profit, setProfit] = useState(null);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { console.error(err); setError(err.message); }
    setBusy(false);
  };

  const load = () => run(async () => {
    const { data } = await getCoordProfitFunction({ uid: player.uid });
    setProfit(data);
    setAmount(String(Math.round(data.suggested)));
    setPreview(data.suggested > 0 ? data.preview : null);
  });

  const checkAmount = () => run(async () => {
    const { data } = await adminRemoveCoordProfitFunction({ uid: player.uid, amount: Number(amount), preview: true });
    setPreview(data);
  });

  const remove = () => run(async () => {
    const n = Number(amount);
    if (!confirm(`Remove $${n.toLocaleString()} from ${player.name}?\n\nCash goes first; the rest is added to their margin balance. They get a notice with the amount. This cannot be undone.`)) return;
    const { data } = await adminRemoveCoordProfitFunction({ uid: player.uid, amount: n, memo });
    setDone(data);
  });

  return { profit, amount, setAmount, memo, setMemo, preview, busy, error, done, load, checkAmount, remove };
}
