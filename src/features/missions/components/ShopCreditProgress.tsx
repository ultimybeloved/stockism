import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { MISSION_CREDIT_AMOUNT, MISSION_CREDIT_EVERY, missionsToNextCredit } from '../../../rules/shop';
import PixelIcon from '../../../shared/components/PixelIcon';

// How close the player is to their next shop credit payout: every
// MISSION_CREDIT_EVERY missions claimed pays MISSION_CREDIT_AMOUNT (rules/shop).
export default function ShopCreditProgress({ total, credit }: { total: number; credit: number }) {
  const { cardClass, textClass, mutedClass } = themeClasses;
  const left = missionsToNextCredit(total);
  const done = MISSION_CREDIT_EVERY - left;

  return (
    <div className={`${cardClass} border rounded-sm px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2`}>
      <p className={`text-sm ${textClass} flex items-center gap-1.5`}>
        <PixelIcon name="shop" set="discord" className="w-4 h-4" />
        {left === 1 ? 'Next mission pays' : `${left} more missions until`}{' '}
        <span className="text-emerald-500 font-semibold">{formatCurrency(MISSION_CREDIT_AMOUNT)}</span> of shop credit
      </p>
      <div
        role="progressbar"
        aria-label="Missions toward shop credit"
        aria-valuemin={0}
        aria-valuemax={MISSION_CREDIT_EVERY}
        aria-valuenow={done}
        className="flex-1 min-w-32 h-1.5 rounded-full light:bg-amber-100 dark:bg-zinc-800 overflow-hidden"
      >
        <div className="h-full bg-emerald-500" style={{ width: `${(done / MISSION_CREDIT_EVERY) * 100}%` }} />
      </div>
      <p className={`text-xs ${mutedClass}`}>
        {done} of {MISSION_CREDIT_EVERY} done.
        {credit > 0 && <> You have {formatCurrency(credit)} of shop credit to spend under Customize.</>}
      </p>
    </div>
  );
}
