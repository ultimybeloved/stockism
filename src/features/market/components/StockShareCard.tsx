import { forwardRef } from 'react';
import type { Character } from '../../../characters';
import type { Crew } from '../../../crews';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { useSession, useTheme } from '../../../context/AppContext';
import PixelIcon from '../../../shared/components/PixelIcon';
import CrewPin from '../../../shared/components/CrewPin';
import { pickSlipTheme } from '../../missions/utils/recapSlipThemes';
import { isRecruitRef } from '../../../rules/recruiting';
import { sharePath } from '../utils/sharePrices';

// The picture is one landscape card, the same size on every screen.
export const SHARE_CARD_WIDTH = 560;
export const SHARE_CARD_HEIGHT = 350;
const CHART_W = SHARE_CARD_WIDTH;
const CHART_H = 150;

export interface StockShareCardProps {
  ticker: string;
  character: Character;
  crews: Crew[];
  currentPrice: number;
  /** The chart line, oldest first (utils/sharePrices). */
  prices: number[];
  /** Percent change over the range, and the range's name ("7 Days"). */
  change: number;
  rangeLabel: string;
}

// A stock as a picture to post: ticker, name, price, the change over the chosen
// range and its chart line. Text and lines only, never character art. It shares
// the Weekly Slip's looks (one per ticker, in the viewer's light or dark theme),
// and carries the player's invite address so a post can bring in recruits.
const StockShareCard = forwardRef<HTMLDivElement, StockShareCardProps>(function StockShareCard(
  { ticker, character, crews, currentPrice, prices, change, rangeLabel },
  ref,
) {
  const { userData } = useSession();
  const { darkMode } = useTheme();
  const t = pickSlipTheme(ticker, darkMode);
  const cb = !!userData?.colorBlindMode;
  const tone = change >= 0 ? (cb ? t.upCb : t.up) : cb ? t.downCb : t.down;
  const name = userData?.displayName;
  const line = sharePath(prices, CHART_W, CHART_H);
  const gradientId = `share-fill-${ticker}`;
  const today = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div
      ref={ref}
      className="relative rounded-md flex flex-col overflow-hidden"
      style={{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT, background: t.bg, color: t.ink }}
    >
      <div className="h-2 shrink-0" style={{ background: t.band }} />
      <div className="px-6 pt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-3xl font-black leading-none" style={{ color: t.accent }}>
              ${ticker}
            </span>
            {character.isETF && (
              <span
                className="text-[11px] font-bold px-1.5 py-0.5 rounded-sm"
                style={{ border: `1px solid ${t.line}` }}
              >
                ETF
              </span>
            )}
          </div>
          <div className="mt-1.5 text-base font-semibold truncate">{character.name}</div>
          {crews.length > 0 && (
            <div className="mt-0.5 text-xs flex items-center gap-1 truncate" style={{ color: t.muted }}>
              <CrewPin crew={crews[0]!} className="w-3.5 h-3.5" />
              {crews.map((c) => c.name).join(', ')}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div
            className="text-4xl font-black tabular-nums tracking-tight leading-none"
            style={{
              backgroundImage: t.figure,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {formatCurrency(currentPrice)}
          </div>
          <div className="mt-1.5 text-base font-bold tabular-nums" style={{ color: tone }}>
            {change >= 0 ? '▲' : '▼'} {formatChange(change)}
          </div>
          <div className="text-xs" style={{ color: t.muted }}>
            {rangeLabel}
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width={CHART_W}
        height={CHART_H}
        className="mt-auto block"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={tone} stopOpacity="0.32" />
            <stop offset="1" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z`} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={tone} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>

      <div
        className="px-6 py-2.5 flex items-center justify-between gap-3 text-xs"
        style={{ color: t.muted, borderTop: `1px solid ${t.line}` }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <PixelIcon name="stockism" className="w-4 h-4 shrink-0" />
          <span className="font-semibold truncate" style={{ color: t.ink }}>
            stockism.app{isRecruitRef(name) ? `/?ref=${name}` : ''}
          </span>
        </div>
        <div className="shrink-0">{today}</div>
      </div>
    </div>
  );
});

export default StockShareCard;
