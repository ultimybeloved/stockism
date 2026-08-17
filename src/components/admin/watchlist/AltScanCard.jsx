// Manual trigger for the proactive alt scan.
//
// The scheduled version runs nightly on its own. This is here for when you want
// an answer now, and for the dry run, which reports what it would flag without
// writing alerts or announcing anyone in Discord.

const AltScanCard = ({ darkMode, textClass, mutedClass, scanning, result, runScan }) => {
  const buttonClass = `flex-1 py-2 text-xs font-semibold rounded-sm disabled:opacity-50 ${
    darkMode
      ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
  }`;

  return (
    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-indigo-50'}`}>
      <h3 className={`text-sm font-bold mb-1 ${textClass}`}>Find Alt Accounts</h3>
      <p className={`text-xs mb-2 ${mutedClass}`}>
        Looks through the last 30 days of trades for accounts that keep trading from the same
        connection. This runs by itself every night at 04:00 UTC and posts to Discord when it
        finds something. Use these buttons to check right now. Dry run shows what it would
        flag without writing anything.
      </p>
      <div className="flex gap-2">
        <button onClick={() => runScan(true)} disabled={scanning} className={buttonClass}>
          {scanning ? 'Scanning...' : 'Dry Run'}
        </button>
        <button
          onClick={() => runScan(false)}
          disabled={scanning}
          className={`flex-1 py-2 text-xs font-semibold rounded-sm disabled:opacity-50 ${
            darkMode
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
              : 'bg-indigo-500 hover:bg-indigo-600 text-white'
          }`}
        >
          {scanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {result && (
        <div className={`mt-2 space-y-1 max-h-60 overflow-y-auto`}>
          <p className={`text-xs ${mutedClass}`}>
            {result.scanned} trades checked · {result.candidates} suspicious pair(s)
            {result.dryRun ? ' · nothing written' : ` · ${result.reported} new alert(s)`}
          </p>
          {(result.findings || []).map((f) => (
            <div
              key={f.key}
              className={`text-xs p-1.5 rounded ${darkMode ? 'bg-slate-800' : 'bg-white'} ${mutedClass}`}
            >
              <span className={f.severity === 'high' ? 'text-red-400 font-semibold' : 'text-amber-400 font-semibold'}>
                {f.severity === 'high' ? '🔴' : '🟡'} {f.names?.join('  +  ')}
              </span>
              <div className="opacity-75">
                {f.sharedNetworks} shared network(s)
                {f.exclusiveNetworks ? `, ${f.exclusiveNetworks} used by nobody else` : ''}
                {f.sameCrew ? ', same crew' : ''}
                {f.sharedTickers?.length ? `, both holding ${f.sharedTickers.join('/')}` : ''}
                {f.alreadyBanned ? ' · one already banned' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AltScanCard;
