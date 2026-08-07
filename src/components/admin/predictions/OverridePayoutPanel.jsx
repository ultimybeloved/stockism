// The stuck/incorrect payout recovery tool from the admin Predictions tab.
// Split out when PredictionsTab hit its 400-line limit. State and handlers live
// in useAdminBetRecovery and arrive as props, same as every other admin tab.
const OverridePayoutPanel = ({
  darkMode,
  mutedClass,
  inputClass,
  loading,
  predictions,
  recoveryPredictionId,
  setRecoveryPredictionId,
  recoveryBets,
  setRecoveryBets,
  recoveryOptions,
  setRecoveryOptions,
  recoveryWinner,
  setRecoveryWinner,
  handleScanForBets,
  handleOverridePayout,
}) => {
  return (
    <div className={`p-4 rounded-sm border-2 border-red-500 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
      <h3 className="font-semibold text-red-500 mb-1">⚠️ Override Previous Decision</h3>
      <p className={`text-xs ${mutedClass} mb-3`}>
        Use this if you paid out the wrong winner. Scan the prediction, select the correct winner, and pay them — regardless of previous payout status.
      </p>

      <div className="space-y-3">
        <div>
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Select Prediction</label>
          <div className="flex gap-2">
            <select
              value={recoveryPredictionId}
              onChange={e => { setRecoveryPredictionId(e.target.value); setRecoveryBets([]); setRecoveryOptions([]); setRecoveryWinner(''); }}
              className={`flex-1 px-3 py-2 border rounded-sm ${inputClass}`}
            >
              <option value="">-- Choose prediction --</option>
              {predictions.map(p => {
                const status = p.resolved ? '✅' : p.endsAt < Date.now() ? '🔒' : '⏳';
                return (
                  <option key={p.id} value={p.id}>
                    {status} {p.question}
                  </option>
                );
              })}
            </select>
            <button
              onClick={handleScanForBets}
              disabled={loading || !recoveryPredictionId.trim()}
              className="px-4 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white rounded-sm disabled:opacity-50 font-semibold"
            >
              {loading ? '...' : 'Scan'}
            </button>
          </div>
        </div>

        {recoveryBets.length > 0 && (
          <>
            <div className={`p-2 rounded-sm text-xs ${mutedClass} ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
              Found {recoveryBets.length} bets •
              Total pool: ${recoveryBets.reduce((s, b) => s + b.amount, 0).toFixed(2)} •
              Already paid: {recoveryBets.filter(b => b.paid).length}
            </div>

            <div>
              <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Correct Winner</label>
              <div className="grid grid-cols-2 gap-2">
                {recoveryOptions.map(opt => (
                  <button
                    key={opt}
                    onClick={() => setRecoveryWinner(opt)}
                    className={`p-3 rounded-sm border-2 font-semibold transition-all ${
                      recoveryWinner === opt
                        ? 'border-red-500 bg-red-500 text-white'
                        : darkMode ? 'border-slate-600 text-slate-300 hover:border-red-500' : 'border-slate-300 hover:border-red-400'
                    }`}
                  >
                    {opt}
                    <span className={`block text-xs font-normal mt-0.5 ${recoveryWinner === opt ? 'text-red-100' : mutedClass}`}>
                      ${recoveryBets.filter(b => b.option === opt).reduce((s, b) => s + b.amount, 0).toFixed(0)} pool
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {recoveryWinner && (
              <button
                onClick={handleOverridePayout}
                disabled={loading}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
              >
                {loading ? 'Processing...' : `⚠️ Pay correct winners: "${recoveryWinner}"`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default OverridePayoutPanel;
