import { getThemeClasses } from '../../utils/theme';
import { formatTimeAgo, formatCurrency } from '../../utils/formatters';
import { getNotificationMeta } from '../../utils/notifications';

// Left-border accent per notification color key. Kept here (not in theme.js)
// because it's specific to this row's accent strip.
const ACCENT = {
  green: 'border-l-green-500',
  blue: 'border-l-blue-500',
  amber: 'border-l-amber-500',
  gold: 'border-l-yellow-500',
  emerald: 'border-l-emerald-500',
  violet: 'border-l-violet-500',
  gray: 'border-l-zinc-400',
};

// Renders a single notification. The whole card is clickable (mark read +
// navigate or expand, decided by the parent). Delete and expand are their own
// buttons that stop propagation so they don't trigger the card action.
export default function NotificationRow({
  notification,
  darkMode,
  expanded,
  actionable,
  canExpand,
  onClick,
  onToggleExpand,
  onDelete,
}) {
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const meta = getNotificationMeta(notification);
  const data = notification.data || {};
  const accent = expanded || !notification.read ? (ACCENT[meta.colorKey] || ACCENT.gray) : 'border-l-transparent';

  const rowBg = !notification.read
    ? darkMode ? 'bg-zinc-800/50 hover:bg-zinc-800' : 'bg-orange-50/50 hover:bg-orange-50'
    : darkMode ? 'hover:bg-zinc-800/50' : 'hover:bg-zinc-50';

  const breakdown = data.breakdown && Object.entries(data.breakdown);
  const reinvested = data.reinvestedBreakdown && Object.entries(data.reinvestedBreakdown);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(notification)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(notification); } }}
      className={`w-full text-left px-4 py-3 transition-colors border-l-2 cursor-pointer ${accent} ${rowBg}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-base mt-0.5 shrink-0">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm truncate ${!notification.read ? 'font-semibold' : 'font-medium'} ${textClass}`}>
              {notification.title}
              {actionable && <span className={`ml-1 text-[10px] ${mutedClass}`}>↗</span>}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className={`text-[10px] ${mutedClass}`}>{formatTimeAgo(notification.createdAt)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(notification.id); }}
                className={`text-sm leading-none px-1 ${mutedClass} hover:text-red-500 transition-colors`}
                title="Delete"
              >
                &times;
              </button>
            </div>
          </div>

          <p className={`text-xs mt-0.5 ${expanded ? '' : 'line-clamp-2'} ${mutedClass}`}>
            {notification.message}
          </p>

          {expanded && (breakdown?.length > 0 || reinvested?.length > 0) && (
            <div className={`mt-2 space-y-0.5 text-[11px] ${mutedClass}`}>
              {breakdown?.map(([ticker, amount]) => (
                <div key={`c-${ticker}`} className="flex justify-between">
                  <span>${ticker}</span>
                  <span>{formatCurrency(amount)}</span>
                </div>
              ))}
              {reinvested?.map(([ticker, amount]) => (
                <div key={`r-${ticker}`} className="flex justify-between">
                  <span>${ticker} (reinvested)</span>
                  <span>{formatCurrency(amount)}</span>
                </div>
              ))}
            </div>
          )}

          {canExpand && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleExpand(notification.id); }}
              className="mt-1 text-[11px] text-orange-600 hover:text-orange-500 font-semibold"
            >
              {expanded ? 'Show less' : 'Show details'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
