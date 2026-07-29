'use strict';
require('./sentry');

require('firebase-admin').initializeApp();

exports.botTrader = require('./botTrader').botTrader;

// Loads only the service owning the invoked function - see serviceLoader.js.
require('./serviceLoader')(exports, __dirname, require('./servicePaths'));
