import { useMemo, useState } from 'react';
import { COSMETICS, COSMETIC_MAP } from '../../../../constants/cosmetics';
import { BUNDLES, bundleQuote, featuredCosmeticId, featuredPrice, shopWeekEndsAt } from '../../../../rules/shop';
import { formatCurrency } from '../../../../utils/formatters';
import { themeClasses } from '../../../../utils/theme';
import { useSession } from '../../../../context/AppContext';

import type { Cosmetic } from '../../../../constants/cosmetics';
import type { PendingPurchase } from '../PinShopModal';
import type { GiftTarget } from '../../hooks/usePinShop';
import { pressable } from '../../../../utils/a11y';

// This week's featured cosmetic id. Worked out from the date (rules/shop), the
// same way purchaseCosmetic prices it, so the shop never shows a price the
// server won't charge.
export const useFeaturedId = () => useMemo(() => featuredCosmeticId(COSMETICS), []);

interface ShopDealsProps {
  /** The Shop tab shows the featured card; the Bundles tab shows the bundles. */
  show: 'featured' | 'bundles';
  cash: number;
  featuredId: string | null;
  onRequestPurchase: (purchase: PendingPurchase) => void;
  onRequestGift?: (gift: GiftTarget) => void;
  onTryOn: (cosmetics: Cosmetic[] | null) => void;
}

const Swatch = ({ cosmetic }: { cosmetic: Cosmetic }) => (
  <span className="inline-block w-6 h-6 rounded-full p-px shrink-0" title={cosmetic.name}>
    <span
      className={`cos-swatch block w-full h-full rounded-full ${cosmetic.type !== 'nameColor' ? cosmetic.effectClass || '' : ''}`}
      style={{ backgroundColor: cosmetic.color }}
    />
  </span>
);

// Shop deals: this week's featured item (top of the Shop tab) and the bundles
// (their own tab). Tapping a bundle tries the whole set on the preview row.
const ShopDeals = ({ show, cash, featuredId, onRequestPurchase, onRequestGift, onTryOn }: ShopDealsProps) => {
  const { userData } = useSession();
  const { textClass, mutedClass, borderClass } = themeClasses;
  const owned = userData?.ownedCosmetics || [];
  const [selectedBundle, setSelectedBundle] = useState<string | null>(null);

  const featured = featuredId ? COSMETIC_MAP[featuredId] : null;
  const endsAt = new Date(shopWeekEndsAt());
  const btn = (enabled: boolean) =>
    `shrink-0 px-3 py-1.5 text-xs font-semibold rounded-sm ${
      enabled
        ? 'bg-orange-600 hover:bg-orange-700 text-white'
        : 'light:bg-slate-100 light:text-slate-400 light:cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500 dark:cursor-not-allowed'
    }`;

  return (
    <>
      {show === 'featured' && featured && (
        <div>
          <h3 className={`font-semibold ${textClass} mb-2`}>
            Featured This Week
            <span className={`ml-2 text-xs font-normal ${mutedClass}`}>
              25% off until {endsAt.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })} 00:00 UTC
            </span>
          </h3>
          <div
            className={`p-3 rounded-sm border border-amber-400/60 flex items-center gap-3 cursor-pointer`}
            {...pressable(() => {
              setSelectedBundle(null);
              onTryOn([featured]);
            })}
          >
            <Swatch cosmetic={featured} />
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-semibold ${textClass}`}>{featured.name}</div>
              <div className={`text-xs ${mutedClass}`}>{featured.description}</div>
            </div>
            {owned.includes(featured.id) ? (
              <span className="text-xs font-semibold text-orange-500">Owned</span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const price = featuredPrice(featured.price);
                  if (cash >= price) onRequestPurchase({ type: 'cosmetic', item: featured, price });
                }}
                disabled={cash < featuredPrice(featured.price)}
                className={btn(cash >= featuredPrice(featured.price))}
              >
                <span className="line-through opacity-70 mr-1">{formatCurrency(featured.price)}</span>
                {formatCurrency(featuredPrice(featured.price))}
              </button>
            )}
          </div>
        </div>
      )}

      {show === 'bundles' && (
        <div>
          <h3 className={`font-semibold ${textClass} mb-2`}>
            Bundles
            <span className={`ml-2 text-xs font-normal ${mutedClass}`}>
              20% off. Already own a piece? You only pay for the rest.
            </span>
          </h3>
          <div className="space-y-2">
            {BUNDLES.map((bundle) => {
              const items = bundle.items.map((id) => COSMETIC_MAP[id]).filter((c): c is Cosmetic => !!c);
              const { missing, fullPrice, price } = bundleQuote(bundle, owned, (id) => COSMETIC_MAP[id]?.price);
              // A gift always costs the whole set, whatever either player owns.
              const wholeSet = bundleQuote(bundle, [], (id) => COSMETIC_MAP[id]?.price).price;
              const selected = selectedBundle === bundle.id;
              const canAfford = cash >= price;
              return (
                <div
                  key={bundle.id}
                  {...pressable(() => {
                    setSelectedBundle(selected ? null : bundle.id);
                    onTryOn(selected ? null : items);
                  })}
                  className={`p-2 rounded-sm border flex items-center gap-3 cursor-pointer ${
                    selected ? 'border-orange-500' : borderClass
                  }`}
                >
                  <div className="flex -space-x-1">
                    {items.map((c) => (
                      <Swatch key={c.id} cosmetic={c} />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-semibold ${textClass}`}>{bundle.name}</div>
                    <div className={`text-xs ${mutedClass} truncate`}>
                      {missing.length === items.length
                        ? items.map((c) => c.name).join(', ')
                        : missing.length
                          ? `${missing.length} of ${items.length} left to collect`
                          : 'You own the whole set'}
                    </div>
                  </div>
                  {onRequestGift && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestGift({ kind: 'bundle', id: bundle.id, name: bundle.name, price: wholeSet });
                      }}
                      title="Buy this bundle for another player"
                      className="shrink-0 px-2 py-1.5 text-xs font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
                    >
                      🎁
                    </button>
                  )}
                  {missing.length ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canAfford)
                          onRequestPurchase({ type: 'bundle', item: bundle, price, count: missing.length });
                      }}
                      disabled={!canAfford}
                      className={btn(canAfford)}
                    >
                      <span className="line-through opacity-70 mr-1">{formatCurrency(fullPrice)}</span>
                      {formatCurrency(price)}
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-orange-500">Owned</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default ShopDeals;
