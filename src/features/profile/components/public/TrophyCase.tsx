// The six stands on a profile. The owner gets an Edit button that opens the
// picker; everyone else sees the stands (an empty one only shows to the owner).
import { TROPHY_SLOTS } from '../../../../rules/trophies';
import { COSMETIC_MAP } from '../../../../constants/cosmetics';
import { getCosmeticStyles } from '../../../../utils/cosmetics';
import CosmeticLayers from '../../../../shared/components/cosmetics/CosmeticLayers';
import { themeClasses } from '../../../../utils/theme';
import { trophyView, type TrophyView } from './TrophyArt';
import type { PublicProfile } from '../../../../api/types';

const { cardClass, textClass, mutedClass, borderClass } = themeClasses;

// Two beams from the bottom corners crossing on the pin, and a soft pool of
// light behind it. Clipped to the stand on their own, so a worn effect can
// still rise past the stand's edge.
const BEAM = (dir: string) => `linear-gradient(${dir}, rgb(255 236 179 / 0.2), rgb(255 236 179 / 0.03) 80%)`;
const Spotlights = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm" aria-hidden="true">
    <span
      className="absolute inset-0"
      style={{ background: 'radial-gradient(ellipse 30% 22% at 50% 34%, rgb(255 236 179 / 0.2), transparent)' }}
    />
    {/* Blurred as a group: a blur on the clipped beam itself would keep hard edges. */}
    <div className="absolute inset-0" style={{ filter: 'blur(3px)' }}>
      <span
        className="absolute inset-0"
        style={{ background: BEAM('to top right'), clipPath: 'polygon(0 100%, 6% 100%, 60% 28%, 46% 14%)' }}
      />
      <span
        className="absolute inset-0"
        style={{ background: BEAM('to top left'), clipPath: 'polygon(100% 100%, 94% 100%, 40% 28%, 54% 14%)' }}
      />
    </div>
  </div>
);

export const TrophyStand = ({ view, seedKey }: { view: TrophyView; seedKey: string }) => {
  // A worn cosmetic takes over the whole stand: its glow, backdrop or frame
  // shaped to the stand, like it shapes to a row.
  const c = view.wear ? COSMETIC_MAP[view.wear] : null;
  const s = c ? getCosmeticStyles({ [c.type]: c.id }, null, { seedKey }) : null;
  return (
    <div
      className={`relative flex flex-col items-center justify-end text-center gap-2 px-2 pt-4 pb-3 min-h-[132px] rounded-sm border ${
        s
          ? `${cardClass} ${s.rowClass}`
          : `${borderClass} light:bg-gradient-to-b light:from-amber-50 light:to-white dark:bg-gradient-to-b dark:from-zinc-800 dark:to-zinc-900`
      }`}
      data-trend={s?.frameTrend}
      style={s ? { ...s.rowStyle, ...(s.glowColor ? { boxShadow: `0 0 20px ${s.glowColor}55` } : {}) } : undefined}
    >
      {s && <CosmeticLayers {...s.layers} seedKey={seedKey} />}
      {view.spotlight && <Spotlights />}
      {view.art && <div className="relative h-14 w-full flex items-center justify-center">{view.art}</div>}
      {view.art && <div className="relative w-10 h-1 rounded-full light:bg-amber-200 dark:bg-zinc-700" />}
      <div className={`relative min-w-0 w-full ${view.art ? '' : 'my-auto'}`}>
        <div className={`${view.art ? 'text-sm' : 'text-sm sm:text-base'} font-semibold leading-tight break-words ${textClass}`}>
          {view.name}
        </div>
        <div className={`text-[11px] truncate ${mutedClass}`} title={view.caption}>
          {view.caption}
        </div>
      </div>
    </div>
  );
};

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
          <TrophyStand key={id} view={view} seedKey={profile.displayName} />
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
