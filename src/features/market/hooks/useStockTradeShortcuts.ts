import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShortcuts } from '../../../shared/hooks/useShortcuts';
import type { TradeAction } from '../../../types';

// The stock page's ways in to a trade besides its buttons: B and S on the
// keyboard, and ?trade=buy in the link (quick search's Buy button).
export function useStockTradeShortcuts(
  openTrade: (action: TradeAction) => void,
  { enabled, canSell }: { enabled: boolean; canSell: boolean },
) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('trade');

  useEffect(() => {
    if (!wanted) return;
    if (enabled && (wanted === 'buy' || (wanted === 'sell' && canSell))) openTrade(wanted);
    setParams(
      (prev) => {
        prev.delete('trade');
        return prev;
      },
      { replace: true },
    );
    // Runs once per link; openTrade is a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, enabled]);

  useShortcuts(
    {
      b: () => openTrade('buy'),
      s: () => canSell && openTrade('sell'),
    },
    enabled,
  );
}
