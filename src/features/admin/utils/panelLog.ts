// Admin history entries for the tools that still write from the browser
// (price adjust, IPOs, predictions, site messages, dividend yields, account
// repair, portfolio sync). Server callables log through
// functions/src/shared/adminLog.ts; these land in the same `adminLog`
// collection, tagged source: 'panel', so the History tab shows both.
//
// Same contract as the server side: called AFTER the change lands, and
// best-effort, so a logging failure is reported but never fails the tool.
// firestore.rules lets only the admin create these, stamped with their own uid
// and the server time.
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../../firebase';
import { reportError } from '../../../monitoring';

export interface PanelActionInput {
  action: string;
  uid?: string | null;
  name?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: Record<string, unknown> | null;
}

// Firestore rejects undefined anywhere in a document; JSON drops it.
const plain = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

export const logPanelAction = async (input: PanelActionInput) => {
  try {
    await addDoc(collection(db, 'adminLog'), {
      action: input.action,
      by: auth.currentUser?.uid || null,
      uid: input.uid || null,
      name: input.name || null,
      before: plain(input.before),
      after: plain(input.after),
      detail: plain(input.detail ?? null),
      source: 'panel',
      at: serverTimestamp(),
    });
  } catch (err) {
    reportError(err, { where: `logPanelAction(${input.action})` });
  }
};
