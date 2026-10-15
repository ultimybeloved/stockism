import { triggerReviewChangesFunction } from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';

// The two admin re-runs for a finished chapter review. Both are recovery tools:
// the scheduled jobs do this on their own every Thursday, the recap at 20:30 and
// the tidy-up at 20:54. Split out of useAdminScheduledJobs, which was at its
// line limit.
export function useAdminReviewJobs({ showMessage, setLoading }: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
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
      showMessage('error', 'Failed to rebuild the review: ' + errorMessage(err));
    }
    setLoading(false);
  };

  return { runReviewChanges };
}
