// The admin history: one record per admin change to a player or the market,
// with what it was before and what it became, so a mistyped edit can be seen
// and put back by hand.
//
// Written AFTER the change lands, so the history never claims a change that
// failed. Best-effort: a logging failure is reported but never fails the
// action itself. Admin-only (adminListLog reads it; firestore.rules deny
// clients), so it may hold private fields such as Discord IDs.
//
// Money still goes in the ledger as well. The ledger answers "where did this
// balance come from"; this answers "what did the admin do, and what was there".
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import type * as functions from 'firebase-functions/v1';

export interface AdminActionInput {
  /** Machine name, e.g. 'set_cash', 'set_holding', 'ban'. */
  action: string;
  /** The player acted on, when there is one. */
  uid?: string | null;
  name?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: Record<string, unknown> | null;
}

// Firestore rejects undefined anywhere in a document; JSON drops it.
const plain = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

export const buildAdminLogEntry = (by: string | null, input: AdminActionInput) => ({
  action: input.action,
  by,
  uid: input.uid || null,
  name: input.name || null,
  before: plain(input.before),
  after: plain(input.after),
  detail: plain(input.detail ?? null),
});

export const logAdminAction = async (context: functions.https.CallableContext, input: AdminActionInput) => {
  try {
    await admin
      .firestore()
      .collection('adminLog')
      .add({ ...buildAdminLogEntry(context.auth?.uid || null, input), at: FieldValue.serverTimestamp() });
  } catch (err) {
    logger.error(`logAdminAction(${input.action}) failed:`, (err as Error).message);
  }
};
