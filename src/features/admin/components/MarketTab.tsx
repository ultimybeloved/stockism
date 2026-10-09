import SeasonPanel from './SeasonPanel';
import { marketTimes, localDailyTime, localWeeklyTime } from '../../../utils/localTime';

import type { AdminCommonProps } from './types';
import type { useAdminMarketTools } from '../hooks/useAdminMarketTools';
import type { useAdminScheduledJobs } from '../hooks/useAdminScheduledJobs';
import type { useAdminReviewJobs } from '../hooks/useAdminReviewJobs';
import type { useAdminSeason } from '../hooks/useAdminSeason';
import type { PriceMap } from '../../../types';
import { useTheme } from '../../../context/AppContext';

const MarketTab = ({
  textClass,
  mutedClass,
  loading,
  prices,
  marketHaltStatus,
  marketHaltReason,
  haltReasonInput,
  setHaltReasonInput,
  updateMarketHalt,
  runCrewRankings,
  runMarketSummary,
  runDailyMarketSummary,
  runDailyFreeStock,
  checkCrewRoles,
  syncCrewRoles,
  runBackfillFillTrades,
  runArchivePriceHistory,
  runReviewChanges,
  runCollapseReview,
  season,
  seasonName,
  setSeasonName,
  preseason,
  setPreseason,
  countThisWeek,
  setCountThisWeek,
  handleStartSeason,
  handleEndSeason,
  handleRunCheckpoint,
}: Omit<AdminCommonProps, 'inputClass'> &
  ReturnType<typeof useAdminMarketTools> &
  ReturnType<typeof useAdminScheduledJobs> &
  ReturnType<typeof useAdminReviewJobs> &
  ReturnType<typeof useAdminSeason> & { prices: PriceMap }) => {
  const { darkMode } = useTheme();
  return (
    // Plain panel, like every other tab. It used to add its own
    // `overflow-y-auto flex-1 p-4`, which nested a second scroll area inside the
    // panel's content wrapper and clipped everything above the halt controls.
    <div className="space-y-4">
      <h3 className="text-lg font-bold light:text-slate-900 dark:text-white">Market Controls</h3>

      <SeasonPanel
        {...{
          darkMode,
          textClass,
          mutedClass,
          loading,
          season,
          seasonName,
          setSeasonName,
          preseason,
          setPreseason,
          countThisWeek,
          setCountThisWeek,
          handleStartSeason,
          handleEndSeason,
          handleRunCheckpoint,
        }}
      />

      {/* Status */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-3 h-3 rounded-full ${prices && !marketHaltStatus ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="font-semibold light:text-slate-900 dark:text-white">
            Market Status: {marketHaltStatus ? 'HALTED' : 'OPEN'}
          </span>
        </div>
        {marketHaltStatus && marketHaltReason && (
          <p className={`text-sm mb-2 ${mutedClass}`}>Reason: {marketHaltReason}</p>
        )}
      </div>

      {/* Emergency Halt Controls */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-3 light:text-slate-900 dark:text-white">Emergency Halt</h4>
        <input
          type="text"
          value={haltReasonInput}
          onChange={(e) => setHaltReasonInput(e.target.value)}
          placeholder="Halt reason (e.g., Emergency maintenance)"
          className="w-full p-2 rounded-sm border text-sm mb-3 light:bg-white light:border-slate-300 light:text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
        />
        <div className="flex gap-2">
          <button
            onClick={() => updateMarketHalt(true, haltReasonInput)}
            disabled={loading || marketHaltStatus}
            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-sm hover:bg-red-700 disabled:opacity-50"
          >
            Halt Market
          </button>
          <button
            onClick={() => updateMarketHalt(false, '')}
            disabled={loading || !marketHaltStatus}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            Resume Market
          </button>
        </div>
      </div>

      {/* Crew stats recompute */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Crew Rankings & Underdog Bonus</h4>
        <p className={`text-xs mb-3 ${mutedClass}`}>
          Recomputes each crew's active-player count and reward multiplier from last week's activity. Runs automatically{' '}
          {localWeeklyTime(90, 1)}; use this to seed or fix it.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => runCrewRankings(true)}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Refresh Multipliers Only
          </button>
          <button
            onClick={() => runCrewRankings(false)}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Recompute + Post to Discord
          </button>
        </div>
      </div>

      {/* Market reports */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Market Reports</h4>
        <p className={`text-xs mb-3 ${mutedClass}`}>
          Posts a report to Discord: trades, volume, player counts, top movers. The daily one runs automatically at
          market close, the weekly one {localWeeklyTime(0, 1)}. Nothing is saved, so you can post either again any time.
        </p>
        <div className="flex gap-2">
          <button
            onClick={runDailyMarketSummary}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Post Daily Report
          </button>
          <button
            onClick={runMarketSummary}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Post Weekly Report
          </button>
        </div>
      </div>

      {/* Review tab rebuild */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Chapter Review Tab</h4>
        <p className={`text-xs mb-3 ${mutedClass}`}>
          Rebuilds the list of stocks you adjusted in the last chapter review, which is what the Review tab shows
          players. This is saved automatically when the review recap posts on Thursday, so you only need this if that
          run failed or a stock is missing from the tab. Safe to run again any time.
        </p>
        <button
          onClick={runReviewChanges}
          disabled={loading}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          Rebuild Review Tab
        </button>
      </div>

      {/* Fold the review's price-history staircase down to one point */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Tidy Review Chart</h4>
        <p className={`text-xs mb-3 ${mutedClass}`}>
          Adjusting one stock also drags every stock linked to it, so a review leaves each chart with a run of steps
          that players read as trading during the halt. This folds them into one point, stamped {localDailyTime(1254)}{' '}
          so every stock moves at the same moment. It never changes a price, and the real step-by-step history is saved
          first. Runs automatically at 20:54 on Thursday, so you only need this if that run failed. Safe to run again
          any time.
        </p>
        <button
          onClick={runCollapseReview}
          disabled={loading}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          Tidy Review Chart
        </button>
      </div>

      {/* Crew head Discord roles */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Crew Head Discord Roles</h4>
        <p className={`text-xs mb-3 ${mutedClass}`}>
          Crew heads get their crew's Discord role automatically every Monday. Check Setup looks for missing roles and
          the hierarchy problem that makes every assignment fail silently. Sync Now re-hands the roles from the current
          standings, and is safe to press again.
        </p>
        <div className="flex gap-2">
          <button
            onClick={checkCrewRoles}
            disabled={loading}
            className="px-4 py-2 bg-slate-600 text-white text-sm font-semibold rounded-sm hover:bg-slate-700 disabled:opacity-50"
          >
            Check Setup
          </button>
          <button
            onClick={syncCrewRoles}
            disabled={loading}
            className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-sm hover:bg-amber-700 disabled:opacity-50"
          >
            Sync Now
          </button>
        </div>
      </div>

      {/* Free stock drop */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Free Stock Drop</h4>
        <p className={`text-xs mb-3 ${mutedClass}`}>
          Posts an extra drop to Discord on top of the automatic one at {localDailyTime(840)}. Every linked player gets
          another claim, worth about $400 each on average, and it stays claimable for 72 hours. Use this for events, not
          routinely.
        </p>
        <button
          onClick={runDailyFreeStock}
          disabled={loading}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          Post Drop Now
        </button>
      </div>

      {/* Missing fill history */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Backfill Old Fill History</h4>
        <p className={`text-xs mb-3 ${mutedClass}`}>
          Limit orders, stop losses and pre-market orders used to fill without writing anything to trade history, so
          players cannot see those trades. This adds the missing entries. Running it twice does nothing the second time,
          so it is safe to press again.
        </p>
        <button
          onClick={runBackfillFillTrades}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Backfill Fill History
        </button>
      </div>

      {/* Price history archive */}
      <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <h4 className="font-semibold mb-1 light:text-slate-900 dark:text-white">Price History Archive</h4>
        <p className={`text-xs mb-3 ${mutedClass}`}>
          Moves old chart points out of the live price doc into the permanent archive. Charts keep all their data. Runs
          automatically every day; press this if trades fail with an index-entries error.
        </p>
        <button
          onClick={runArchivePriceHistory}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Archive Old Price Points
        </button>
      </div>

      {/* Info */}
      <div className="p-3 rounded-sm text-xs light:bg-blue-50 light:text-blue-700 light:border light:border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border dark:border-blue-800">
        Automatic weekly halt ({marketTimes().halt}) is always active. This is for emergencies only.
      </div>
    </div>
  );
};

export default MarketTab;
