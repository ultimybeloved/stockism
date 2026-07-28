'use strict';
require('./sentry');

require('firebase-admin').initializeApp();

exports.botTrader = require('./botTrader').botTrader;

// Loads only the service owning the invoked function - see serviceLoader.js.
require('./serviceLoader')(exports, __dirname, [
  './services/trading',
  './services/users',
  './services/leaderboard',
  './services/market',
  './services/marketOrders',
  './services/marketWeekly',
  './services/admin',
  './services/adminOps',
  './services/tradeBackfill',
  './services/alerts',
  './services/discord',
  './services/discordInteractions',
  './services/discordAdmin',
  './services/dividends',
  './services/watchlist',
  './services/ladderGame',
  './services/ladderTransfers',
  './services/limitOrders',
  './services/missions',
  './services/predictions',
  './services/eventMarket',
  './services/archiving',
  './services/margin',
  './services/crew',
  './services/portfolio',
  './services/preMarket',
  './services/marketMaker',
  './services/crewMissions',
  './services/health',
  './services/billing',
]);
