import { useState } from 'react';
import { COSMETICS, COSMETIC_MAP, COSMETIC_TYPE_LABELS, COSMETIC_TYPES } from '../../../constants/cosmetics';
import { formatCurrency } from '../../../utils/formatters';
import { getThemeClasses } from '../../../utils/theme';
import { useAppContext } from '../../../context/AppContext';

// Cosmetics tab of the customization modal: buy/equip leaderboard effects.
const CosmeticsTab = ({ cash, onEquipCosmetic, onRequestPurchase }) => {
  const { darkMode, userData } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const ownedCosmetics = userData?.ownedCosmetics || [];
  const activeCosmetics = userData?.activeCosmetics || {};
  // Row glows come in a standard and a pulsing variant of every color. Showing
  // all 18 at once is overwhelming, so a toggle switches the section between
  // the two sets (paired by color, one card position each). Opens on whichever
  // set holds the player's equipped glow so it's never hidden.
  const [glowVariant, setGlowVariant] = useState(() =>
    COSMETIC_MAP[activeCosmetics.rowGlow]?.effectClass ? 'pulse' : 'standard'
  );

  const glowToggleBtn = (variant, label) => (
    <button
      onClick={() => setGlowVariant(variant)}
      className={`px-3 py-1 text-xs font-semibold rounded-sm ${
        glowVariant === variant
          ? 'bg-orange-600 text-white'
          : darkMode ? 'bg-zinc-800 text-zinc-400 hover:text-zinc-200' : 'bg-slate-100 text-slate-500 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <p className={`text-xs ${mutedClass}`}>Cosmetics apply visual effects to your leaderboard row, visible to all players. One active per type.</p>
      {COSMETIC_TYPES.map(type => (
        <div key={type}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={`font-semibold ${textClass}`}>{COSMETIC_TYPE_LABELS[type]}</h3>
            {type === 'rowGlow' && (
              <div className="flex gap-1">
                {glowToggleBtn('standard', 'Standard')}
                {glowToggleBtn('pulse', 'Pulsing')}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {COSMETICS.filter(c =>
              c.type === type &&
              (type !== 'rowGlow' || (glowVariant === 'pulse' ? !!c.effectClass : !c.effectClass))
            ).map(cosmetic => {
              const owned = ownedCosmetics.includes(cosmetic.id);
              const active = activeCosmetics[type] === cosmetic.id;
              const canAfford = cash >= cosmetic.price;
              return (
                <div
                  key={cosmetic.id}
                  className={`p-3 rounded-sm border ${
                    active ? 'border-orange-500 bg-orange-500/10'
                    : owned ? `border-2` : darkMode ? 'border-zinc-700' : 'border-slate-200'
                  }`}
                  style={owned && !active ? { borderColor: cosmetic.color + '80' } : {}}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className={`relative w-5 h-5 rounded-full shrink-0 ${cosmetic.type !== 'nameColor' ? (cosmetic.effectClass || '') : ''}`}
                      style={{ backgroundColor: cosmetic.color }}
                    />
                    <span className={`font-semibold text-sm ${cosmetic.type === 'nameColor' && cosmetic.effectClass ? cosmetic.effectClass : textClass}`}>
                      {cosmetic.name}
                    </span>
                  </div>
                  <p className={`text-xs ${mutedClass} mb-2`}>{cosmetic.description}</p>
                  {owned ? (
                    <button
                      onClick={() => onEquipCosmetic(type, active ? null : cosmetic.id)}
                      className={`w-full py-1 text-xs font-semibold rounded-sm ${
                        active
                          ? 'bg-orange-600 hover:bg-orange-700 text-white'
                          : darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      }`}
                    >
                      {active ? 'Equipped ✓' : 'Equip'}
                    </button>
                  ) : (
                    <button
                      onClick={() => canAfford && onRequestPurchase({ type: 'cosmetic', item: cosmetic, price: cosmetic.price })}
                      disabled={!canAfford}
                      className={`w-full py-1 text-xs font-semibold rounded-sm ${
                        canAfford
                          ? 'bg-orange-600 hover:bg-orange-700 text-white'
                          : darkMode ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      {formatCurrency(cosmetic.price)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default CosmeticsTab;
