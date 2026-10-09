import * as logger from 'firebase-functions/logger';
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

// The loaded SDK, null when unavailable, undefined until first use.
let cached: typeof import('@sentry/node') | null | undefined;

export const getSentry = () => {
  if (cached !== undefined) return cached;
  if (!process.env.SENTRY_DSN) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily on purpose, see above
    const Sentry: typeof import('@sentry/node') = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: true });
    cached = Sentry;
  } catch (err) {
    logger.error('Sentry failed to load:', (err as Error)?.message);
    cached = null;
  }
  return cached;
};

const capture = (err: unknown, extra?: Parameters<typeof import('@sentry/node').captureException>[1]) => {
  try {
    const Sentry = getSentry();
    if (!Sentry) return;
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), extra);
  } catch (_) {
    /* never let error reporting itself throw */
  }
};

process.on('unhandledRejection', (err) => {
  capture(err);
});

/**
 * Report a handled error that we are NOT rethrowing, so silent failures still
 * surface in Sentry (and the logs) instead of vanishing. Use at any swallow point.
 * @param err - the caught error
 * @param context - extra context, e.g. { where: 'sendDiscordMessage', channelId }
 */
export function reportError(err: unknown, context: { where?: string; [key: string]: unknown } = {}) {
  const message = (err as { message?: unknown } | null)?.message;
  const tag = context.where ? `[${context.where}] ` : '';
  try {
    logger.error(`${tag}${message ? message : err}`);
  } catch (_) {
    /* noop */
  }
  capture(err, { extra: context });
}
