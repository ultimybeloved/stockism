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

  return (
    <div
      className={`${cardClass} border rounded-sm p-4 mb-4 light:border-indigo-200 dark:border-indigo-900 ${className}`}
    >
      <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Discord welcome week</p>
      {!linked ? (
        <>
          <p className={`text-sm font-semibold ${textClass} mt-1`}>
            Start with {formatCurrency(STARTING_CASH + WELCOME_STREAK_TOTAL)}
          </p>
          <p className={`text-xs ${mutedClass} mt-1`}>
            Link your Discord to unlock your full {formatCurrency(STARTING_CASH)}, then run <code>/welcome</code> in the
            Stockism server once a day for a week to earn {formatCurrency(WELCOME_STREAK_TOTAL)} more.
          </p>
        </>
      ) : (
        <>
          <p className={`text-sm font-mono ${textClass} mt-1 tracking-widest`}>{welcomeTrack(claimed)}</p>
          <p className={`text-xs ${mutedClass} mt-1`}>
            {doneToday
              ? `Day ${claimed} claimed. Day ${claimed + 1} (${formatCurrency(nextReward)}) unlocks at 00:00 UTC.`
              : `Run /welcome in the Stockism server for day ${claimed + 1}: ${formatCurrency(nextReward)}.`}{' '}
            Missing a day only pauses your week.
          </p>
        </>
      )}
      <div className="flex gap-2 mt-3">
        {!linked && (
          <a
            href="/link-discord"
            className="flex-1 py-1.5 text-xs font-semibold rounded-sm text-center bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            Link Discord
          </a>
        )}
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 py-1.5 text-xs font-semibold rounded-sm text-center light:bg-slate-200 light:text-slate-700 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          Open the Stockism Discord
        </a>
      </div>
    </div>
  );
};

export default WelcomeWeekCard;
