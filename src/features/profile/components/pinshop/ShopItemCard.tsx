import { useState, type PointerEvent } from 'react';
import { BULLBEAR_FRAME_ID, type CosmeticStyle, type FrameTrend } from '../../../../rules/cosmetics';
import { SPLIT_FLAP_ID } from '../../../../constants/cosmeticLayers';
import { themeClasses } from '../../../../utils/theme';
import { pressable } from '../../../../utils/a11y';
import { shortPrice } from '../../utils/shopCatalog';
import ShopMiniRow from './ShopMiniRow';
import StyleSwitch from './StyleSwitch';
import type { Cosmetic } from '../../../../constants/cosmetics';

const FLAP_OPTIONS = [
  ['random', 'Random'],
  ['scramble', 'Scramble'],
  ['board', 'Arrivals'],
] as const;
const BULLBEAR_OPTIONS = [
  ['daily', 'Daily'],
  ['split', 'Split'],
] as const;

interface ShopItemCardProps {
  cosmetic: Cosmetic;
  /** Showcase cards are full width with the flavor text beside the name. */
  big: boolean;
  /** Shows the item's kind next to its name (search results). */
  kind?: string;
  selected: boolean;
  owned: boolean;
  /** This week's price, when it's the featured item. */
  salePrice?: number;
  style: CosmeticStyle;
  onStyle: (patch: CosmeticStyle) => void;
  onPick: () => void;
}

// One showcase or premium shop item: a live mini row wearing it, the name,
// flavor text and price. Split Flap and Bull / Bear carry their style switch
// (picking a style also picks the item). Pointing at a side of the Bull / Bear
// card shows that day in full.
const ShopItemCard = ({
  cosmetic,
  big,
  kind,
  selected,
  owned,
  salePrice,
  style,
  onStyle,
  onPick,
}: ShopItemCardProps) => {
  const { textClass, mutedClass } = themeClasses;
  const [side, setSide] = useState<FrameTrend>(null);
  const isBullBear = cosmetic.id === BULLBEAR_FRAME_ID;
  const hoverSide = (e: PointerEvent<HTMLDivElement>) => {
    if (!isBullBear || style.bullbear === 'split' || e.pointerType !== 'mouse') return;
    const box = e.currentTarget.getBoundingClientRect();
    setSide(e.clientX - box.left < box.width / 2 ? 'up' : 'down');
  };
  const pickStyle = (patch: CosmeticStyle) => {
    onStyle(patch);
    if (!selected) onPick();
  };
  const sw =
    cosmetic.id === SPLIT_FLAP_ID ? (
      <StyleSwitch
        label="Flip style"
        options={FLAP_OPTIONS}
        value={style.flap || 'random'}
        onChange={(flap) => pickStyle({ flap })}
      />
    ) : isBullBear ? (
      <StyleSwitch
        label="Bull / Bear style"
        options={BULLBEAR_OPTIONS}
        value={style.bullbear || 'daily'}
        onChange={(bullbear) => pickStyle({ bullbear })}
      />
    ) : null;
  const price = owned ? (
    <span className="ml-auto text-xs font-bold text-orange-500">Owned</span>
  ) : (
    <span className={`ml-auto whitespace-nowrap font-bold text-amber-500 ${big ? 'text-[15px]' : 'text-[13px]'}`}>
      {salePrice != null && (
        <span className={`mr-1 text-[11px] font-semibold line-through ${mutedClass}`}>
          {shortPrice(cosmetic.price)}
        </span>
      )}
      {shortPrice(salePrice ?? cosmetic.price)}
    </span>
  );

  return (
    <div
      {...pressable(onPick)}
      aria-pressed={selected}
      onPointerMove={hoverSide}
      onPointerLeave={() => setSide(null)}
      className={`cos-mini block min-w-0 cursor-pointer rounded-md border transition-colors ${big ? 'p-2.5' : 'p-2'} ${
        selected
          ? 'border-orange-500 ring-1 ring-orange-500'
          : big
            ? 'light:border-amber-300 dark:border-amber-700/50 light:hover:border-amber-500 dark:hover:border-amber-500/70'
            : 'light:border-amber-200 dark:border-zinc-800 light:hover:border-amber-400 dark:hover:border-zinc-600'
      } light:bg-white dark:bg-zinc-900/40`}
    >
      <div className="pt-1">
        <ShopMiniRow
          cosmetic={cosmetic}
          compact={!big}
          style={style}
          trend={isBullBear ? side || 'split' : undefined}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
        <b className={`whitespace-nowrap ${textClass}`}>
          {cosmetic.name}
          {kind && <span className={`ml-1.5 text-[11px] font-medium ${mutedClass}`}>{kind}</span>}
        </b>
        {big && <span className={`hidden sm:block flex-1 min-w-0 text-xs ${mutedClass}`}>{cosmetic.description}</span>}
        {salePrice != null && !owned && <span className="text-[11px] font-semibold text-orange-500">25% off</span>}
        {sw}
        {price}
        {!big && !kind && cosmetic.description && (
          <span className={`basis-full order-last text-[11.5px] leading-snug ${mutedClass}`}>
            {cosmetic.description}
          </span>
        )}
      </div>
    </div>
  );
};

export default ShopItemCard;
