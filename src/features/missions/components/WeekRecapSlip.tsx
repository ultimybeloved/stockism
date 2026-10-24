import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { CHARACTER_MAP } from '../../../characters';
import { CREW_MAP } from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';
import { weekStartOfId } from '../../../rules/missions';
import type { WeeklyRecap } from '../../../rules/weeklyRecap';
import { useSession, useTheme } from '../../../context/AppContext';
import CrewPin from '../../../shared/components/CrewPin';
import PixelIcon from '../../../shared/components/PixelIcon';
import { barcode, pickSlipTheme } from '../utils/recapSlipThemes';

const DAY_MS = 86400000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const signedMoney = (n: number) => `${n < 0 ? '-' : '+'}${formatCurrency(Math.abs(n))}`;
const signedPct = (n: number) => `${n < 0 ? '' : '+'}${n.toFixed(1)}%`;

// The perforation sits this far down the slip (the top band plus the header,
// which has a fixed height so the two line up), with a notch cut out of each
// side. On the page a mask cuts them; the saved picture loses masks, so
// WeekRecapCard punches the same holes into it (punchNotches).
export const PERFORATION_Y = 78;
export const NOTCH_RADIUS = 9;
const notch = (x: string) =>
  `radial-gradient(circle at ${x} ${PERFORATION_Y}px, transparent ${NOTCH_RADIUS}px, #000 ${NOTCH_RADIUS + 0.5}px)`;
const NOTCHES: CSSProperties = {
  maskImage: `${notch('0')}, ${notch('100%')}`,
  maskComposite: 'intersect',
  WebkitMaskImage: `${notch('0')}, ${notch('100%')}`,
  WebkitMaskComposite: 'source-in',
};

const Stat = ({
  label,
  first,
  line,
  children,
}: {
  label: string;
  first?: boolean;
  line: string;
  children: ReactNode;
}) => (
  <div className="min-w-0" style={first ? undefined : { borderLeft: `1px solid ${line}`, paddingLeft: '1rem' }}>
    <div className="text-xs opacity-70">{label}</div>
    <div className="mt-0.5 text-sm font-semibold">{children}</div>
  </div>
);

// The Weekly Slip: what the page shows and what Save image draws. Its
// look is picked at random per player and week (recapSlipThemes).
const WeekRecapSlip = forwardRef<HTMLDivElement, { recap: WeeklyRecap; style?: CSSProperties }>(function WeekRecapSlip(
  { recap, style },
  ref,
) {
  const { user, userData } = useSession();
  const { darkMode } = useTheme();
  const t = pickSlipTheme(`${user?.uid || ''}:${recap.weekId}`, darkMode);
  const cb = !!userData?.colorBlindMode;
  const tone = (n: number) => (n >= 0 ? (cb ? t.upCb : t.up) : cb ? t.downCb : t.down);
  const name = userData?.displayName || userData?.username;
  const crew = userData?.crew ? CREW_MAP[userData.crew] : null;

  const start = weekStartOfId(recap.weekId);
  const mover = recap.mover && CHARACTER_MAP[recap.mover.ticker];
  const rivalry = recap.rivalry;
  const crewName = (id: string) => CREW_MAP[id]?.name || id;
  // The mission week runs Thursday 21:00 to Thursday 21:00 UTC: eight UTC dates.
  const days = Array.from({ length: 8 }, (_, i) =>
    new Date(Date.parse(recap.weekId) + i * DAY_MS).toISOString().slice(0, 10),
  );
  const traded = new Set(recap.tradingDays);
  const checked = new Set(recap.checkinDays);
  const muted = { color: t.muted };

  return (
    <div
      ref={ref}
      className="relative rounded-md overflow-hidden"
      style={{ background: t.bg, color: t.ink, ...NOTCHES, ...style }}
    >
      <div className="h-2" style={{ background: t.band }} />
      <div className="h-[70px] px-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-black italic tracking-tight leading-none">Weekly Slip</div>
          <div className="mt-1 text-xs flex items-center gap-1 truncate" style={muted}>
            {crew && <CrewPin crew={crew} className="w-3.5 h-3.5" />}
            {name}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold" style={{ color: t.accent }}>
            {shortDate(start)} to {shortDate(start + 7 * DAY_MS)}
          </div>
        </div>
      </div>
      <div
        className="absolute left-4 right-4 border-t-2 border-dashed"
        style={{ top: PERFORATION_Y - 1, borderColor: t.line }}
      />

      <div className="px-5 pt-5 pb-3 grid gap-5 md:grid-cols-[auto_1fr] md:gap-8">
        <div>
          <div className="text-xs" style={muted}>
            Net worth
          </div>
          <div
            className="text-4xl sm:text-5xl font-black tabular-nums tracking-tight leading-tight"
            style={{
              backgroundImage: t.figure,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {formatCurrency(recap.netWorth)}
          </div>
          <div className="text-sm tabular-nums">
            <span className="font-bold" style={{ color: tone(recap.trading) }}>
              {signedMoney(recap.trading)} ({signedPct(recap.tradingPct)})
            </span>{' '}
            <span style={muted}>from trading</span>
          </div>
          {recap.rewards >= 1 && (
            <div className="text-sm tabular-nums" style={muted}>
              plus {formatCurrency(recap.rewards)} in rewards
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <ol className="grid grid-cols-8 gap-1">
            {days.map((d) => (
              <li
                key={d}
                className="rounded-sm py-1 text-center"
                style={{ background: t.tile, border: `1px solid ${t.line}` }}
              >
                <div className="text-[11px]" style={muted}>
                  {WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} {Number(d.slice(8))}
                </div>
                <div className="flex justify-center gap-0.5 h-3.5 mt-0.5">
                  {traded.has(d) && <PixelIcon name="trade" alt="Traded" className="w-3.5 h-3.5" />}
                  {checked.has(d) && <PixelIcon name="success" alt="Checked in" className="w-3.5 h-3.5" />}
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs" style={muted}>
            Traded {traded.size} {traded.size === 1 ? 'day' : 'days'}, checked in {checked.size}
          </p>

          <div className="grid grid-cols-3 gap-x-4">
            <Stat label="Biggest mover" first line={t.line}>
              {recap.mover ? (
                <>
                  <span style={{ color: t.accent }}>${recap.mover.ticker}</span>{' '}
                  <span style={{ color: tone(recap.mover.move) }}>{signedPct(recap.mover.move)}</span>
                  {mover && (
                    <div className="text-xs font-normal truncate" style={muted}>
                      {mover.name}
                    </div>
                  )}
                </>
              ) : (
                <span style={muted}>None</span>
              )}
            </Stat>
            <Stat label="Missions" line={t.line}>
              {recap.missions} finished
            </Stat>
            <Stat label="Rivalry" line={t.line}>
              {rivalry ? (
                <>
                  <span className="flex items-center gap-1">
                    <CrewPin crew={CREW_MAP[rivalry.crew]} className="w-4 h-4" />
                    {rivalry.won ? 'Won' : 'Lost'}
                  </span>
                  <div className="text-xs font-normal truncate" style={muted}>
                    {rivalry.won ? 'Beat' : 'Lost to'} {rivalry.opponents.map(crewName).join(' and ')}
                  </div>
                </>
              ) : (
                <span style={muted}>No crew</span>
              )}
            </Stat>
          </div>
        </div>
      </div>

      <div className="px-5 pb-4 pt-1 flex items-end justify-between gap-3">
        <div className="text-xs flex items-center gap-1" style={muted}>
          <PixelIcon name="stockism" className="w-3.5 h-3.5" />
          stockism.app
        </div>
        <div className="flex items-stretch h-6 gap-[2px] opacity-60" aria-hidden>
          {barcode(`${user?.uid || ''}:${recap.weekId}`).map((w, i) => (
            <span key={i} style={{ width: w, background: t.ink }} />
          ))}
        </div>
      </div>
    </div>
  );
});

export default WeekRecapSlip;
