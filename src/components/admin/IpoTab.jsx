import { useState } from 'react';
import { CHARACTERS } from '../../characters';
import { initNewCharacterPricesFunction } from '../../firebase';
import { formatUTCDateTime, formatTimeRemaining } from '../../utils/formatters';

const IpoTab = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  ipoTicker,
  setIpoTicker,
  ipoStartAtInput,
  setIpoStartAtInput,
  setIpoStartToNow,
  setIpoStartToNextOpen,
  ipoDurationHours,
  setIpoDurationHours,
  ipoTotalShares,
  setIpoTotalShares,
  ipoMaxPerUser,
  setIpoMaxPerUser,
  ipoEligibleCharacters,
  activeIPOs,
  handleCreateIPO,
  handleCancelIPO,
  setMessage,
}) => {
  const [initingPrices, setInitingPrices] = useState(false);

  // Derived start-time info for the create form
  const startDate = ipoStartAtInput ? new Date(ipoStartAtInput) : null;
  const startValid = !!startDate && !isNaN(startDate.getTime());
  const startMs = startValid ? startDate.getTime() : 0;
  const startsImmediately = startValid && startMs <= Date.now();
  const presetBtnClass = `text-xs px-2 py-1 rounded-sm ${darkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`;

  const handleInitPrices = async () => {
    setInitingPrices(true);
    try {
      const result = await initNewCharacterPricesFunction();
      const { initialized, message } = result.data;
      if (initialized.length === 0) {
        setMessage({ type: 'info', text: 'All characters already have prices' });
      } else {
        setMessage({ type: 'success', text: `${message}: ${initialized.map(i => `$${i.ticker}`).join(', ')}` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to initialize prices' });
    } finally {
      setInitingPrices(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-orange-50'}`}>
        <p className={`text-sm ${mutedClass}`}>
          🚀 <strong>IPO System:</strong> Create limited-time offerings for new characters.
          <br />• Hype Phase: from creation until your chosen start time. Announcement only, no buying
          <br />• IPO Window (24h default): configurable shares and per-user limits
          <br />• After IPO: Price jumps 15%, normal trading begins
        </p>
      </div>

      {/* Initialize prices for newly added characters */}
      <div className={`p-3 rounded-sm border ${darkMode ? 'border-slate-600' : 'border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h4 className={`text-sm font-semibold ${textClass}`}>New Character Prices</h4>
            <p className={`text-xs ${mutedClass}`}>Sets base prices for any new characters missing from the market. Run after adding characters.</p>
          </div>
          <button
            onClick={handleInitPrices}
            disabled={initingPrices}
            className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {initingPrices ? 'Initializing...' : 'Init Prices'}
          </button>
        </div>
      </div>

      {/* Create IPO Form */}
      <div className={`p-4 rounded-sm border ${darkMode ? 'border-slate-600' : 'border-slate-200'}`}>
        <h3 className={`font-semibold ${textClass} mb-3`}>Create New IPO</h3>

        <div className="space-y-3">
          <div>
            <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Character</label>
            <select
              value={ipoTicker}
              onChange={e => setIpoTicker(e.target.value)}
              className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
            >
              <option value="">Select character...</option>
              {ipoEligibleCharacters.length === 0 ? (
                <option disabled>No characters need IPO (add ipoRequired: true to characters.js)</option>
              ) : (
                ipoEligibleCharacters.map(c => (
                  <option key={c.ticker} value={c.ticker}>
                    ${c.ticker} - {c.name} (Base: ${c.basePrice})
                  </option>
                ))
              )}
            </select>
            {ipoEligibleCharacters.length === 0 && (
              <p className={`text-xs ${mutedClass} mt-1`}>
                💡 To add a new character for IPO, add them to characters.js with <code className="bg-slate-700 px-1 rounded">ipoRequired: true</code>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Buying Starts At (your local time)</label>
              <input
                type="datetime-local"
                value={ipoStartAtInput}
                onChange={e => setIpoStartAtInput(e.target.value)}
                className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
              />
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={setIpoStartToNow} className={presetBtnClass}>Now</button>
                <button type="button" onClick={setIpoStartToNextOpen} className={presetBtnClass}>Next market open (Thu 21:00 UTC)</button>
              </div>
              <p className={`text-xs ${mutedClass} mt-1`}>
                {!startValid ? 'Pick a date and time'
                  : startsImmediately ? 'Buying starts immediately'
                  : `${formatUTCDateTime(startMs)} (in ${formatTimeRemaining(startMs - Date.now())})`}
              </p>
            </div>
            <div>
              <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>IPO Duration (hours)</label>
              <input
                type="number"
                value={ipoDurationHours}
                onChange={e => setIpoDurationHours(Math.max(1, parseInt(e.target.value) || 24))}
                min="1"
                className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Total Shares</label>
              <input
                type="number"
                value={ipoTotalShares}
                onChange={e => setIpoTotalShares(Math.max(1, parseInt(e.target.value) || 150))}
                min="1"
                className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
              />
            </div>
            <div>
              <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Max Per User</label>
              <input
                type="number"
                value={ipoMaxPerUser}
                onChange={e => setIpoMaxPerUser(Math.max(1, parseInt(e.target.value) || 10))}
                min="1"
                className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
              />
            </div>
          </div>

          {ipoTicker && (
            <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
              <p className={`text-sm ${textClass}`}>
                <strong>${ipoTicker}</strong> IPO will:
              </p>
              <ul className={`text-xs ${mutedClass} mt-1 space-y-1`}>
                <li>• Buying opens: {!startValid ? 'pick a time' : startsImmediately ? 'immediately' : formatUTCDateTime(startMs)}</li>
                <li>• IPO buying: {ipoDurationHours}h</li>
                <li>• {ipoTotalShares} shares at ${CHARACTERS.find(c => c.ticker === ipoTicker)?.basePrice} (max {ipoMaxPerUser}/user)</li>
                <li>• After IPO: +15% price jump</li>
              </ul>
            </div>
          )}

          <button
            onClick={handleCreateIPO}
            disabled={loading || !ipoTicker}
            className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {loading ? 'Creating...' : '🚀 Create IPO'}
          </button>
        </div>
      </div>

      {/* Active IPOs */}
      <div>
        <h3 className={`font-semibold ${textClass} mb-3`}>Active IPOs ({activeIPOs.filter(i => !i.priceJumped).length})</h3>

        {activeIPOs.filter(i => !i.priceJumped).length === 0 ? (
          <p className={`text-sm ${mutedClass}`}>No active IPOs</p>
        ) : (
          <div className="space-y-2">
            {activeIPOs.filter(i => !i.priceJumped).map(ipo => {
              const character = CHARACTERS.find(c => c.ticker === ipo.ticker);
              const now = Date.now();
              const inHypePhase = now < ipo.ipoStartsAt;
              const inBuyingPhase = now >= ipo.ipoStartsAt && now < ipo.ipoEndsAt;
              const timeUntilStart = ipo.ipoStartsAt - now;
              const timeUntilEnd = ipo.ipoEndsAt - now;

              const formatTime = (ms) => {
                if (ms <= 0) return 'Now';
                const hours = Math.floor(ms / (1000 * 60 * 60));
                const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
                return `${hours}h ${mins}m`;
              };

              return (
                <div key={ipo.ticker} className={`p-3 rounded-sm border ${
                  inBuyingPhase ? 'border-green-500 bg-green-900/20' :
                  inHypePhase ? 'border-orange-500 bg-orange-900/20' :
                  'border-slate-600'
                }`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`font-bold ${textClass}`}>${ipo.ticker}</span>
                      <span className={`text-sm ${mutedClass} ml-2`}>{character?.name}</span>
                      <div className={`text-xs mt-1 ${
                        inBuyingPhase ? 'text-green-400' :
                        inHypePhase ? 'text-orange-400' : mutedClass
                      }`}>
                        {inHypePhase ? `🔥 Hype Phase - IPO starts in ${formatTime(timeUntilStart)}` :
                         inBuyingPhase ? `📈 LIVE - ${ipo.sharesRemaining ?? ipo.totalShares ?? 150}/${ipo.totalShares || 150} left - Ends in ${formatTime(timeUntilEnd)}` :
                         '✓ Completed'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleCancelIPO(ipo.ticker)}
                      disabled={loading}
                      className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Past IPOs */}
      {activeIPOs.filter(i => i.priceJumped).length > 0 && (
        <div>
          <h3 className={`font-semibold ${textClass} mb-3`}>Completed IPOs</h3>
          <div className="space-y-1">
            {activeIPOs.filter(i => i.priceJumped).slice(-5).map(ipo => (
              <div key={ipo.ticker} className={`p-2 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                <span className={`text-sm ${textClass}`}>${ipo.ticker}</span>
                <span className={`text-xs ${mutedClass} ml-2`}>
                  Sold {(ipo.totalShares || 150) - (ipo.sharesRemaining || 0)} shares
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default IpoTab;
