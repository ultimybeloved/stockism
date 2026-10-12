import { titleTier } from '../../utils/cosmetics';
import type { SeasonTitle } from '../../types';

// Tiers whose title glows; in light mode these get a dark halo.
const PLATED = ['platinum', 'diamond'];

/** A player's title under their name, styled by its tier (see styles/titles.css). */
const TitleText = ({ title, className = 'text-xs' }: { title: SeasonTitle | null | undefined; className?: string }) => {
  if (!title) return null;
  const tier = titleTier(title.id);
  const text = <span className={`cos-title${tier ? ` cos-title-${tier}` : ''}`}>{title.text}</span>;
  return (
    <div className={`truncate ${className}`}>
      {tier && PLATED.includes(tier) ? <span className="cos-title-plate">{text}</span> : text}
    </div>
  );
};

export default TitleText;
