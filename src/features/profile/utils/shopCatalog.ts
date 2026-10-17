import { COSMETICS, COSMETIC_MAP, type Cosmetic, type CosmeticType } from '../../../constants/cosmetics';
import { getActiveShopPins, type ShopPin } from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';

// The shop's layout rules: categories, the three price shelves, the paired
// classic items, and search. Pure, so the shop components stay about looks.

export type ShopCategory = CosmeticType | 'pin' | 'perk';

export const SHOP_CATEGORIES: [ShopCategory, string][] = [
  ['nameColor', 'Names'],
  ['rowGlow', 'Effects'],
  ['rowBackdrop', 'Backdrops'],
  ['rowFrame', 'Frames'],
  ['pin', 'Pins'],
  ['perk', 'Perks'],
];

export const KIND_LABEL: Record<CosmeticType | 'pin', string> = {
  nameColor: 'Name',
  rowGlow: 'Effect',
  rowBackdrop: 'Backdrop',
  rowFrame: 'Frame',
  pin: 'Pin',
};

/** Showcase: big live cards. Premium: smaller live cards. Classics: dots. */
export const SHOWCASE_MIN_PRICE = 100000;
export const PREMIUM_MIN_PRICE = 30000;

export type ShelfKey = 'showcase' | 'premium' | 'classics';

export const shelfOf = (price: number): ShelfKey =>
  price >= SHOWCASE_MIN_PRICE ? 'showcase' : price >= PREMIUM_MIN_PRICE ? 'premium' : 'classics';

// Every standard glow has a pulsing twin. The Classics shelf shows one dot per
// color and a Steady / Pulsing switch picks which of the pair it means.
const PULSE_PREFIX = 'glow_pulse_';
export const isPulsingGlow = (id: string) => id.startsWith(PULSE_PREFIX);
export const pulsingTwin = (id: string) => COSMETIC_MAP[id.replace('glow_', PULSE_PREFIX)];
/** The other half of a classic glow pair (steady to pulsing and back), if it has one. */
export const glowTwin = (id: string) =>
  isPulsingGlow(id) ? COSMETIC_MAP[id.replace(PULSE_PREFIX, 'glow_')] : pulsingTwin(id);

/** What the shop sells in a category, most expensive first (pulsing glows ride with their twin). */
export const shopItems = (type: CosmeticType): Cosmetic[] =>
  COSMETICS.filter((c) => !c.earned && c.type === type && !isPulsingGlow(c.id)).sort((a, b) => b.price - a.price);

export const shortPrice = (n: number): string => (n >= 1000 ? `$${n / 1000}k` : formatCurrency(n));

/** The Classics shelf note, read off the shelf's real prices. */
export const classicsNote = (items: Cosmetic[], type: CosmeticType): string => {
  const prices = items.flatMap((c) => [c.price, ...(type === 'rowGlow' ? [pulsingTwin(c.id)?.price ?? c.price] : [])]);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const base = low === high ? `${shortPrice(high)} each.` : `Up to ${shortPrice(high)}.`;
  return type === 'rowBackdrop' ? `${base} Comes with both Fade and Solid.` : base;
};

/** Pins on sale, most expensive first. */
export const shopPins = (): ShopPin[] =>
  getActiveShopPins()
    .flatMap((c) => c.pins)
    .sort((a, b) => b.price - a.price);

export type ShopEntry = { kind: 'cosmetic'; item: Cosmetic } | { kind: 'pin'; item: ShopPin };

/** Everything for sale whose name or kind matches, most expensive first. */
export const searchShop = (query: string): ShopEntry[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hit = (name: string, kind: string) => `${name} ${kind}`.toLowerCase().includes(q);
  const entries: ShopEntry[] = [
    ...COSMETICS.filter((c) => !c.earned && hit(c.name, KIND_LABEL[c.type])).map((item): ShopEntry => ({
      kind: 'cosmetic',
      item,
    })),
    ...shopPins()
      .filter((p) => hit(p.name, KIND_LABEL.pin))
      .map((item): ShopEntry => ({ kind: 'pin', item })),
  ];
  return entries.sort((a, b) => b.item.price - a.item.price);
};
