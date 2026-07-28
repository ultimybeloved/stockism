'use strict';
require('./sentry');

require('firebase-admin').initializeApp();

// Registers only exports Firebase would actually deploy - see registerService.js.
const registerService = require('./registerService')(exports);

exports.botTrader = require('./botTrader').botTrader;

registerService(require('./services/trading'));
registerService(require('./services/users'));
registerService(require('./services/leaderboard'));
registerService(require('./services/market'));
registerService(require('./services/marketOrders'));
registerService(require('./services/marketWeekly'));
registerService(require('./services/admin'));
registerService(require('./services/adminOps'));
registerService(require('./services/tradeBackfill'));
registerService(require('./services/alerts'));
registerService(require('./services/discord'));
registerService(require('./services/discordInteractions'));
registerService(require('./services/discordAdmin'));
registerService(require('./services/dividends'));
registerService(require('./services/watchlist'));
registerService(require('./services/ladderGame'));
registerService(require('./services/ladderTransfers'));
registerService(require('./services/limitOrders'));
registerService(require('./services/missions'));
registerService(require('./services/predictions'));
registerService(require('./services/eventMarket'));
registerService(require('./services/archiving'));
registerService(require('./services/margin'));
registerService(require('./services/crew'));
registerService(require('./services/portfolio'));
registerService(require('./services/preMarket'));
registerService(require('./services/marketMaker'));
registerService(require('./services/crewMissions'));
registerService(require('./services/health'));
registerService(require('./services/billing'));
