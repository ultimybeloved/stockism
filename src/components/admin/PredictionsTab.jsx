import PredictionCreateForm from './PredictionCreateForm';
import PredictionExtendForm from './PredictionExtendForm';
import { lmsrCost } from '../../utils/calculations';
import { EVENT_AMM_LIQUIDITY } from '../../constants/economy';

// Weekly predictions track cash in a `pools` map; long-term (event) markets have
// no pool — the money staked equals what the LMSR AMM has taken in net, which is
// cost(q) - cost(seedQ) (seedQ is all-zeros unless the market opened with
// admin-set odds). marketValue picks the right one per market type.
const sumPool = (p) => Object.values(p.pools || {}).reduce((a, b) => a + b, 0);
const eventStaked = (p) => {
  const outcomes = p.outcomes || [];
  const b = p.b || EVENT_AMM_LIQUIDITY;
  if (!outcomes.length || !b) return 0;
  const q = Array.isArray(p.q) && p.q.length === outcomes.length ? p.q : outcomes.map(() => 0);
  const seedQ = Array.isArray(p.seedQ) && p.seedQ.length === outcomes.length ? p.seedQ : outcomes.map(() => 0);
  return Math.max(0, lmsrCost(q, b) - lmsrCost(seedQ, b));
};
const marketValue = (p) => (p.cancelled ? 0 : p.type === 'event' ? eventStaked(p) : sumPool(p));
const valueLabel = (p) => (p.type === 'event' ? 'Staked' : 'Pool');

const PredictionsTab = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  predictions,
  unresolvedPredictions,
  selectedPrediction,
  setSelectedPrediction,
  selectedOutcomes,
  setSelectedOutcomes,
  handleResolvePrediction,
  question,
  setQuestion,
  options,
  setOptions,
  daysUntilEnd,
  setDaysUntilEnd,
  mayExtend,
  setMayExtend,
  endDate,
  getEndTime,
  handleCreatePrediction,
  predictionType,
  setPredictionType,
  seedLiquidity,
  setSeedLiquidity,
  openDelayHours,
  setOpenDelayHours,
  openingOdds,
  setOpeningOdds,
  extendPredictionId,
  setExtendPredictionId,
  extendDays,
  setExtendDays,
  allowAdditionalBets,
  setAllowAdditionalBets,
  handleExtendPrediction,
  handleDeletePrediction,
  onCancelPrediction,
  loadAllBets,
  betsLoading,
  allBets,
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
    <div className="space-y-6">

      {/* SECTION 1: Resolve Pending Predictions */}
      {unresolvedPredictions.length > 0 && (
        <div className={`p-4 rounded-sm border-2 border-amber-500 ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
          <h3 className={`font-semibold text-amber-500 mb-3`}>⏳ Pending Resolution ({unresolvedPredictions.length})</h3>
          <div className="space-y-2 mb-3">
            {unresolvedPredictions.map(p => (
              <button
                key={p.id}
                onClick={() => { setSelectedPrediction(p); setSelectedOutcomes([]); }}
                className={`w-full p-3 text-left rounded-sm border transition-all ${
                  selectedPrediction?.id === p.id
                    ? 'border-teal-500 bg-teal-500/10'
                    : darkMode ? 'border-slate-600 hover:border-slate-500' : 'border-slate-300 hover:border-slate-400'
                }`}
              >
                <div className={`font-semibold ${textClass}`}>{p.question}</div>
                <div className={`text-xs ${mutedClass} mt-1`}>
                  {p.options.join(' • ')} | {valueLabel(p)}: ${marketValue(p).toFixed(0)}
                </div>
              </button>
            ))}
          </div>

          {selectedPrediction && (
            <>
              <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Winner(s) — tap to toggle</label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {selectedPrediction.options.map(opt => {
                  const isSelected = selectedOutcomes.includes(opt);
                  return (
                    <button
                      key={opt}
                      onClick={() => setSelectedOutcomes(prev =>
                        isSelected ? prev.filter(o => o !== opt) : [...prev, opt]
                      )}
                      className={`p-3 rounded-sm border-2 font-semibold transition-all ${
                        isSelected
                          ? 'border-green-500 bg-green-500 text-white'
                          : darkMode ? 'border-slate-600 text-slate-300 hover:border-green-500' : 'border-slate-300 hover:border-green-500'
                      }`}
                    >
                      {isSelected ? '✓ ' : ''}{opt}
                    </button>
                  );
                })}
              </div>

              {selectedOutcomes.length > 0 && (
                <button
                  onClick={handleResolvePrediction}
                  disabled={loading}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
                >
                  {loading ? 'Resolving...' : `✅ Confirm Winner(s): "${selectedOutcomes.join('" & "')}"`}
                </button>
              )}

              <button
                onClick={() => onCancelPrediction(selectedPrediction.id)}
                disabled={loading}
                className="w-full mt-2 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-sm disabled:opacity-50"
              >
                🚫 Cancel & Refund Everyone
              </button>
            </>
          )}
        </div>
      )}

      {/* SECTION 2: Create New Prediction */}
      <PredictionCreateForm
        darkMode={darkMode}
        textClass={textClass}
        mutedClass={mutedClass}
        inputClass={inputClass}
        loading={loading}
        question={question}
        setQuestion={setQuestion}
        options={options}
        setOptions={setOptions}
        daysUntilEnd={daysUntilEnd}
        setDaysUntilEnd={setDaysUntilEnd}
        mayExtend={mayExtend}
        setMayExtend={setMayExtend}
        endDate={endDate}
        handleCreatePrediction={handleCreatePrediction}
        predictionType={predictionType}
        setPredictionType={setPredictionType}
        seedLiquidity={seedLiquidity}
        setSeedLiquidity={setSeedLiquidity}
        openDelayHours={openDelayHours}
        setOpenDelayHours={setOpenDelayHours}
        openingOdds={openingOdds}
        setOpeningOdds={setOpeningOdds}
      />

      {/* SECTION 3: Extend/Reopen Prediction */}
      {predictions.length > 0 && (
        <PredictionExtendForm
          darkMode={darkMode}
          textClass={textClass}
          mutedClass={mutedClass}
          inputClass={inputClass}
          loading={loading}
          predictions={predictions}
          extendPredictionId={extendPredictionId}
          setExtendPredictionId={setExtendPredictionId}
          extendDays={extendDays}
          setExtendDays={setExtendDays}
          allowAdditionalBets={allowAdditionalBets}
          setAllowAdditionalBets={setAllowAdditionalBets}
          getEndTime={getEndTime}
          handleExtendPrediction={handleExtendPrediction}
        />
      )}

      {/* SECTION 4: All Predictions List */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <div className="flex justify-between items-center mb-3">
          <h3 className={`font-semibold ${textClass}`}>📋 All Predictions ({predictions.length})</h3>
          <button
            onClick={loadAllBets}
            disabled={betsLoading}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-sm disabled:opacity-50"
          >
            {betsLoading ? '...' : '🔄 Refresh Bets'}
          </button>
        </div>

        {predictions.length === 0 ? (
          <p className={`text-center py-4 ${mutedClass}`}>No predictions yet</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {predictions.map(p => (
              <div key={p.id} className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${p.cancelled ? 'text-zinc-400' : p.resolved ? 'text-green-500' : 'text-amber-500'}`}>
                        {p.cancelled ? '🚫 Cancelled' : p.resolved ? '✅ Resolved' : '⏳ Active'}
                      </span>
                    </div>
                    <div className={`font-semibold ${textClass} mt-1`}>{p.question}</div>
                    <div className={`text-xs ${mutedClass} mt-1`}>
                      Options: {p.options.join(', ')}
                    </div>
                    {p.resolved && !p.cancelled && (
                      <div className="text-xs text-green-500 mt-1">Winner: {p.outcome}</div>
                    )}
                    {p.cancelled && (
                      <div className="text-xs text-zinc-400 mt-1">All bettors refunded</div>
                    )}
                    <div className={`text-xs ${mutedClass} mt-1`}>
                      {valueLabel(p)}: ${marketValue(p).toFixed(0)}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 ml-2">
                    {!p.resolved && !p.cancelled && (
                      <button
                        onClick={() => onCancelPrediction(p.id)}
                        disabled={loading}
                        className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-sm"
                      >
                        Cancel & Refund
                      </button>
                    )}
                    <button
                      onClick={() => handleDeletePrediction(p.id)}
                      disabled={loading}
                      className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 5b: Override Previous Decision */}
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

      {/* SECTION 5: Bets Summary */}
      {allBets.length > 0 && (
        <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <h3 className={`font-semibold ${textClass} mb-3`}>🎲 Bets Summary ({allBets.length} total bets)</h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {(() => {
              const byPrediction = {};
              allBets.forEach(bet => {
                if (!byPrediction[bet.predictionId]) {
                  byPrediction[bet.predictionId] = {
                    question: bet.question,
                    totalAmount: 0,
                    betCount: 0,
                    byOption: {}
                  };
                }
                byPrediction[bet.predictionId].totalAmount += bet.amount;
                byPrediction[bet.predictionId].betCount += 1;
                if (!byPrediction[bet.predictionId].byOption[bet.option]) {
                  byPrediction[bet.predictionId].byOption[bet.option] = 0;
                }
                byPrediction[bet.predictionId].byOption[bet.option] += bet.amount;
              });

              return Object.entries(byPrediction).map(([predId, data]) => (
                <div key={predId} className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-50'}`}>
                  <div className={`font-semibold ${textClass} text-sm`}>{data.question}</div>
                  <div className={`text-xs ${mutedClass} mt-1`}>
                    {data.betCount} bets • Total: ${data.totalAmount.toFixed(0)}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {Object.entries(data.byOption).map(([opt, amt]) => (
                      <span key={opt} className={`text-xs px-2 py-1 rounded ${darkMode ? 'bg-slate-600' : 'bg-slate-200'}`}>
                        {opt}: ${amt.toFixed(0)}
                      </span>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default PredictionsTab;
