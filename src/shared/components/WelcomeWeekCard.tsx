import { useSession } from '../../context/AppContext';
import { themeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';
import { STARTING_CASH } from '../../constants/economy';
import { WELCOME_STREAK_DAYS, WELCOME_STREAK_REWARDS, WELCOME_STREAK_TOTAL, welcomeTrack } from '../../rules/welcome';
import { DISCORD_INVITE_URL } from '../../constants';

// Points players at the Discord welcome week (/welcome in the official server)
// until they finish it. Before they link, it sells the whole $10,000 start;
// after, it shows the 7-day track and what today pays. Hidden once the week is
// done, and for guests.
const WelcomeWeekCard = ({ className = '' }: { className?: string }) => {
  const { user, userData } = useSession();
  const { cardClass, textClass, mutedClass } = themeClasses;
  if (!user || !userData || userData.isBot) return null;

  const claimed = userData.welcomeStreak?.day || 0;
  if (claimed >= WELCOME_STREAK_DAYS) return null;

  const linked = !!userData.discordId;
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = userData.welcomeStreak?.lastClaimDay === today;
  const nextReward = WELCOME_STREAK_REWARDS[claimed] ?? 0;

  const btn = 'shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-sm text-center';
  return (
    <div
      className={`${cardClass} border rounded-sm px-3 py-2.5 mb-4 flex items-center gap-3 light:border-indigo-200 dark:border-indigo-900 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] font-semibold uppercase ${mutedClass}`}>Welcome week</p>
        {!linked ? (
          <p className={`text-xs ${textClass}`}>
            Link Discord for your full {formatCurrency(STARTING_CASH)}, then <code>/welcome</code> daily for{' '}
            {formatCurrency(WELCOME_STREAK_TOTAL)} more.
          </p>
        ) : (
          <p className={`text-xs ${textClass}`}>
            <span className="font-mono tracking-widest mr-2">{welcomeTrack(claimed)}</span>
            <span className={mutedClass}>
              {doneToday
                ? `Day ${claimed + 1} (${formatCurrency(nextReward)}) at 00:00 UTC`
                : `/welcome for ${formatCurrency(nextReward)}`}
            </span>
          </p>
        )}
      </div>
      {!linked ? (
        <a href="/link-discord" className={`${btn} bg-indigo-600 hover:bg-indigo-700 text-white`}>
          Link Discord
        </a>
      ) : (
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btn} light:bg-slate-200 light:text-slate-700 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700`}
        >
          Open Discord
        </a>
      )}
    </div>
  );
};

export default WelcomeWeekCard;
