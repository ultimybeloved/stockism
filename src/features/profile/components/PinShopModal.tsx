import { useState } from 'react';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';
import { useSession } from '../../../context/AppContext';

import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import RowPreview from './pinshop/RowPreview';
import MyLookTab from './pinshop/MyLookTab';
import ShopTab from './pinshop/ShopTab';
import ShopDeals from './pinshop/ShopDeals';
import GiftDialog from './pinshop/GiftDialog';
import type { ShopPin } from '../../../crews';
import type { Cosmetic } from '../../../constants/cosmetics';
import type { Bundle } from '../../../rules/shop';
import type { StreakSaverPlan } from '../../../rules/economy';
import type { PinAction, GiftTarget } from '../hooks/usePinShop';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';
import { pixelatedIfSvg } from '../../../constants/crests';
import PixelIcon from '../../../shared/components/PixelIcon';

/** The purchase waiting on the confirm dialog. */
export type PendingPurchase =
  | { type: 'pin'; item: ShopPin; price: number }
  | { type: 'cosmetic'; item: Cosmetic; price: number }
  | { type: 'bundle'; item: Bundle; price: number; count: number }
  | { type: 'slot'; item: 'achievement' | 'shop'; price: number }
  | { type: 'perk'; item: StreakSaverPlan; name: string; price: number };

interface PinShopModalProps {
  onClose: () => void;
  onPurchase: (action: PinAction, payload: unknown, cost?: number) => Promise<void>;
  onPurchaseCosmetic: (cosmeticId: string) => Promise<void>;
  onPurchaseBundle: (bundleId: string) => Promise<void>;
  onGiftCosmetic: (target: GiftTarget, recipient: string) => Promise<string | null>;
  onEquipCosmetic: (type: string, cosmeticId: string | null) => Promise<void>;
  portfolioValue: number;
}

// Customization modal: a live preview of the user's leaderboard row pinned at
// the top, then two tabs — My Look (equip everything you own) and Shop (buy
// cosmetics, pins, slots). The purchase confirm dialog lives here so both tabs
// share it.
const PinShopModal = ({
  onClose,
  onPurchase,
  onPurchaseCosmetic,
  onPurchaseBundle,
  onGiftCosmetic,
  onEquipCosmetic,
  portfolioValue,
}: PinShopModalProps) => {
  useEscapeKey(onClose);
  const dialogRef = useModalFocus();
  const { userData } = useSession();
  const [activeTab, setActiveTab] = useState('look');
  const [confirmPurchase, setConfirmPurchase] = useState<PendingPurchase | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [gift, setGift] = useState<GiftTarget | null>(null);
  const [tryOn, setTryOn] = useState<Cosmetic[] | null>(null); // shop cosmetics being previewed on the row

  const { cardClass, textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass } = themeClasses;
  const cash = userData?.cash || 0;

  const handleConfirmPurchase = async () => {
    if (!confirmPurchase || purchasing) return;
    setPurchasing(true);
    try {
      if (confirmPurchase.type === 'pin') {
        await onPurchase('buyPin', confirmPurchase.item.id, confirmPurchase.price);
      } else if (confirmPurchase.type === 'slot') {
        await onPurchase('buySlot', confirmPurchase.item, confirmPurchase.price);
      } else if (confirmPurchase.type === 'perk') {
        await onPurchase('buyStreakSaver', confirmPurchase.item, confirmPurchase.price);
      } else if (confirmPurchase.type === 'cosmetic') {
        await onPurchaseCosmetic(confirmPurchase.item.id);
      } else if (confirmPurchase.type === 'bundle') {
        await onPurchaseBundle(confirmPurchase.item.id);
      }
    } finally {
      setPurchasing(false);
      setConfirmPurchase(null);
    }
  };

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`${modalShellClass} max-w-2xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>
              <PixelIcon name="palette" className="w-5 h-5 mr-1.5 align-[-3px]" />
              Customization
            </h2>
            <button aria-label="Close" onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <p className={`text-sm ${mutedClass}`}>
            Cash: <span className="text-orange-500 font-semibold">{formatCurrency(cash)}</span>
          </p>
        </div>

        <RowPreview portfolioValue={portfolioValue} tryOn={tryOn} />

        {/* Tabs */}
        <div className={`flex border-b ${cardEdgeClass} mt-3`}>
          {(
            [
              ['look', '✨ My Look'],
              ['shop', '🛒 Shop'],
              ['bundles', '🎁 Bundles'],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setTryOn(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold ${
                activeTab === tab ? 'text-orange-500 border-b-2 border-orange-500' : mutedClass
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'look' && (
            <MyLookTab onPinAction={onPurchase} onEquipCosmetic={onEquipCosmetic} onClose={onClose} />
          )}
          {activeTab === 'shop' && (
            <ShopTab
              cash={cash}
              onEquipCosmetic={onEquipCosmetic}
              onRequestPurchase={setConfirmPurchase}
              onRequestGift={(cosmetic, price) =>
                setGift({ kind: 'cosmetic', id: cosmetic.id, name: cosmetic.name, price })
              }
              onTryOn={setTryOn}
            />
          )}
          {activeTab === 'bundles' && (
            <div className="space-y-6">
              <ShopDeals
                show="bundles"
                cash={cash}
                featuredId={null}
                onRequestPurchase={setConfirmPurchase}
                onRequestGift={setGift}
                onTryOn={setTryOn}
              />
            </div>
          )}
        </div>

        {gift && (
          <GiftDialog
            gift={gift}
            cash={cash}
            onSend={(recipient) => onGiftCosmetic(gift, recipient)}
            onClose={() => setGift(null)}
          />
        )}

        {/* Purchase Confirmation Dialog */}
        {confirmPurchase && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className={`${cardClass} border rounded-sm p-6 m-4 max-w-sm`}>
              <h3 className={`text-lg font-semibold ${textClass} mb-3`}>Confirm Purchase</h3>
              <p className={`${mutedClass} mb-4`}>
                {confirmPurchase.type === 'pin' ? (
                  <>
                    Buy{' '}
                    <img
                      src={`/pins/${confirmPurchase.item.image}`}
                      alt={confirmPurchase.item.name}
                      className="w-6 h-6 object-contain inline"
                      style={pixelatedIfSvg(confirmPurchase.item.image)}
                    />{' '}
                    <strong>{confirmPurchase.item.name}</strong> for{' '}
                    <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?
                  </>
                ) : confirmPurchase.type === 'cosmetic' ? (
                  <>
                    Buy{' '}
                    <span
                      className="inline-block w-3 h-3 rounded-full mx-1 align-middle"
                      style={{ backgroundColor: confirmPurchase.item.color }}
                    />
                    <strong>{confirmPurchase.item.name}</strong> for{' '}
                    <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?
                  </>
                ) : confirmPurchase.type === 'bundle' ? (
                  <>
                    Buy the <strong>{confirmPurchase.item.name}</strong> bundle ({confirmPurchase.count}{' '}
                    {confirmPurchase.count === 1 ? 'item' : 'items'}) for{' '}
                    <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?
                  </>
                ) : confirmPurchase.type === 'perk' ? (
                  <>
                    Buy the <strong>{confirmPurchase.name}</strong> for{' '}
                    <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?
                  </>
                ) : (
                  <>
                    Buy <strong>+1 {confirmPurchase.item === 'achievement' ? 'Achievement' : 'Shop'} Slot</strong> for{' '}
                    <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?
                  </>
                )}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmPurchase(null)}
                  className="flex-1 py-2 rounded-sm border light:border-amber-200 light:text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
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
