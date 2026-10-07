import { useMemo, useState } from 'react';
import { sweepDustPositionsFunction } from '../firebase';
import { DUST_MAX_VALUE } from '../constants/economy';
import { formatCurrency } from '../utils/formatters';
import { errorMessage } from '../utils/errors';
import type { AppContextValue } from '../context/AppContext';

/** The fields this hook reads from a portfolio row. */
interface ValuedItem {
  value: number;
}

// Finds a user's tiny long positions (market value below DUST_MAX_VALUE) and
// liquidates them all to cash via the sweepDustPositions callable. See that
// function for why a normal "sell all" can't clear sub-0.01-share slivers.
export function useDustCleanup<T extends ValuedItem>(
  portfolioItems: T[],
  showNotification: AppContextValue['showNotification'],
) {
  const [sweeping, setSweeping] = useState(false);

  const dustItems = useMemo(
    () => portfolioItems.filter((i) => i.value > 0 && i.value < DUST_MAX_VALUE),
    [portfolioItems],
  );

  const dustTotal = useMemo(() => dustItems.reduce((sum, i) => sum + i.value, 0), [dustItems]);

  const handleSweep = async () => {
    if (sweeping) return;
    setSweeping(true);
    try {
      const res = await sweepDustPositionsFunction();
      const { swept = 0, proceeds = 0 } = res?.data || {};
      if (swept > 0) {
        showNotification(
          'success',
          `Cleaned up ${swept} tiny position${swept === 1 ? '' : 's'} for ${formatCurrency(proceeds)}`,
        );
      } else {
        showNotification('error', 'Nothing to clean up. Those positions may be locked.');
      }
    } catch (err) {
      showNotification('error', errorMessage(err) || 'Could not clean up dust.');
    } finally {
      setSweeping(false);
    }
  };

  return { dustItems, dustTotal, sweeping, handleSweep };
}
