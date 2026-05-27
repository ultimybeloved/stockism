'use strict';
const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN });
process.on('unhandledRejection', (err) => { Sentry.captureException(err); });

const admin = require('firebase-admin');
const { botTrader } = require('./botTrader');

admin.initializeApp();

exports.botTrader = botTrader;

Object.assign(exports, require('./services/trading'));
Object.assign(exports, require('./services/users'));
Object.assign(exports, require('./services/leaderboard'));
Object.assign(exports, require('./services/market'));
Object.assign(exports, require('./services/admin'));
Object.assign(exports, require('./services/adminOps'));
Object.assign(exports, require('./services/alerts'));
Object.assign(exports, require('./services/discord'));
Object.assign(exports, require('./services/dividends'));
Object.assign(exports, require('./services/watchlist'));
Object.assign(exports, require('./services/ladderGame'));
Object.assign(exports, require('./services/limitOrders'));
Object.assign(exports, require('./services/missions'));
Object.assign(exports, require('./services/predictions'));
Object.assign(exports, require('./services/archiving'));
Object.assign(exports, require('./services/margin'));
Object.assign(exports, require('./services/crew'));
Object.assign(exports, require('./services/preMarket'));
