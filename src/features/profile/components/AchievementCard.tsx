// One achievement on the achievements page: badge, name, its text (the real
// goal once earned, the cryptic hint until then), progress toward counted
// goals, and the Equip button for earned ones.
import type { Achievement } from '../../../constants/achievements';
import { themeClasses } from '../../../utils/theme';
import { formatCompactCurrency } from '../../../utils/formatters';
import AchievementIcon from '../../../shared/components/AchievementIcon';
import type { AchievementProgress } from '../utils/achievementProgress';

interface AchievementCardProps {
  achievement: Achievement;
  earned: boolean;
  progress: AchievementProgress | null;
  /** Earned and the player can wear pins: whether it's worn and whether slots are full. */
  pin: { worn: boolean; slotsFull: boolean } | null;
  onTogglePin: () => void;
}

const amount = (n: number, money?: boolean) => (money ? formatCompactCurrency(Math.floor(n)) : n.toLocaleString());

const AchievementCard = ({ achievement, earned, progress, pin, onTogglePin }: AchievementCardProps) => {
  const { mutedClass } = themeClasses;
  const showProgress = !earned && progress && progress.current > 0;

  return (
    <div
      className={`p-3 rounded-sm border ${
        earned
          ? 'light:bg-orange-50 light:border-orange-300 dark:bg-orange-900/30 dark:border-orange-700'
          : 'light:bg-amber-50 light:border-amber-200 dark:bg-zinc-800/30 dark:border-zinc-700'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`text-2xl inline-flex items-center justify-center ${earned ? '' : 'grayscale opacity-50'}`}>
          <AchievementIcon achievement={achievement} className="h-7 w-7" />
        </span>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm ${earned ? 'text-orange-500' : mutedClass}`}>{achievement.name}</div>
          <div className={`text-xs ${mutedClass}`}>{earned ? achievement.description : achievement.hint}</div>
          {showProgress && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden light:bg-amber-200 dark:bg-zinc-700">
                <div
                  className="h-full bg-orange-500/70"
                  style={{ width: `${(progress.current / progress.target) * 100}%` }}
                />
              </div>
              <span className={`text-[11px] tabular-nums ${mutedClass}`}>
                {amount(progress.current, progress.money)} / {amount(progress.target, progress.money)}
              </span>
            </div>
          )}
          {pin && (
            <button
              onClick={onTogglePin}
              disabled={pin.slotsFull}
              className={`mt-1.5 px-2 py-0.5 text-xs font-semibold rounded-sm border ${
                pin.worn
                  ? 'border-orange-500 text-orange-500 bg-orange-500/10'
                  : pin.slotsFull
                    ? 'light:border-slate-200 light:text-slate-400 light:cursor-not-allowed dark:border-zinc-700 dark:text-zinc-600 dark:cursor-not-allowed'
                    : 'light:border-slate-300 light:text-slate-600 light:hover:border-orange-500 light:hover:text-orange-500 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-orange-500 dark:hover:text-orange-500'
              }`}
            >
              {pin.worn ? 'Equipped' : pin.slotsFull ? 'Slots full' : 'Equip'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AchievementCard;
