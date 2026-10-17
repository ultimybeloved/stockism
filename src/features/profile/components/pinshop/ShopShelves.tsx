import type { ReactNode } from 'react';
import { themeClasses } from '../../../../utils/theme';
import { classicsNote, pulsingTwin, shelfOf, shopItems } from '../../utils/shopCatalog';
import ShopItemCard from './ShopItemCard';
import StyleSwitch from './StyleSwitch';
import type { Cosmetic, CosmeticType } from '../../../../constants/cosmetics';
import type { CosmeticStyle } from '../../../../rules/cosmetics';

const GLOW_OPTIONS = [
  ['steady', 'Steady'],
  ['pulse', 'Pulsing'],
] as const;
const TINT_OPTIONS = [
  ['fade', 'Fade'],
  ['solid', 'Solid'],
] as const;

export interface ShelfProps {
  type: CosmeticType;
  /** Ids being tried on, to mark them selected. */
  selectedIds: Set<string>;
  owned: Set<string>;
  featuredId: string | null;
  salePriceOf: (c: Cosmetic) => number | undefined;
  style: CosmeticStyle;
  onStyle: (patch: CosmeticStyle) => void;
  /** Classic effects: show the pulsing twin of each color. */
  pulsing: boolean;
  onPulsing: (on: boolean) => void;
  onPick: (c: Cosmetic) => void;
}

const ShelfHead = ({
  title,
  note,
  gold,
  children,
}: {
  title: string;
  note: string;
  gold?: boolean;
  children?: ReactNode;
}) => {
  const { mutedClass, textClass } = themeClasses;
  return (
    <div
      className={`flex items-center gap-2.5 mb-2.5 ${gold ? 'pb-1.5 border-b light:border-amber-300/70 dark:border-amber-700/30' : ''}`}
    >
      <span
        className={`text-sm font-extrabold tracking-wide ${
          gold
            ? 'bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500 bg-clip-text text-transparent light:from-amber-600 light:via-amber-500 light:to-amber-700'
            : textClass
        }`}
      >
        {title}
      </span>
      <span className={`text-xs ${mutedClass}`}>{note}</span>
      {children && <span className="ml-auto">{children}</span>}
    </div>
  );
};

// One category of the shop on three shelves: Showcase ($100k and up, big live
// cards), Premium ($30k to $99k, smaller live cards) and Classics (the color
// dots). Classic effects pair each steady glow with its pulsing twin under one
// dot; plain backdrops preview as Fade or Solid (one purchase gets both).
const ShopShelves = (p: ShelfProps) => {
  const items = shopItems(p.type);
  const showcase = items.filter((c) => shelfOf(c.price) === 'showcase');
  const premium = items.filter((c) => shelfOf(c.price) === 'premium');
  const classics = items.filter((c) => shelfOf(c.price) === 'classics');
  const card = (c: Cosmetic, big: boolean) => (
    <ShopItemCard
      key={c.id}
      cosmetic={c}
      big={big}
      selected={p.selectedIds.has(c.id)}
      owned={p.owned.has(c.id)}
      salePrice={p.salePriceOf(c)}
      style={p.style}
      onStyle={p.onStyle}
      onPick={() => p.onPick(c)}
    />
  );

  return (
    <div className="space-y-5 pt-4">
      {showcase.length > 0 && (
        <section>
          <ShelfHead title="Showcase" note="$100k and up." gold />
          <div className="grid gap-2.5">{showcase.map((c) => card(c, true))}</div>
        </section>
      )}
      {premium.length > 0 && (
        <section>
          <ShelfHead title="Premium" note="$30k to $99k." />
          <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2">{premium.map((c) => card(c, false))}</div>
        </section>
      )}
      {classics.length > 0 && (
        <section>
          <ShelfHead title="Classics" note={classicsNote(classics, p.type)}>
            {p.type === 'rowGlow' && (
              <StyleSwitch
                label="Glow style"
                options={GLOW_OPTIONS}
                value={p.pulsing ? 'pulse' : 'steady'}
                onChange={(v) => p.onPulsing(v === 'pulse')}
              />
            )}
            {p.type === 'rowBackdrop' && (
              <StyleSwitch
                label="Backdrop style"
                options={TINT_OPTIONS}
                value={p.style.tint || 'fade'}
                onChange={(tint) => p.onStyle({ tint })}
              />
            )}
          </ShelfHead>
          <div className="flex flex-wrap gap-2">
            {classics.map((c) => {
              const item = p.type === 'rowGlow' && p.pulsing ? pulsingTwin(c.id) || c : c;
              return (
                <ClassicDot
                  key={c.id}
                  item={item}
                  ring={p.type === 'rowFrame'}
                  pulse={p.type === 'rowGlow' && p.pulsing}
                  fade={p.type === 'rowBackdrop' && p.style.tint !== 'solid'}
                  selected={p.selectedIds.has(item.id)}
                  owned={p.owned.has(item.id)}
                  featured={item.id === p.featuredId}
                  onPick={() => p.onPick(item)}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

interface ClassicDotProps {
  item: Cosmetic;
  ring: boolean;
  pulse: boolean;
  fade: boolean;
  selected: boolean;
  owned: boolean;
  featured: boolean;
  onPick: () => void;
}

const ClassicDot = ({ item, ring, pulse, fade, selected, owned, featured, onPick }: ClassicDotProps) => (
  <button
    type="button"
    onClick={onPick}
    title={item.name}
    aria-label={item.name}
    aria-pressed={selected}
    className={`relative w-9 h-9 rounded-full border-2 p-0.5 ${selected ? 'border-orange-500' : 'border-transparent'}`}
  >
    <span
      className={`block w-full h-full rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={
        ring
          ? { boxShadow: `inset 0 0 0 5px ${item.color}` }
          : fade
            ? { background: `linear-gradient(90deg, ${item.color} 20%, transparent)` }
            : { backgroundColor: item.color, ...(pulse ? { boxShadow: `0 0 10px 1px ${item.color}` } : {}) }
      }
    />
    {owned ? (
      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-orange-600 text-white text-[9px] flex items-center justify-center font-bold">
        ✓
      </span>
    ) : (
      featured && (
        <span
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 text-zinc-900 text-[9px] flex items-center justify-center font-bold"
          title="Featured this week, 25% off"
        >
          %
        </span>
      )
    )}
  </button>
);

export default ShopShelves;
