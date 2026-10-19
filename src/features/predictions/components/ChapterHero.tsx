// The top of the predictions page: the chapter the weekly bets are about and
// when betting on it closes. The chapter comes from the weekly predictions
// themselves (set when an admin creates one); without it the hero says "This week".
import { useEffect, useState } from 'react';
import '@fontsource/big-shoulders-display/latin-900';
import { themeClasses } from '../../../utils/theme';
import { formatTimeRemaining } from '../../../utils/formatters';
import type { PredictionDoc } from '../../../types';

const closeTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' });

const ChapterHero = ({ weekly }: { weekly: PredictionDoc[] }) => {
  const { textClass, mutedClass } = themeClasses;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const chapters = weekly.map((p) => Number(p.chapter)).filter((n) => n > 0);
  const chapter = chapters.length ? Math.max(...chapters) : null;
  // Extended questions run late; the hero follows the regular ones.
  const open = weekly.filter((p) => (p.endsAt ?? 0) > now);
  const regular = open.filter((p) => !p.reopened);
  const closesAt = Math.min(...(regular.length ? regular : open).map((p) => p.endsAt ?? 0));

  const [headline, detail] =
    open.length > 0
      ? [
          `Betting closes ${closeTime(closesAt)}`,
          `${formatTimeRemaining(closesAt - now)} left. Bets settle after the chapter releases.`,
        ]
      : weekly.length > 0
        ? ['Betting is closed', 'Bets settle after the chapter releases.']
        : ['No weekly bets right now', 'New ones open after the next chapter.'];

  return (
    <section className="flex items-end gap-4 sm:gap-5 pb-4 border-b-2 light:border-slate-900 dark:border-zinc-100">
      <div className="shrink-0">
        {chapter && <div className={`text-xs font-semibold mb-1 ${mutedClass}`}>Chapter</div>}
        <div
          className={`leading-[.8] tabular-nums ${textClass} ${chapter ? 'text-[88px] sm:text-[112px]' : 'text-6xl sm:text-7xl'}`}
          style={{ fontFamily: '"Big Shoulders Display", sans-serif', fontWeight: 900 }}
        >
          {chapter ?? 'This week'}
        </div>
      </div>
      <div className="pb-1 min-w-0">
        <h1 className={`font-bold sm:text-lg leading-snug ${textClass}`}>{headline}</h1>
        <p className={`text-sm ${mutedClass}`}>{detail}</p>
      </div>
    </section>
  );
};

export default ChapterHero;
