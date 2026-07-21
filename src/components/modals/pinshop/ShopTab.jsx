import { useState } from 'react';
import { COSMETICS, COSMETIC_MAP, COSMETIC_TYPE_LABELS, COSMETIC_TYPES } from '../../../constants/cosmetics';
import { PIN_SLOT_COSTS, getActiveShopPins } from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';
import { getThemeClasses } from '../../../utils/theme';
import { useAppContext } from '../../../context/AppContext';

// Shop tab: everything money can buy. Cosmetics render as compact swatch rows
// (tap a swatch to open a detail panel with description + buy/equip) instead of
// a card per item. Pin collections only appear when one is actually on sale.
// Extra pin slots live at the bottom. Equipping mostly happens in My Look, but
// owned items can be equipped from the detail panel so buying flows straight
// into wearing.

const PULSE_PREFIX = 'glow_pulse_';
const toPulse = (id) => (id.startsWith(PULSE_PREFIX) ? id : id.replace('glow_', PULSE_PREFIX));
const toStandard = (id) => id.replace(PULSE_PREFIX, 'glow_');

const ShopTab = ({ cash, onEquipCosmetic, onRequestPurchase }) => {
  const { darkMode, userData } = useAppContext();
  const { textClass, mutedClass, borderClass } = getThemeClasses(darkMode);
  const ownedCosmetics = userData?.ownedCosmetics || [];
  const activeCosmetics = userData?.activeCosmetics || {};
  const ownedPins = userData?.ownedShopPins || [];

  const [selectedId, setSelectedId] = useState(null);
  // Row glows exist in a standard and a pulsing variant of every color; the
  // toggle swaps the whole section between the two sets. Opens on whichever
  // set holds the equipped glow. Switching also re-targets the open detail
  // panel to the paired color so the selection follows the toggle.
  const [glowVariant, setGlowVariant] = useState(() =>
    COSMETIC_MAP[activeCosmetics.rowGlow]?.effectClass ? 'pulse' : 'standard'
  );

  const switchGlowVariant = (variant) => {
    setGlowVariant(variant);
    setSelectedId(sel => {
      if (!sel || COSMETIC_MAP[sel]?.type !== 'rowGlow') return sel;
      const paired = variant === 'pulse' ? toPulse(sel) : toStandard(sel);
      return COSMETIC_MAP[paired] ? paired : sel;
    });
  };

  const pinCollections = getActiveShopPins();
  const panelClass = `mt-2 p-3 rounded-sm border ${borderClass} flex items-center justify-between gap-3`;
  const buyBtnClass = (enabled) => `shrink-0 px-3 py-1.5 text-xs font-semibold rounded-sm ${
    enabled
      ? 'bg-orange-600 hover:bg-orange-700 text-white'
      : darkMode ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
  }`;

  const renderDetailPanel = (cosmetic) => {
    const owned = ownedCosmetics.includes(cosmetic.id);
    const equipped = activeCosmetics[cosmetic.type] === cosmetic.id;
    const canAfford = cash >= cosmetic.price;
    return (
      <div className={panelClass}>
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${cosmetic.type === 'nameColor' && cosmetic.effectClass ? cosmetic.effectClass : textClass}`}
            style={cosmetic.type === 'nameColor' && !cosmetic.effectClass ? { color: cosmetic.color } : undefined}>
            {cosmetic.name}
          </div>
          <div className={`text-xs ${mutedClass}`}>{cosmetic.description}</div>
        </div>
        {owned ? (
          <button
            onClick={() => onEquipCosmetic(cosmetic.type, equipped ? null : cosmetic.id)}
            className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-sm ${
              equipped
                ? 'bg-orange-600 hover:bg-orange-700 text-white'
                : darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
            }`}
          >
            {equipped ? 'Equipped ✓' : 'Equip'}
          </button>
        ) : (
          <button
            onClick={() => canAfford && onRequestPurchase({ type: 'cosmetic', item: cosmetic, price: cosmetic.price })}
            disabled={!canAfford}
            className={buyBtnClass(canAfford)}
          >
            {formatCurrency(cosmetic.price)}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Cosmetics — swatch grid per type */}
      {COSMETIC_TYPES.map(type => {
        const items = COSMETICS.filter(c =>
          c.type === type &&
          (type !== 'rowGlow' || (glowVariant === 'pulse' ? !!c.effectClass : !c.effectClass))
        );
        const selectedItem = items.find(i => i.id === selectedId);
        const minPrice = Math.min(...items.map(i => i.price));
        return (
          <div key={type}>
            <div className="flex items-center justify-between mb-2">
              <h3 className={`font-semibold ${textClass}`}>
                {COSMETIC_TYPE_LABELS[type]}
                <span className={`ml-2 text-xs font-normal ${mutedClass}`}>from {formatCurrency(minPrice)}</span>
              </h3>
              {type === 'rowGlow' && (
                <div className="flex gap-1">
                  {[['standard', 'Standard'], ['pulse', 'Pulsing']].map(([variant, label]) => (
                    <button
                      key={variant}
                      onClick={() => switchGlowVariant(variant)}
                      className={`px-3 py-1 text-xs font-semibold rounded-sm ${
                        glowVariant === variant
                          ? 'bg-orange-600 text-white'
                          : darkMode ? 'bg-zinc-800 text-zinc-400 hover:text-zinc-200' : 'bg-slate-100 text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {items.map(cosmetic => {
                const owned = ownedCosmetics.includes(cosmetic.id);
                const selected = selectedId === cosmetic.id;
                return (
                  <button
                    key={cosmetic.id}
                    onClick={() => setSelectedId(selected ? null : cosmetic.id)}
                    title={cosmetic.name}
                    className={`relative w-9 h-9 rounded-full border-2 p-0.5 ${selected ? 'border-orange-500' : 'border-transparent'}`}
                  >
                    {/* Explicit size, not absolute inset: cos-frame-* classes set
                        position:relative and would collapse an absolute span. */}
                    <span
                      className={`block w-full h-full rounded-full ${cosmetic.type !== 'nameColor' ? (cosmetic.effectClass || '') : ''}`}
                      style={{ backgroundColor: cosmetic.color }}
                    />
                    {owned && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-orange-600 text-white text-[9px] flex items-center justify-center font-bold">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            {selectedItem
              ? renderDetailPanel(selectedItem)
              : <p className={`mt-2 text-xs ${mutedClass}`}>Tap a color to see it.</p>}
          </div>
        );
      })}

      {/* Pin collections — only when something is actually on sale */}
      {pinCollections.length > 0 && pinCollections.map(collection => (
        <div key={collection.id}>
          <div className="flex items-center gap-2 mb-3">
            <h3 className={`font-semibold ${textClass}`}>{collection.name}</h3>
            {collection.limited && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 font-semibold">Limited</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {collection.pins.map(pin => {
              const owned = ownedPins.includes(pin.id);
              const bestStreak = Math.max(userData?.maxCheckinStreak || 0, userData?.checkinStreak || 0);
              const streakMet = !pin.requiredCheckinStreak || bestStreak >= pin.requiredCheckinStreak;
              const canBuy = cash >= pin.price && streakMet && !owned;
              return (
                <div key={pin.id} className={`p-3 rounded-sm border ${owned ? 'border-orange-500 bg-orange-500/10' : borderClass}`}>
                  <div className="text-center mb-2 flex items-center justify-center h-8">
                    <img src={`/pins/${pin.image}`} alt={pin.name} className="w-8 h-8 object-contain" />
                  </div>
                  <div className={`text-sm font-semibold text-center ${textClass}`}>{pin.name}</div>
                  <div className={`text-xs text-center ${mutedClass} mb-2`}>{pin.description}</div>
                  {owned ? (
                    <div className="text-xs text-center text-orange-500 font-semibold">Owned</div>
                  ) : (
                    <>
                      {pin.requiredCheckinStreak && !streakMet && (
                        <div className={`text-xs text-center mb-1 ${darkMode ? 'text-red-400' : 'text-red-500'}`}>
                          Requires {pin.requiredCheckinStreak}-day streak
                        </div>
                      )}
                      <button
                        onClick={() => canBuy && onRequestPurchase({ type: 'pin', item: pin, price: pin.price })}
                        disabled={!canBuy}
                        title={pin.requiredCheckinStreak && !streakMet ? `Best streak: ${bestStreak}/${pin.requiredCheckinStreak} days` : undefined}
                        className={`w-full py-1 text-xs rounded-sm font-semibold ${
                          canBuy ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-slate-600 text-zinc-400 cursor-not-allowed'
                        }`}
                      >
                        {formatCurrency(pin.price)}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Extra pin slots */}
      <div>
        <h3 className={`font-semibold ${textClass} mb-2`}>Extra Pin Slots</h3>
        <div className="flex flex-wrap gap-3">
          {!userData?.extraAchievementSlot && (
            <button
              onClick={() => cash >= PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT && onRequestPurchase({ type: 'slot', item: 'achievement', price: PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT })}
              disabled={cash < PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT}
              className={`px-4 py-2 rounded-sm border text-sm ${
                cash >= PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT
                  ? 'border-orange-500 text-orange-500 hover:bg-orange-500/10'
                  : 'border-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}
            >
              +1 Achievement Slot ({formatCurrency(PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT)})
            </button>
          )}
          {!userData?.extraShopSlot && (
            <button
              onClick={() => cash >= PIN_SLOT_COSTS.EXTRA_SHOP_SLOT && onRequestPurchase({ type: 'slot', item: 'shop', price: PIN_SLOT_COSTS.EXTRA_SHOP_SLOT })}
              disabled={cash < PIN_SLOT_COSTS.EXTRA_SHOP_SLOT}
              className={`px-4 py-2 rounded-sm border text-sm ${
                cash >= PIN_SLOT_COSTS.EXTRA_SHOP_SLOT
                  ? 'border-orange-500 text-orange-500 hover:bg-orange-500/10'
                  : 'border-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}
            >
              +1 Shop Slot ({formatCurrency(PIN_SLOT_COSTS.EXTRA_SHOP_SLOT)})
            </button>
          )}
          {userData?.extraAchievementSlot && userData?.extraShopSlot && (
            <p className={`text-sm ${mutedClass}`}>All extra slots purchased!</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShopTab;
