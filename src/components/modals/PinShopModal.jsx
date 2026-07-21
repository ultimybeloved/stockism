import { useState } from 'react';
import { formatCurrency } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import RowPreview from './pinshop/RowPreview';
import MyLookTab from './pinshop/MyLookTab';
import ShopTab from './pinshop/ShopTab';

// Customization modal: a live preview of the user's leaderboard row pinned at
// the top, then two tabs — My Look (equip everything you own) and Shop (buy
// cosmetics, pins, slots). The purchase confirm dialog lives here so both tabs
// share it.
const PinShopModal = ({ onClose, onPurchase, onPurchaseCosmetic, onEquipCosmetic, portfolioValue }) => {
  useEscapeKey(onClose);
  const { darkMode, userData } = useAppContext();
  const [activeTab, setActiveTab] = useState('look');
  const [confirmPurchase, setConfirmPurchase] = useState(null); // { type: 'pin' | 'slot' | 'cosmetic', item, price }
  const [purchasing, setPurchasing] = useState(false);
  const [tryOn, setTryOn] = useState(null); // shop cosmetic being previewed on the row

  const { cardClass, textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass } = getThemeClasses(darkMode);
  const cash = userData?.cash || 0;

  const handleConfirmPurchase = async () => {
    if (!confirmPurchase || purchasing) return;
    setPurchasing(true);
    try {
      if (confirmPurchase.type === 'pin') {
        await onPurchase('buyPin', confirmPurchase.item.id, confirmPurchase.price);
      } else if (confirmPurchase.type === 'slot') {
        await onPurchase('buySlot', confirmPurchase.item, confirmPurchase.price);
      } else if (confirmPurchase.type === 'cosmetic') {
        await onPurchaseCosmetic(confirmPurchase.item.id);
      }
    } finally {
      setPurchasing(false);
      setConfirmPurchase(null);
    }
  };

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div className={`${modalShellClass} max-w-2xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🎨 Customization</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>×</button>
          </div>
          <p className={`text-sm ${mutedClass}`}>Cash: <span className="text-orange-500 font-semibold">{formatCurrency(cash)}</span></p>
        </div>

        <RowPreview portfolioValue={portfolioValue} tryOn={tryOn} />

        {/* Tabs */}
        <div className={`flex border-b ${cardEdgeClass} mt-3`}>
          {[['look', '✨ My Look'], ['shop', '🛒 Shop']].map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setTryOn(null); }}
              className={`flex-1 py-2 text-xs font-semibold ${
                activeTab === tab
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : mutedClass
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'look' && (
            <MyLookTab
              onPinAction={onPurchase}
              onEquipCosmetic={onEquipCosmetic}
              onClose={onClose}
            />
          )}
          {activeTab === 'shop' && (
            <ShopTab
              cash={cash}
              onEquipCosmetic={onEquipCosmetic}
              onRequestPurchase={setConfirmPurchase}
              onTryOn={setTryOn}
            />
          )}
        </div>

        {/* Purchase Confirmation Dialog */}
        {confirmPurchase && (
          <div className={`absolute inset-0 bg-black/50 flex items-center justify-center`}>
            <div className={`${cardClass} border rounded-sm p-6 m-4 max-w-sm`}>
              <h3 className={`text-lg font-semibold ${textClass} mb-3`}>Confirm Purchase</h3>
              <p className={`${mutedClass} mb-4`}>
                {confirmPurchase.type === 'pin' ? (
                  <>Buy <img src={`/pins/${confirmPurchase.item.image}`} alt={confirmPurchase.item.name} className="w-6 h-6 object-contain inline" /> <strong>{confirmPurchase.item.name}</strong> for <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?</>
                ) : confirmPurchase.type === 'cosmetic' ? (
                  <>Buy <span className="inline-block w-3 h-3 rounded-full mx-1 align-middle" style={{ backgroundColor: confirmPurchase.item.color }} /><strong>{confirmPurchase.item.name}</strong> for <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?</>
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
                  disabled={purchasing}
                  className="flex-1 py-2 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold disabled:opacity-50"
                >
                  {purchasing ? 'Buying…' : 'Confirm'}
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
