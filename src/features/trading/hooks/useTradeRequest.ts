import { useCallback } from 'react';
import { CHARACTER_MAP, exitLoyaltyDiscount } from '../../../characters';
import { estimateTradeTotal, getAccountAgeImpactFactor, liquidityFor } from '../../../utils/calculations';
import { getCumulativeVolume } from '../../../utils/tradeLimits';
import type { TradeHookDeps } from '../../../shared/hooks/types';
import type { TradeAction } from '../../../types';

type TradeRequestDeps = Pick<
  TradeHookDeps,
  'user' | 'userData' | 'getMarket' | 'showNotification' | 'setTradeConfirmation'
>;

/** requestTrade: checks a trade can be placed, then opens the confirmation dialog with an estimated total. */
export function useTradeRequest({
  user,
  userData,
  getMarket,
  showNotification,
  setTradeConfirmation,
}: TradeRequestDeps) {
  const requestTrade = useCallback(
    (ticker: string, action: TradeAction, amount: number) => {
      if (!user || !userData) {
        showNotification('info', 'Sign in to start trading!');
        return;
      }
      const { prices, activeIPOs, launchedTickers } = getMarket();

      // Characters in an IPO phase aren't tradeable normally
      const now = Date.now();
      const activeIPO = activeIPOs.find((ipo) => ipo.ticker === ticker && !ipo.priceJumped && now < ipo.ipoEndsAt);
      if (activeIPO) {
        const inHypePhase = now < activeIPO.ipoStartsAt;
        showNotification(
          'error',
          inHypePhase
            ? `$${ticker} is in IPO hype phase - trading opens soon!`
            : `$${ticker} is in IPO - buy through the IPO section above!`,
        );
        return;
      }

      const asset = CHARACTER_MAP[ticker];
      if (asset?.ipoRequired && !launchedTickers.includes(ticker)) {
        showNotification('error', `$${ticker} requires an IPO before trading`);
        return;
      }

      const price = prices[ticker] || asset?.basePrice || 0;

      // Estimated total (with new-account impact reduction and exit loyalty)
      const exitDiscount =
        action === 'sell' ? exitLoyaltyDiscount(userData.holdingCohorts?.[ticker], amount, Date.now()) : 0;
      const total = estimateTradeTotal({
        action,
        price,
        amount,
        isETF: asset?.isETF || false,
        ageFactor: getAccountAgeImpactFactor(userData),
        shortPosition: userData.shorts?.[ticker],
        exitDiscount,
        // Same rolling-24h volume the trade form prices against, so the quote on
        // the confirmation matches the one the player just saw.
        cumulativeVolume: getCumulativeVolume(userData, ticker, action),
        liquidity: liquidityFor(ticker),
      });

      setTradeConfirmation({ ticker, action, amount, price, total, name: asset?.name, exitDiscount });
    },
    [user, userData, getMarket, showNotification, setTradeConfirmation],
  );

  return requestTrade;
}
