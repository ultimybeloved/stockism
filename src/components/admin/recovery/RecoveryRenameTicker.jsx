import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { PreflightTable, DryRunBreakdown, PhaseProgress } from './RecoveryRenameStatus';

// Admin front end for the ticker rename engine (functions/services/tickerRename.js).
//
// Progress comes from a live subscription to market/tickerRename rather than
// from the callable's return value. A rename can run for minutes and pause on a
// time budget, and the HTTP connection often dies before it finishes — the
// journal keeps updating either way.
const RecoveryRenameTicker = ({
  darkMode, textClass, mutedClass,
  renameOldTicker, setRenameOldTicker,
  renameNewTicker, setRenameNewTicker,
  renameResult, setRenameResult,
  showMessage, renameTickerFunction,
}) => {
  // Owned here, not a prop, so the buttons actually disable while a run is in
  // flight — a rename halts the whole market and must never fire twice.
  const [renaming, setRenaming] = useState(false);
  const [journal, setJournal] = useState(null);

  useEffect(() => onSnapshot(
    doc(db, 'market', 'tickerRename'),
    (snap) => setJournal(snap.exists() ? snap.data() : null),
    () => setJournal(null)
  ), []);

  const incomplete = journal && journal.status !== 'complete';
  const inputClass = `w-full px-3 py-2 border rounded-sm text-sm font-mono ${
    darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
  }`;

  const call = async (mode, onOk) => {
    setRenaming(true);
    try {
      const res = await renameTickerFunction({
        oldTicker: renameOldTicker.trim(),
        newTicker: renameNewTicker.trim(),
        mode,
      });
      setRenameResult(res.data);
      onOk?.(res.data);
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setRenaming(false);
    }
  };

  const runDryRun = () => {
    if (!renameOldTicker.trim() || !renameNewTicker.trim()) {
      showMessage('error', 'Enter both tickers');
      return;
    }
    setRenameResult(null);
    call('dryRun', (d) => {
      if (d.blocked) showMessage('error', 'Preflight failed. Fix the red rows below.');
    });
  };

  const execute = () => {
    if (!renameResult?.dryRun || renameResult.blocked) {
      showMessage('error', 'Run a clean dry run first');
      return;
    }
    const total = Object.values(renameResult.breakdown || {}).reduce((s, n) => s + (n || 0), 0);
    if (!window.confirm(
      `RENAME $${renameOldTicker} to $${renameNewTicker}?\n\n`
      + `${total} documents will be rewritten.\n`
      + 'The market halts now and reopens only when the rename verifies clean.\n\n'
      + 'If it fails or pauses, the market STAYS halted. Resume it from here.'
    )) return;
    call('execute', (d) => {
      if (d.success) showMessage('success', `Renamed $${d.oldTicker} to $${d.newTicker}. Market reopened.`);
      else if (d.paused) showMessage('error', `Paused after ${d.nextPhase}. Market is still halted — click Resume.`);
    });
  };

  const resume = () => call('resume', (d) => {
    if (d.success) showMessage('success', 'Rename finished. Market reopened.');
    else if (d.paused) showMessage('error', `Paused again at ${d.nextPhase}. Click Resume.`);
    else if (d.alreadyComplete) showMessage('success', 'That rename was already complete.');
  });

  const abort = () => {
    if (!window.confirm(
      'ABORT this rename?\n\n'
      + 'This does NOT roll anything back and does NOT reopen the market. '
      + 'The database stays part-renamed and you will need to finish it by hand.\n\n'
      + 'Resume is almost always the better option.'
    )) return;
    call('abort', () => showMessage('error', 'Rename aborted. Market is still halted.'));
  };

  // Written out in full rather than interpolated: Tailwind scans source text,
  // so a class built from a variable is purged and the button ships with no
  // background at all.
  const BTN = 'flex-1 px-4 py-2 text-white font-semibold rounded-sm disabled:opacity-50';
  const btn = (color) => `${BTN} ${{
    blue: 'bg-blue-600 hover:bg-blue-700',
    red: 'bg-red-600 hover:bg-red-700',
    amber: 'bg-amber-600 hover:bg-amber-700',
  }[color]}`;

  return (
    <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
      <h3 className={`font-semibold mb-2 ${textClass}`}>🔄 Rename Ticker</h3>
      <p className={`text-xs ${mutedClass} mb-3`}>
        Rewrites the ticker everywhere the game computes on it: prices, history,
        holdings, loyalty lots, open orders, alerts and the index. Records that
        are only history keep the old name and resolve through an alias. Always
        dry run first.
      </p>

      <div className={`p-2.5 rounded-sm mb-3 text-xs ${darkMode ? 'bg-amber-900/30 border border-amber-700 text-amber-200' : 'bg-amber-50 border border-amber-300 text-amber-900'}`}>
        <strong>Do this first.</strong> Edit src/characters.js and src/crews.js,
        run <code>npm run check:data</code>, <code>npm run sync:chars</code>, then
        deploy functions. Preflight refuses until the new name is live in the
        deployed roster. Renaming before deploying can re-seed the old ticker as
        a duplicate stock.
      </div>

      {incomplete && (
        <div className="p-2.5 rounded-sm mb-3 text-xs bg-red-900/40 border border-red-600 text-red-200">
          <strong>MARKET IS HALTED.</strong> The rename {journal.old} → {journal.new} is{' '}
          {journal.status}. Resume it or abort it here. Do not un-halt the market by hand.
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Old Ticker</label>
          <input type="text" placeholder="e.g. BUFF" value={renameOldTicker} disabled={renaming}
            onChange={(e) => setRenameOldTicker(e.target.value.toUpperCase())} className={inputClass} />
        </div>
        <div className="flex items-end pb-2"><span className={`text-lg ${mutedClass}`}>→</span></div>
        <div className="flex-1">
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>New Ticker</label>
          <input type="text" placeholder="e.g. YOKO" value={renameNewTicker} disabled={renaming}
            onChange={(e) => setRenameNewTicker(e.target.value.toUpperCase())} className={inputClass} />
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <button onClick={runDryRun} className={btn('blue')}
          disabled={renaming || !renameOldTicker.trim() || !renameNewTicker.trim()}>
          {renaming ? 'Working...' : '🔍 Dry Run'}
        </button>
        {incomplete ? (
          <>
            <button onClick={resume} className={btn('amber')} disabled={renaming}>
              {renaming ? 'Working...' : '▶️ Resume'}
            </button>
            <button onClick={abort} className={btn('red')} disabled={renaming}>Abort</button>
          </>
        ) : (
          <button onClick={execute} className={btn('red')}
            disabled={renaming || !renameResult?.dryRun || renameResult?.blocked}>
            {renaming ? 'Executing...' : '⚡ Execute Rename'}
          </button>
        )}
      </div>

      <PhaseProgress journal={journal} textClass={textClass} mutedClass={mutedClass} darkMode={darkMode} />

      {renameResult?.dryRun && (
        <>
          <PreflightTable checks={renameResult.checks} textClass={textClass}
            mutedClass={mutedClass} darkMode={darkMode} />
          {!renameResult.blocked && (
            <DryRunBreakdown result={renameResult} textClass={textClass}
              mutedClass={mutedClass} darkMode={darkMode} />
          )}
        </>
      )}

      {renameResult?.success && (
        <div className={`p-3 rounded-sm ${darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-300'}`}>
          <p className="text-sm font-semibold text-green-400 mb-1">✅ Rename complete and verified</p>
          <p className={`text-xs ${textClass}`}>
            ${renameResult.oldTicker} → ${renameResult.newTicker}.{' '}
            {renameResult.marketHalted
              ? 'Market left halted because it was already halted when this started.'
              : 'Market reopened.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default RecoveryRenameTicker;
