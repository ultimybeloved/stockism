import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { COSMETICS, COSMETIC_TYPE_LABELS, COSMETIC_TYPES } from '../../../../constants/cosmetics';
import { SHOP_PINS, CREW_MAP } from '../../../../crews';
import { ACHIEVEMENT_MAP } from '../../../../constants/achievements';
import { getMaxAchievementSlots, getMaxShopSlots, toggleDisplayedPin } from '../../../../utils/pinSlots';
import { themeClasses } from '../../../../utils/theme';
import { useSession } from '../../../../context/AppContext';
import type { PinAction } from '../../hooks/usePinShop';
import AchievementIcon from '../../../../shared/components/AchievementIcon';
import CrewPin from '../../../../shared/components/CrewPin';
import { crewPinSrc, pixelatedIfSvg } from '../../../../constants/crests';
import { COSMETIC_MAP } from '../../../../constants/cosmetics';
import { SPLIT_FLAP_ID } from '../../../../constants/cosmeticLayers';
import { BULLBEAR_FRAME_ID, type CosmeticStyle, type CosmeticStyleKey } from '../../../../rules/cosmetics';
import StyleSwitch from '../../../../shared/components/SegmentedSwitch';
import CosmeticSwatch from './CosmeticSwatch';

interface MyLookTabProps {
  onPinAction: (action: PinAction, payload: unknown, cost?: number) => void;
  onEquipCosmetic: (type: string, cosmeticId: string | null) => void;
  onSetCosmeticStyle: <K extends CosmeticStyleKey>(key: K, value: NonNullable<CosmeticStyle[K]>) => unknown;
  onClose: () => void;
}

const FLAP_OPTIONS = [
  ['random', 'Random'],
  ['scramble', 'Scramble'],
  ['board', 'Arrivals'],
] as const;
const BULLBEAR_OPTIONS = [
  ['daily', 'Daily'],
  ['split', 'Split'],
] as const;
const TINT_OPTIONS = [
  ['fade', 'Fade'],
  ['solid', 'Solid'],
] as const;

const StyleRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <span className={`text-xs ${themeClasses.mutedClass}`}>{label}</span>
    {children}
  </div>
);

// These pin lists are client-writable, so anything that isn't a list is ignored.
const asList = (value: unknown): string[] => (Array.isArray(value) ? value : []);

// My Look tab: everything the user wears in one place — owned cosmetics
// (tap a swatch to equip, tap again to take off), achievement pins, shop pins,
// and the crew pin. Buying lives in the Shop tab.
const MyLookTab = ({ onPinAction, onEquipCosmetic, onSetCosmeticStyle, onClose }: MyLookTabProps) => {
  const { userData } = useSession();
  const { textClass, mutedClass, borderClass } = themeClasses;

  const ownedCosmetics = userData?.ownedCosmetics || [];
  const activeCosmetics = userData?.activeCosmetics || {};
  const ownedPins = userData?.ownedShopPins || [];
  const displayedShopPins = asList(userData?.displayedShopPins);
  const earnedAchievements = userData?.achievements || [];
  // Drop pins for achievements the user no longer has (revocable ones like
  // Unifier can be lost). A stale entry is invisible below but would otherwise
  // keep occupying a slot. Toggling anything persists this cleaned list.
  const displayedAchievementPins = asList(userData?.displayedAchievementPins).filter((id) =>
    earnedAchievements.includes(id),
  );

  const style = userData?.cosmeticStyle || {};
  const maxAchievementSlots = getMaxAchievementSlots(userData);
  const maxShopSlots = getMaxShopSlots(userData);
  const ownedByType = COSMETIC_TYPES.map(
    (type) =>
      [
        type,
        COSMETICS.filter((c) => c.type === type && ownedCosmetics.includes(c.id)).sort((a, b) => a.price - b.price),
      ] as const,
  ).filter(([, items]) => items.length > 0);

  const chipClass = (active: boolean) =>
    `px-3 py-2 rounded-sm border ${active ? 'border-orange-500 bg-orange-500/10' : borderClass}`;

  return (
    <div className="space-y-6">
      {/* Cosmetics */}
      <div>
        <h3 className={`font-semibold ${textClass} mb-2`}>Cosmetics</h3>
        {ownedByType.length > 0 ? (
          <div className="space-y-3">
            {ownedByType.map(([type, items]) => {
              const equippedId = activeCosmetics[type];
              const equipped = items.find((i) => i.id === equippedId);
              return (
                <div key={type}>
                  <p className={`text-xs ${mutedClass} mb-1`}>
                    <b className={textClass}>{COSMETIC_TYPE_LABELS[type]}</b>
                    {equipped && <span className="text-orange-500 font-semibold"> · {equipped.name}</span>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {items.map((cosmetic) => {
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
                          <CosmeticSwatch cosmetic={cosmetic} style={style} seedKey={userData?.displayName} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <p className={`text-xs ${mutedClass}`}>Tap to equip one, tap again to take it off.</p>
            {/* Style choices for owned items that come with one */}
            {(ownedCosmetics.includes(SPLIT_FLAP_ID) ||
              ownedCosmetics.includes(BULLBEAR_FRAME_ID) ||
              ownedCosmetics.some(
                (id) => COSMETIC_MAP[id]?.type === 'rowBackdrop' && !COSMETIC_MAP[id]?.effectClass,
              )) && (
              <div className="space-y-2 pt-1">
                {ownedCosmetics.includes(SPLIT_FLAP_ID) && (
                  <StyleRow label="Split Flap">
                    <StyleSwitch
                      label="Split Flap style"
                      options={FLAP_OPTIONS}
                      value={style.flap || 'random'}
                      onChange={(v) => onSetCosmeticStyle('flap', v)}
                    />
                  </StyleRow>
                )}
                {ownedCosmetics.includes(BULLBEAR_FRAME_ID) && (
                  <StyleRow label="Bull / Bear">
                    <StyleSwitch
                      label="Bull / Bear style"
                      options={BULLBEAR_OPTIONS}
                      value={style.bullbear || 'daily'}
                      onChange={(v) => onSetCosmeticStyle('bullbear', v)}
                    />
                  </StyleRow>
                )}
                {ownedCosmetics.some(
                  (id) => COSMETIC_MAP[id]?.type === 'rowBackdrop' && !COSMETIC_MAP[id]?.effectClass,
                ) && (
                  <StyleRow label="Color backdrops">
                    <StyleSwitch
                      label="Color backdrop style"
                      options={TINT_OPTIONS}
                      value={style.tint || 'fade'}
                      onChange={(v) => onSetCosmeticStyle('tint', v)}
                    />
                  </StyleRow>
                )}
              </div>
            )}
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
            {earnedAchievements.map((achId) => {
              const ach = ACHIEVEMENT_MAP[achId];
              if (!ach) return null;
              const isDisplayed = displayedAchievementPins.includes(achId);
              return (
                <button
                  key={achId}
                  onClick={() =>
                    onPinAction(
                      'setAchievementPins',
                      toggleDisplayedPin(displayedAchievementPins, achId, maxAchievementSlots),
                      0,
                    )
                  }
                  className={chipClass(isDisplayed)}
                >
                  <span className="mr-1 inline-flex items-center align-middle">
                    <AchievementIcon achievement={ach} />
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
          <Link to="/achievements" onClick={onClose} className="text-orange-500 hover:underline">
            See all achievements →
          </Link>
        </p>
      </div>

      {/* Shop pins */}
      {ownedPins.length > 0 && (
        <div>
          <h3 className={`font-semibold ${textClass} mb-2`}>
            Shop Pins ({displayedShopPins.length}/{maxShopSlots} slots)
          </h3>
          <div className="flex flex-wrap gap-2">
            {ownedPins.map((pinId) => {
              const pin = SHOP_PINS[pinId];
              if (!pin) return null;
              const isDisplayed = displayedShopPins.includes(pinId);
              return (
                <button
                  key={pinId}
                  onClick={() =>
                    onPinAction('setShopPins', toggleDisplayedPin(displayedShopPins, pinId, maxShopSlots), 0)
                  }
                  className={chipClass(isDisplayed)}
                >
                  <span className="mr-1 inline-flex items-center align-middle">
                    <img
                      src={`/pins/${pin.image}`}
                      alt={pin.name}
                      className="w-5 h-5 object-contain"
                      style={pixelatedIfSvg(pin.image)}
                    />
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
      {userData?.crew &&
        (() => {
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
                {crew && crewPinSrc(crew) ? (
                  <CrewPin crew={crew} className="w-5 h-5 mr-1" />
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
