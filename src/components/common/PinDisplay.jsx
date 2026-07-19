import { CREW_MAP } from '../../crews';
import { ACHIEVEMENTS } from '../../constants/achievements';
import { SHOP_PINS } from '../../crews';

const PinDisplay = ({ userData, size = 'sm' }) => {
  if (!userData) return null;

  const pins = [];
  const sizeClass = size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : 'text-base';
  const imgSize = size === 'sm' ? 'h-4' : size === 'md' ? 'h-5' : 'h-6';

  // Crew pin - shown if user has a crew and displayCrewPin is not false
  if (userData.crew) {
    const crew = CREW_MAP[userData.crew];
    if (crew) {
      const shouldShowCrewPin = userData.displayCrewPin !== false;
      if (shouldShowCrewPin) {
        pins.push(
          <span key="crew" title={crew.name} className={`inline-flex items-center ${sizeClass}`}>
            {crew.icon ? (
              <img src={crew.icon} alt={crew.name} className={`${imgSize} object-contain`} />
            ) : crew.emblem}
          </span>
        );
      }
    }
  }

  // Achievement pins (only show if user still has the achievement).
  // Array.isArray guards throughout: these fields are client-writable, so a
  // malformed value must never crash every viewer's render.
  const achievementPins = Array.isArray(userData.displayedAchievementPins) ? userData.displayedAchievementPins : [];
  const earnedAchievements = Array.isArray(userData.achievements) ? userData.achievements : [];
  achievementPins.forEach((achId, idx) => {
    const achievement = ACHIEVEMENTS[achId];
    if (achievement && earnedAchievements.includes(achId)) {
      pins.push(
        <span key={`ach-${idx}`} title={achievement.name} className={`inline-flex items-center ${sizeClass}`}>
          {achievement.icon ? (
            <img src={`/pins/${achievement.icon}`} alt={achievement.name} className={`${imgSize} object-contain`} />
          ) : achievement.emoji}
        </span>
      );
    }
  });

  // Shop pins. Server payloads (leaderboard/public profile) arrive pre-filtered
  // to owned pins; when the full user doc is present (own header), enforce
  // ownership here too so unowned pins never render anywhere.
  const shopPins = Array.isArray(userData.displayedShopPins) ? userData.displayedShopPins : [];
  const ownedShopPins = Array.isArray(userData.ownedShopPins) ? userData.ownedShopPins : null;
  shopPins.forEach((pinId, idx) => {
    const pin = SHOP_PINS[pinId];
    if (pin && (!ownedShopPins || ownedShopPins.includes(pinId))) {
      pins.push(
        <span key={`shop-${idx}`} title={pin.name} className={`inline-flex items-center ${sizeClass}`}>
          <img src={`/pins/${pin.image}`} alt={pin.name} className={`${imgSize} object-contain`} />
        </span>
      );
    }
  });

  if (pins.length === 0) return null;

  return <span className="inline-flex items-center gap-0.5 ml-1">{pins}</span>;
};

export default PinDisplay;
