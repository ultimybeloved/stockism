import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, splitStockFunction } from '../../firebase';

// Admin → Recovery → Split Stock. Progress comes from a live subscription to
// the journal, not the call's return: a split can pause on its time budget and
// the connection can drop before it finishes.
export function useStockSplit(showMessage) {
  const [ticker, setTicker] = useState('');
  const [ratio, setRatio] = useState('10');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [journal, setJournal] = useState(null);

  useEffect(() => onSnapshot(
    doc(db, 'market', 'splitJournal'),
    (snap) => setJournal(snap.exists() ? snap.data() : null),
    () => setJournal(null)
  ), []);

  const incomplete = !!journal && journal.status !== 'complete';

  const call = async (mode, onOk) => {
    setBusy(true);
    try {
      const { data } = await splitStockFunction({ ticker: ticker.trim().toUpperCase(), ratio: Number(ratio), mode });
      setResult(data);
      onOk?.(data);
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const dryRun = () => {
    setResult(null);
    call('dryRun', (d) => { if (d.blocked) showMessage('error', 'Preflight failed. Fix the red rows below.'); });
  };

  const execute = () => {
    if (!result?.dryRun || result.blocked) { showMessage('error', 'Run a clean dry run first'); return; }
    if (!window.confirm(
      `SPLIT $${result.ticker} ${result.ratio}-for-1?\n\n`
      + `Price ${result.priceNow} becomes ${(result.priceNow / result.ratio).toFixed(2)}, and every holder gets `
      + `${result.ratio}x the shares. Nobody's money changes.\n\n`
      + 'The market stays halted afterwards. Check the stock, then reopen it yourself.'
    )) return;
    call('execute', (d) => {
      if (d.success) showMessage('success', `$${d.ticker} split ${d.ratio}-for-1 and verified. Reopen the market when you're happy.`);
      else if (d.paused) showMessage('error', `Paused at ${d.nextPhase}. Click Resume.`);
    });
  };

  const resume = () => call('resume', (d) => {
    if (d.success) showMessage('success', 'Split finished and verified. Reopen the market when ready.');
    else if (d.paused) showMessage('error', `Paused again at ${d.nextPhase}. Click Resume.`);
    else if (d.alreadyComplete) showMessage('success', 'That split was already complete.');
  });

  const abort = () => {
    if (!window.confirm('ABORT this split?\n\nNothing is rolled back. Some records will stay split and some not, and the stock cannot be split again until that is fixed by hand. Resume is almost always right.')) return;
    call('abort', () => showMessage('error', 'Split aborted. Market is still halted.'));
  };

  return { ticker, setTicker, ratio, setRatio, result, busy, journal, incomplete, dryRun, execute, resume, abort };
}
