import {
  MARGIN_WARNING_THRESHOLD,
  MARGIN_DANGER_THRESHOLD,
  MARGIN_CALL_THRESHOLD
} from '../../../constants';
import { formatCurrency } from '../../../utils/formatters';
import { getThemeClasses } from '../../../utils/theme';
import { useAppContext } from '../../../context/AppContext';

/**
 * The two progress bars inside the margin status card: equity ratio and credit used.
 * Both fills are clamped to 0-100 so an out-of-range value can never emit an invalid
 * CSS width (which would silently render as a full bar).
 */
const MarginStatusBars = ({ marginStatus, statusColorClass }) => {
  const { darkMode, userData } = useAppContext();
  const { mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;

  const trackClass = `h-3 rounded-full ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'} overflow-hidden`;

  const ratio = marginStatus.equityRatio;
  const fillPct = Math.min(100, Math.max(0, ratio * 100));

  // Scale markers are positioned at their true spot on the track, so the fill always
  // lines up with the percentage shown above it.
  const ticks = [
    { at: 0, color: colorBlindMode ? 'text-purple-500' : 'text-red-500' },
    { at: MARGIN_CALL_THRESHOLD * 100, color: colorBlindMode ? 'text-purple-500' : 'text-red-500' },
    { at: MARGIN_DANGER_THRESHOLD * 100, color: 'text-orange-500' },
    { at: MARGIN_WARNING_THRESHOLD * 100, color: mutedClass },
    { at: 100, color: colorBlindMode ? 'text-teal-500' : 'text-green-500' },
  ];

  const tickStyle = (i, at) => {
    if (i === 0) return { left: 0 };
    if (i === ticks.length - 1) return { right: 0 };
    return { left: `${at}%`, transform: 'translateX(-50%)' };
  };

  const atLimit = marginStatus.marginUsed >= marginStatus.maxBorrowable || marginStatus.maxBorrowable <= 0;
  const utilization = atLimit ? 1 : marginStatus.marginUsed / marginStatus.maxBorrowable;
  const utilizationPct = Math.min(100, Math.max(0, utilization * 100));
  const utilLabel = utilizationPct.toFixed(0);
  const utilColor = utilization < 0.5 ? (colorBlindMode ? 'bg-teal-500' : 'bg-green-500')
    : utilization < 0.75 ? 'bg-amber-500'
    : utilization < 1 ? 'bg-orange-500'
    : (colorBlindMode ? 'bg-purple-500' : 'bg-red-500');
  const utilTextColor = utilization < 0.5 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500')
    : utilization < 0.75 ? 'text-amber-500'
    : utilization < 1 ? 'text-orange-500'
    : (colorBlindMode ? 'text-purple-500' : 'text-red-500');

  return (
    <>
      {/* Equity Ratio Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className={mutedClass}>Equity Ratio</span>
          <span className={statusColorClass}>{(ratio * 100).toFixed(1)}%</span>
        </div>
        <div className={`relative ${trackClass}`}>
          <div
            className={`h-full rounded-full transition-all ${
              ratio > MARGIN_WARNING_THRESHOLD ? (colorBlindMode ? 'bg-teal-500' : 'bg-green-500') :
              ratio > MARGIN_DANGER_THRESHOLD ? 'bg-amber-500' :
              ratio > MARGIN_CALL_THRESHOLD ? 'bg-orange-500' : (colorBlindMode ? 'bg-purple-500' : 'bg-red-500')
            }`}
            style={{ width: `${fillPct}%` }}
          />
          {ticks.slice(1, -1).map((t) => (
            <div
              key={t.at}
              className={`absolute top-0 h-full w-px ${darkMode ? 'bg-zinc-900/70' : 'bg-white/80'}`}
              style={{ left: `${t.at}%` }}
            />
          ))}
        </div>
        <div className="relative h-4 mt-1 text-xs">
          {ticks.map((t, i) => (
            <span key={t.at} className={`absolute top-0 ${t.color}`} style={tickStyle(i, t.at)}>
              {+t.at.toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      {/* Debt Utilization Bar */}
      {marginStatus.marginUsed > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className={mutedClass}>Credit Used</span>
            <span className={utilTextColor}>
              {atLimit
                ? `${formatCurrency(marginStatus.marginUsed)} (at limit)`
                : `${formatCurrency(marginStatus.marginUsed)} / ${formatCurrency(marginStatus.maxBorrowable)} (${utilLabel}%)`
              }
            </span>
          </div>
          <div className={trackClass}>
            <div className={`h-full rounded-full transition-all ${utilColor}`} style={{ width: `${utilizationPct}%` }} />
          </div>
        </div>
      )}
    </>
  );
};

export default MarginStatusBars;
