import { useMemo, useState } from 'react';
import { themeClasses } from '../../../../utils/theme';
import { pressable } from '../../../../utils/a11y';
import { useSession } from '../../../../context/AppContext';
import { shopItems, shortPrice } from '../../utils/shopCatalog';
import { markCardProps, type HoldingMark, type Position } from '../../../../utils/holdingMarks';
import { HoldingLabel, HoldingMarkLayer } from '../../../../shared/components/cosmetics/HoldingMark';
import ProfileBackground from '../../../../shared/components/cosmetics/ProfileBackground';
import type { Cosmetic } from '../../../../constants/cosmetics';
import { DEFAULT_TICKER_COLORS } from '../../../../constants/cosmeticsProfile';
import type { CosmeticStyle } from '../../../../rules/cosmetics';

// The Holdings and Backgrounds tabs of the shop: one card per item with a
// live preview (a stock card wearing the mark, or a small desktop window with
// the background), cheapest first. Color marks carry a color wheel, Ticker
// Wall its two gradient colors, and the Color Wash pairs share one card.

interface Props {
  type: 'holdingMark' | 'profileBg';
  selectedIds: Set<string>;
  owned: Set<string>;
  featuredId: string | null;
  salePriceOf: (c: Cosmetic) => number | undefined;
  style: CosmeticStyle;
  onStyle: (patch: CosmeticStyle) => void;
  onPick: (c: Cosmetic) => void;
}

const SAMPLE_POS: Position = { kind: 'long', shares: 12, cost: 380.4, gainPct: 8.4, heldDays: 9 };
const SPARK = 'M0,34 L20,30 L40,32 L60,24 L80,26 L100,18 L120,22 L140,14 L160,16 L180,10 L200,12 L220,6 L240,8 L260,4';

export const MarkPreview = ({ mark }: { mark: HoldingMark }) => {
  const { className, style } = markCardProps(mark, SAMPLE_POS);
  return (
    <div
      className={`relative rounded-sm border p-3 light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-800 ${className}`}
      style={style}
    >
      <HoldingMarkLayer mark={mark} pos={SAMPLE_POS} />
      <div className="relative z-[1]">
        <div className="flex justify-between items-baseline">
          <span className="text-orange-500 font-mono text-sm font-semibold">$GWON</span>
          <span className="font-semibold tabular-nums light:text-slate-900 dark:text-zinc-100">$412.60</span>
        </div>
        <svg viewBox="0 0 260 40" preserveAspectRatio="none" className="block w-full h-8 my-2" aria-hidden="true">
          <path d={SPARK} fill="none" stroke="#22c55e" strokeWidth="1.6" />
        </svg>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[10px] font-semibold uppercase text-green-500">Bullish</span>
          <HoldingLabel mark={mark} pos={SAMPLE_POS} />
        </div>
      </div>
    </div>
  );
};

export const BgPreview = ({ item, style, tickers }: { item: Cosmetic; style: CosmeticStyle; tickers: string[] }) => (
  <div className="relative aspect-[16/10] overflow-hidden rounded-sm border light:border-amber-200 dark:border-zinc-800 bg-zinc-950">
    <ProfileBackground id={item.id} seedKey="preview" style={style} data={{ tickers }} preview />
    <div className="absolute inset-y-0 left-1/2 w-[46%] -translate-x-1/2 border-x border-zinc-800 bg-zinc-950 px-[3%] pt-[6%]">
      <div className="h-[22%] rounded-sm border border-zinc-800 bg-gradient-to-br from-slate-800 to-zinc-900" />
      <div className="h-[6%] w-1/2 my-[6%] rounded-sm bg-zinc-700" />
      <div className="grid grid-cols-4 gap-[4%] h-[12%]">
        {[0, 1, 2, 3].map((k) => (
          <i key={k} className="block rounded-sm border border-zinc-800 bg-zinc-900" />
        ))}
      </div>
      <div className="h-[30%] mt-[6%] rounded-sm border border-zinc-800 bg-zinc-900" />
    </div>
  </div>
);

export const ColorPick = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) => (
  <label className="inline-flex items-center gap-1.5 text-[11.5px] light:text-slate-600 dark:text-zinc-400">
    {label}
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value.toLowerCase())}
      onClick={(e) => e.stopPropagation()}
      className="h-6 w-8 cursor-pointer rounded-sm border light:border-amber-200 dark:border-zinc-700 bg-transparent p-0"
    />
  </label>
);

/** Puts a picked color back to the item's own default. */
export const ResetColor = ({ onReset }: { onReset: () => void }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onReset();
    }}
    className="text-[11.5px] text-orange-500 hover:underline"
  >
    Reset to default
  </button>
);

/** Backgrounds are hidden below the lg breakpoint; say so plainly before anyone buys one. */
export const PhoneWarning = ({ className = '' }: { className?: string }) => (
  <p
    role="note"
    className={`rounded-sm border px-3 py-2 text-xs font-medium light:border-amber-300 light:bg-amber-50 light:text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 ${className}`}
  >
    <b>Desktop only.</b> Backgrounds do not show on phones. Anyone viewing your profile on a phone, you included, sees
    it without the background.
  </p>
);

/** The card title for a group of colors (the Color Wash pairs). */
const groupName = (c: Cosmetic) => (c.variantOf === 'bg_wash' ? 'Color Wash' : c.name);

const ProfileShopShelf = (p: Props) => {
  const { textClass, mutedClass } = themeClasses;
  const { userData } = useSession();
  const items = useMemo(() => [...shopItems(p.type)].sort((a, b) => a.price - b.price), [p.type]);
  // One card per item; the Color Wash pairs share one, showing the pair last picked.
  const [variant, setVariant] = useState<Record<string, string>>({});
  const cards = items.filter((c, i) => !c.variantOf || items.findIndex((x) => x.variantOf === c.variantOf) === i);
  const tickers = useMemo(() => {
    const h = userData?.holdings || {};
    const top = Object.keys(h)
      .filter((t) => (h[t] || 0) > 0)
      .sort((a, b) => (h[b] || 0) - (h[a] || 0))
      .slice(0, 3);
    return top.length ? top : ['GWON', 'HANT', 'TCHI'];
  }, [userData?.holdings]);

  const tickerColors = (p.style.tickerColors || DEFAULT_TICKER_COLORS).split(',') as [string, string];

  return (
    <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 pt-4">
      {p.type === 'profileBg' && <PhoneWarning className="sm:col-span-2" />}
      {p.type === 'holdingMark' && (
        <p className={`sm:col-span-2 text-xs ${mutedClass}`}>
          How the stocks you own or short look in the market. Only you see it.
        </p>
      )}
      {cards.map((card) => {
        const group = card.variantOf ? items.filter((x) => x.variantOf === card.variantOf) : [card];
        const c =
          group.find((x) => x.id === variant[card.variantOf || '']) ||
          group.find((x) => p.selectedIds.has(x.id)) ||
          card;
        const owned = p.owned.has(c.id);
        const sale = p.salePriceOf(c);
        // Unpicked, a color mark wears its own color (Ember orange, the rest blue).
        const markColor = (p.style.markColor || c.color).toLowerCase();
        const mark: HoldingMark = { cosmetic: c, color: c.pickColor ? markColor : c.color };
        return (
          <div
            key={card.variantOf || card.id}
            {...pressable(() => p.onPick(c))}
            aria-pressed={p.selectedIds.has(c.id)}
            className={`block min-w-0 cursor-pointer rounded-md border p-2 transition-colors ${
              p.selectedIds.has(c.id)
                ? 'border-orange-500 ring-1 ring-orange-500'
                : 'light:border-amber-200 dark:border-zinc-800 light:hover:border-amber-400 dark:hover:border-zinc-600'
            } light:bg-white dark:bg-zinc-900/40`}
          >
            {p.type === 'holdingMark' ? (
              <MarkPreview mark={mark} />
            ) : (
              <BgPreview item={c} style={p.style} tickers={tickers} />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
              <b className={`whitespace-nowrap ${textClass}`}>{card.variantOf ? groupName(card) : c.name}</b>
              {sale != null && !owned && <span className="text-[11px] font-semibold text-orange-500">25% off</span>}
              <span className="ml-auto whitespace-nowrap text-[13px] font-bold">
                {c.free ? (
                  <span className="text-orange-500">Free</span>
                ) : owned ? (
                  <span className="text-xs text-orange-500">Owned</span>
                ) : (
                  <span className="text-amber-500">{shortPrice(sale ?? c.price)}</span>
                )}
              </span>
              <span className={`basis-full text-[11.5px] leading-snug ${mutedClass}`}>{c.description}</span>
              {c.pickColor && (
                <span className="flex items-center gap-3">
                  <ColorPick
                    label="Color"
                    value={markColor}
                    onChange={(markColor) => {
                      p.onStyle({ markColor });
                      if (!p.selectedIds.has(c.id)) p.onPick(c);
                    }}
                  />
                  {p.style.markColor && (
                    <ResetColor
                      onReset={() => {
                        p.onStyle({ markColor: undefined });
                        if (!p.selectedIds.has(c.id)) p.onPick(c);
                      }}
                    />
                  )}
                </span>
              )}
              {c.id === 'bg_tickers' && (
                <span className="flex items-center gap-3">
                  {(['Top', 'Bottom'] as const).map((label, k) => (
                    <ColorPick
                      key={label}
                      label={label}
                      value={tickerColors[k]!}
                      onChange={(hex) => {
                        const next = [...tickerColors];
                        next[k] = hex;
                        p.onStyle({ tickerColors: next.join(',') });
                        if (!p.selectedIds.has(c.id)) p.onPick(c);
                      }}
                    />
                  ))}
                  {p.style.tickerColors !== DEFAULT_TICKER_COLORS && (
                    <ResetColor
                      onReset={() => {
                        p.onStyle({ tickerColors: DEFAULT_TICKER_COLORS });
                        if (!p.selectedIds.has(c.id)) p.onPick(c);
                      }}
                    />
                  )}
                </span>
              )}
              {group.length > 1 && (
                <span className="flex gap-1.5" role="group" aria-label={`${groupName(card)} colors`}>
                  {group.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-label={v.name}
                      aria-pressed={v.id === c.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setVariant((prev) => ({ ...prev, [card.variantOf!]: v.id }));
                        p.onPick(v);
                      }}
                      className={`h-5 w-8 rounded-full border-2 ${v.id === c.id ? 'border-orange-500' : 'border-transparent'}`}
                      style={{ background: `linear-gradient(90deg, ${v.colors?.[0]}, ${v.colors?.[1]})` }}
                    />
                  ))}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ProfileShopShelf;
