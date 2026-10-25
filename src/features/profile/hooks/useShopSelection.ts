import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../../context/AppContext';
import { SPLIT_FLAP_ID } from '../../../constants/cosmeticLayers';
import { BULLBEAR_FRAME_ID, type CosmeticStyle, type CosmeticStyleKey } from '../../../rules/cosmetics';
import { featuredPrice } from '../../../rules/shop';
import { glowTwin, isPulsingGlow, type ShopEntry } from '../utils/shopCatalog';
import type { Cosmetic, CosmeticType } from '../../../constants/cosmetics';
import { DEFAULT_TICKER_COLORS } from '../../../constants/cosmeticsProfile';
import type { ShopPin } from '../../../crews';

// No markColor: an unpicked color mark wears its own color (Ember orange, the rest blue).
const DEFAULT_STYLE: CosmeticStyle = {
  flap: 'random',
  bullbear: 'daily',
  tint: 'fade',
  tickerColors: DEFAULT_TICKER_COLORS,
};

/** Which style choice an item comes with, if any. */
export const styleKeyOf = (c: Cosmetic): CosmeticStyleKey | null =>
  c.pickColor
    ? 'markColor'
    : c.id === 'bg_tickers'
      ? 'tickerColors'
      : c.id === SPLIT_FLAP_ID
        ? 'flap'
        : c.id === BULLBEAR_FRAME_ID
          ? 'bullbear'
          : c.type === 'rowBackdrop' && !c.effectClass
            ? 'tint'
            : null;

interface ShopSelectionDeps {
  featuredId: string | null;
  onTryOn: (items: Cosmetic[] | null) => void;
  onTryPin: (pin: ShopPin | null) => void;
  onPreviewStyle: (style: CosmeticStyle) => void;
}

// The shop's browsing state: what's being tried on (one item per slot, plus a
// pin), which item the buy bar is about, and the style choices being
// previewed. Tapping an item tries it on and puts it in the buy bar; tapping
// it again takes it off. Everything clears when the shop closes.
export function useShopSelection({ featuredId, onTryOn, onTryPin, onPreviewStyle }: ShopSelectionDeps) {
  const { userData } = useSession();
  const [tried, setTried] = useState<Partial<Record<CosmeticType, Cosmetic>>>({});
  const [pin, setPin] = useState<ShopPin | null>(null);
  const [active, setActive] = useState<ShopEntry | null>(null);
  const [style, setStyle] = useState<CosmeticStyle>(() => ({ ...DEFAULT_STYLE, ...(userData?.cosmeticStyle || {}) }));
  const [pulsing, setPulsing] = useState(() => isPulsingGlow(userData?.activeCosmetics?.rowGlow || ''));

  useEffect(() => {
    const items = Object.values(tried).filter((c): c is Cosmetic => !!c);
    onTryOn(items.length ? items : null);
  }, [tried, onTryOn]);
  useEffect(() => onTryPin(pin), [pin, onTryPin]);
  useEffect(() => onPreviewStyle(style), [style, onPreviewStyle]);

  const pickCosmetic = (c: Cosmetic, keep = false) => {
    const off = !keep && tried[c.type]?.id === c.id;
    setTried((prev) => ({ ...prev, [c.type]: off ? undefined : c }));
    setActive(off ? null : { kind: 'cosmetic', item: c });
  };
  const pickPin = (p: ShopPin) => {
    const off = pin?.id === p.id;
    setPin(off ? null : p);
    setActive(off ? null : { kind: 'pin', item: p });
  };
  const pick = (entry: ShopEntry) => (entry.kind === 'pin' ? pickPin(entry.item) : pickCosmetic(entry.item));

  // Classic effects: flipping Steady / Pulsing re-targets a picked classic glow.
  const switchPulsing = (on: boolean) => {
    setPulsing(on);
    const glow = tried.rowGlow;
    const twin = glow && isPulsingGlow(glow.id) !== on ? glowTwin(glow.id) : undefined;
    if (twin) pickCosmetic(twin, true);
  };

  const selectedIds = useMemo(() => new Set(Object.values(tried).flatMap((c) => (c ? [c.id] : []))), [tried]);
  const salePriceOf = (c: Cosmetic) => (c.id === featuredId ? featuredPrice(c.price) : undefined);

  return {
    active,
    pin,
    style,
    pulsing,
    selectedIds,
    salePriceOf,
    pick,
    pickCosmetic,
    pickPin,
    switchPulsing,
    updateStyle: (patch: CosmeticStyle) => setStyle((prev) => ({ ...prev, ...patch })),
    /** The style the player has saved for a key (or the default). */
    savedStyle: <K extends CosmeticStyleKey>(key: K) => userData?.cosmeticStyle?.[key] || DEFAULT_STYLE[key],
    previewStyleFor: <K extends CosmeticStyleKey>(key: K) => style[key] || DEFAULT_STYLE[key],
  };
}
