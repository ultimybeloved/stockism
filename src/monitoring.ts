// Frontend error monitoring.
//
// Deliberately mirrors functions/sentry.js so both halves of the codebase report
// failures the same way:
//
//   reportError(err, { where: 'useTradeManagement.handleTrade', ticker, action });
//
// Sentry itself is initialised in main.tsx (and disabled outside production).
// This module is the one place that decides what a swallowed error does, so a
// `catch` that previously only wrote to the browser console, where nobody would
// ever read it, becomes something visible on a dashboard.
//
// Context is intentionally limited to what diagnoses the bug: what failed, and
// on which ticker/action/amount. No account IDs, emails, or display names are
// attached.

import * as Sentry from '@sentry/react';
import { isExpectedRejection } from './utils/errors';

/**
 * Report a handled error that is NOT being rethrown, so silent failures surface
 * instead of vanishing. Use at any swallow point.
 *
 * `context` is extra detail for the report, e.g. { where: 'handleBuyIPO', ticker }.
 */
export interface ErrorContext {
  where?: string;
  [key: string]: unknown;
}

const messageOf = (err: unknown): unknown => (err as { message?: string } | null)?.message || err;

export function reportError(err: unknown, context: ErrorContext = {}): void {
  const tag = context.where ? `[${context.where}] ` : '';
  try {
    console.error(`${tag}${messageOf(err)}`, context);
  } catch {
    /* noop */
  }
  try {
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), { extra: context });
  } catch {
    /* never let error reporting itself throw */
  }
}

/**
 * Report only if the failure is an actual fault. Rejections that are part of
 * normal play (not enough cash, mission unfinished, IPO sold out) still reach
 * the console but never Sentry, so the dashboard stays worth reading.
 *
 * This is the right default for anything driven by a player action. Use the
 * plain reportError above when a failure is known to be a fault regardless of
 * its code.
 */
export function reportUnexpected(err: unknown, context: ErrorContext = {}): void {
  if (isExpectedRejection(err)) {
    const tag = context.where ? `[${context.where}] ` : '';
    try {
      console.error(`${tag}${messageOf(err)}`);
    } catch {
      /* noop */
    }
    return;
  }
  reportError(err, context);
}
