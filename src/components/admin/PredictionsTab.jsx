import React from 'react';
import EventMarketFields from './EventMarketFields';
import { lmsrCost } from '../../utils/calculations';
import { EVENT_AMM_LIQUIDITY } from '../../constants/economy';

// Weekly predictions track cash in a `pools` map; long-term (event) markets have
// no pool — the money staked equals what the LMSR AMM has taken in net, which is
// cost(q) - cost(all-zeros). marketValue picks the right one per market type.
const sumPool = (p) => Object.values(p.pools || {}).reduce((a, b) => a + b, 0);
const eventStaked = (p) => {
  const outcomes = p.outcomes || [];
  const b = p.b || EVENT_AMM_LIQUIDITY;
  if (!outcomes.length || !b) return 0;
  const q = Array.isArray(p.q) && p.q.length === outcomes.length ? p.q : outcomes.map(() => 0);
  return Math.max(0, lmsrCost(q, b) - lmsrCost(outcomes.map(() => 0), b));
};
const marketValue = (p) => (p.type === 'event' ? eventStaked(p) : sumPool(p));
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

      {/* SECTION 3: Extend/Reopen Prediction */}
      {predictions.length > 0 && (
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
