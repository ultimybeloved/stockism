// Predictions tab, "Extend/Reopen Prediction" section (weekly predictions only).
// Extracted from PredictionsTab to keep it under the component line limit.
const PredictionExtendForm = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  predictions,
  extendPredictionId,
  setExtendPredictionId,
  extendDays,
  setExtendDays,
  allowAdditionalBets,
  setAllowAdditionalBets,
  getEndTime,
  handleExtendPrediction,
}) => {
  return (
    <div className={`p-4 rounded-sm border-2 border-blue-500 ${darkMode ? 'bg-blue-900/20' : 'bg-blue-50'}`}>
      <h3 className={`font-semibold text-blue-500 mb-3`}>⏰ Extend/Reopen Prediction</h3>
      <div className="space-y-3">
        <div>
          <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Prediction</label>
          <select
            value={extendPredictionId}
            onChange={e => setExtendPredictionId(e.target.value)}
            className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
          >
            <option value="">-- Choose prediction --</option>
            {predictions.map(p => {
              const isClosed = p.endsAt < Date.now();
              const status = p.resolved ? '✅ Resolved' : isClosed ? '🔒 Closed' : '⏳ Active';
              return (
                <option key={p.id} value={p.id}>
                  {status} - {p.question}
                </option>
              );
            })}
          </select>
        </div>

        {extendPredictionId && (
          <>
            <div>
              <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Extend By (Days)</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="14"
                  value={extendDays}
                  onChange={e => setExtendDays(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className={`text-lg font-semibold ${textClass} w-20`}>{extendDays} days</span>
              </div>
              <p className={`text-xs ${mutedClass} mt-1`}>
                New deadline: {new Date(getEndTime(extendDays)).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allowAdditionalBets"
                checked={allowAdditionalBets}
                onChange={e => setAllowAdditionalBets(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
              />
              <label htmlFor="allowAdditionalBets" className={`text-sm cursor-pointer ${textClass}`}>
                Allow users to add to existing bets
              </label>
            </div>
            {allowAdditionalBets && (
              <p className={`text-xs ${mutedClass} pl-6`}>
                Users who already bet can add more money to their original choice (cannot change or remove)
              </p>
            )}

            <button
              onClick={handleExtendPrediction}
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
            >
              {loading ? 'Extending...' : '⏰ Extend Prediction'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default PredictionExtendForm;
