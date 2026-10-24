import { themeClasses } from '../../../utils/theme';
import { formatDateTime } from '../../../utils/localTime';
import { missionWeekEndMs, type WeeklyProgress } from '../../../utils/missionProgress';
import { missionWeekStartMs } from '../../../rules/missions';
import PixelIcon from '../../../shared/components/PixelIcon';

const DAY_MS = 86400000;
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The mission week, Thursday reopen to Thursday reopen, one tile per UTC day,
// marked with the days you traded and checked in (the days the weekly
// missions count).
export default function WeekStrip({ weekly }: { weekly: WeeklyProgress }) {
  const { textClass, mutedClass, cardClass } = themeClasses;
  const now = Date.now();
  const start = missionWeekStartMs(now);
  const end = missionWeekEndMs(now);
  const today = utcDate(now);
  const days: string[] = [];
  for (let t = Date.parse(utcDate(start)); t < end; t += DAY_MS) days.push(utcDate(t));
  const traded = Object.keys(weekly.tradingDays || {}).length;
  const checkedIn = Object.keys(weekly.checkinDays || {}).length;

  return (
    <div className={`${cardClass} border rounded-sm p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <h1 className={`text-2xl font-bold ${textClass}`}>This week</h1>
        <p className={`text-sm ${mutedClass}`}>New missions {formatDateTime(end)}</p>
      </div>
      <ol className="grid grid-cols-8 gap-1 sm:gap-2">
        {days.map((d) => {
          const isToday = d === today;
          const future = d > today;
          const date = new Date(`${d}T00:00:00Z`);
          return (
            <li
              key={d}
              aria-current={isToday ? 'date' : undefined}
              className={`rounded-sm border px-0.5 py-2 text-center ${
                isToday
                  ? 'border-orange-500 bg-orange-500/10'
                  : 'light:border-amber-200 dark:border-zinc-800' + (future ? ' opacity-50' : '')
              }`}
            >
              <div className={`text-[11px] font-semibold ${isToday ? 'text-orange-500' : mutedClass}`}>
                {WEEKDAYS[date.getUTCDay()]}
              </div>
              <div className={`text-lg font-bold tabular-nums leading-tight ${textClass}`}>{date.getUTCDate()}</div>
              <div className="flex justify-center gap-0.5 h-4 mt-1">
                {weekly.tradingDays?.[d] && <PixelIcon name="trade" alt="Traded" className="w-4 h-4" />}
                {weekly.checkinDays?.[d] && <PixelIcon name="success" alt="Checked in" className="w-4 h-4" />}
              </div>
            </li>
          );
        })}
      </ol>
      <p className={`text-xs ${mutedClass} mt-3 flex flex-wrap gap-x-4 gap-y-1`}>
        <span>
          <PixelIcon name="trade" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
          Traded {traded} {traded === 1 ? 'day' : 'days'}
        </span>
        <span>
          <PixelIcon name="success" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
          Checked in {checkedIn} {checkedIn === 1 ? 'day' : 'days'}
        </span>
        <span>Days are UTC.</span>
      </p>
    </div>
  );
}
