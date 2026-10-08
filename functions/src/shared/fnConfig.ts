// Shared Cloud Function builder + guards.
//
// Every function in this codebase is created through cf() instead of `functions`
// directly, so it inherits a maxInstances cap (limits how fast cost can accrue if
// the function is flooded). Callable functions also call requireAppCheck() so only
// our real app can reach them. Both knobs live in constants.js.
import * as functions from 'firebase-functions';
import { MAX_FN_INSTANCES, APP_CHECK_ENFORCED, ADMIN_UID } from './constants';

// 1st-gen function builder, pre-capped to MAX_FN_INSTANCES. Pass extra runWith
// options (e.g. timeoutSeconds, memory) and they merge on top of the cap:
//   cf().https.onCall(...)            // default cap
//   cf({ memory: '1GB' }).https...    // cap + custom memory
export const cf = (opts: functions.RuntimeOptions = {}) =>
  functions.runWith({ maxInstances: MAX_FN_INSTANCES, ...opts });

// Reject callable requests that carry no valid App Check token (i.e. did not come
// from our real app). No-op while APP_CHECK_ENFORCED is false, so it is safe to
// ship everywhere first and switch enforcement on later from a single constant.
//
// The emulator suites call these functions directly with a hand-built context
// that has no App Check token, so enforcement has to stand down there or every
// test fails the moment the flag is turned on. FIRESTORE_EMULATOR_HOST is only
// ever set when running against the local emulators, never in production, and
// this mirrors what src/firebase.js already does on the frontend.
export const requireAppCheck = (context: functions.https.CallableContext) => {
  if (!APP_CHECK_ENFORCED) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) return;
  if (!context.app) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This request could not be verified. Reload the page and try again.',
    );
  }
};

// Admin-only callables: App Check, then the caller must be the admin account.
// The message is what a non-admin caller sees; some older functions word it
// their own way, so it can be passed in.
export const requireAdmin = (context: functions.https.CallableContext, message = 'Admin only') => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', message);
  }
};
