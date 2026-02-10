import React, { useState } from 'react';
import { SHOP_PINS, PIN_SLOT_COSTS, CREW_MAP, getActiveShopPins } from '../../crews';
import { ACHIEVEMENTS } from '../../constants/achievements';
import { formatCurrency } from '../../utils/formatters';
import PinDisplay from '../common/PinDisplay';

const PinShopModal = ({ onClose, darkMode, userData, onPurchase, purchaseLoading }) => {
  const [selectedPin, setSelectedPin] = useState(null);
  const [activeTab, setActiveTab] = useState('shop'); // 'shop', 'achievement', 'manage'
  const [confirmPurchase, setConfirmPurchase] = useState(null); // { type: 'pin' | 'slot', item: pin | slotType, price: number }

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const ownedPins = userData?.ownedShopPins || [];
  const displayedShopPins = userData?.displayedShopPins || [];
  const displayedAchievementPins = userData?.displayedAchievementPins || [];
  const earnedAchievements = userData?.achievements || [];
  const cash = userData?.cash || 0;

  // Calculate slots
  const baseAchievementSlots = 1;
  const baseShopSlots = 1;
  const extraAchievementSlot = userData?.extraAchievementSlot ? 1 : 0;
  const extraShopSlot = userData?.extraShopSlot ? 1 : 0;
  const allAchievementsBonus = earnedAchievements.length >= Object.keys(ACHIEVEMENTS).length ? 1 : 0;

  const maxAchievementSlots = baseAchievementSlots + extraAchievementSlot + allAchievementsBonus;
  const maxShopSlots = baseShopSlots + extraShopSlot;

  const handleBuyPin = (pin) => {
    if (cash >= pin.price && !ownedPins.includes(pin.id)) {
      setConfirmPurchase({ type: 'pin', item: pin, price: pin.price });
    }
  };

  const handleConfirmPurchase = () => {
    if (!confirmPurchase) return;

    if (confirmPurchase.type === 'pin') {
      onPurchase('buyPin', confirmPurchase.item.id, confirmPurchase.price);
    } else if (confirmPurchase.type === 'slot') {
      onPurchase('buySlot', confirmPurchase.item, confirmPurchase.price);
    }
    setConfirmPurchase(null);
  };

  const handleToggleShopPin = (pinId) => {
    const newDisplayed = displayedShopPins.includes(pinId)
      ? displayedShopPins.filter(p => p !== pinId)
      : displayedShopPins.length < maxShopSlots
        ? [...displayedShopPins, pinId]
        : displayedShopPins;
    onPurchase('setShopPins', newDisplayed, 0);
  };

  const handleToggleAchievementPin = (achId) => {
    const newDisplayed = displayedAchievementPins.includes(achId)
      ? displayedAchievementPins.filter(p => p !== achId)
      : displayedAchievementPins.length < maxAchievementSlots
        ? [...displayedAchievementPins, achId]
        : displayedAchievementPins;
    onPurchase('setAchievementPins', newDisplayed, 0);
  };

  const handleBuySlot = (slotType) => {
    const cost = slotType === 'achievement' ? PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT : PIN_SLOT_COSTS.EXTRA_SHOP_SLOT;
    if (cash >= cost) {
      setConfirmPurchase({ type: 'slot', item: slotType, price: cost });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>📌 Pins</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
          <p className={`text-sm ${mutedClass}`}>Cash: <span className="text-orange-500 font-semibold">{formatCurrency(cash)}</span></p>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          {['shop', 'achievement', 'manage'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-semibold ${
                activeTab === tab
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : mutedClass
              }`}
            >
              {tab === 'shop' ? '🛒 Buy Pins' : tab === 'achievement' ? '🏆 Achievements' : '📋 Display'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'shop' && (
            <div className="space-y-5">
              {getActiveShopPins().map(collection => (
                <div key={collection.id}>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className={`font-semibold ${textClass}`}>{collection.name}</h3>
                    {collection.limited && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 font-semibold">
                        Limited
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {collection.pins.map(pin => {
                      const owned = ownedPins.includes(pin.id);
                      const canAfford = cash >= pin.price;
                      const streakMet = !pin.requiredCheckinStreak || (userData?.checkinStreak || 0) >= pin.requiredCheckinStreak;
                      const canBuy = canAfford && streakMet && !owned;
                      return (
                        <div
                          key={pin.id}
                          className={`p-3 rounded-sm border ${
                            owned
                              ? 'border-orange-500 bg-orange-500/10'
                              : darkMode ? 'border-zinc-700' : 'border-amber-200'
                          }`}
                        >
                          <div className="text-2xl text-center mb-2 flex items-center justify-center h-8">
                            {pin.image ? (
                              <img src={`/pins/${pin.image}`} alt={pin.name} className="w-8 h-8 object-contain" />
                            ) : pin.emoji}
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
                                onClick={() => canBuy && handleBuyPin(pin)}
                                disabled={!canBuy}
                                className={`w-full py-1 text-xs rounded-sm font-semibold ${
                                  canBuy
                                    ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                    : 'bg-slate-600 text-zinc-400 cursor-not-allowed'
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
            </div>
          )}

          {activeTab === 'achievement' && (
            <div>
              <p className={`text-sm ${mutedClass} mb-3`}>
                Select up to {maxAchievementSlots} achievement{maxAchievementSlots > 1 ? 's' : ''} to display as pins.
                ({displayedAchievementPins.length}/{maxAchievementSlots} selected)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {earnedAchievements.map(achId => {
                  const ach = ACHIEVEMENTS[achId];
                  if (!ach) return null;
                  const isDisplayed = displayedAchievementPins.includes(achId);
                  return (
                    <button
                      key={achId}
                      onClick={() => handleToggleAchievementPin(achId)}
                      className={`p-3 rounded-sm border text-left ${
                        isDisplayed
                          ? 'border-orange-500 bg-orange-500/10'
                          : darkMode ? 'border-zinc-700' : 'border-amber-200'
                      }`}
                    >
                      <div className="text-2xl mb-1">{ach.emoji}</div>
                      <div className={`text-sm font-semibold ${textClass}`}>{ach.name}</div>
                      {isDisplayed && <span className="text-xs text-orange-500">✓ Displayed</span>}
                    </button>
                  );
                })}
              </div>
              {earnedAchievements.length === 0 && (
                <p className={`text-center ${mutedClass} py-8`}>No achievements yet! Start trading to earn some.</p>
              )}
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="space-y-6">
              {/* Crew Pin Toggle */}
              {userData?.crew && (
                <div>
                  <h3 className={`font-semibold ${textClass} mb-2`}>Crew Pin</h3>
                  <button
                    onClick={() => onPurchase('toggleCrewPin', !userData.displayCrewPin, 0)}
                    className={`px-3 py-2 rounded-sm border flex items-center ${
                      userData.displayCrewPin !== false
                        ? 'border-orange-500 bg-orange-500/10'
                        : darkMode ? 'border-zinc-700' : 'border-amber-200'
                    }`}
                  >
                    {CREW_MAP[userData.crew]?.icon ? (
                      <img src={CREW_MAP[userData.crew]?.icon} alt="" className="w-5 h-5 object-contain mr-1" />
                    ) : (
                      <span className="mr-1">{CREW_MAP[userData.crew]?.emblem}</span>
                    )}
                    <span className={`text-sm ${textClass}`}>{CREW_MAP[userData.crew]?.name}</span>
                    {userData.displayCrewPin !== false && <span className="text-xs text-orange-500 ml-2">✓ Displayed</span>}
                  </button>
                </div>
              )}

              {/* Displayed Shop Pins */}
              <div>
                <h3 className={`font-semibold ${textClass} mb-2`}>
                  Shop Pins ({displayedShopPins.length}/{maxShopSlots} slots)
                </h3>
                {ownedPins.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {ownedPins.map(pinId => {
                      const pin = SHOP_PINS[pinId];
                      if (!pin) return null;
                      const isDisplayed = displayedShopPins.includes(pinId);
                      return (
                        <button
                          key={pinId}
                          onClick={() => handleToggleShopPin(pinId)}
                          className={`px-3 py-2 rounded-sm border ${
                            isDisplayed
                              ? 'border-orange-500 bg-orange-500/10'
                              : darkMode ? 'border-zinc-700' : 'border-amber-200'
                          }`}
                        >
                          <span className="mr-1 inline-flex items-center">
                            {pin.image ? (
                              <img src={`/pins/${pin.image}`} alt={pin.name} className="w-5 h-5 object-contain" />
                            ) : pin.emoji}
                          </span>
                          <span className={`text-sm ${textClass}`}>{pin.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className={`text-sm ${mutedClass}`}>No pins owned yet. Visit the shop to buy some!</p>
                )}
              </div>

              {/* Buy Extra Slots */}
              <div>
                <h3 className={`font-semibold ${textClass} mb-2`}>Buy Extra Slots</h3>
                <div className="flex flex-wrap gap-3">
                  {!userData?.extraAchievementSlot && (
                    <button
                      onClick={() => handleBuySlot('achievement')}
                      disabled={cash < PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT}
                      className={`px-4 py-2 rounded-sm border ${
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
                      onClick={() => handleBuySlot('shop')}
                      disabled={cash < PIN_SLOT_COSTS.EXTRA_SHOP_SLOT}
                      className={`px-4 py-2 rounded-sm border ${
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
          )}
        </div>

        {/* Purchase Confirmation Dialog */}
        {confirmPurchase && (
          <div className={`absolute inset-0 bg-black/50 flex items-center justify-center`}>
            <div className={`${cardClass} border rounded-sm p-6 m-4 max-w-sm`}>
              <h3 className={`text-lg font-semibold ${textClass} mb-3`}>Confirm Purchase</h3>
              <p className={`${mutedClass} mb-4`}>
                {confirmPurchase.type === 'pin' ? (
                  <>Buy <span className="text-xl">{confirmPurchase.item.emoji}</span> <strong>{confirmPurchase.item.name}</strong> for <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?</>
                ) : (
                  <>Buy <strong>+1 {confirmPurchase.item === 'achievement' ? 'Achievement' : 'Shop'} Slot</strong> for <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?</>
                )}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmPurchase(null)}
                  className={`flex-1 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300' : 'border-amber-200 text-zinc-600'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPurchase}
                  disabled={purchaseLoading}
                  className="flex-1 py-2 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold disabled:opacity-50"
                >
                  {purchaseLoading ? 'Buying...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PinShopModal;
