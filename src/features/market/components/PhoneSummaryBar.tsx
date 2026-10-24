// Phones: one slim bar pinned under the header in place of the stacked
// dashboard cards. Shows portfolio value, today's change and cash; tapping it
// opens the full dashboard. The daily check-in and the bailout get their own
// button on the bar so they are never hidden behind the tap.
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { getTodayDateString, toUTCDateString } from '../../../utils/date';
import type { UserData } from '../../../types';

interface PhoneSummaryBarProps {
  activeUserData: UserData;
  portfolioValue: number;
  isGuest: boolean;
  open: boolean;
  onToggle: () => void;
  checkinLoading: boolean;
  onCheckin: () => void;
  onShowLogin: () => void;
  onShowBailout: () => void;
}

const PhoneSummaryBar = ({
  activeUserData,
  portfolioValue,
  isGuest,
  open,
  onToggle,
  checkinLoading,
  onCheckin,
  onShowLogin,
  onShowBailout,
}: PhoneSummaryBarProps) => {
  const { getColorBlindColors } = useSession();
  const { cardClass, mutedClass, textClass } = themeClasses;
  const cash = activeUserData.cash || 0;
  const dayAgo = activeUserData.portfolioSnapshot24h?.value ?? null;
  const change = dayAgo ? portfolioValue - dayAgo : null;
  const changePct = dayAgo && dayAgo > 0 && change !== null ? (change / dayAgo) * 100 : null;
  const canCheckIn = !isGuest && toUTCDateString(activeUserData.lastCheckin) !== getTodayDateString();

  let action = null;
  if (isGuest) {
    action = { label: 'Sign in', onClick: onShowLogin, cls: 'bg-orange-600 text-white' };
  } else if (activeUserData.isBankrupt) {
    action = { label: 'Bailout', onClick: onShowBailout, cls: 'bg-red-600 text-white' };
  } else if (canCheckIn) {
    action = { label: checkinLoading ? '...' : 'Check in', onClick: onCheckin, cls: 'bg-orange-600 text-white' };
  }

  return (
    <div
      data-tour="money"
      className={`md:hidden sticky top-16 z-30 -mx-4 mb-3 px-4 py-2 border-b ${cardClass} flex items-center gap-3`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex-1 min-w-0 flex items-center gap-4 text-left"
      >
        <div className="min-w-0">
          <div className={`text-[10px] uppercase font-semibold ${mutedClass}`}>Portfolio</div>
          <div className={`text-base font-bold leading-tight ${textClass}`}>
            {formatCurrency(portfolioValue)}
            {changePct !== null && (
              <span className={`ml-1.5 text-xs font-semibold ${getColorBlindColors((change || 0) >= 0).text}`}>
                {formatChange(changePct)}
              </span>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <div className={`text-[10px] uppercase font-semibold ${mutedClass}`}>Cash</div>
          <div className={`text-sm font-semibold leading-tight ${cash < 0 ? 'text-red-500' : textClass}`}>
            {cash < 0 ? '-' : ''}
            {formatCurrency(Math.abs(cash))}
          </div>
        </div>
        <span className={`ml-auto text-xs ${mutedClass}`} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {action && (
        <button
          type="button"
          data-tour={canCheckIn && !activeUserData.isBankrupt ? 'checkin' : undefined}
          onClick={action.onClick}
          disabled={checkinLoading}
          className={`shrink-0 px-3 py-2 text-xs font-semibold uppercase rounded-sm ${action.cls}`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default PhoneSummaryBar;
