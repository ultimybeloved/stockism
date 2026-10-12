import { useSession } from '../../../../context/AppContext';
import { formatCurrency } from '../../../../utils/formatters';
import { formatDateTime } from '../../../../utils/localTime';
import { themeClasses } from '../../../../utils/theme';
import {
  CHECKIN_STREAK_REWARDS,
  STREAK_SAVER_PLANS,
  STREAK_SAVER_MIN_STREAK,
  streakSaverActive,
  liveCheckinStreak,
  canBuyStreakSaver,
} from '../../../../rules/economy';
import { getTodayDateString, toUTCDateString } from '../../../../utils/date';
import type { StreakSaverPlan } from '../../../../rules/economy';
import type { PendingPurchase } from '../PinShopModal';

const TOP_REWARD = CHECKIN_STREAK_REWARDS[CHECKIN_STREAK_REWARDS.length - 1];

const PLANS: { plan: StreakSaverPlan; name: string; blurb: string }[] = [
  { plan: 'month', name: '30-Day Streak Saver', blurb: '30 days. Buying again adds 30 more.' },
  { plan: 'permanent', name: 'Permanent Streak Saver', blurb: 'Never runs out.' },
];

// Shop perks: things that do something rather than change how you look. The
// streak saver makes every check-in pay the top reward while it lasts
// (rules/economy). Bought through the shared confirm dialog in PinShopModal.
const ShopPerks = ({
  cash,
  onRequestPurchase,
}: {
  cash: number;
  onRequestPurchase: (purchase: PendingPurchase) => void;
}) => {
  const { userData } = useSession();
  const { textClass, mutedClass, borderClass } = themeClasses;
  const permanent = !!userData?.streakSaverPermanent;
  const active = streakSaverActive(userData);
  const live = liveCheckinStreak(
    userData?.checkinStreak || 0,
    toUTCDateString(userData?.lastCheckin) || null,
    getTodayDateString(),
  );
  const eligible = canBuyStreakSaver(live, active);

  return (
    <div>
      <h3 className={`font-semibold ${textClass}`}>Perks</h3>
      <p className={`text-xs mb-2 ${mutedClass}`}>
        Streak saver: every daily check-in pays the top ${TOP_REWARD}, even if you miss days.
      </p>
      {!eligible && (
        <p className="text-xs mb-2 light:text-red-600 dark:text-red-400">
          Needs a {STREAK_SAVER_MIN_STREAK}-day check-in streak. You're on day {live}.
        </p>
      )}
      {active && (
        <p className="text-xs mb-2 font-semibold text-orange-500">
          {permanent
            ? 'You have the permanent streak saver.'
            : `Your streak saver runs until ${formatDateTime(userData?.streakSaverUntil || 0)}.`}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLANS.map(({ plan, name, blurb }) => {
          const price = STREAK_SAVER_PLANS[plan].price;
          const canBuy = !permanent && eligible && cash >= price;
          return (
            <div key={plan} className={`p-3 rounded-sm border ${borderClass} flex items-center justify-between gap-3`}>
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${textClass}`}>🔥 {name}</div>
                <div className={`text-xs ${mutedClass}`}>{blurb}</div>
              </div>
              <button
                onClick={() => canBuy && onRequestPurchase({ type: 'perk', item: plan, name, price })}
                disabled={!canBuy}
                className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-sm ${
                  canBuy
                    ? 'bg-orange-600 hover:bg-orange-700 text-white'
                    : 'light:bg-slate-100 light:text-slate-400 light:cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500 dark:cursor-not-allowed'
                }`}
              >
                {permanent ? 'Owned' : formatCurrency(price)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ShopPerks;
