import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeason } from '../hooks/useSeason';
import SeasonProgress from './SeasonProgress';
import { themeClasses } from '../../../utils/theme';
import { SEASON_REWARDS } from '../../../rules/seasons';

import {
  SEASON_TIERS,
  seasonTierRule,
  seasonLabel,
  tierGivesTitle,
  divisionRange,
  SEASON_MIN_BASELINE,
} from '../../../constants/seasons';
import PixelIcon from '../../../shared/components/PixelIcon';

// The season at a glance: what you're on, what's next, and how far off it is.
// This is the piece that gives a player a reason to open the site on a Tuesday,
// so it lives on the home page rather than behind a tab.
//
// No countdown by design — a season ends when the arc's Finale chapter lands and
// nobody knows that in advance.
//
// Starts folded to one line: not everyone is here to compete, and the full card
// was the whole first screen. Open/closed is remembered per device.
const OPEN_KEY = 'stockism.seasonCardOpen';
const readOpen = () => {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
};

const SeasonCard = () => {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      // Private mode / storage disabled: it just won't be remembered.
    }
  };
  const { textClass, mutedClass } = themeClasses;
  const {
    active,
    season,
    weeks,
    rules,
    inSeason,
    returnPercent,
    returnWithLadder,
    lockedTierMeta,
    activeWeeks,
    bronzeActiveWeeks,
    nextTier,
    belowFloor,
    seasonWeeks,
    baselineValue,
    baselineLadder,
    baselinePinnedAt,
    baselineIndex,
    division,
    topTierExcluded,
  } = useSeason();

  if (!active) return null;

  const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

  // What the next tier asks for, in this player's own numbers where there are any.
  const nextHint = () => {
    if (!nextTier || returnPercent === null) return null;
    if (topTierExcluded && (nextTier.id === 'platinum' || nextTier.id === 'diamond')) return null;
    switch (nextTier.id) {
      case 'bronze':
        return `Be active in ${bronzeActiveWeeks} weeks of the season. You have ${activeWeeks} so far. Every tier above needs Bronze first.`;
      case 'silver':
        return `Finish the season above where you started. You're at ${fmtPct(returnPercent)}.`;
      case 'gold':
        return "You're up, which is Silver if you finish there. For Gold, finish the season ahead of the market. The chart above shows where you stood at the last checkpoint.";
      default:
        return `${seasonTierRule(nextTier.id, rules)} Decided when the season ends. The season board shows where you'd land right now.`;
    }
  };
  const hint = nextHint();
  // The lowest tier that pays a title. Everything above it does too.
  const firstTitled = SEASON_TIERS.find((t) => tierGivesTitle(t.id, rules));

  return (
    <div
      className={`${open ? 'p-4' : 'px-4 py-2'} rounded-sm border mb-4 light:bg-amber-50 light:border-amber-200 dark:bg-zinc-800/50 dark:border-zinc-700`}
    >
      <div className={`flex justify-between gap-3 ${open ? 'items-start flex-wrap' : 'items-center'}`}>
        <div className="min-w-0">
          <h3 className={`font-semibold ${textClass} ${open ? '' : 'text-sm truncate'}`}>
            <PixelIcon name="season" className="w-4 h-4 mr-1 align-[-3px]" />
            {seasonLabel(season)} · {season.name}
            {!open && inSeason && (
              <span className={`ml-2 font-bold ${returnPercent! >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                {fmtPct(returnPercent!)}
              </span>
            )}
          </h3>
          {open && <p className={`text-xs ${mutedClass}`}>Week {weeks} · ends when the arc finale drops</p>}
          {open && season.preseason && (
            <p className={`text-xs ${mutedClass} mt-1`}>
              A trial run before Season 1.
              {firstTitled && ` Finishing ${firstTitled.name} or better gives a Preseason title.`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lockedTierMeta && (
            <span
              className="px-2 py-1 rounded-sm text-xs font-bold"
              style={{ backgroundColor: `${lockedTierMeta.color}22`, color: lockedTierMeta.color }}
            >
              {lockedTierMeta.name} secured
            </span>
          )}
          <button
            onClick={toggle}
            aria-expanded={open}
            className="text-xs font-semibold text-orange-500 hover:underline whitespace-nowrap"
          >
            {open ? 'Hide ▴' : 'Details ▾'}
          </button>
        </div>
      </div>

      {!open ? null : !inSeason ? (
        <p className={`text-sm ${mutedClass} mt-3`}>
          {belowFloor
            ? `Your account was under $${SEASON_MIN_BASELINE.toLocaleString()} when this season started. Get it over $${SEASON_MIN_BASELINE.toLocaleString()} and the next Thursday checkpoint adds you, scored from there.`
            : "You're not in this season yet. Thursday's checkpoint adds you, and you're scored from there."}
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-3">
            {/* In season, returnPercent is always set. */}
            <span className={`text-2xl font-bold ${returnPercent! >= 0 ? 'text-green-500' : 'text-red-400'}`}>
              {fmtPct(returnPercent!)}
            </span>
            <span className={`text-xs ${mutedClass}`}>season return, trading only</span>
          </div>
          {division && (
            <p className={`text-xs ${mutedClass} mt-1`}>
              <span className={`font-semibold ${textClass}`}>{division.label} division</span> ({divisionRange(division)}{' '}
              at the start). Platinum and Diamond are ranked against players your size.
            </p>
          )}
          {topTierExcluded && (
            <p className="text-xs text-red-400 mt-1">
              You can&apos;t place Platinum or Diamond this season because your trades were repeatedly flagged as
              coordinated with other players. Bronze, Silver and Gold still count.
            </p>
          )}

          {/* The ladder is excluded from anything that counts. Showing what it
              would have been is honest, and quietly discourages chasing it. */}
          {returnWithLadder !== null && Math.abs(returnWithLadder - returnPercent!) >= 0.1 && (
            <p className={`text-xs ${mutedClass} mt-1`}>
              With ladder winnings it would be {fmtPct(returnWithLadder)}. The ladder is a casino, so it doesn't count
              toward your season.
            </p>
          )}

          <SeasonProgress
            season={season}
            seasonWeeks={seasonWeeks}
            baselineValue={baselineValue}
            baselineLadder={baselineLadder}
            baselinePinnedAt={baselinePinnedAt}
            baselineIndex={baselineIndex}
          />

          {hint && (
            <p className={`text-sm ${textClass} mt-2`}>
              Next up {/* A hint only exists when there is a next tier. */}
              <span className="font-semibold" style={{ color: nextTier!.color }}>
                {nextTier!.name}
              </span>
              . {hint}
            </p>
          )}

          <p className={`text-xs ${mutedClass} mt-2`}>
            Bronze is banked at Thursday checkpoints and can't be lost. Silver and Gold go by where you finish, and
            Platinum and Diamond are handed out when the season ends. Borrowed money counts as money you traded with for
            as long as you owe it, so margin can't make your return look bigger. Talking about stocks is fine, but
            repeatedly planning trades with other players to move a price keeps you out of Platinum and Diamond.
            {firstTitled && ` ${firstTitled.name} and up earn a permanent title.`}
            {season?.id &&
              SEASON_REWARDS[season.id] &&
              ' Every tier earns a row frame, plus the frames of the tiers below it.'}
          </p>
        </>
      )}

      {open && (
        <Link
          to="/leaderboard?board=season"
          className="inline-block mt-3 text-xs font-semibold text-orange-500 hover:underline"
        >
          See the season board →
        </Link>
      )}
    </div>
  );
};

export default SeasonCard;
