'use strict';
// Copies a service module's Cloud Functions onto index.js's exports.
//
// Why this exists instead of Object.assign:
//
// Service files sometimes export an internal helper so a sibling service or an
// emulator test can drive it - runLimitOrderCheck, runFillBackfill,
// runMarketOpenProcessing and trackWatchedIpTrade are all exported for exactly
// that reason. A plain Object.assign copied those into index.js's exports,
// where they looked like deployable Cloud Functions.
//
// Firebase never actually deployed them (it only deploys exports carrying a
// trigger), so this was cosmetic rather than broken. But it made index.js a
// misleading picture of the deployed surface, and it let a plain constant
// (CREW_MISSION_REWARDS) sit in the function list unnoticed. Filtering here
// means index.js always reflects what really ships.
//
// A genuinely shared helper belongs in helpers.js or an internal module that
// index.js does not require - not exported from a service file.
//
// Guarded by `npm run check:functions`.
// Curried so index.js can bind its exports object once:
//   const registerService = require('./registerService')(exports);
module.exports = (target) => (serviceModule) => {
  for (const [name, value] of Object.entries(serviceModule)) {
    const deployable = typeof value === 'function'
      && (value.__endpoint !== undefined || value.__trigger !== undefined);
    if (deployable) target[name] = value;
  }
};
