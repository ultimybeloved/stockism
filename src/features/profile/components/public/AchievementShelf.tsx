// Every achievement by category: earned ones in color, the rest faded, so a
// visitor can see what's left to collect.
import { ACHIEVEMENT_MAP } from '../../../../constants/achievements';
import { ACHIEVEMENT_CATEGORIES } from '../../utils/achievementCategories';
import AchievementIcon from '../../../../shared/components/AchievementIcon';
import { themeClasses } from '../../../../utils/theme';

const { cardClass, textClass, mutedClass } = themeClasses;
const TOTAL = Object.values(ACHIEVEMENT_CATEGORIES).flat().length;

const AchievementShelf = ({ owned }: { owned: string[] }) => {
  const have = new Set(owned);
  return (
    <section className={`${cardClass} border rounded-sm p-4`}>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className={`font-bold ${textClass}`}>Achievements</h2>
        <span className={`text-[11px] uppercase tracking-wider ${mutedClass}`}>
          {Object.values(ACHIEVEMENT_CATEGORIES)
            .flat()
            .filter((id) => have.has(id)).length}{' '}
          of {TOTAL}
        </span>
      </div>
      <div className="space-y-3">
        {Object.entries(ACHIEVEMENT_CATEGORIES).map(([cat, ids]) => (
          <div key={cat} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
            <div className="sm:w-28 shrink-0 flex sm:block items-baseline gap-2">
              <div className={`text-xs font-semibold ${textClass}`}>{cat}</div>
              <div className={`text-[11px] ${mutedClass}`}>
                {ids.filter((id) => have.has(id)).length}/{ids.length}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ids.map((id) => {
                const a = ACHIEVEMENT_MAP[id];
                if (!a) return null;
                const got = have.has(id);
                return (
                  <span
                    key={id}
                    title={`${a.name}: ${got ? a.description : a.hint}`}
                    className={got ? '' : 'opacity-20 grayscale'}
                  >
                    <AchievementIcon achievement={a} className="w-7 h-7" />
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default AchievementShelf;
