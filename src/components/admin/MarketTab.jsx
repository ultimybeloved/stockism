import React from 'react';

const MarketTab = ({
  darkMode,
  textClass,
  mutedClass,
  loading,
  setLoading,
  setMessage,
  user,
  prices,
  marketHaltStatus,
  marketHaltReason,
  haltReasonInput,
  setHaltReasonInput,
  updateMarketHalt,
}) => {
  return (
    <div className="space-y-4 p-4 overflow-y-auto flex-1" onClick={e => e.stopPropagation()}>
      <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>Market Controls</h3>

      {/* Status */}
      <div className={`p-4 rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-3 h-3 rounded-full ${prices && !marketHaltStatus ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className={`font-semibold ${darkMode ? 'text-white' : 'text-slate-900'}`}>
            Market Status: {marketHaltStatus ? 'HALTED' : 'OPEN'}
          </span>
        </div>
        {marketHaltStatus && marketHaltReason && (
          <p className={`text-sm mb-2 ${mutedClass}`}>Reason: {marketHaltReason}</p>
        )}
      </div>

      {/* Emergency Halt Controls */}
      <div className={`p-4 rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
        <h4 className={`font-semibold mb-3 ${darkMode ? 'text-white' : 'text-slate-900'}`}>Emergency Halt</h4>
        <input
          type="text"
          value={haltReasonInput}
          onChange={e => setHaltReasonInput(e.target.value)}
          placeholder="Halt reason (e.g., Emergency maintenance)"
          className={`w-full p-2 rounded-sm border text-sm mb-3 ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
        />
        <div className="flex gap-2">
          <button
            onClick={() => updateMarketHalt(true, haltReasonInput)}
            disabled={loading || marketHaltStatus}
            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-sm hover:bg-red-700 disabled:opacity-50"
          >
            Halt Market
          </button>
          <button
            onClick={() => updateMarketHalt(false, '')}
            disabled={loading || !marketHaltStatus}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            Resume Market
          </button>
        </div>
      </div>

      {/* Info */}
      <div className={`p-3 rounded-sm text-xs ${darkMode ? 'bg-blue-900/30 text-blue-300 border border-blue-800' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
        Automatic weekly halt (Thu 13:00–21:00 UTC) is always active. This is for emergencies only.
      </div>
    </div>
  );
};

export default MarketTab;
