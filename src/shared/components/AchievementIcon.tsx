import type { Achievement } from '../../constants/achievements';

// An achievement's badge: its pixel-art image when it has one (public/pins/),
// otherwise its emoji. Every place that shows an achievement goes through
// this so the two never drift apart.
const AchievementIcon = ({
  achievement,
  className = 'w-5 h-5',
  alt = '',
}: {
  achievement: Pick<Achievement, 'icon' | 'emoji'>;
  className?: string;
  alt?: string;
}) =>
  achievement.icon ? (
    <img
      src={`/pins/${achievement.icon}`}
      alt={alt}
      className={`${className} object-contain`}
      // Only our pixel-art SVGs want hard edges; photos/logos (the Discord png) stay smooth.
      style={achievement.icon.endsWith('.svg') ? { imageRendering: 'pixelated' } : undefined}
    />
  ) : (
    <span aria-hidden={alt ? undefined : true}>{achievement.emoji}</span>
  );

export default AchievementIcon;
