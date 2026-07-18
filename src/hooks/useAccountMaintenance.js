import { useEffect, useRef } from 'react';
import { claimPredictionPayoutFunction, chargeMarginInterestFunction, syncPortfolioFunction } from '../firebase';
import { formatCurrency } from '../utils/formatters';
import { BAILOUT_CASH, PORTFOLIO_SYNC_MIN_INTERVAL_MS } from '../constants';

// Background upkeep for the signed-in account: prediction payout claims,
// debounced portfolio sync, daily margin interest, and bankruptcy reminders.
export function useAccountMaintenance({ user, userData, prices, predictions, showNotification }) {
  // Auto-process payouts when prediction is resolved
  useEffect(() => {
    const processPayouts = async () => {
      if (!user || !userData || !userData.bets) return;

      for (const prediction of predictions) {
        if (!prediction.resolved || prediction.payoutsProcessed) continue;

        const userBet = userData.bets[prediction.id];
        if (!userBet || userBet.paid) continue;

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
          console.error(`[Payout] Failed to process payout for prediction ${prediction.id}:`, error);
        }
      }
    };

    processPayouts();
  }, [user, userData, predictions]);

  // Sync portfolio value, history, and achievements via Cloud Function
  // (these fields are blocked from client-side writes by security rules).
  // Debounced, with a minimum interval: the sync's own write updates userData,
  // which re-arms this effect — without the floor every active client would
  // call the backend roughly every 30 seconds for the whole session.
  const lastPortfolioSyncRef = useRef(0);
  useEffect(() => {
    if (!user || !userData || Object.keys(prices).length === 0) return;

    const timeout = setTimeout(async () => {
      if (Date.now() - lastPortfolioSyncRef.current < PORTFOLIO_SYNC_MIN_INTERVAL_MS) return;
      lastPortfolioSyncRef.current = Date.now();
      try {
        await syncPortfolioFunction();
      } catch (error) {
        console.error('[PORTFOLIO SYNC ERROR]', error);
      }
    }, 30000);

    return () => clearTimeout(timeout);
  }, [user, userData, prices]);

  // Daily margin interest (charged at midnight or on login)
  useEffect(() => {
    if (!user || !userData || !userData.marginEnabled) return;

    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) return;

    const lastInterestCharge = userData.lastMarginInterestCharge || 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (now - lastInterestCharge >= oneDayMs) {
      chargeMarginInterestFunction({}).then(result => {
        if (result.data.charged > 0) {
          console.log(`Margin interest charged: ${formatCurrency(result.data.charged)}`);
        }
      }).catch(err => console.error('Margin interest charge failed:', err));
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
        showNotification('warning', `💸 You're wiped out and ${formatCurrency(debtAmount)} in debt. You can take a bailout to restart with ${formatCurrency(BAILOUT_CASH)}, but it clears your holdings and exiles you from your crew.`);
      } else {
        showNotification('warning', `💸 You're ${formatCurrency(debtAmount)} short on cash. Sell or close a position to free up funds.`);
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
