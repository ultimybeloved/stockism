import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { getCosmeticStyles } from '../../../../utils/cosmetics';
import { frameTrend, BULLBEAR_FRAME_ID, type CosmeticStyle } from '../../../../rules/cosmetics';
import { themeClasses } from '../../../../utils/theme';
import { formatCurrency } from '../../../../utils/formatters';
import { useSession } from '../../../../context/AppContext';
import { CREW_MAP, type ShopPin } from '../../../../crews';
import { pixelatedIfSvg } from '../../../../constants/crests';
import PinDisplay from '../../../../shared/components/PinDisplay';
import CosmeticLayers from '../../../../shared/components/cosmetics/CosmeticLayers';
import CosmeticName from '../../../../shared/components/cosmetics/CosmeticName';
import { useInstantPreview } from '../../hooks/useInstantPreview';
import type { Cosmetic } from '../../../../constants/cosmetics';

interface RowPreviewProps {
  portfolioValue: number;
  /** Shop items being tried on, one per slot; layered over what's equipped. */
  tryOn?: Cosmetic[] | null;
  /** A shop pin being tried on, shown after the worn pins. */
  tryPin?: ShopPin | null;
  /** Style choices being previewed (Split Flap motion, Bull / Bear, backdrop tint). */
  previewStyle?: CosmeticStyle | null;
}

// Live preview of the user's leaderboard row. Uses the same cosmetic pieces
// the leaderboard rows use (getCosmeticStyles, CosmeticLayers, CosmeticName,
// PinDisplay), so what shows here is what every other player sees. Reads
// straight from userData, so it updates the moment anything is equipped or
// purchased. Anything newly tried on plays right away (useInstantPreview).
const RowPreview = ({ portfolioValue, tryOn, tryPin, previewStyle }: RowPreviewProps) => {
  const { userData, holdings } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const rowRef = useRef<HTMLDivElement>(null);
  // `tryOn` is a shop item being browsed: layer it over the equipped set so the
  // row previews it before purchase. The owned filter is skipped for try-ons
  // (they aren't owned yet — that's the point); display-only, nothing persists.
  // A bundle try-on layers every piece at once.
  const actives = tryOn?.length
    ? { ...(userData?.activeCosmetics || {}), ...Object.fromEntries(tryOn.map((c) => [c.type, c.id])) }
    : userData?.activeCosmetics;
  const style = { ...(userData?.cosmeticStyle || {}), ...(previewStyle || {}) };
  // Trying on Bull / Bear shows both days at once (bull left, bear right).
  // Pointing at a side, or tapping it on a phone, shows that day in full.
  // The Split style always shows both, so pointing does nothing there.
  const [side, setSide] = useState<'up' | 'down' | null>(null);
  const tryingBullBear = !!tryOn?.some((c) => c.id === BULLBEAR_FRAME_ID);
  const fixedSplit = tryingBullBear && style.bullbear === 'split';
  const sideAt = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientX - box.left < box.width / 2 ? 'up' : 'down';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') setSide(sideAt(e));
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const next = sideAt(e);
    setSide((cur) => (cur === next ? null : next));
  };
  const trend = tryingBullBear
    ? (!fixedSplit && side) || 'split'
    : frameTrend(userData?.portfolioValue, userData?.portfolioSnapshot24h);
  const cosmetics = getCosmeticStyles(actives, tryOn?.length ? null : userData?.ownedCosmetics, {
    seedKey: userData?.displayName,
    trend,
    style,
  });
  const { glowColor, rowClass, rowStyle, layers } = cosmetics;
  const holdingsCount = Object.values(holdings || {}).filter((s) => s > 0).length;
  // Crew heads see their crew-colored crown aura here too, unless a glow
  // cosmetic is equipped (or being tried on) — purchased glows always win.
  const crew = userData?.crew ? CREW_MAP[userData.crew] : null;
  const crownGlow = userData?.isCrewHead && crew && !actives?.rowGlow;
  useInstantPreview(rowRef, `${(tryOn || []).map((c) => c.id).join()}|${style.flap}|${style.tint}`);

  return (
    <div className="px-4 pt-3">
      <p className={`text-[10px] uppercase tracking-wide font-semibold ${mutedClass} mb-1`}>
        {tryOn?.length || tryPin ? (
          <>
            Previewing:{' '}
            <span className="text-orange-500">
              {[...(tryOn || []), ...(tryPin ? [tryPin] : [])].map((c) => c.name).join(' + ')}
            </span>
          </>
        ) : (
          'Your row on the leaderboard'
        )}
      </p>
      <div
        ref={rowRef}
        className={`relative p-3 flex items-center gap-3 rounded-sm border light:border-amber-200 light:bg-amber-50 dark:border-zinc-800 dark:bg-zinc-900/50 ${rowClass} ${crownGlow ? 'cos-glow-pulse-crew' : ''}`}
        data-trend={cosmetics.frameTrend}
        {...(tryingBullBear && !fixedSplit && { onPointerMove, onPointerLeave: () => setSide(null), onClick })}
        style={{
          ...rowStyle,
          ...(glowColor ? { boxShadow: `0 0 18px ${glowColor}50` } : {}),
          ...(crownGlow ? { '--cgp': crew.color } : {}),
        }}
      >
        <CosmeticLayers {...layers} seedKey={userData?.displayName} />
        <div className={`w-10 text-center font-bold ${mutedClass}`}>#?</div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold truncate ${textClass} flex items-center gap-1`}>
            <CosmeticName name={userData?.displayName || 'You'} styles={cosmetics} />
            <PinDisplay userData={userData} size="sm" />
            {tryPin && (
              <img
                src={`/pins/${tryPin.image}`}
                alt={tryPin.name}
                className="w-5 h-5 object-contain"
                style={pixelatedIfSvg(tryPin.image)}
              />
            )}
          </div>
          <div className={`text-xs ${mutedClass}`}>{holdingsCount} characters</div>
        </div>
        <div className={`text-right font-bold ${textClass}`}>{formatCurrency(portfolioValue || 0)}</div>
      </div>
      {tryingBullBear && (
        <p className={`text-[10px] ${mutedClass} mt-1`}>
          {fixedSplit
            ? 'Split style: both halves show every day.'
            : "Green on days you're up, red on days you're down. Point at or tap a side to see each."}
        </p>
      )}
    </div>
  );
};

export default RowPreview;
