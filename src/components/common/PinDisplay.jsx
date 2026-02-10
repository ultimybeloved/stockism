import React from 'react';
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

  // Achievement pins (only show if user still has the achievement)
  const achievementPins = userData.displayedAchievementPins || [];
  const earnedAchievements = userData.achievements || [];
  achievementPins.forEach((achId, idx) => {
    const achievement = ACHIEVEMENTS[achId];
    if (achievement && earnedAchievements.includes(achId)) {
      pins.push(
        <span key={`ach-${idx}`} title={achievement.name} className={sizeClass}>
          {achievement.emoji}
        </span>
      );
    }
  });

  // Shop pins
  const shopPins = userData.displayedShopPins || [];
  shopPins.forEach((pinId, idx) => {
    const pin = SHOP_PINS[pinId];
    if (pin) {
      pins.push(
        <span key={`shop-${idx}`} title={pin.name} className={`inline-flex items-center ${sizeClass}`}>
          {pin.image ? (
            <img src={`/pins/${pin.image}`} alt={pin.name} className={`${imgSize} object-contain`} />
          ) : pin.emoji}
        </span>
      );
    }
  });

  if (pins.length === 0) return null;

  return <span className="inline-flex items-center gap-0.5 ml-1">{pins}</span>;
};

export default PinDisplay;
