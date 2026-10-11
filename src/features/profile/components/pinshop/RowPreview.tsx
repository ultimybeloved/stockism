import { useState, type MouseEvent, type PointerEvent } from 'react';
import { getCosmeticStyles } from '../../../../utils/cosmetics';
import { frameTrend, BULLBEAR_FRAME_ID } from '../../../../rules/cosmetics';
import { themeClasses } from '../../../../utils/theme';
import { formatCurrency } from '../../../../utils/formatters';
import { useTheme, useSession } from '../../../../context/AppContext';
import { CREW_MAP } from '../../../../crews';
import PinDisplay from '../../../../shared/components/PinDisplay';
import type { Cosmetic } from '../../../../constants/cosmetics';

// Live preview of the user's leaderboard row. Uses the exact cosmetic layering
// LeaderboardPage rows use (glow/backdrop inline styles + rowClass for animated
// effects + name color/class + PinDisplay), so what shows here is what every
// other player sees. Reads straight from userData, so it updates the moment
// anything is equipped or purchased.
const RowPreview = ({ portfolioValue, tryOn }: { portfolioValue: number; tryOn?: Cosmetic | null }) => {
  const { darkMode } = useTheme();
  const { userData, holdings } = useSession();
  const { textClass, mutedClass } = themeClasses;
  // `tryOn` is a shop item being browsed: layer it over the equipped set so the
  // row previews it before purchase. The owned filter is skipped for try-ons
  // (they aren't owned yet — that's the point); display-only, nothing persists.
  const actives = tryOn ? { ...(userData?.activeCosmetics || {}), [tryOn.type]: tryOn.id } : userData?.activeCosmetics;
  // Trying on Bull / Bear shows both days at once (bull left, bear right).
  // Pointing at a side, or tapping it on a phone, shows that day in full.
  const [side, setSide] = useState<'up' | 'down' | null>(null);
  const tryingBullBear = tryOn?.id === BULLBEAR_FRAME_ID;
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
  const trend = tryingBullBear ? side || 'split' : frameTrend(userData?.portfolioValue, userData?.portfolioSnapshot24h);
  const styles = getCosmeticStyles(actives, tryOn ? null : userData?.ownedCosmetics, {
    seedKey: userData?.displayName,
    trend,
  });
  const { nameColor, nameClass, glowColor, backdropColor, rowClass, frameStyle } = styles;
  const holdingsCount = Object.values(holdings || {}).filter((s) => s > 0).length;
  // Crew heads see their crew-colored crown aura here too, unless a glow
  // cosmetic is equipped (or being tried on) — purchased glows always win.
  const crew = userData?.crew ? CREW_MAP[userData.crew] : null;
  const crownGlow = userData?.isCrewHead && crew && !actives?.rowGlow;

  return (
    <div className="px-4 pt-3">
      <p className={`text-[10px] uppercase tracking-wide font-semibold ${mutedClass} mb-1`}>
        {tryOn ? (
          <>
            Previewing: <span className="text-orange-500">{tryOn.name}</span>
          </>
        ) : (
          'Your row on the leaderboard'
        )}
      </p>
      <div
        className={`relative p-3 flex items-center gap-3 rounded-sm border light:border-amber-200 light:bg-amber-50 dark:border-zinc-800 dark:bg-zinc-900/50 ${rowClass} ${crownGlow ? 'cos-glow-pulse-crew' : ''}`}
        data-trend={styles.frameTrend}
        {...(tryingBullBear && { onPointerMove, onPointerLeave: () => setSide(null), onClick })}
        style={{
          ...frameStyle,
          ...(glowColor ? { boxShadow: `0 0 18px ${glowColor}50` } : {}),
          ...(backdropColor ? { backgroundColor: darkMode ? `${backdropColor}18` : `${backdropColor}12` } : {}),
          ...(crownGlow ? { '--cgp': crew.color } : {}),
        }}
      >
        <div className={`w-10 text-center font-bold ${mutedClass}`}>#?</div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold truncate ${textClass} flex items-center gap-1`}>
            <span className={nameClass} style={nameClass ? undefined : { color: nameColor }}>
              {userData?.displayName || 'You'}
            </span>
            <PinDisplay userData={userData} size="sm" />
          </div>
          <div className={`text-xs ${mutedClass}`}>{holdingsCount} characters</div>
        </div>
        <div className={`text-right font-bold ${textClass}`}>{formatCurrency(portfolioValue || 0)}</div>
      </div>
      {tryingBullBear && (
        <p className={`text-[10px] ${mutedClass} mt-1`}>
          Green on days you&apos;re up, red on days you&apos;re down. Point at or tap a side to see each.
        </p>
      )}
    </div>
  );
};

export default RowPreview;
