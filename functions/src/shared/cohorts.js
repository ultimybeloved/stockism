'use strict';
// Dividend / exit-loyalty lot ledger (holdingCohorts) and exit share sizes.

const { FieldValue } = require('firebase-admin/firestore');
const { DIVIDEND_HOLD_MS, DIVIDEND_MATURE_MS } = require('./characters');
const { MIN_EXIT_SHARES, EXIT_SHARE_DECIMALS } = require('./constants');

// Cohort bookkeeping helpers. `cohort = { eligible: N, pending: [{shares, availableAt}] }`
// Pending = purchase lots. A lot pays nothing until availableAt (the 10-day
// hold gate), then earns its loyalty-ladder multiplier from its age, and is
// folded into `eligible` (= fully matured, top multiplier) at 8 weeks.
// Invariant: eligible + sum(pending.shares) === holdings[ticker].
// Cohorts may carry extra fields (e.g. firstHeldAt for the Dividend Demon
// achievement) — every helper must preserve them, not rebuild bare objects.
const addPendingShares = (cohort, shares, now) => {
  const c =
    cohort && typeof cohort === 'object'
      ? { ...cohort, eligible: cohort.eligible || 0, pending: [...(cohort.pending || [])] }
      : { eligible: 0, pending: [] };
  c.pending.push({ shares, availableAt: now + DIVIDEND_HOLD_MS });
  return c;
};

// Decrement a cohort by `shares`. Consumes eligible first, then oldest pending
// (FIFO by availableAt). Returns null if the cohort is fully consumed.
const decrementCohort = (cohort, shares) => {
  if (!cohort) return null;
  let remaining = shares;
  let eligible = cohort.eligible || 0;
  const pending = [...(cohort.pending || [])];

  const takeFromEligible = Math.min(eligible, remaining);
  eligible -= takeFromEligible;
  remaining -= takeFromEligible;

  pending.sort((a, b) => (a.availableAt || 0) - (b.availableAt || 0));
  while (remaining > 0 && pending.length > 0) {
    const head = pending[0];
    if (head.shares <= remaining) {
      remaining -= head.shares;
      pending.shift();
    } else {
      head.shares -= remaining;
      remaining = 0;
    }
  }

  if (eligible === 0 && pending.length === 0) return null;
  return { ...cohort, eligible, pending };
};

// Fold fully matured pending lots (held past the top loyalty rung) into
// eligible. Lots between the hold gate and full maturity stay pending so their
// age keeps driving the ladder multiplier.
const graduateCohort = (cohort, now) => {
  if (!cohort) return { eligible: 0, pending: [] };
  let eligible = cohort.eligible || 0;
  const stillPending = [];
  for (const p of cohort.pending || []) {
    const acquiredAt = (p.availableAt || 0) - DIVIDEND_HOLD_MS;
    if (now - acquiredAt >= DIVIDEND_MATURE_MS) eligible += p.shares || 0;
    else stillPending.push(p);
  }
  return { ...cohort, eligible, pending: stillPending };
};

// ── Cohort updates for a fill ────────────────────────────────────────────────
// The two functions below are the ONLY way a fill lane should touch
// holdingCohorts. They return a field-path fragment ready to spread into the
// user-doc update, so executeTrade, limit-order fills, the pre-market auction
// and the stop-loss sweep all keep the ledger the same way.
//
// This exists because they did not. For a long time only executeTrade
// maintained the ledger, so every other lane left it describing a position the
// player no longer had (or did not yet have). Two things went wrong with that:
// a sold-through-a-limit-order position kept its matured lots, handing the next
// sell an exit-loyalty discount it had not earned, and a bought-through-a-limit
// -order position had no lot at all, so the next dividend run opened a fresh
// one and silently restarted the holder's 10-day clock.
//
// If you add a lane that changes holdings[ticker], it calls one of these.

// Shares ENTERING a position. `isETF` preserves the Dividend Demon clock.
const cohortAddUpdate = (userData, ticker, shares, now, isETF = false) => {
  const existing = userData?.holdingCohorts?.[ticker] || null;
  const next = addPendingShares(existing, shares, now);
  if (isETF) next.firstHeldAt = existing?.firstHeldAt || now;
  return { [`holdingCohorts.${ticker}`]: next };
};

// Shares LEAVING a position. The ledger is deleted outright when the position
// closes, so a later re-buy starts a clean clock instead of inheriting the old
// position's loyalty standing.
const cohortRemoveUpdate = (userData, ticker, shares) => {
  const next = decrementCohort(userData?.holdingCohorts?.[ticker] || null, shares);
  return { [`holdingCohorts.${ticker}`]: next || FieldValue.delete() };
};

// ── Exit share sizes ─────────────────────────────────────────────────────────
// Holdings pick up fractional remainders from dividends, partial fills and ETF
// math, so a sell has to be able to name six decimals or the last speck of a
// position becomes unsellable. Every exit lane (executeTrade, limit orders, the
// stop-loss sweep, the opening auction) goes through these two so they can't
// drift apart again: the auction and the sweep were still rounding to two and
// four decimals and refusing anything under 0.01 shares long after the instant
// sell path had been fixed.
const EXIT_SHARE_STEP = 10 ** EXIT_SHARE_DECIMALS;

// Clamp a fill size to the exit grid. Floors rather than rounds, so a fill can
// never be for more shares than the player actually holds.
//
// The slack is not optional. In binary floating point 8.29 * 1e6 is
// 8289999.999999999, and a plain floor would shave a millionth of a share off
// every number like it — leaving behind exactly the unsellable speck this whole
// grid exists to prevent. A ten-thousandth of a step is far below any real share
// quantity (one step is a whole unit here) and comfortably above the noise.
const EXIT_SHARE_EPSILON = 1e-4;
const floorExitShares = (n) => Math.floor((n || 0) * EXIT_SHARE_STEP + EXIT_SHARE_EPSILON) / EXIT_SHARE_STEP;

// What is left of a position after selling `sold` of it. Anything under the
// minimum sellable size is dropped rather than parked as a speck the player can
// never clear, so callers can treat 0 as "position closed".
const remainingShares = (held, sold) => {
  const left = Math.round(((held || 0) - (sold || 0)) * EXIT_SHARE_STEP) / EXIT_SHARE_STEP;
  return left < MIN_EXIT_SHARES ? 0 : left;
};

const lockedShares = (userData, ticker, now = Date.now()) => {
  const ipo = userData?.ipoLockup?.[ticker];
  const margin = userData?.marginLockup?.[ticker];
  const ipoN = ipo && now < (ipo.until || 0) ? ipo.shares || 0 : 0;
  const marginN = margin && now < (margin.until || 0) ? margin.shares || 0 : 0;
  return { ipo: ipoN, margin: marginN, total: ipoN + marginN };
};

module.exports = {
  addPendingShares,
  decrementCohort,
  graduateCohort,
  cohortAddUpdate,
  cohortRemoveUpdate,
  floorExitShares,
  remainingShares,
  lockedShares,
};
