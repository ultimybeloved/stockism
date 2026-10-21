import { titleTier } from '../../utils/cosmetics';
import type { SeasonTitle } from '../../types';

// Tiers whose title glows; in light mode these get a dark halo.
const PLATED = ['platinum', 'diamond'];

/** A player's title under their name, styled by its tier (see styles/titles.css). */
const TitleText = ({ title, className = 'text-xs' }: { title: SeasonTitle | null | undefined; className?: string }) => {
  if (!title) return null;
  const tier = titleTier(title.id);
  const text = <span className={`cos-title${tier ? ` cos-title-${tier}` : ''}`}>{title.text}</span>;
  // A cut-off title clips at its box, so a glowing tier gets room for its glow
  // (padding, cancelled by an equal negative margin so nothing moves).
  const glowRoom = tier && PLATED.includes(tier) ? ' px-2 -mx-2 py-1 -my-1' : '';
  return (
    <div className={`truncate${glowRoom} ${className}`}>
      {tier && PLATED.includes(tier) ? <span className="cos-title-plate">{text}</span> : text}
    </div>
  );
};

export default TitleText;
