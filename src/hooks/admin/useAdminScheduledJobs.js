import {
  triggerWeeklyCrewRankingsFunction,
  triggerWeeklyMarketSummaryFunction,
  archivePriceHistoryFunction,
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
        showMessage('success', `Posted to Discord. ${d.activeThisWeek} active this week, ${d.activeUsers} active this month, ${d.totalPlayers} players total.`);
      } else {
        showMessage('error', 'Summary failed: ' + (d.error || 'unknown error'));
      }
    } catch (err) {
      console.error('Market summary run failed:', err);
      showMessage('error', 'Failed to post summary: ' + err.message);
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

  return { runCrewRankings, runMarketSummary, runArchivePriceHistory };
}
