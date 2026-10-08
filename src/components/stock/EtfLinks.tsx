import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { formatCurrency, formatChange } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';
import type { Character } from '../../characters';
import type { useStockPageData } from '../../hooks/useStockPageData';

interface EtfLinksProps {
  character: Character;
  memberOfETFs: ReturnType<typeof useStockPageData>['memberOfETFs'];
}

// Links between a stock and its funds: the ETFs a character belongs to, or an
// ETF's own holdings with their 24h move.
const EtfLinks = ({ character, memberOfETFs }: EtfLinksProps) => {
  const navigate = useNavigate();
  const { darkMode, userData, prices, priceHistory } = useAppContext();
  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;
  const upColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';
  const constituents = character.constituents ?? [];

  return (
    <>
      {/* Part of ETFs */}
      {memberOfETFs.length > 0 && (
        <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
          <h3 className={`text-sm font-semibold ${textClass} mb-3`}>
            Part of {memberOfETFs.length} ETF{memberOfETFs.length > 1 ? 's' : ''}
          </h3>
          <div className="flex flex-wrap gap-2">
            {memberOfETFs.map((etf) => (
              <button
                key={etf.ticker}
                onClick={() => navigate(`/stock/${etf.ticker}`)}
                className={`flex items-center gap-2 px-3 py-2 rounded-sm border text-left hover:border-orange-500 transition-colors ${darkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}
              >
                <span className="text-orange-500 font-mono text-xs font-bold">${etf.ticker}</span>
                <span className={`text-xs ${mutedClass}`}>{etf.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ETF Constituents */}
      {character.isETF && constituents.length > 0 && (
        <div className={`${cardClass} border rounded-sm p-4`}>
          <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Holdings ({constituents.length})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[...constituents]
              .sort((a, b) => (prices[b] || 0) - (prices[a] || 0))
              .map((t) => {
                const tHistory = priceHistory[t] || [];
                const tFiltered = tHistory.filter((p) => p.timestamp >= Date.now() - 86400000);
                const tFirst = tFiltered[0]?.price || prices[t] || 0;
                const tChange = tFirst > 0 ? (((prices[t] ?? 0) - tFirst) / tFirst) * 100 : 0;
                return (
                  <button
                    key={t}
                    onClick={() => navigate(`/stock/${t}`)}
                    className={`flex justify-between items-center p-2 rounded-sm border text-left hover:border-orange-500 transition-colors ${darkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}
                  >
                    <span className="text-orange-500 font-mono text-xs font-semibold">${t}</span>
                    <div className="text-right">
                      <div className={`text-xs font-semibold ${textClass}`}>{formatCurrency(prices[t] || 0)}</div>
                      <div className={`text-[10px] ${tChange >= 0 ? upColor : downColor}`}>
                        {tChange >= 0 ? '▲' : '▼'} {formatChange(Math.abs(tChange))}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </>
  );
};

export default EtfLinks;
