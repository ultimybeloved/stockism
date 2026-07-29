import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';

// The admin-only block on a public profile. Extracted from PublicProfilePage.jsx
// (past the 300-line page limit); it was also called `AdminPanel` there, which
// collided with the real admin panel in src/AdminPanel.jsx.
const ProfileAdminPanel = ({ data }) => {
  const { darkMode } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const [copied, setCopied] = useState(false);

  const copyUID = () => {
    navigator.clipboard.writeText(data.uid);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const weeklyColor = data.weeklyGain >= 0 ? 'text-green-500' : 'text-red-500';
  const activeShorts = Object.entries(data.shorts || {}).filter(([, p]) => p && p.shares > 0);
  const activeHoldings = Object.entries(data.holdings || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className={`border-2 border-orange-500 rounded-sm p-4 ${darkMode ? 'bg-zinc-900' : 'bg-orange-50'} space-y-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-orange-500 font-bold text-sm uppercase tracking-widest">Admin View</h2>
        {(data.isBanned || data.isBot) && (
          <div className="flex gap-1.5">
            {data.isBanned && <span className="text-xs px-2 py-0.5 rounded bg-red-500 text-white font-bold">Banned</span>}
            {data.isBot && <span className="text-xs px-2 py-0.5 rounded bg-zinc-500 text-white font-bold">Bot</span>}
          </div>
        )}
      </div>

      {/* UID */}
      <div>
        <p className={`text-xs ${mutedClass} mb-0.5`}>UID</p>
        <button onClick={copyUID} className={`font-mono text-xs ${textClass} hover:text-orange-500 transition-colors`}>
          {data.uid} {copied ? '(copied)' : ''}
        </button>
      </div>

      {/* Key financials */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className={`text-xs ${mutedClass}`}>Cash</p>
          <p className={`font-bold ${textClass}`}>{formatCurrency(data.cash)}</p>
        </div>
        <div>
          <p className={`text-xs ${mutedClass}`}>Net equity</p>
          <p className={`font-bold ${textClass}`}>{formatCurrency(data.netEquity)}</p>
        </div>
        <div>
          <p className={`text-xs ${mutedClass}`}>Margin debt</p>
          <p className={`font-bold ${data.marginUsed > 0 ? 'text-red-500' : textClass}`}>
            {formatCurrency(data.marginUsed)}
            {data.marginEnabled && <span className={`text-xs ${mutedClass} ml-1`}>(on)</span>}
          </p>
        </div>
        <div>
          <p className={`text-xs ${mutedClass}`}>7-day gain</p>
          <p className={`font-bold ${weeklyColor}`}>
            {data.weeklyGain >= 0 ? '+' : ''}{formatCurrency(data.weeklyGain)}
            <span className="text-xs ml-1">({data.weeklyGain >= 0 ? '+' : ''}{data.weeklyGainPercent}%)</span>
          </p>
        </div>
      </div>

      {/* Holdings with share counts */}
      {activeHoldings.length > 0 && (
        <div>
          <p className={`text-xs ${mutedClass} mb-1.5`}>Holdings ({activeHoldings.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {activeHoldings.map(([ticker, shares]) => (
              <span key={ticker} className={`text-xs px-2 py-0.5 rounded font-mono ${darkMode ? 'bg-zinc-800 text-zinc-200' : 'bg-white text-zinc-700'} border ${darkMode ? 'border-zinc-700' : 'border-zinc-200'}`}>
                ${ticker} <span className="font-bold">{shares}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Short positions with full details */}
      {activeShorts.length > 0 && (
        <div>
          <p className={`text-xs ${mutedClass} mb-1.5`}>Short positions ({activeShorts.length})</p>
          <div className="space-y-1">
            {activeShorts.map(([ticker, pos]) => (
              <div key={ticker} className={`text-xs px-2 py-1.5 rounded font-mono flex flex-wrap gap-x-3 gap-y-0.5 ${darkMode ? 'bg-zinc-800' : 'bg-red-50 border border-red-100'}`}>
                <span className="text-red-500 font-bold">${ticker}</span>
                <span className={textClass}>{pos.shares} shares</span>
                <span className={mutedClass}>basis {formatCurrency(pos.costBasis)}</span>
                {pos.margin > 0 && <span className="text-orange-400">margin {formatCurrency(pos.margin)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileAdminPanel;
