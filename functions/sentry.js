'use strict';

const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN });
process.on('unhandledRejection', (err) => { Sentry.captureException(err); });

/**
 * Report a handled error that we are NOT rethrowing, so silent failures still
 * surface in Sentry (and the logs) instead of vanishing. Use at any swallow point.
 * @param {*} err - the caught error
 * @param {object} context - extra context, e.g. { where: 'sendDiscordMessage', channelId }
 */
function reportError(err, context = {}) {
  const tag = context.where ? `[${context.where}] ` : '';
  try {
    console.error(`${tag}${err && err.message ? err.message : err}`);
  } catch (_) { /* noop */ }
  try {
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), { extra: context });
  } catch (_) { /* never let error reporting itself throw */ }
}

module.exports = { Sentry, reportError };
