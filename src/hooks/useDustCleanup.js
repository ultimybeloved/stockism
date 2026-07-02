import { useMemo, useState } from 'react';
import { sweepDustPositionsFunction } from '../firebase';
import { DUST_MAX_VALUE } from '../constants/economy';
import { formatCurrency } from '../utils/formatters';

// Finds a user's tiny long positions (market value below DUST_MAX_VALUE) and
// liquidates them all to cash via the sweepDustPositions callable. See that
// function for why a normal "sell all" can't clear sub-0.01-share slivers.
export function useDustCleanup(portfolioItems, showNotification) {
  const [sweeping, setSweeping] = useState(false);

  const dustItems = useMemo(
    () => portfolioItems.filter((i) => i.value > 0 && i.value < DUST_MAX_VALUE),
    [portfolioItems]
  );

  const dustTotal = useMemo(
    () => dustItems.reduce((sum, i) => sum + i.value, 0),
    [dustItems]
  );

  const handleSweep = async () => {
    if (sweeping) return;
    setSweeping(true);
    try {
      const res = await sweepDustPositionsFunction();
      const { swept = 0, proceeds = 0 } = res?.data || {};
      if (swept > 0) {
        showNotification(
          'success',
          `Cleaned up ${swept} tiny position${swept === 1 ? '' : 's'} for ${formatCurrency(proceeds)}`
        );
      } else {
        showNotification('error', 'Nothing to clean up. Those positions may be locked.');
      }
    } catch (err) {
      showNotification('error', err.message || 'Could not clean up dust.');
    } finally {
      setSweeping(false);
    }
  };

  return { dustItems, dustTotal, sweeping, handleSweep };
}
