import {
  triggerWeeklyCrewRankingsFunction,
  triggerWeeklyMarketSummaryFunction,
  triggerDailyMarketSummaryFunction,
  archivePriceHistoryFunction,
  backfillFillTradeRecordsFunction,
  triggerDailyFreeStockFunction,
} from '../../firebase';

// Manual re-runs of jobs that normally fire on a schedule. Used by the Market
// tab when a scheduled run failed, or to seed/preview one on demand.
export function useAdminScheduledJobs({ showMessage, setLoading }) {
  // Recompute crew underdog multipliers now (writes market/crewStats).
  // skipDiscord=true only refreshes the stats doc without posting rankings.
  const runCrewRankings = async (skipDiscord) => {
    setLoading(true);
    try {
      const result = await triggerWeeklyCrewRankingsFunction({ skipDiscord: !!skipDiscord });
      const mults = result.data?.multipliers || {};
      const summary = Object.entries(mults).map(([id, m]) => `${id} x${m}`).join(', ');
      showMessage('success', `Crew stats updated. ${summary}`);
    } catch (err) {
      console.error('Crew rankings run failed:', err);
      showMessage('error', 'Failed to run crew rankings: ' + err.message);
    }
    setLoading(false);
  };

  // Post the weekly market report to Discord now. Read-only, so it can be run
  // any number of times.
  const runMarketSummary = async () => {
    setLoading(true);
    try {
      const result = await triggerWeeklyMarketSummaryFunction({});
      const d = result.data || {};
      if (d.posted) {
        showMessage('success', `Weekly report posted. ${d.weeklyTrades} trades, ${d.activeUsers} active users.`);
      } else {
        showMessage('error', 'Summary failed: ' + (d.error || 'unknown error'));
      }
    } catch (err) {
      console.error('Market summary run failed:', err);
      showMessage('error', 'Failed to post summary: ' + err.message);
    }
    setLoading(false);
  };

  // Post the daily market report to Discord now. Skips recording the daily
  // index point, so a manual run can't double-count it.
  const runDailyMarketSummary = async () => {
    setLoading(true);
    try {
      const result = await triggerDailyMarketSummaryFunction({});
      if (result.data?.success) {
        showMessage('success', 'Daily report posted to Discord.');
      } else {
        showMessage('error', 'Daily report failed: ' + (result.data?.error || 'unknown error'));
      }
    } catch (err) {
      console.error('Daily summary run failed:', err);
      showMessage('error', 'Failed to post daily report: ' + err.message);
    }
    setLoading(false);
  };

  // Check the Discord side of crew head roles without changing anything:
  // missing roles, bad IDs, and the role-hierarchy trap that makes every
  // assignment fail with a silent 403.
  const checkCrewRoles = async () => {
    setLoading(true);
    try {
      const result = await triggerWeeklyCrewRankingsFunction({ rolesOnly: true, dryRun: true });
      const d = result.data || {};
      if (!d.configured) {
        showMessage('error', 'Crew role IDs are not set up yet.');
      } else if (d.problems && d.problems.length > 0) {
        showMessage('error', d.problems.join(' | '));
      } else {
        showMessage('success', `Setup looks good. ${d.configuredCount || 0} crew roles ready.`);
      }
    } catch (err) {
      console.error('Crew role check failed:', err);
      showMessage('error', 'Check failed: ' + err.message);
    }
    setLoading(false);
  };

  // Re-hand the crew head roles from the current standings. Safe to repeat.
  const syncCrewRoles = async () => {
    setLoading(true);
    try {
      const result = await triggerWeeklyCrewRankingsFunction({ rolesOnly: true });
      const d = result.data || {};
      if (!d.configured) {
        showMessage('error', 'Crew role IDs are not set up yet.');
      } else if (d.problems && d.problems.length > 0) {
        showMessage('error', d.problems.join(' | '));
      } else {
        showMessage('success', `Roles synced. ${d.added || 0} given, ${d.removed || 0} removed.`);
      }
    } catch (err) {
      console.error('Crew role sync failed:', err);
      showMessage('error', 'Sync failed: ' + err.message);
    }
    setLoading(false);
  };

  // Post an extra free-stock drop to Discord now. Unlike the report buttons
  // this one gives every linked player another claim, so it asks first.
  const runDailyFreeStock = async () => {
    const ok = window.confirm(
      'Post another free stock drop?\n\n' +
      'Every linked player gets a second claim today, worth about $400 each on average. ' +
      'The drop stays claimable for 72 hours.'
    );
    if (!ok) return;

    setLoading(true);
    try {
      const result = await triggerDailyFreeStockFunction({});
      if (result.data?.success) {
        showMessage('success', 'Drop posted to Discord.');
      } else {
        showMessage('error', 'Drop failed: ' + (result.data?.error || 'unknown error'));
      }
    } catch (err) {
      console.error('Daily drop post failed:', err);
      showMessage('error', 'Failed to post drop: ' + err.message);
    }
    setLoading(false);
  };

  // Move old price points from the live market/priceHistory doc into the
  // per-ticker archive. Charts merge the archive back in, so nothing visible
  // changes. Run this if trades ever fail with "too many index entries".
  const runArchivePriceHistory = async () => {
    setLoading(true);
    try {
      const result = await archivePriceHistoryFunction({});
      if (result.data?.success) {
        showMessage('success', `Archived old points for ${result.data.archivedTickers} tickers.`);
      } else {
        showMessage('error', 'Archive failed: ' + (result.data?.error || 'unknown error'));
      }
    } catch (err) {
      console.error('Archive run failed:', err);
      showMessage('error', 'Archive failed: ' + err.message);
    }
    setLoading(false);
  };

  // One-off repair: writes trade records for old limit/stop-loss/pre-market
  // fills. Deterministic ids make repeat runs harmless.
  const runBackfillFillTrades = async () => {
    setLoading(true);
    try {
      const result = await backfillFillTradeRecordsFunction({});
      const { limitOrders, preMarketOrders } = result.data || {};
      showMessage('success', `Backfilled ${limitOrders?.written || 0} limit/stop-loss fills and ${preMarketOrders?.written || 0} pre-market fills.`);
    } catch (err) {
      console.error('Fill backfill failed:', err);
      showMessage('error', 'Backfill failed: ' + err.message);
    }
    setLoading(false);
  };

  return { runCrewRankings, runMarketSummary, runDailyMarketSummary, runDailyFreeStock, checkCrewRoles, syncCrewRoles, runArchivePriceHistory, runBackfillFillTrades };
}
