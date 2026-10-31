// The admin buttons that close and reopen long-term markets.
import { errorMessage } from '../../../utils/errors';
import type { AdminHookDeps } from '../utils/adminShared';
import { reopenEventMarkets, toggleEventTrading } from '../utils/eventTrading';

export const useEventTradingActions = (
  setLoading: AdminHookDeps['setLoading'],
  showMessage: AdminHookDeps['showMessage'],
) => {
  const run = async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
      showMessage('success', 'Long-term market trading updated');
    } catch (err) {
      showMessage('error', `Could not update the market: ${errorMessage(err)}`);
    }
    setLoading(false);
  };
  return {
    handleToggleEventTrading: (id: string) => run(() => toggleEventTrading(id)),
    handleReopenEventMarkets: () => run(reopenEventMarkets),
  };
};
