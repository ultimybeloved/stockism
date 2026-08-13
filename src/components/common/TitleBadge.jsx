import { SEASON_TIER_MAP } from '../../constants/seasons';

// A season title shown under a player's name. Titles are the one reward that
// can't be bought or re-earned — they are stamped with the season and the arc
// they came from, which is the whole reason they're worth competing for.
//
// The display text lives on the user doc (titleMeta) rather than being rebuilt
// here, so an arc renamed later doesn't rewrite history.
const TitleBadge = ({ titleId, titleMeta, className = '' }) => {
  if (!titleId) return null;

  const text = titleMeta?.[titleId];
  if (!text) return null;

  // Tier is the last segment of the id (season_1_diamond / arc_s1_diamond).
  const tier = titleId.split('_').pop();
  const color = SEASON_TIER_MAP[tier]?.color || '#A1A1AA';

  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-semibold leading-none ${className}`}
      style={{ backgroundColor: `${color}1F`, color }}
      title={text}
    >
      {text}
    </span>
  );
};

export default TitleBadge;
