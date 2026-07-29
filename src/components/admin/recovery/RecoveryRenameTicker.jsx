import { useState } from 'react';

// Extracted from RecoveryTab.jsx, which was past the 400-line component limit.
const RecoveryRenameTicker = ({ darkMode, textClass, mutedClass, renameOldTicker, setRenameOldTicker, renameNewTicker, setRenameNewTicker, renameResult, setRenameResult, showMessage, renameTickerFunction }) => {
  // Owned here (not a prop) so the rename buttons actually disable while a
  // rename/dry-run is in flight — renameTicker halts the whole market, so a
  // double-click must never fire it twice.
  const [renaming, setRenaming] = useState(false);

  return (
    <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
      <h3 className={`font-semibold mb-2 ${textClass}`}>🔄 Rename Ticker</h3>
      <p className={`text-xs ${mutedClass} mb-3`}>
        Rename a ticker across ALL Firestore data (market prices, user holdings, trades, limit orders, IP tracking).
        Always do a Dry Run first. The market will be automatically halted during execution.
      </p>

      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Old Ticker</label>
          <input
            type="text"
            placeholder="e.g. JSN"
            value={renameOldTicker}
            onChange={e => setRenameOldTicker(e.target.value.toUpperCase())}
            className={`w-full px-3 py-2 border rounded-sm text-sm font-mono ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
            disabled={renaming}
          />
        </div>
        <div className="flex items-end pb-0.5">
          <span className={`text-lg ${mutedClass}`}>→</span>
        </div>
        <div className="flex-1">
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>New Ticker</label>
          <input
            type="text"
            placeholder="e.g. JASON"
            value={renameNewTicker}
            onChange={e => setRenameNewTicker(e.target.value.toUpperCase())}
            className={`w-full px-3 py-2 border rounded-sm text-sm font-mono ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
            disabled={renaming}
          />
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <button
          onClick={async () => {
            if (!renameOldTicker.trim() || !renameNewTicker.trim()) {
              showMessage('error', 'Enter both old and new ticker');
              return;
            }
            setRenameResult(null);
            setRenaming(true);
            try {
              const result = await renameTickerFunction({ oldTicker: renameOldTicker.trim(), newTicker: renameNewTicker.trim(), dryRun: true });
              setRenameResult(result.data);
            } catch (err) {
              showMessage('error', `Dry run failed: ${err.message}`);
            } finally {
              setRenaming(false);
            }
          }}
          disabled={renaming || !renameOldTicker.trim() || !renameNewTicker.trim()}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {renaming ? 'Running...' : '🔍 Dry Run'}
        </button>
        <button
          onClick={async () => {
            if (!renameResult || !renameResult.dryRun) {
              showMessage('error', 'Run a dry run first');
              return;
            }
            if (!window.confirm(`RENAME ${renameOldTicker} → ${renameNewTicker}?\n\nThis will modify ${renameResult.totalDocsToModify} documents.\nThe market will be halted during execution.\n\nAre you sure?`)) {
              return;
            }
            setRenaming(true);
            try {
              const result = await renameTickerFunction({ oldTicker: renameOldTicker.trim(), newTicker: renameNewTicker.trim(), dryRun: false });
              setRenameResult(result.data);
              showMessage('success', `Renamed ${renameOldTicker} → ${renameNewTicker} successfully! ${result.data.totalDocsModified} docs modified.`);
            } catch (err) {
              showMessage('error', `Rename failed: ${err.message}`);
            } finally {
              setRenaming(false);
            }
          }}
          disabled={renaming || !renameResult?.dryRun}
          className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {renaming ? 'Executing...' : '⚡ Execute Rename'}
        </button>
      </div>

      {renameResult && (
        <div className={`p-3 rounded-sm ${renameResult.dryRun ? (darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-300') : (darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-300')}`}>
          <p className={`text-sm font-semibold mb-2 ${renameResult.dryRun ? 'text-blue-400' : 'text-green-400'}`}>
            {renameResult.dryRun ? '🔍 Dry Run Preview' : '✅ Rename Complete'}
          </p>
          <p className={`text-xs ${textClass}`}>
            <strong>{renameResult.oldTicker}</strong> → <strong>{renameResult.newTicker}</strong>
          </p>
          <div className={`text-xs ${mutedClass} mt-1 space-y-0.5`}>
            <p>Market doc: 1</p>
            <p>User docs: {renameResult.breakdown?.users || 0}</p>
            <p>Trade records: {renameResult.breakdown?.trades || 0}</p>
            <p>Limit orders: {renameResult.breakdown?.limitOrders || 0}</p>
            <p>IP tracking docs: {renameResult.breakdown?.ipTracking || 0}</p>
            <p className={`font-semibold ${textClass} mt-1`}>Total: {renameResult.totalDocsToModify || renameResult.totalDocsModified || 0} documents</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecoveryRenameTicker;
