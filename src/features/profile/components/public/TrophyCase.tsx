// The six stands on a profile. The owner gets an Edit button that opens the
// picker; everyone else sees the stands (an empty one only shows to the owner).
import { TROPHY_SLOTS } from '../../../../rules/trophies';
import { themeClasses } from '../../../../utils/theme';
import { trophyView, type TrophyView } from './TrophyArt';
import type { PublicProfile } from '../../../../api/types';

const { cardClass, textClass, mutedClass, borderClass } = themeClasses;

export const TrophyStand = ({ view }: { view: TrophyView }) => (
  <div
    className={`flex flex-col items-center justify-end text-center gap-2 px-2 pt-4 pb-3 rounded-sm border ${borderClass} light:bg-gradient-to-b light:from-amber-50 light:to-white dark:bg-gradient-to-b dark:from-zinc-800 dark:to-zinc-900`}
  >
    <div className="h-14 w-full flex items-center justify-center">{view.art}</div>
    <div className="w-10 h-1 rounded-full light:bg-amber-200 dark:bg-zinc-700" />
    <div className="min-w-0 w-full">
      <div className={`text-sm font-semibold truncate ${textClass}`}>{view.name}</div>
      <div className={`text-[11px] truncate ${mutedClass}`} title={view.caption}>
        {view.caption}
      </div>
    </div>
  </div>
);

interface TrophyCaseProps {
  profile: PublicProfile;
  isOwner: boolean;
  onEdit: () => void;
}

const TrophyCase = ({ profile, isOwner, onEdit }: TrophyCaseProps) => {
  const ctx = { seedKey: profile.displayName, titles: profile.trophyTitles || {}, headReign: profile.headReign };
  const views = (profile.trophyCase || [])
    .map((id) => ({ id, view: trophyView(id, ctx) }))
    .filter((t): t is { id: string; view: TrophyView } => !!t.view);
  if (!isOwner && views.length === 0) return null;

  return (
    <section className={`${cardClass} border rounded-sm p-4`}>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className={`font-bold ${textClass}`}>Trophy case</h2>
        {isOwner ? (
          <button onClick={onEdit} className="text-sm font-semibold text-orange-500 hover:underline">
            Edit
          </button>
        ) : (
          <span className={`text-[11px] uppercase tracking-wider ${mutedClass}`}>
            {views.length} of {TROPHY_SLOTS}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {views.map(({ id, view }) => (
          <TrophyStand key={id} view={view} />
        ))}
        {isOwner &&
          Array.from({ length: TROPHY_SLOTS - views.length }, (_, i) => (
            <button
              key={`empty${i}`}
              onClick={onEdit}
              className={`min-h-[132px] rounded-sm border border-dashed ${borderClass} ${mutedClass} text-xs hover:text-orange-500`}
            >
              Add a trophy
            </button>
          ))}
      </div>
    </section>
  );
};

export default TrophyCase;
