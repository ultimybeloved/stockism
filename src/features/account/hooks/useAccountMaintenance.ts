import { useEffect, useRef } from 'react';
import {
  claimPredictionPayoutFunction,
  chargeMarginInterestFunction,
  syncPortfolioFunction,
} from '../../../api/callables';
import { formatCurrency } from '../../../utils/formatters';
import { BAILOUT_CASH, PORTFOLIO_SYNC_MIN_INTERVAL_MS } from '../../../constants';
import { reportUnexpected } from '../../../monitoring';
import type { AppContextValue } from '../../../context/AppContext';

// Background upkeep for the signed-in account: prediction payout claims,
// debounced portfolio sync, daily margin interest, and bankruptcy reminders.
const PAYOUT_RETRY_MS = 5 * 60 * 1000;

type MaintenanceArgs = Pick<AppContextValue, 'user' | 'userData' | 'prices' | 'predictions' | 'showNotification'>;

export function useAccountMaintenance({ user, userData, prices, predictions, showNotification }: MaintenanceArgs) {
  // Auto-process payouts when prediction is resolved.
  // This effect re-runs on every account or market update, so each claim is
  // remembered: one already on its way is never sent twice, and one that failed
  // waits PAYOUT_RETRY_MS before another try instead of firing on every update.
  const payoutAttemptsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const processPayouts = async () => {
      if (!user || !userData || !userData.bets) return;

      for (const prediction of predictions) {
        if (!prediction.resolved || prediction.payoutsProcessed) continue;

        const userBet = userData.bets[prediction.id];
        if (!userBet || userBet.paid) continue;

        const key = `${user.uid}:${prediction.id}`;
        if (Date.now() - (payoutAttemptsRef.current[key] || 0) < PAYOUT_RETRY_MS) continue;
        payoutAttemptsRef.current[key] = Date.now();

        try {
          const result = await claimPredictionPayoutFunction({ predictionId: prediction.id });
          const { won, payout } = result.data;

          if (won) {
            // Win surfaces as a persistent bell notification (written server-side), not a toast
            console.log(`[Payout] Processed winning bet for prediction ${prediction.id}: +${payout}`);
          } else {
            console.log(`[Payout] Processed losing bet for prediction ${prediction.id}`);
          }
        } catch (error) {
          // Nothing surfaces to the player here, so a failure means a bet that
          // won and was never paid, with no complaint and no trace.
          reportUnexpected(error, { where: 'processPayouts', predictionId: prediction.id });
        }
      }
    };

    processPayouts();
  }, [user, userData, predictions]);

  // Sync portfolio value, history, and achievements via Cloud Function
  // (these fields are blocked from client-side writes by security rules).
  // At most one sync per PORTFOLIO_SYNC_MIN_INTERVAL_MS, and never sooner than
  // 30 seconds after the change that asked for it. A pending sync is left alone
  // rather than pushed back by later changes: restarting the wait on every
  // price tick meant a busy market could postpone the sync indefinitely.
  const lastPortfolioSyncRef = useRef(0);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = user?.uid;
  useEffect(() => {
    if (!uid || !userData || Object.keys(prices).length === 0 || syncTimerRef.current) return;

    const wait = Math.max(30000, lastPortfolioSyncRef.current + PORTFOLIO_SYNC_MIN_INTERVAL_MS - Date.now());
    syncTimerRef.current = setTimeout(async () => {
      syncTimerRef.current = null;
      lastPortfolioSyncRef.current = Date.now();
      try {
        await syncPortfolioFunction();
      } catch (error) {
        // Silent background write. When this fails the player's portfolio value,
        // history, and achievements quietly stop updating.
        reportUnexpected(error, { where: 'syncPortfolio' });
      }
    }, wait);
  }, [uid, userData, prices]);

  // Drop a pending sync on sign-out or account switch.
  useEffect(
    () => () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    },
    [uid],
  );

  // Daily margin interest (charged at midnight or on login)
  useEffect(() => {
    if (!user || !userData || !userData.marginEnabled) return;

    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) return;

    const lastInterestCharge = userData.lastMarginInterestCharge || 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (now - lastInterestCharge >= oneDayMs) {
      chargeMarginInterestFunction({})
        .then((result) => {
          if (result.data.charged > 0) {
            console.log(`Margin interest charged: ${formatCurrency(result.data.charged)}`);
          }
        })
        .catch((err) => reportUnexpected(err, { where: 'chargeMarginInterest' }));
    }
    // Deliberately narrow deps: re-check only when the margin fields change,
    // not on every userData write (holdings, missions, etc. update constantly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userData?.marginEnabled, userData?.marginUsed, userData?.lastMarginInterestCharge]);

  // Bankruptcy notification system - remind every 5 minutes
  useEffect(() => {
    if (!user || !userData) return;

    const cash = userData.cash || 0;
    if (cash >= 0) return; // cash is fine

    const showBankruptcyReminder = () => {
      const debtAmount = Math.abs(cash);
      if (userData.isBankrupt) {
        showNotification(
          'warning',
          `You're wiped out and ${formatCurrency(debtAmount)} in debt. You can take a bailout to restart with ${formatCurrency(BAILOUT_CASH)}, but it clears your holdings and exiles you from your crew.`,
        );
      } else {
        showNotification(
          'warning',
          `You're ${formatCurrency(debtAmount)} short on cash. Sell or close a position to free up funds.`,
        );
      }
    };

    // Show immediately on login/becoming bankrupt
    showBankruptcyReminder();

    // Then every 5 minutes
    const interval = setInterval(showBankruptcyReminder, 5 * 60 * 1000);

    return () => clearInterval(interval);
    // Deliberately narrow deps: the 5-minute reminder should re-arm only when
    // cash changes, not on every userData write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userData?.cash, showNotification]);
}
