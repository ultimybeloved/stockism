import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
// Modular import — the emulator sandbox strips admin.firestore statics.
import { Timestamp } from 'firebase-admin/firestore';
const db = admin.firestore();

/** A filled limit or pre-market order, the fields a trade record needs. */
interface FilledOrder {
  userId?: string;
  ticker?: string;
  type?: string;
  action?: string;
  filledShares?: number;
  executedPrice?: number;
  executedAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

type TradeRecordDoc = NonNullable<ReturnType<typeof buildRecord>>;

const FILLED_STATUSES = ['FILLED', 'PARTIALLY_FILLED'];
const BATCH_SIZE = 400;

// Trade records are keyed off the order they came from, so re-running this
// overwrites the same document instead of adding a duplicate. This is the whole
// safety story for the backfill — never switch these to auto-ids.
const fillRecordId = (orderId: string) => `fill_${orderId}`;

// Shapes one completed order into the same record executeTrade writes.
// cashBefore / cashAfter aren't recoverable from an order doc, so they're left
// off: Trade History and the market reports don't need them, and
// reconstructPortfolioHistory already skips records without them.
function buildRecord(orderId: string, order: FilledOrder, { action, source }: { action: string; source: string }) {
  const shares = order.filledShares || 0;
  const price = order.executedPrice || 0;
  if (!order.userId || !order.ticker || shares <= 0 || price <= 0) return null;

  return {
    uid: order.userId,
    ticker: order.ticker,
    action,
    amount: shares,
    price,
    priceImpact: 0,
    totalValue: Math.round(price * shares * 100) / 100,
    timestamp: order.executedAt || order.updatedAt || Timestamp.now(),
    ip: null,
    source,
    orderId,
    backfilled: true,
  };
}

// Orders whose fills are already recorded — either by the live fill path or by
// an earlier backfill run. Without this, pressing the button after a fill has
// been recorded live would write a second copy of the same trade.
async function alreadyRecordedOrderIds() {
  const snap = await db.collection('trades').where('source', 'in', ['limit', 'stop_loss', 'premarket']).get();

  const ids = new Set<string>();
  snap.forEach((doc) => {
    const orderId = doc.data().orderId;
    if (orderId) ids.add(orderId);
  });
  return ids;
}

async function backfillCollection(
  name: string,
  toRecord: (id: string, order: FilledOrder) => TradeRecordDoc | null,
  recorded: Set<string>,
) {
  const snap = await db.collection(name).where('status', 'in', FILLED_STATUSES).get();

  let written = 0;
  let skipped = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    if (recorded.has(doc.id)) {
      skipped++;
      continue;
    }

    const record = toRecord(doc.id, doc.data());
    if (!record) {
      skipped++;
      continue;
    }

    batch.set(db.collection('trades').doc(fillRecordId(doc.id)), record);
    written++;
    pending++;

    if (pending >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) await batch.commit();
  return { scanned: snap.size, written, skipped };
}

// Split out from the callable so the emulator test can run it directly.
export async function runFillBackfill() {
  const recorded = await alreadyRecordedOrderIds();

  const limitOrders = await backfillCollection(
    'limitOrders',
    (id, order) =>
      buildRecord(id, order, {
        action: order.type === 'BUY' ? 'buy' : 'sell',
        source: order.type === 'STOP_LOSS' ? 'stop_loss' : 'limit',
      }),
    recorded,
  );

  const preMarketOrders = await backfillCollection(
    'preMarketOrders',
    (id, order) =>
      buildRecord(id, order, {
        action: order.action === 'buy' ? 'buy' : 'sell',
        source: 'premarket',
      }),
    recorded,
  );

  console.log('[BACKFILL] limitOrders', limitOrders, 'preMarketOrders', preMarketOrders);
  return { success: true, limitOrders, preMarketOrders };
}

/**
 * Admin-only one-off: writes the trade records that limit-order, stop-loss and
 * pre-market fills never wrote. Those fills moved real money but left nothing in
 * the trades collection, so they're missing from players' own Trade History and
 * from the daily/weekly market reports.
 *
 * Safe to run more than once — records use deterministic ids.
 */
export const backfillFillTradeRecords = cf({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(
  async (_data: unknown, context) => {
    requireAdmin(context);
    return runFillBackfill();
  },
);
