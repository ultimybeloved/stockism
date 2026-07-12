import EventMarketFields from './EventMarketFields';

// Predictions tab, "Create New Prediction" section: weekly (cash) and long-term
// (event shares) forms. Extracted from PredictionsTab to keep it under the
// component line limit.
const PredictionCreateForm = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  question,
  setQuestion,
  options,
  setOptions,
  daysUntilEnd,
  setDaysUntilEnd,
  mayExtend,
  setMayExtend,
  endDate,
  handleCreatePrediction,
  predictionType,
  setPredictionType,
  seedLiquidity,
  setSeedLiquidity,
  openDelayHours,
  setOpenDelayHours,
  openingOdds,
  setOpeningOdds,
}) => {
  return (
    <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-slate-50'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
      <h3 className={`font-semibold ${textClass} mb-3`}>➕ Create New Prediction</h3>
      <div className="space-y-3">
        <div>
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPredictionType('weekly')}
              className={`flex-1 py-2 text-sm font-semibold rounded-sm border-2 transition-all ${predictionType === 'weekly' ? 'border-teal-500 bg-teal-500 text-white' : darkMode ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-600'}`}
            >
              Weekly (cash)
            </button>
            <button
              type="button"
              onClick={() => setPredictionType('event')}
              className={`flex-1 py-2 text-sm font-semibold rounded-sm border-2 transition-all ${predictionType === 'event' ? 'border-teal-500 bg-teal-500 text-white' : darkMode ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-600'}`}
            >
              Long-Term (shares)
            </button>
          </div>
        </div>
        <div>
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Question</label>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder=""
            className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
          />
        </div>

        <div>
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Options (2-6)</label>
          <div className="space-y-2">
            {options.map((opt, idx) => (
              <input
                key={idx}
                type="text"
                value={opt}
                onChange={e => {
                  const newOpts = [...options];
                  newOpts[idx] = e.target.value;
                  setOptions(newOpts);
                }}
                placeholder={idx < 2 ? `Option ${idx + 1} (required)` : `Option ${idx + 1} (optional)`}
                className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
              />
            ))}
          </div>
        </div>

        {predictionType !== 'event' ? (
          <>
            <div>
              <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Days Until Betting Ends</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="14"
                  value={daysUntilEnd}
                  onChange={e => setDaysUntilEnd(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className={`text-lg font-semibold ${textClass} w-20`}>{daysUntilEnd} days</span>
              </div>
              <p className={`text-xs ${mutedClass} mt-1`}>
                Ends: {endDate.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="mayExtend"
                checked={mayExtend}
                onChange={e => setMayExtend(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
              />
              <label htmlFor="mayExtend" className={`text-sm cursor-pointer ${textClass}`}>
                ⏳ Result may need an extra week to confirm
              </label>
            </div>
          </>
        ) : (
          <EventMarketFields
            darkMode={darkMode}
            mutedClass={mutedClass}
            inputClass={inputClass}
            seedLiquidity={seedLiquidity}
            setSeedLiquidity={setSeedLiquidity}
            openDelayHours={openDelayHours}
            setOpenDelayHours={setOpenDelayHours}
            options={options}
            openingOdds={openingOdds}
            setOpeningOdds={setOpeningOdds}
          />
        )}

        <button
          onClick={handleCreatePrediction}
          disabled={loading}
          className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {loading ? 'Creating...' : (predictionType === 'event' ? '➕ Create Long-Term Market' : '➕ Create Prediction')}
        </button>
      </div>
    </div>
  );
};

export default PredictionCreateForm;
