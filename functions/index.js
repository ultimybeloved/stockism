'use strict';
require('./sentry');

const admin = require('firebase-admin');

admin.initializeApp();

const { botTrader } = require('./botTrader');
exports.botTrader = botTrader;

Object.assign(exports, require('./services/trading'));
Object.assign(exports, require('./services/users'));
Object.assign(exports, require('./services/leaderboard'));
Object.assign(exports, require('./services/market'));
Object.assign(exports, require('./services/marketOrders'));
Object.assign(exports, require('./services/marketWeekly'));
Object.assign(exports, require('./services/admin'));
Object.assign(exports, require('./services/adminOps'));
Object.assign(exports, require('./services/alerts'));
Object.assign(exports, require('./services/discord'));
Object.assign(exports, require('./services/discordInteractions'));
Object.assign(exports, require('./services/discordAdmin'));
Object.assign(exports, require('./services/dividends'));
Object.assign(exports, require('./services/watchlist'));
Object.assign(exports, require('./services/ladderGame'));
Object.assign(exports, require('./services/ladderTransfers'));
Object.assign(exports, require('./services/limitOrders'));
Object.assign(exports, require('./services/missions'));
Object.assign(exports, require('./services/predictions'));
Object.assign(exports, require('./services/eventMarket'));
Object.assign(exports, require('./services/archiving'));
Object.assign(exports, require('./services/margin'));
Object.assign(exports, require('./services/crew'));
Object.assign(exports, require('./services/preMarket'));
Object.assign(exports, require('./services/marketMaker'));
Object.assign(exports, require('./services/crewMissions'));
Object.assign(exports, require('./services/health'));
