// The stocks picked for a chart comparison (shift-click a card, or Compare in
// the side panel), pinned to the bottom of the screen until compared or cleared.
import { themeClasses } from '../../../utils/theme';
import { COMPARE_MAX } from './CompareChartModal';

interface CompareTrayProps {
  tickers: string[];
  onRemove: (ticker: string) => void;
  onClear: () => void;
  onCompare: () => void;
}

const CompareTray = ({ tickers, onRemove, onClear, onCompare }: CompareTrayProps) => {
  const { cardClass, raisedClass, mutedClass, ghostBtnClass } = themeClasses;
  if (tickers.length === 0) return null;
  return (
    <div
      className={`hidden md:flex fixed bottom-4 left-1/2 -translate-x-1/2 z-40 items-center gap-2 px-3 py-2 border rounded-sm shadow-xl ${cardClass} ${raisedClass}`}
    >
      <span className={`text-xs font-semibold uppercase ${mutedClass}`}>Compare</span>
      {tickers.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1 px-2 py-0.5 text-sm font-mono text-orange-500 border border-orange-500/40 rounded-sm"
        >
          ${t}
          <button
            aria-label={`Remove $${t}`}
            onClick={() => onRemove(t)}
            className={`${mutedClass} hover:text-orange-500`}
          >
            ×
          </button>
        </span>
      ))}
      {tickers.length < 2 && <span className={`text-xs ${mutedClass}`}>Shift+click another stock</span>}
      {tickers.length >= COMPARE_MAX && <span className={`text-xs ${mutedClass}`}>Up to {COMPARE_MAX}</span>}
      <button
        disabled={tickers.length < 2}
        onClick={onCompare}
        className="px-3 py-1 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-40"
      >
        Compare
      </button>
      <button onClick={onClear} className={`px-2 py-1 text-sm rounded-sm border ${ghostBtnClass}`}>
        Clear
      </button>
    </div>
  );
};

export default CompareTray;
