import {
  triggerReviewChangesFunction,
  triggerCollapseReviewHistoryFunction,
} from '../../firebase';

// The two admin re-runs for a finished chapter review. Both are recovery tools:
// the scheduled jobs do this on their own every Thursday, the recap at 20:30 and
// the tidy-up at 20:54. Split out of useAdminScheduledJobs, which was at its
// line limit.
export function useAdminReviewJobs({ showMessage, setLoading }) {
  // Rebuild what the Review tab shows for the most recent chapter review.
  // Reads the permanent price-history archive too, so it still works after the
  // live history has rolled past the halt window.
  const runReviewChanges = async () => {
    setLoading(true);
    try {
      const result = await triggerReviewChangesFunction({});
      const d = result.data || {};
      showMessage('success', `Review tab rebuilt: ${d.tickerCount} adjusted stock${d.tickerCount === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error('Review changes rebuild failed:', err);
      showMessage('error', 'Failed to rebuild the review: ' + err.message);
    }
    setLoading(false);
  };

  // Save the review's numbers, then fold its price-history staircase down to one
  // point per stock. Runs automatically at 20:54 Thursday; this is the re-run.
  const runCollapseReview = async () => {
    setLoading(true);
    try {
      const d = (await triggerCollapseReviewHistoryFunction({})).data || {};
      showMessage('success', d.tidied
        ? `Chart tidied: ${d.tidied} stock${d.tidied === 1 ? '' : 's'}, ${d.folded} extra points folded away.`
        : 'Nothing to tidy — the review is already one point per stock.');
    } catch (err) {
      console.error('Review collapse failed:', err);
      showMessage('error', 'Failed to tidy the review chart: ' + err.message);
    }
    setLoading(false);
  };

  return { runReviewChanges, runCollapseReview };
}
