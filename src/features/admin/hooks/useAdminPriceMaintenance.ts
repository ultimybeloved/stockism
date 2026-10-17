import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { fixBasePriceCliffsFunction } from '../../../api/callables';
import { priceHistoryDocRef } from '../utils/adminShared';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import { logPanelAction } from '../utils/panelLog';
import type { PriceHistory, PricePoint } from '../../../types';

// Price maintenance: the chart-cliff fix (Stats tab) and the price/history
// sync the backup restore runs afterwards.
export function useAdminPriceMaintenance({
  showMessage,
  setLoading,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
  // Sync current prices to match the latest price history entry
  const handleSyncPricesToHistory = async () => {
    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const histSnap = await getDoc(priceHistoryDocRef());

      if (!histSnap.exists()) {
        showMessage('error', 'Price history document not found');
        setLoading(false);
        return;
      }

      const priceHistory: PriceHistory = histSnap.data() || {};
      const updatedPrices: Record<string, number> = {};

      // For each ticker, set current price to the last history entry
      Object.entries(priceHistory).forEach(([ticker, history]) => {
        if (history && history.length > 0) {
          const latestEntry = history[history.length - 1] as PricePoint;
          updatedPrices[ticker] = latestEntry.price;
        }
      });

      const oldPrices: Record<string, number> = (await getDoc(marketRef)).data()?.prices || {};

      // Write only the prices that differ, one field each. Replacing the whole map
      // dropped every ticker with no history entry, and re-wrote untouched prices
      // over any trade that landed in between.
      const changed = Object.keys(updatedPrices).filter((t) => oldPrices[t] !== updatedPrices[t]);
      if (changed.length > 0) {
        await updateDoc(marketRef, Object.fromEntries(changed.map((t) => [`prices.${t}`, updatedPrices[t]])));
      }
      await logPanelAction({
        action: 'sync_prices_to_history',
        before: Object.fromEntries(changed.map((t) => [t, oldPrices[t] ?? null])),
        after: Object.fromEntries(changed.map((t) => [t, updatedPrices[t]])),
      });

      showMessage('success', `Synced ${changed.length} prices to match latest history!`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to sync prices: ' + errorMessage(err));
    }
    setLoading(false);
  };

  // Drop a chart's first point when it sits >2% away from the second one.
  // Data loss can leave a ticker starting at its base price with a jump to the
  // first real price, which reads as a cliff on the chart that never happened.
  const handleFixPriceCliffs = async () => {
    if (
      !window.confirm(
        'Scan charts for base-price cliffs and remove them?\n\nThis drops the first history point on any ticker that jumps more than 2% to its second point.',
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      const { data } = await fixBasePriceCliffsFunction({});
      if (data.tickersFixed === 0) {
        showMessage('info', `No cliffs found — all ${data.tickersSkipped} charts look clean.`);
      } else {
        const names = (data.fixed || []).map((f) => `${f.ticker} (${f.percentChange}%)`).join(', ');
        showMessage('success', `Fixed ${data.tickersFixed} chart${data.tickersFixed === 1 ? '' : 's'}: ${names}`);
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to fix price cliffs: ' + errorMessage(err));
    }
    setLoading(false);
  };

  return { handleSyncPricesToHistory, handleFixPriceCliffs };
}
