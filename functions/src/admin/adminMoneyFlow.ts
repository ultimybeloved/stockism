// The money flow report: every cash change in the ledger, summed by type and
// UTC day. Read-only on player data.
//
// A finished day never changes, so its summary is saved once to
// `ledgerDaily/{YYYY-MM-DD}` the first time anyone asks for it and read from
// there after. That keeps the report to one read per day shown, plus today's
// entries, without a scheduled job to keep alive. Days before the ledger
// existed (2026-10-10) come back empty.
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cf, requireAdmin } from '../shared/fnConfig';
import { lastDays, rollupLedger, utcDay } from '../shared/rules/ledgerFlow';
import type { LedgerDay, LedgerFlowEntry } from '../shared/rules/ledgerFlow';

const db = admin.firestore();
const MAX_DAYS = 90;
const LEDGER_START_DAY = '2026-10-10';

const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

async function readLedgerDay(day: string): Promise<LedgerDay> {
  const start = dayStartMs(day);
  const snap = await db
    .collection('ledger')
    .where('timestamp', '>=', Timestamp.fromMillis(start))
    .where('timestamp', '<', Timestamp.fromMillis(start + 86400000))
    .select('uid', 'type', 'account', 'amount')
    .get();
  return rollupLedger(
    day,
    snap.docs.map((d) => d.data() as LedgerFlowEntry),
  );
}

/** One day's summary: saved for finished days, live for today. */
export async function ledgerDay(day: string, today = utcDay(Date.now())): Promise<LedgerDay> {
  if (day < LEDGER_START_DAY) return { day, rows: {}, players: 0 };
  if (day >= today) return readLedgerDay(day);
  const ref = db.collection('ledgerDaily').doc(day);
  const saved = await ref.get();
  if (saved.exists) return saved.data() as LedgerDay;
  const fresh = await readLedgerDay(day);
  await ref.set({ ...fresh, savedAt: Date.now() });
  return fresh;
}

/** Admin-only: the last `days` days of money flow, oldest first. */
export const adminMoneyFlow = cf({ timeoutSeconds: 120, memory: '512MB' }).https.onCall(async (data, context) => {
  requireAdmin(context);
  const requested = Math.floor(Number(data?.days));
  const days = Math.min(MAX_DAYS, Number.isFinite(requested) && requested > 0 ? requested : 14);
  const now = Date.now();
  const today = utcDay(now);
  const list = lastDays(now, days);
  // Few at a time: a first-ever load of 90 days would otherwise open 90 big queries at once.
  const out: LedgerDay[] = [];
  for (let i = 0; i < list.length; i += 6) {
    out.push(...(await Promise.all(list.slice(i, i + 6).map((d) => ledgerDay(d, today)))));
  }
  return { days: out, generatedAt: now };
});
