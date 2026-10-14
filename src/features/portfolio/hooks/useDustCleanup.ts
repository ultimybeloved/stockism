import { useMemo, useState } from 'react';
import { sweepDustPositionsFunction } from '../../../api/callables';
import { DUST_MAX_VALUE } from '../../../constants/economy';
import { formatCurrency } from '../../../utils/formatters';
import { errorMessage } from '../../../utils/errors';
import type { AppContextValue } from '../../../context/AppContext';

/** The fields this hook reads from a portfolio row. Short rows also carry
 * shares and price: a short counts as tiny by the size of the position, while
 * `value` is what closing it hands back. */
interface ValuedItem {
  value: number;
  shares?: number;
  currentPrice?: number;
}

export type DustSide = 'long' | 'short';

// Finds a user's tiny positions on one side (worth less than DUST_MAX_VALUE)
// and closes them all via the sweepDustPositions callable. See that function
// for why a normal "sell all" can't clear sub-0.01-share slivers.
export function useDustCleanup<T extends ValuedItem>(
  items: T[],
  showNotification: AppContextValue['showNotification'],
  side: DustSide = 'long',
) {
  const [sweeping, setSweeping] = useState(false);

  const dustItems = useMemo(
    () =>
      items.filter((i) => {
        const size = side === 'short' ? (i.shares || 0) * (i.currentPrice || 0) : i.value;
        return size > 0 && size < DUST_MAX_VALUE;
      }),
    [items, side],
  );

  const dustTotal = useMemo(() => dustItems.reduce((sum, i) => sum + i.value, 0), [dustItems]);

  const handleSweep = async () => {
    if (sweeping) return;
    setSweeping(true);
    try {
      const res = await sweepDustPositionsFunction(side === 'short' ? { side: 'short' } : undefined);
      const { swept = 0, proceeds = 0 } = res?.data || {};
      if (swept > 0) {
        showNotification(
          'success',
          `Cleaned up ${swept} tiny ${side === 'short' ? 'short' : 'position'}${swept === 1 ? '' : 's'} for ${formatCurrency(proceeds)}`,
        );
      } else {
        showNotification(
          'error',
          side === 'short'
            ? 'Nothing to clean up. Shorts opened in the last minute have to wait.'
            : 'Nothing to clean up. Those positions may be locked.',
        );
      }
    } catch (err) {
      showNotification('error', errorMessage(err) || 'Could not clean up dust.');
    } finally {
      setSweeping(false);
    }
  };

  return { dustItems, dustTotal, sweeping, handleSweep };
}
