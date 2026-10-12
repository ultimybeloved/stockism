// Admin: cancel a weekly prediction and refund every stake.
//
// This used to run in the admin's browser, writing each bettor's cash directly:
// no ledger entry, no record, and a refund that missed predictionFlowUpdate, so
// the stake a bet had taken out of season returns never came back. Event
// (long-term) markets have their own server cancel, cancelEventMarket.
import * as functions from 'firebase-functions/v1';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();
import { predictionFlowUpdate } from '../shared/equity';
import { writeNotification } from '../shared/notifications';
import { recordLedger } from '../shared/ledger';
import { logAdminAction } from '../shared/adminLog';

export const adminCancelPrediction = cf({ timeoutSeconds: 300 }).https.onCall(
  async (data: { predictionId?: unknown } | null, context) => {
    requireAdmin(context);
    const predictionId = data?.predictionId;
    if (!predictionId || typeof predictionId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'predictionId required');
    }

    // 1. Mark it cancelled first. placeBet and claimPredictionPayout read this
    // doc inside their own transactions, so no stake can land after this point.
    const predictionsRef = db.collection('predictions').doc('current');
    const label = await db.runTransaction(async (tx) => {
      const snap = await tx.get(predictionsRef);
      const list = (snap.data()?.list || []) as Record<string, unknown>[];
      const idx = list.findIndex((p) => p.id === predictionId);
      if (idx === -1) throw new functions.https.HttpsError('not-found', 'Prediction not found');
      const prediction = list[idx]!;
      if (prediction.type === 'event') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Event markets are cancelled with cancelEventMarket',
        );
      }
      if (!prediction.cancelled) {
        list[idx] = { ...prediction, cancelled: true, cancelledAt: Date.now() };
        tx.update(predictionsRef, { list });
      }
      return String(prediction.question || prediction.title || 'a prediction');
    });

    // 2. Refund every stake not yet paid out, one transaction per player so a
    // retry never pays twice (the paid flag is re-read each time).
    const bettors = await db.collection('users').where(`bets.${predictionId}.amount`, '>', 0).get();
    let refunded = 0;
    let total = 0;
    for (const doc of bettors.docs) {
      try {
        const amount = await db.runTransaction(async (tx) => {
          const snap = await tx.get(doc.ref);
          const user = snap.data() || {};
          const bet = user.bets?.[predictionId];
          const stake = Number(bet?.amount) || 0;
          if (!bet || bet.paid || stake <= 0) return 0;
          const cashAfter = (user.cash || 0) + stake;
          tx.update(doc.ref, {
            cash: cashAfter,
            ...predictionFlowUpdate(stake),
            [`bets.${predictionId}.paid`]: true,
            [`bets.${predictionId}.payout`]: stake,
            [`bets.${predictionId}.refunded`]: true,
          });
          recordLedger(tx, { uid: doc.id, type: 'prediction_refund', amount: stake, cashAfter, ref: predictionId });
          return stake;
        });
        if (amount > 0) {
          refunded++;
          total += amount;
          await writeNotification(doc.id, {
            type: 'system',
            title: 'Prediction cancelled',
            message: `"${label}" was cancelled. Your $${amount.toLocaleString('en-US')} stake was refunded.`,
            data: { predictionId },
          }).catch(() => {});
        }
      } catch (err) {
        logger.error(`adminCancelPrediction: refund failed for ${doc.id}:`, (err as Error).message);
      }
    }

    await logAdminAction(context, {
      action: 'cancel_prediction',
      detail: { predictionId, question: label, refunded, total },
    });
    logger.info(`PREDICTION CANCELLED: ${predictionId}, ${refunded} refunded ($${total})`);
    return { success: true, refunded, total };
  },
);
