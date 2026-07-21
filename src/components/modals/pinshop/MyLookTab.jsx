import { Link } from 'react-router-dom';
import { COSMETICS, COSMETIC_TYPE_LABELS, COSMETIC_TYPES } from '../../../constants/cosmetics';
import { SHOP_PINS, CREW_MAP } from '../../../crews';
import { ACHIEVEMENTS } from '../../../constants/achievements';
import { getMaxAchievementSlots, getMaxShopSlots, toggleDisplayedPin } from '../../../utils/pinSlots';
import { getThemeClasses } from '../../../utils/theme';
import { useAppContext } from '../../../context/AppContext';

// My Look tab: everything the user wears in one place — owned cosmetics
// (tap a swatch to equip, tap again to take off), achievement pins, shop pins,
// and the crew pin. Buying lives in the Shop tab.
const MyLookTab = ({ onPinAction, onEquipCosmetic, onClose }) => {
  const { darkMode, userData } = useAppContext();
  const { textClass, mutedClass, borderClass } = getThemeClasses(darkMode);

  const ownedCosmetics = userData?.ownedCosmetics || [];
  const activeCosmetics = userData?.activeCosmetics || {};
  const ownedPins = userData?.ownedShopPins || [];
  const displayedShopPins = userData?.displayedShopPins || [];
  const earnedAchievements = userData?.achievements || [];
  // Drop pins for achievements the user no longer has (revocable ones like
  // Unifier can be lost). A stale entry is invisible below but would otherwise
  // keep occupying a slot. Toggling anything persists this cleaned list.
  const displayedAchievementPins = (userData?.displayedAchievementPins || []).filter(id => earnedAchievements.includes(id));

  const maxAchievementSlots = getMaxAchievementSlots(userData);
  const maxShopSlots = getMaxShopSlots(userData);
  const ownedByType = COSMETIC_TYPES
    .map(type => [type, COSMETICS.filter(c => c.type === type && ownedCosmetics.includes(c.id))])
    .filter(([, items]) => items.length > 0);

  const chipClass = (active) => `px-3 py-2 rounded-sm border ${active ? 'border-orange-500 bg-orange-500/10' : borderClass}`;

  return (
    <div className="space-y-6">
      {/* Cosmetics */}
      <div>
        <h3 className={`font-semibold ${textClass} mb-2`}>Cosmetics</h3>
        {ownedByType.length > 0 ? (
          <div className="space-y-3">
            {ownedByType.map(([type, items]) => {
              const equippedId = activeCosmetics[type];
              const equipped = items.find(i => i.id === equippedId);
              return (
                <div key={type}>
                  <p className={`text-xs ${mutedClass} mb-1`}>
                    {COSMETIC_TYPE_LABELS[type]}
                    {equipped && <span className="text-orange-500 font-semibold"> · {equipped.name}</span>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {items.map(cosmetic => {
                      const isEquipped = equippedId === cosmetic.id;
                      return (
                        <button
                          key={cosmetic.id}
                          onClick={() => onEquipCosmetic(type, isEquipped ? null : cosmetic.id)}
                          title={`${cosmetic.name}${isEquipped ? ' (tap to take off)' : ''}`}
                          className={`relative w-9 h-9 rounded-full border-2 p-0.5 ${isEquipped ? 'border-orange-500' : 'border-transparent'}`}
                        >
                          {/* Explicit size, not absolute inset: cos-frame-* classes set
                              position:relative and would collapse an absolute span. */}
                          <span
                            className={`block w-full h-full rounded-full ${cosmetic.type !== 'nameColor' ? (cosmetic.effectClass || '') : ''}`}
                            style={{ backgroundColor: cosmetic.color }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <p className={`text-xs ${mutedClass}`}>Tap to wear one, tap again to take it off.</p>
          </div>
        ) : (
          <p className={`text-sm ${mutedClass}`}>Nothing owned yet. Grab something in the Shop tab!</p>
        )}
      </div>

      {/* Achievement pins */}
      <div>
        <h3 className={`font-semibold ${textClass} mb-2`}>
          Achievement Pins ({displayedAchievementPins.length}/{maxAchievementSlots} slots)
        </h3>
        {earnedAchievements.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {earnedAchievements.map(achId => {
              const ach = ACHIEVEMENTS[achId];
              if (!ach) return null;
              const isDisplayed = displayedAchievementPins.includes(achId);
              return (
                <button
                  key={achId}
                  onClick={() => onPinAction('setAchievementPins', toggleDisplayedPin(displayedAchievementPins, achId, maxAchievementSlots), 0)}
                  className={chipClass(isDisplayed)}
                >
                  <span className="mr-1 inline-flex items-center align-middle">
                    {ach.icon ? <img src={`/pins/${ach.icon}`} alt="" className="w-5 h-5 object-contain" /> : ach.emoji}
                  </span>
                  <span className={`text-sm ${textClass}`}>{ach.name}</span>
                  {isDisplayed && <span className="text-xs text-orange-500 ml-2">✓</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className={`text-sm ${mutedClass}`}>No achievements yet. Start trading to earn some!</p>
        )}
        <p className={`text-xs ${mutedClass} mt-2`}>
          <Link to="/achievements" onClick={onClose} className="text-orange-500 hover:underline">See all achievements →</Link>
        </p>
      </div>

      {/* Shop pins */}
      {ownedPins.length > 0 && (
        <div>
          <h3 className={`font-semibold ${textClass} mb-2`}>
            Shop Pins ({displayedShopPins.length}/{maxShopSlots} slots)
          </h3>
          <div className="flex flex-wrap gap-2">
            {ownedPins.map(pinId => {
              const pin = SHOP_PINS[pinId];
              if (!pin) return null;
              const isDisplayed = displayedShopPins.includes(pinId);
              return (
                <button
                  key={pinId}
                  onClick={() => onPinAction('setShopPins', toggleDisplayedPin(displayedShopPins, pinId, maxShopSlots), 0)}
                  className={chipClass(isDisplayed)}
                >
                  <span className="mr-1 inline-flex items-center align-middle">
                    <img src={`/pins/${pin.image}`} alt={pin.name} className="w-5 h-5 object-contain" />
                  </span>
                  <span className={`text-sm ${textClass}`}>{pin.name}</span>
                  {isDisplayed && <span className="text-xs text-orange-500 ml-2">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Crew pin */}
      {userData?.crew && (() => {
        const crew = CREW_MAP[userData.crew];
        // displayCrewPin defaults to undefined (= shown), so toggle off the
        // EFFECTIVE displayed state, not the raw value. Crew heads always
        // display their pin — the backend ignores their toggles, so show the
        // pin as locked instead of a button that silently does nothing.
        const crewPinDisplayed = userData.displayCrewPin !== false;
        const isCrewHead = !!userData.isCrewHead;
        return (
          <div>
            <h3 className={`font-semibold ${textClass} mb-2`}>Crew Pin</h3>
            <button
              onClick={() => !isCrewHead && onPinAction('toggleCrewPin', !crewPinDisplayed, 0)}
              disabled={isCrewHead}
              className={`${chipClass(crewPinDisplayed)} ${isCrewHead ? 'cursor-default' : ''} inline-flex items-center`}
            >
              {crew?.icon ? (
                <img src={crew.icon} alt="" className="w-5 h-5 object-contain mr-1" />
              ) : (
                <span className="mr-1">{crew?.emblem}</span>
              )}
              <span className={`text-sm ${textClass}`}>{crew?.name}</span>
              {crewPinDisplayed && <span className="text-xs text-orange-500 ml-2">✓</span>}
            </button>
            {isCrewHead && <p className={`text-xs ${mutedClass} mt-1`}>Crew heads always show their crew pin.</p>}
          </div>
        );
      })()}
    </div>
  );
};

export default MyLookTab;
