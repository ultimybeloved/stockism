import React from 'react';
import { CHARACTERS } from '../../characters';

const HoldersTab = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  prices,
  holdersTicker,
  setHoldersTicker,
  holdersData,
  setHoldersData,
  holdersLoading,
  loadHolders,
}) => {
  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-purple-50'}`}>
        <p className={`text-sm ${mutedClass}`}>
          📊 View all users who hold shares of a specific character. Click a character to see their holders.
        </p>
      </div>

      <div>
        <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Search Characters</label>
        <input
          type="text"
          placeholder="Filter by name or ticker..."
          value={holdersTicker}
          onChange={e => setHoldersTicker(e.target.value)}
          className={`w-full px-3 py-2 border rounded-sm ${inputClass} mb-3`}
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 max-h-96 overflow-y-auto p-2">
          {CHARACTERS
            .filter(c => {
              const searchTerm = holdersTicker.toLowerCase();
              return !searchTerm ||
                     c.name.toLowerCase().includes(searchTerm) ||
                     c.ticker.toLowerCase().includes(searchTerm);
            })
            .map(c => {
              const currentPrice = prices[c.ticker] || c.basePrice;
              return (
                <button
                  key={c.ticker}
                  onClick={() => {
                    setHoldersTicker(c.ticker);
                    loadHolders(c.ticker);
                  }}
                  className={`p-3 rounded-sm text-left transition-all ${
                    darkMode
                      ? 'bg-slate-800 hover:bg-slate-700 border border-slate-700'
                      : 'bg-white hover:bg-blue-50 border border-slate-200'
                  }`}
                >
                  <div className={`text-xs font-semibold ${mutedClass} mb-1`}>${c.ticker}</div>
                  <div className={`text-sm font-semibold ${textClass} truncate`}>{c.name}</div>
                  <div className={`text-xs text-green-500 mt-1`}>${currentPrice.toFixed(2)}</div>
                </button>
              );
            })}
        </div>
      </div>

      {holdersTicker && CHARACTERS.find(c => c.ticker === holdersTicker) && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <h3 className={`font-semibold ${textClass}`}>
              ${holdersTicker} - {CHARACTERS.find(c => c.ticker === holdersTicker)?.name} ({holdersData.length} holders)
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setHoldersTicker('');
                  setHoldersData([]);
                }}
                className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-700 text-white rounded-sm"
              >
                ← Back
              </button>
              <button
                onClick={() => loadHolders(holdersTicker)}
                disabled={holdersLoading}
                className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-sm disabled:opacity-50"
              >
                {holdersLoading ? '...' : '🔄 Refresh'}
              </button>
            </div>
          </div>

          {holdersLoading ? (
            <p className={`text-center py-4 ${mutedClass}`}>Loading holders...</p>
          ) : holdersData.length === 0 ? (
            <p className={`text-center py-4 ${mutedClass}`}>No one holds ${holdersTicker}</p>
          ) : (
            <>
              {/* Summary */}
              <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className={`text-xs ${mutedClass}`}>Holders</p>
                    <p className={`font-bold ${textClass}`}>{holdersData.length}</p>
                  </div>
                  <div>
                    <p className={`text-xs ${mutedClass}`}>Total Shares</p>
                    <p className={`font-bold ${textClass}`}>
                      {holdersData.reduce((sum, h) => sum + h.shares, 0)}
                    </p>
                  </div>
                  <div>
                    <p className={`text-xs ${mutedClass}`}>Total Value</p>
                    <p className={`font-bold text-green-500`}>
                      ${holdersData.reduce((sum, h) => sum + h.value, 0).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Holders List */}
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {holdersData.map((holder, idx) => (
                  <div
                    key={holder.userId}
                    className={`p-2 rounded-sm flex justify-between items-center ${
                      darkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white hover:bg-slate-50'
                    } ${idx === 0 ? 'border-2 border-yellow-500' : ''}`}
                  >
                    <div>
                      <span className={`font-semibold ${textClass}`}>
                        {idx === 0 && '👑 '}{holder.displayName}
                      </span>
                      {holder.costBasis && (
                        <span className={`text-xs ${mutedClass} ml-2`}>
                          (avg: ${holder.costBasis.toFixed(2)})
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`font-bold ${textClass}`}>{holder.shares}</span>
                      <span className={`text-xs ${mutedClass} ml-1`}>shares</span>
                      <p className={`text-xs text-green-500`}>${holder.value.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default HoldersTab;
