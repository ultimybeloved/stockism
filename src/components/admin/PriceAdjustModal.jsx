import { CHARACTERS } from '../../characters';

// Admin price adjustment modal: pick a character, nudge its price by a percent.
// All state and the write handler live in useAdminMarketTools; this is render-only.
//
// A selected stock also shows what the review has ALREADY done to it. Adjusting
// one stock drags every stock linked to it, so by the time you get to $GAP it
// may be several percent up on knock-on alone, and the number you type lands on
// top of that. Before this was on screen it was invisible: $GAP was set +4.75%
// on 2026-08-20 and finished the review +8.71%.
const PriceAdjustModal = ({
  darkMode, cardClass, textClass, mutedClass, prices, loading,
  setShowPriceModal, priceModalSearch, setPriceModalSearch,
  selectedPriceCharacter, setSelectedPriceCharacter,
  priceAdjustPercent, setPriceAdjustPercent, handleModalPriceAdjustment,
  reviewSoFar = {},
}) => {
  const signed = (pct) => `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  const notable = (pct) => typeof pct === 'number' && Math.abs(pct) >= 0.01;

  return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]" onClick={() => setShowPriceModal(false)}>
          <div
            className={`w-full max-w-xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] flex flex-col`}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
              <div className="flex justify-between items-center">
                <h2 className={`text-lg font-semibold ${textClass}`}>💰 Adjust Character Prices</h2>
                <button onClick={() => setShowPriceModal(false)} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Search */}
              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Search Characters</label>
                <input
                  type="text"
                  placeholder="Search by name or ticker..."
                  value={priceModalSearch}
                  onChange={e => setPriceModalSearch(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                />
              </div>

              {/* Character List */}
              <div className="space-y-2">
                {CHARACTERS
                  .filter(c => {
                    const search = priceModalSearch.toLowerCase();
                    return !search ||
                           c.name.toLowerCase().includes(search) ||
                           c.ticker.toLowerCase().includes(search) ||
                           (c.altNames || []).some(n => n.toLowerCase().includes(search));
                  })
                  .map(character => {
                    const currentPrice = prices[character.ticker] || character.basePrice;
                    const isSelected = selectedPriceCharacter?.ticker === character.ticker;

                    return (
                      <div
                        key={character.ticker}
                        className={`p-3 rounded-sm border cursor-pointer transition-all ${
                          isSelected
                            ? darkMode
                              ? 'bg-teal-900/30 border-teal-500'
                              : 'bg-teal-50 border-teal-500'
                            : darkMode
                            ? 'bg-slate-800 border-slate-700 hover:border-slate-600'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedPriceCharacter(null);
                            setPriceAdjustPercent('');
                          } else {
                            setSelectedPriceCharacter(character);
                            setPriceAdjustPercent('');
                          }
                        }}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <div className={`font-semibold ${textClass}`}>{character.name}</div>
                            <div className={`text-xs ${mutedClass}`}>${character.ticker}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-green-500">${currentPrice.toFixed(2)}</div>
                          </div>
                        </div>

                        {/* Adjustment Controls - Show when selected */}
                        {isSelected && (
                          <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'} space-y-2`}>
                            {/* What this review has already done to it */}
                            {(() => {
                              const so = reviewSoFar[character.ticker];
                              if (!so || !notable(so.percentChange)) return null;
                              return (
                                <div className={`text-xs rounded-sm px-2 py-1.5 ${
                                  darkMode ? 'bg-amber-500/10 text-amber-200' : 'bg-amber-50 text-amber-800'
                                }`}>
                                  <span className="font-semibold">This review so far: {signed(so.percentChange)}</span>
                                  {' from $'}{so.oldPrice?.toFixed(2)}
                                  {notable(so.trailingChange) && (
                                    <div className="mt-0.5">
                                      {notable(so.directChange)
                                        ? `${signed(so.directChange)} set directly, ${signed(so.trailingChange)} from linked stocks`
                                        : `${signed(so.trailingChange)} from linked stocks. You have not adjusted it directly yet.`}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {/* Quick Buttons */}
                            <div className="grid grid-cols-6 gap-1">
                              {[-50, -25, -10, 10, 25, 50].map(pct => (
                                <button
                                  key={pct}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPriceAdjustPercent(pct.toString());
                                  }}
                                  className={`py-1.5 text-xs font-semibold rounded-sm ${
                                    pct < 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                                  } text-white`}
                                >
                                  {pct > 0 ? '+' : ''}{pct}%
                                </button>
                              ))}
                            </div>

                            {/* Custom Input */}
                            <div className="flex gap-2">
                              <input
                                type="number"
                                step="1"
                                value={priceAdjustPercent}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setPriceAdjustPercent(e.target.value);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="Custom % (e.g., -15, 20)"
                                className={`flex-1 px-3 py-2 border rounded-sm text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (priceAdjustPercent) {
                                    handleModalPriceAdjustment(character, priceAdjustPercent);
                                  }
                                }}
                                disabled={!priceAdjustPercent || loading}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
                              >
                                Apply
                              </button>
                            </div>

                            {/* Preview */}
                            {priceAdjustPercent && !isNaN(parseFloat(priceAdjustPercent)) && (() => {
                              const preview = Math.round(currentPrice * (1 + parseFloat(priceAdjustPercent) / 100) * 100) / 100;
                              const openPrice = reviewSoFar[character.ticker]?.oldPrice;
                              return (
                                <div className={`text-sm ${mutedClass}`}>
                                  Preview: ${currentPrice.toFixed(2)} → ${preview.toFixed(2)}
                                  {openPrice > 0 && (
                                    <div className="text-xs mt-0.5">
                                      Review total would be {signed(((preview - openPrice) / openPrice) * 100)}
                                      {' from $'}{openPrice.toFixed(2)}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
  );
};

export default PriceAdjustModal;
