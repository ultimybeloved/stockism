'use strict';
// Barrel for the shared helpers, which used to be one 2,300-line file. Each
// topic now has its own module in this folder; prefer requiring that directly in
// new code. Existing `require('../shared/helpers')` calls keep working.

const { reportError } = require('./sentry');
const { DIVIDEND_HOLD_MS } = require('./characters');

module.exports = {
  ...require('./money'),
  ...require('./roster'),
  ...require('./cohorts'),
  ...require('./tradeRecords'),
  ...require('./marketData'),
  ...require('./impact'),
  ...require('./ladderMath'),
  ...require('./equity'),
  ...require('./lmsr'),
  ...require('./notifications'),
  ...require('./usernames'),
  ...require('./accountGuards'),
  ...require('./discordApi'),
  ...require('./activity'),
  reportError,
  DIVIDEND_HOLD_MS,
};
