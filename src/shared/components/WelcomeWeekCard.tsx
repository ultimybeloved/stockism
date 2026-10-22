import { useSession } from '../../context/AppContext';
import { themeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';
import { WELCOME_STREAK_DAYS, WELCOME_STREAK_REWARDS, WELCOME_STREAK_TOTAL } from '../../rules/welcome';
import { DISCORD_INVITE_URL } from '../../constants';

// Points players at the Discord welcome week (/welcome in the official server)
// until they finish it. Before they link, it sells the whole $10,000 start;
// after, it shows the 7-day track and what today pays. Hidden once the week is
// done, and for guests.
const WelcomeWeekCard = ({ className = '' }: { className?: string }) => {
  const { user, userData } = useSession();
  const { cardClass, mutedClass } = themeClasses;
  if (!user || !userData || userData.isBot) return null;

  const claimed = userData.welcomeStreak?.day || 0;
  if (claimed >= WELCOME_STREAK_DAYS) return null;

  const linked = !!userData.discordId;
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = userData.welcomeStreak?.lastClaimDay === today;
  const nextReward = WELCOME_STREAK_REWARDS[claimed] ?? 0;

  const btn = 'px-2 py-0.5 text-[10px] font-semibold rounded-sm text-center whitespace-nowrap';
  return (
    <div
      className={`${cardClass} border rounded-sm px-3 py-2.5 mb-4 flex items-center gap-3 light:border-indigo-200 dark:border-indigo-900 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-[10px] font-semibold uppercase ${mutedClass}`}>Welcome week</p>
          <p className={`text-[10px] font-semibold tabular-nums ${mutedClass}`}>
            Day {claimed}/{WELCOME_STREAK_DAYS}
          </p>
        </div>
        {/* One segment per day, filled as each is claimed. */}
        <div className="flex gap-1 my-1.5" aria-hidden="true">
          {Array.from({ length: WELCOME_STREAK_DAYS }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < claimed
                  ? 'bg-indigo-500'
                  : i === claimed && linked && !doneToday
                    ? 'bg-indigo-500/40'
                    : 'light:bg-zinc-200 dark:bg-zinc-800'
              }`}
            />
          ))}
        </div>
        <p className={`text-xs ${mutedClass}`}>
          {!linked ? (
            <>
              Link Discord, then <code>/welcome</code> daily for {formatCurrency(WELCOME_STREAK_TOTAL)} more
            </>
          ) : doneToday ? (
            `Next: ${formatCurrency(nextReward)} at 00:00 UTC`
          ) : (
            <>
              <code>/welcome</code> today for {formatCurrency(nextReward)}
            </>
          )}
        </p>
      </div>
      {/* Link (until linked) stacked over the way into the server. */}
      <div className="shrink-0 flex flex-col gap-1">
        {!linked && (
          <a href="/link-discord" className={`${btn} bg-indigo-600 hover:bg-indigo-700 text-white`}>
            Link Discord
          </a>
        )}
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btn} light:bg-slate-200 light:text-slate-700 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700`}
        >
          Open Discord
        </a>
      </div>
    </div>
  );
};

export default WelcomeWeekCard;
