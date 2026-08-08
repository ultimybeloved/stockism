'use strict';
// Every service file index.js re-exports, in one list so index.js stays a bare
// re-exporter. serviceLoader.js walks this to find the owner of an invoked
// function; order does not matter.
//
// Adding a service: create functions/services/<domain>.js and add it here.
// INTERNAL modules (tradeGuards, limitOrderMatching, missionChecks, ...) must
// NOT be listed — they are required directly by the service that owns them, and
// listing one here would put its helpers on the deployed function surface.

module.exports = [
'./services/trading',
  './services/users',
  './services/userProfile',
  './services/leaderboard',
  './services/market',
  './services/marketOrders',
  './services/marketWeekly',
  './services/admin',
  './services/adminBackups',
  './services/adminOps',
  './services/adminUserEdit',
  './services/adminRepair',
  './services/adminMigrate',
  './services/tradeBackfill',
  './services/alerts',
  './services/discord',
  './services/discordInteractions',
  './services/discordAdmin',
  './services/dropAudit',
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
  './services/marginScanners',
  './services/crew',
  './services/portfolio',
  './services/preMarket',
  './services/marketMaker',
  './services/crewMissions',
  './services/health',
  './services/billing',
];
