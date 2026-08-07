import { CHARACTERS } from '../../characters';

// Pure input handling for the admin IPO form. Split out of useAdminIpo when it
// hit its 200-line limit — none of this touches React or Firestore, so it also
// stops the create handler from being half validation.

// <input type="datetime-local"> takes local time as "YYYY-MM-DDTHH:mm".
export const toLocalInputValue = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// A start time this far in the past still creates (starting immediately),
// covering the gap between clicking the "Now" preset and clicking Create.
export const START_TIME_PAST_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Validate a draft IPO. Returns { error } with a message to show the admin, or
 * { character, ipoStartsAt } ready to write.
 */
export const validateIpoDraft = ({ ipoTicker, ipoStartAtInput, activeIPOs, now }) => {
  if (!ipoTicker) return { error: 'Please select a character' };

  const character = CHARACTERS.find(c => c.ticker === ipoTicker);
  if (!character) return { error: 'Character not found' };

  // One live IPO per ticker.
  if (activeIPOs.some(ipo => ipo.ticker === ipoTicker && !ipo.priceJumped)) {
    return { error: 'An IPO already exists for this character' };
  }

  const startDate = new Date(ipoStartAtInput);
  if (!ipoStartAtInput || isNaN(startDate.getTime())) {
    return { error: 'Pick a valid start date and time' };
  }

  let ipoStartsAt = startDate.getTime();
  if (ipoStartsAt <= now) {
    if (now - ipoStartsAt > START_TIME_PAST_TOLERANCE_MS) {
      return { error: 'Start time is in the past' };
    }
    ipoStartsAt = now; // "Now" preset: start immediately
  }

  return { character, ipoStartsAt };
};
