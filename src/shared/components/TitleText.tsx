import { titleTier } from '../../utils/cosmetics';
import type { SeasonTitle } from '../../types';

// Tiers whose title glows; in light mode these get a dark halo.
const PLATED = ['platinum', 'diamond'];

/** A player's title under their name, styled by its tier (see styles/titles.css). `wrap` lets a long one break lines instead of cutting off. */
const TitleText = ({
  title,
  className = 'text-xs',
  wrap = false,
}: {
  title: SeasonTitle | null | undefined;
  className?: string;
  wrap?: boolean;
}) => {
  if (!title) return null;
  const tier = titleTier(title.id);
  const text = (
    <span
      className={`cos-title${tier ? ` cos-title-${tier}` : ''}`}
      style={wrap ? { whiteSpace: 'normal', letterSpacing: '0.08em' } : undefined}
    >
      {title.text}
    </span>
  );
  return (
    <div className={`${wrap ? 'text-center' : 'truncate'} ${className}`}>
      {tier && PLATED.includes(tier) ? <span className="cos-title-plate">{text}</span> : text}
    </div>
  );
};

export default TitleText;
