'use strict';

const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN });
process.on('unhandledRejection', (err) => { Sentry.captureException(err); });
