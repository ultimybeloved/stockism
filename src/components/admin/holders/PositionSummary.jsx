// Long vs short totals for one ticker. Net shares is the number worth watching:
// a large short interest against a small float is what a squeeze looks like
// before it happens.
const PositionSummary = ({ darkMode, textClass, mutedClass, holdersData, shortsData }) => {
  const longShares = holdersData.reduce((sum, h) => sum + h.shares, 0);
  const longValue = holdersData.reduce((sum, h) => sum + h.value, 0);
  const shortShares = shortsData.reduce((sum, s) => sum + s.shares, 0);
  const shortValue = shortsData.reduce((sum, s) => sum + s.value, 0);
  const netShares = longShares - shortShares;

  const Cell = ({ label, value, tone }) => (
    <div>
      <p className={`text-xs ${mutedClass}`}>{label}</p>
      <p className={`font-bold ${tone || textClass}`}>{value}</p>
    </div>
  );

  return (
    <div className={`p-3 rounded-sm mb-3 space-y-3 ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Cell label="Holders" value={holdersData.length} />
        <Cell label="Long Shares" value={longShares} />
        <Cell label="Long Value" value={`$${longValue.toFixed(2)}`} tone="text-green-500" />
      </div>

      <div className={`grid grid-cols-3 gap-2 text-center pt-3 border-t ${darkMode ? 'border-slate-700' : 'border-slate-300'}`}>
        <Cell label="Shorting" value={shortsData.length} tone={shortsData.length > 0 ? 'text-red-400' : textClass} />
        <Cell label="Short Shares" value={shortShares} tone={shortShares > 0 ? 'text-red-400' : textClass} />
        <Cell label="Short Value" value={`$${shortValue.toFixed(2)}`} tone={shortShares > 0 ? 'text-red-400' : textClass} />
      </div>

      {shortShares > 0 && (
        <div className={`text-center pt-3 border-t ${darkMode ? 'border-slate-700' : 'border-slate-300'}`}>
          <p className={`text-xs ${mutedClass}`}>Net Shares (long minus short)</p>
          <p className={`font-bold ${netShares >= 0 ? textClass : 'text-red-400'}`}>{netShares}</p>
        </div>
      )}
    </div>
  );
};

export default PositionSummary;
