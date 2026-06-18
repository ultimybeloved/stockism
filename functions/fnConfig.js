'use strict';
// Shared Cloud Function builder + guards.
//
// Every function in this codebase is created through cf() instead of `functions`
// directly, so it inherits a maxInstances cap (limits how fast cost can accrue if
// the function is flooded). Callable functions also call requireAppCheck() so only
// our real app can reach them. Both knobs live in constants.js.
const functions = require('firebase-functions');
const { MAX_FN_INSTANCES, APP_CHECK_ENFORCED } = require('./constants');

// 1st-gen function builder, pre-capped to MAX_FN_INSTANCES. Pass extra runWith
// options (e.g. timeoutSeconds, memory) and they merge on top of the cap:
//   cf().https.onCall(...)            // default cap
//   cf({ memory: '1GB' }).https...    // cap + custom memory
const cf = (opts = {}) => functions.runWith({ maxInstances: MAX_FN_INSTANCES, ...opts });

// Reject callable requests that carry no valid App Check token (i.e. did not come
// from our real app). No-op while APP_CHECK_ENFORCED is false, so it is safe to
// ship everywhere first and switch enforcement on later from a single constant.
const requireAppCheck = (context) => {
  if (!APP_CHECK_ENFORCED) return;
  if (!context.app) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This request could not be verified. Reload the page and try again.'
    );
  }
};

module.exports = { cf, requireAppCheck };
