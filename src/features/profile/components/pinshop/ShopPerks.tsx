import { useSession } from '../../../../context/AppContext';
import { formatCurrency } from '../../../../utils/formatters';
import { formatDateTime } from '../../../../utils/localTime';
import { themeClasses } from '../../../../utils/theme';
import { PIN_SLOT_COSTS } from '../../../../crews';
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
const SAVER_BLURB = `Every daily check-in pays the top $${TOP_REWARD}, even if you miss days.`;

const PLANS: { plan: StreakSaverPlan; name: string; blurb: string }[] = [
  { plan: 'month', name: '30-Day Streak Saver', blurb: `${SAVER_BLURB} Lasts 30 days. Buying again adds 30 more.` },
  { plan: 'permanent', name: 'Permanent Streak Saver', blurb: `${SAVER_BLURB} Never runs out.` },
];

// The Perks tab: things that do something rather than change how you look.
// The streak saver makes every check-in pay the top reward while it lasts
// (rules/economy); the pin slots let you show one more pin. Bought through the
// shared confirm dialog in PinShopModal.
const ShopPerks = ({
  budget,
  onRequestPurchase,
}: {
  budget: number;
  onRequestPurchase: (purchase: PendingPurchase) => void;
}) => {
  const { userData } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const permanent = !!userData?.streakSaverPermanent;
  const active = streakSaverActive(userData);
  const live = liveCheckinStreak(
    userData?.checkinStreak || 0,
    toUTCDateString(userData?.lastCheckin) || null,
    getTodayDateString(),
  );
  const eligible = canBuyStreakSaver(live, active);

  const row = (
    key: string,
    name: string,
    blurb: string,
    price: number,
    done: string | null,
    canBuy: boolean,
    buy: () => void,
  ) => (
    <div
      key={key}
      className="flex items-center gap-3 rounded-md border p-3 light:border-amber-200 light:bg-white dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-semibold ${textClass}`}>{name}</div>
        <div className={`text-xs ${mutedClass}`}>{blurb}</div>
      </div>
      {done ? (
        <span className="shrink-0 text-xs font-bold text-orange-500">{done}</span>
      ) : (
        <button
          type="button"
          onClick={() => canBuy && buy()}
          disabled={!canBuy}
          className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-sm ${
            canBuy
              ? 'bg-orange-600 hover:bg-orange-700 text-white'
              : 'light:bg-slate-100 light:text-slate-400 light:cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500 dark:cursor-not-allowed'
          }`}
        >
          {formatCurrency(price)}
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-2.5 pt-4">
      {!eligible && !active && (
        <p className="text-xs light:text-red-600 dark:text-red-400">
          The streak saver needs a {STREAK_SAVER_MIN_STREAK}-day check-in streak. You're on day {live}.
        </p>
      )}
      {active && (
        <p className="text-xs font-semibold text-orange-500">
          {permanent
            ? 'You have the permanent streak saver.'
            : `Your streak saver runs until ${formatDateTime(userData?.streakSaverUntil || 0)}.`}
        </p>
      )}
      {PLANS.map(({ plan, name, blurb }) => {
        const price = STREAK_SAVER_PLANS[plan].price;
        return row(plan, name, blurb, price, permanent ? 'Owned' : null, eligible && budget >= price, () =>
          onRequestPurchase({ type: 'perk', item: plan, name, price }),
        );
      })}
      {row(
        'slot_achievement',
        '+1 Achievement Pin Slot',
        'Display one more pin earned from achievements.',
        PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT,
        userData?.extraAchievementSlot ? 'Owned' : null,
        budget >= PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT,
        () => onRequestPurchase({ type: 'slot', item: 'achievement', price: PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT }),
      )}
      {row(
        'slot_shop',
        '+1 Shop Pin Slot',
        'Display one more pin bought from the shop.',
        PIN_SLOT_COSTS.EXTRA_SHOP_SLOT,
        userData?.extraShopSlot ? 'Owned' : null,
        budget >= PIN_SLOT_COSTS.EXTRA_SHOP_SLOT,
        () => onRequestPurchase({ type: 'slot', item: 'shop', price: PIN_SLOT_COSTS.EXTRA_SHOP_SLOT }),
      )}
    </div>
  );
};

export default ShopPerks;
