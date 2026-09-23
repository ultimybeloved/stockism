import { useStockSplit } from '../../../hooks/admin/useStockSplit';
import { PreflightTable, PhaseProgress } from './RecoveryRenameStatus';

// Admin front end for the stock split engine (functions/services/stockSplit.js).
const RecoverySplitStock = ({ darkMode, textClass, mutedClass, showMessage }) => {
  const {
    ticker, setTicker, ratio, setRatio, result, busy, journal, incomplete, dryRun, execute, resume, abort,
  } = useStockSplit(showMessage);

  const inputClass = `w-full px-3 py-2 border rounded-sm text-sm font-mono ${
    darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
  }`;
  // Written out in full: Tailwind purges classes built from variables.
  const BTN = 'flex-1 px-4 py-2 text-white font-semibold rounded-sm disabled:opacity-50';
  const btn = (color) => `${BTN} ${{
    blue: 'bg-blue-600 hover:bg-blue-700', red: 'bg-red-600 hover:bg-red-700', amber: 'bg-amber-600 hover:bg-amber-700',
  }[color]}`;

  return (
    <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
      <h3 className={`font-semibold mb-2 ${textClass}`}>✂️ Split Stock</h3>
      <p className={`text-xs ${mutedClass} mb-3`}>
        N-for-1: the price is divided by N and every holder gets N times the shares, so nobody&apos;s money
        changes. Shorts, open orders, alerts, dividend lots, chart history and the index all move with it.
      </p>

      <div className={`p-2.5 rounded-sm mb-3 text-xs ${darkMode ? 'bg-amber-900/30 border border-amber-700 text-amber-200' : 'bg-amber-50 border border-amber-300 text-amber-900'}`}>
        <strong>In this order.</strong> 1) Halt the market. 2) Add <code>splitFactor: N</code> to the stock in
        src/characters.js (times any earlier factor), run <code>npm run sync:chars</code>, push, and deploy
        functions. 3) Dry run, then Execute. 4) Check the stock, then reopen the market yourself.
      </div>

      {incomplete && (
        <div className="p-2.5 rounded-sm mb-3 text-xs bg-red-900/40 border border-red-600 text-red-200">
          <strong>SPLIT UNFINISHED.</strong> ${journal.ticker} {journal.ratio}-for-1 is {journal.status}. Resume it.
          Keep the market halted until it completes.
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Ticker</label>
          <input type="text" placeholder="e.g. SHNG" value={ticker} disabled={busy}
            onChange={(e) => setTicker(e.target.value.toUpperCase())} className={inputClass} />
        </div>
        <div className="w-28">
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>For 1</label>
          <input type="number" min="2" max="100" value={ratio} disabled={busy}
            onChange={(e) => setRatio(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <button onClick={dryRun} className={btn('blue')} disabled={busy || !ticker.trim()}>
          {busy ? 'Working...' : '🔍 Dry Run'}
        </button>
        {incomplete ? (
          <>
            <button onClick={resume} className={btn('amber')} disabled={busy}>{busy ? 'Working...' : '▶️ Resume'}</button>
            <button onClick={abort} className={btn('red')} disabled={busy}>Abort</button>
          </>
        ) : (
          <button onClick={execute} className={btn('red')} disabled={busy || !result?.dryRun || result?.blocked}>
            {busy ? 'Splitting...' : '✂️ Execute Split'}
          </button>
        )}
      </div>

      <PhaseProgress journal={journal} textClass={textClass} mutedClass={mutedClass} darkMode={darkMode} />

      {result?.dryRun && (
        <>
          <PreflightTable checks={result.checks} textClass={textClass} mutedClass={mutedClass} darkMode={darkMode} />
          {result.breakdown && (
            <p className={`text-xs ${textClass}`}>
              ${result.ticker} at {result.priceNow} becomes {(result.priceNow / result.ratio).toFixed(2)}.
              Touches {result.breakdown.holders} holders, {result.breakdown.shorts} shorts,{' '}
              {result.breakdown.limitOrders} limit orders, {result.breakdown.priceAlerts} alerts and{' '}
              {result.breakdown.trades} trade records.
            </p>
          )}
        </>
      )}

      {result?.success && (
        <p className="text-sm font-semibold text-green-400 mt-2">
          ✅ ${result.ticker} split {result.ratio}-for-1 and verified. The market is still halted: reopen it when ready.
        </p>
      )}
    </div>
  );
};

export default RecoverySplitStock;
