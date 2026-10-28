import { useMemo, useState } from 'react';
import { COSMETICS } from '../../../../constants/cosmetics';
import { themeClasses } from '../../../../utils/theme';
import { formatCurrency } from '../../../../utils/formatters';
import { useSession } from '../../../../context/AppContext';
import { featuredPrice } from '../../../../rules/shop';
import { searchShop, shopItems, shopPins, type ShopCategory } from '../../utils/shopCatalog';
import { styleKeyOf, useShopSelection } from '../../hooks/useShopSelection';
import { useFeaturedId } from './ShopDeals';
import ShopCategoryTabs from './ShopCategoryTabs';
import ShopShelves from './ShopShelves';
import ProfileShopShelf from './ProfileShopShelf';
import ShopPinGrid from './ShopPinGrid';
import ShopSearchResults from './ShopSearchResults';
import ShopPerks from './ShopPerks';
import ShopBuyBar, { type BuyBarAction } from './ShopBuyBar';
import type { Cosmetic, CosmeticType } from '../../../../constants/cosmetics';
import type { CosmeticStyle, CosmeticStyleKey } from '../../../../rules/cosmetics';
import type { ShopPin } from '../../../../crews';
import type { PendingPurchase } from '../PinShopModal';

interface ShopTabProps {
  /** Cash plus shop credit: what the player can spend here. */
  budget: number;
  onEquipCosmetic: (type: string, cosmeticId: string | null) => unknown;
  onSetCosmeticStyle: <K extends CosmeticStyleKey>(key: K, value: NonNullable<CosmeticStyle[K]> | null) => unknown;
  onRequestPurchase: (purchase: PendingPurchase) => void;
  /** Opens the gift dialog for a shop item at the price the giver would pay. */
  onRequestGift: (cosmetic: Cosmetic, price: number) => void;
  /** Previews cosmetics on the sample row (one per slot); null clears it. */
  onTryOn: (cosmetics: Cosmetic[] | null) => void;
  onTryPin: (pin: ShopPin | null) => void;
  onPreviewStyle: (style: CosmeticStyle) => void;
}

const COUNTS: Partial<Record<ShopCategory, number>> = {
  nameColor: COSMETICS.filter((c) => !c.earned && c.type === 'nameColor').length,
  rowGlow: COSMETICS.filter((c) => !c.earned && c.type === 'rowGlow').length,
  rowBackdrop: COSMETICS.filter((c) => !c.earned && c.type === 'rowBackdrop').length,
  rowFrame: COSMETICS.filter((c) => !c.earned && c.type === 'rowFrame').length,
  holdingMark: COSMETICS.filter((c) => c.type === 'holdingMark').length,
  profileBg: COSMETICS.filter((c) => c.type === 'profileBg' && !c.variantOf).length + 1,
  pin: shopPins().length,
};

// Shop tab: a search box, the category tabs, and one category at a time on
// three price shelves (Showcase, Premium, Classics). Tapping anything tries it
// on the preview row (mixed with whatever else is being tried) and puts it in
// the buy bar under the list. Pins and perks get their own tabs.
const ShopTab = ({
  budget,
  onEquipCosmetic,
  onSetCosmeticStyle,
  onRequestPurchase,
  onRequestGift,
  onTryOn,
  onTryPin,
  onPreviewStyle,
}: ShopTabProps) => {
  const { userData } = useSession();
  const { textClass, mutedClass, inputClass } = themeClasses;
  const featuredId = useFeaturedId();
  const sel = useShopSelection({ featuredId, onTryOn, onTryPin, onPreviewStyle });
  const [category, setCategory] = useState<ShopCategory>('nameColor');
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchShop(query), [query]);

  // Free items (the plain holding marks) belong to everyone.
  const ownedCosmetics = useMemo(
    () => new Set([...(userData?.ownedCosmetics || []), ...COSMETICS.filter((c) => c.free).map((c) => c.id)]),
    [userData?.ownedCosmetics],
  );
  const ownedPins = useMemo(() => new Set(userData?.ownedShopPins || []), [userData?.ownedShopPins]);
  const allOwned = useMemo(() => new Set([...ownedCosmetics, ...ownedPins]), [ownedCosmetics, ownedPins]);
  const featured = featuredId ? COSMETICS.find((c) => c.id === featuredId) : null;

  // The buy bar: what its main button does for the item tapped last.
  const bar = (() => {
    const a = sel.active;
    if (!a) return null;
    if (a.kind === 'pin') {
      const owned = ownedPins.has(a.item.id);
      return {
        name: owned ? `${a.item.name} (owned)` : a.item.name,
        price: a.item.price,
        action: (owned ? null : 'buy') as BuyBarAction,
        run: () => onRequestPurchase({ type: 'pin', item: a.item, price: a.item.price }),
      };
    }
    const c = a.item;
    const key = styleKeyOf(c);
    const price = sel.salePriceOf(c) ?? c.price;
    const owned = ownedCosmetics.has(c.id);
    const equipped = userData?.activeCosmetics?.[c.type as CosmeticType] === c.id;
    const restyle = !!key && sel.previewStyleFor(key) !== sel.savedStyle(key);
    const styleNow = key ? ({ [key]: sel.previewStyleFor(key) } as CosmeticStyle) : undefined;
    const saveStyle = () => key && onSetCosmeticStyle(key, sel.previewStyleFor(key) ?? null);
    const action: BuyBarAction = !owned ? 'buy' : !equipped ? 'equip' : restyle ? 'restyle' : 'unequip';
    return {
      name: c.name,
      price,
      listPrice: price !== c.price ? c.price : undefined,
      action,
      gift: c.free ? undefined : () => onRequestGift(c, price),
      run: () => {
        if (action === 'buy') onRequestPurchase({ type: 'cosmetic', item: c, price, style: styleNow });
        else if (action === 'equip') {
          onEquipCosmetic(c.type, c.id);
          saveStyle();
        } else if (action === 'restyle') saveStyle();
        else onEquipCosmetic(c.type, null);
      },
    };
  })();

  const shelfProps = {
    selectedIds: sel.selectedIds,
    owned: ownedCosmetics,
    featuredId,
    salePriceOf: sel.salePriceOf,
    style: sel.style,
    onStyle: sel.updateStyle,
    pulsing: sel.pulsing,
    onPulsing: sel.switchPulsing,
    onPick: (c: Cosmetic) => sel.pickCosmetic(c),
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <label className="relative mx-4 mt-3 shrink-0 block">
        <span className="sr-only">Search the shop</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 stroke-current ${mutedClass}`}
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the shop"
          className={`w-full rounded-md border py-2 pl-8 pr-3 text-[13px] outline-none ${inputClass}`}
        />
      </label>
      {!query && <ShopCategoryTabs value={category} counts={COUNTS} onChange={setCategory} />}
      <div
        className={`flex-1 min-h-0 overflow-y-auto mx-4 px-3.5 pb-4 border light:border-amber-200 dark:border-zinc-800 ${
          query ? 'mt-2.5 rounded-t-md' : 'border-t-0'
        } ${bar ? '' : 'mb-4 rounded-b-md'}`}
      >
        {!query && featured && featured.type === category && !ownedCosmetics.has(featured.id) && (
          <button
            type="button"
            onClick={() => sel.pickCosmetic(featured, true)}
            className="mt-3 w-full rounded-md border border-amber-400/60 px-3 py-2 text-left text-xs light:bg-amber-50 dark:bg-amber-500/5"
          >
            <span className="font-semibold text-orange-500">Featured this week: </span>
            <span className={`font-semibold ${textClass}`}>{featured.name}</span>
            <span className={mutedClass}> is 25% off, {formatCurrency(featuredPrice(featured.price))}.</span>
          </button>
        )}
        {query ? (
          <ShopSearchResults
            results={results}
            selectedIds={sel.selectedIds}
            selectedPinId={sel.pin?.id || null}
            owned={allOwned}
            salePriceOf={sel.salePriceOf}
            style={sel.style}
            onStyle={sel.updateStyle}
            onPick={sel.pick}
          />
        ) : category === 'perk' ? (
          <ShopPerks budget={budget} onRequestPurchase={onRequestPurchase} />
        ) : category === 'pin' ? (
          <div className="pt-4">
            <ShopPinGrid pins={shopPins()} selectedId={sel.pin?.id || null} owned={ownedPins} onPick={sel.pickPin} />
          </div>
        ) : category === 'holdingMark' || category === 'profileBg' ? (
          <ProfileShopShelf type={category} {...shelfProps} />
        ) : shopItems(category).length ? (
          <ShopShelves type={category} {...shelfProps} />
        ) : null}
      </div>
      {bar && (
        <ShopBuyBar
          name={bar.name}
          price={bar.price}
          listPrice={'listPrice' in bar ? bar.listPrice : undefined}
          action={bar.action}
          canAfford={budget >= bar.price}
          onAction={bar.run}
          onGift={'gift' in bar && bar.gift ? bar.gift : undefined}
        />
      )}
    </div>
  );
};

export default ShopTab;
