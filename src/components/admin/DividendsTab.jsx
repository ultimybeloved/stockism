import { useMemo } from 'react';
import { CHARACTERS, getDividendTier, computeRarityTiers } from '../../characters';
import { DIVIDEND_RATES } from '../../constants/economy';

const OVERRIDE_TIERS = ['legendary', 'epic', 'rare', 'uncommon', 'common', 'none'];

const DividendsTab = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  dividendActionLoading,
  handleRunDividends,
  loadDividendConfig,
  dividendRunResult,
  dividendLastRuns,
  dividendSearch,
  setDividendSearch,
  dividendConfigLoaded,
  dividendOverrides,
  saveDividendTier,
  prices,
}) => {
  const rarityTiers = useMemo(() => computeRarityTiers(CHARACTERS, prices), [prices]);
  return (
    <div className="space-y-4 p-4 overflow-y-auto flex-1" onClick={e => e.stopPropagation()}>
      {/* Controls */}
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-emerald-50'}`}>
        <h3 className={`text-sm font-bold mb-2 ${textClass}`}>Dividend Controls</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleRunDividends}
            disabled={dividendActionLoading}
            className="px-3 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm disabled:opacity-50 font-semibold"
          >
            {dividendActionLoading ? 'Working...' : '▶ Run Dividend Payout Now'}
          </button>
          <button
            onClick={loadDividendConfig}
            disabled={dividendActionLoading}
            className={`px-3 py-2 text-xs rounded-sm font-semibold border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-600' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
          >
            ↻ Refresh
          </button>
        </div>
        {dividendRunResult && (
          <div className={`mt-3 text-xs ${mutedClass}`}>
            Last manual run: paid <span className={textClass}>{dividendRunResult.usersPaid}</span> of {dividendRunResult.usersConsidered} users •
            total <span className={textClass}>${(dividendRunResult.totalPaid || 0).toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Rate table */}
      <div className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700' : 'border-amber-200'}`}>
        <h3 className={`text-sm font-bold mb-2 ${textClass}`}>Weekly Base Rates (auto from rarity tier)</h3>
        <div className={`text-xs ${mutedClass} grid grid-cols-3 gap-2`}>
          <div>Legendary: <span className={textClass}>{(DIVIDEND_RATES.legendary * 100).toFixed(2)}%</span></div>
          <div>Epic: <span className={textClass}>{(DIVIDEND_RATES.epic * 100).toFixed(2)}%</span></div>
          <div>Rare: <span className={textClass}>{(DIVIDEND_RATES.rare * 100).toFixed(2)}%</span></div>
          <div>Uncommon: <span className={textClass}>{(DIVIDEND_RATES.uncommon * 100).toFixed(2)}%</span></div>
          <div>Common: <span className={textClass}>{(DIVIDEND_RATES.common * 100).toFixed(2)}%</span></div>
          <div>ETF: <span className={textClass}>{(DIVIDEND_RATES.etf * 100).toFixed(2)}%</span></div>
        </div>
        <div className={`text-xs ${mutedClass} mt-2`}>
          Loyalty ladder on top: shares pay nothing for 10 days, then 1x, 1.25x after 4 weeks, 1.5x after 8 weeks.
        </div>
      </div>

      {/* Recent runs */}
      {dividendLastRuns.length > 0 && (
        <div className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700' : 'border-amber-200'}`}>
          <h3 className={`text-sm font-bold mb-2 ${textClass}`}>Recent Runs</h3>
          <div className="space-y-1">
            {dividendLastRuns.map(run => (
              <div key={run.id} className={`text-xs ${mutedClass} flex gap-3`}>
                <span>{run.ranAt?.toDate ? run.ranAt.toDate().toLocaleString() : 'pending'}</span>
                <span className="uppercase">{run.source}</span>
                <span>{run.usersPaid} paid / {run.usersConsidered} considered</span>
                <span className={textClass}>${(run.totalPaid || 0).toFixed(2)}</span>
                <span>{run.durationMs}ms</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-ticker tier overrides */}
      <div className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700' : 'border-amber-200'}`}>
        <div className="flex justify-between items-center mb-2">
          <h3 className={`text-sm font-bold ${textClass}`}>Per-Ticker Tier Overrides</h3>
          <input
            type="text"
            value={dividendSearch}
            onChange={e => setDividendSearch(e.target.value)}
            placeholder="Search ticker…"
            className={`px-2 py-1 text-xs border rounded-sm ${inputClass}`}
          />
        </div>
        {!dividendConfigLoaded ? (
          <p className={`text-xs ${mutedClass}`}>Click Refresh to load tier config.</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {CHARACTERS
              .filter(c => !dividendSearch || c.ticker.toLowerCase().includes(dividendSearch.toLowerCase()) || c.name.toLowerCase().includes(dividendSearch.toLowerCase()))
              .map(c => {
                const effective = getDividendTier(c.ticker, rarityTiers, dividendOverrides);
                const autoTier = c.isETF ? 'etf' : (rarityTiers?.[c.ticker] || 'common');
                const isOverride = dividendOverrides[c.ticker];
                return (
                  <div key={c.ticker} className="flex items-center gap-2 text-xs">
                    <span className="text-orange-500 font-mono w-14">${c.ticker}</span>
                    <span className={`${mutedClass} flex-1 truncate`}>{c.name}</span>
                    <span className={`${mutedClass} w-24`}>auto: {autoTier}</span>
                    <select
                      value={isOverride || 'default'}
                      onChange={e => saveDividendTier(c.ticker, e.target.value)}
                      disabled={c.isETF}
                      className={`px-2 py-1 text-xs border rounded-sm ${inputClass} ${c.isETF ? 'opacity-50' : ''}`}
                    >
                      <option value="default">auto ({autoTier})</option>
                      {OVERRIDE_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <span className={`w-24 text-right ${effective === 'none' ? mutedClass : textClass}`}>→ {effective} ({(DIVIDEND_RATES[effective] * 100).toFixed(2)}%)</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DividendsTab;
