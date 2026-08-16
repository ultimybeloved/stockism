// Firebase callable errors, classified in one place so every caller reacts to
// the same failure the same way. Pure functions only.
//
// Callable errors carry a code like 'functions/resource-exhausted'. The original
// version of this logic (inline in useTradeManagement) matched only on message
// text, so anything the backend didn't phrase exactly as expected fell through
// and the player saw a raw gRPC string. Both code and message are checked here.

/** 'functions/resource-exhausted' → 'resource-exhausted'; '' when there is no code. */
export const callableErrorCode = (error) =>
  String(error?.code || '').replace(/^functions\//, '').toLowerCase();

const messageOf = (error) => String(error?.message || '');

/**
 * Transaction contention: another write touched the same documents at the same
 * moment. Nothing is broken and the identical request is worth retrying.
 */
export const isContentionError = (error) => {
  if (callableErrorCode(error) === 'aborted') return true;
  const msg = messageOf(error);
  return msg.includes('busy') || msg.includes('try again') || msg.includes('contention');
};

/**
 * Out of capacity rather than broken: the MAX_FN_INSTANCES cap was hit. Retrying
 * immediately just hits the same wall, so callers should ask the player to wait
 * instead of retrying on their behalf.
 */
export const isCapacityError = (error) =>
  callableErrorCode(error) === 'resource-exhausted' ||
  messageOf(error).includes('RESOURCE_EXHAUSTED');

// Callable codes the backend uses to mean "you cannot do that": insufficient
// cash, mission not finished, IPO sold out, trade cooldown still running. These
// are ordinary gameplay, not faults, and reporting them would bury the real
// failures under thousands of routine rejections.
//
// 'aborted' is here because contention is expected under load and is retried;
// a retry that ALSO fails is reported explicitly by the caller.
const EXPECTED_REJECTION_CODES = [
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'already-exists',
  'out-of-range',
  'unauthenticated',
  'cancelled',
  'aborted',
];

/**
 * True when the backend deliberately refused the request as part of normal play.
 *
 * Anything else is worth reporting, including an error with no callable code at
 * all: that means a plain JavaScript exception got this far, which is always a
 * bug rather than a rule being enforced.
 *
 * Deliberately NOT treated as expected:
 *   permission-denied  — a logged-in player should never hit this, so it means
 *                        rules or App Check are misconfigured
 *   resource-exhausted — capacity, which is exactly what needs to be visible
 *   internal / unknown / unavailable / deadline-exceeded / data-loss
 */
export const isExpectedRejection = (error) =>
  EXPECTED_REJECTION_CODES.includes(callableErrorCode(error));

/**
 * A failure on the infrastructure side. The raw message means nothing to a
 * player, so callers substitute their own wording.
 */
export const isInfraError = (error) => {
  const code = callableErrorCode(error);
  if (['internal', 'deadline-exceeded', 'unavailable', 'permission-denied'].includes(code)) {
    return true;
  }
  const msg = messageOf(error);
  return msg.includes('INTERNAL') || msg.includes('DEADLINE_EXCEEDED') ||
         msg.includes('UNAVAILABLE') || msg.includes('PERMISSION_DENIED');
};
