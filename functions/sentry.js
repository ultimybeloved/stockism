'use strict';
// Error monitoring.
//
// @sentry/node is by far the most expensive thing this backend loads (~700ms of
// a ~1.4s cold start), and it does nothing at all unless something fails. So it
// is pulled in on first use instead of at startup: cold starts pay nothing for
// it, and the cost only lands on a request that was already going wrong.
//
// Crash coverage is unchanged. The unhandledRejection hook below is registered
// eagerly - registering a listener is free - and loads Sentry only if it fires.
// If SENTRY_DSN is unset the SDK is never loaded at all, since captureException
// would have been a no-op anyway.

let cached;

const getSentry = () => {
  if (cached !== undefined) return cached;
  if (!process.env.SENTRY_DSN) {
    cached = null;
    return cached;
  }
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: true });
    cached = Sentry;
  } catch (err) {
    console.error('Sentry failed to load:', err && err.message);
    cached = null;
  }
  return cached;
};

const capture = (err, extra) => {
  try {
    const Sentry = getSentry();
    if (!Sentry) return;
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), extra);
  } catch (_) { /* never let error reporting itself throw */ }
};

process.on('unhandledRejection', (err) => { capture(err); });

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
  capture(err, { extra: context });
}

module.exports = { reportError, getSentry };
