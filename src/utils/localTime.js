// Times shown in the viewer's own time zone.
//
// The game runs on UTC — the Thursday halt, pre-market, the daily reset — and
// that never changes. This file only changes how those moments are SHOWN: the
// browser knows the player's zone, so "21:00 UTC" becomes "4:00 PM CDT" for one
// player and "Fri 6:00 AM JST" for another. Daylight saving is handled because
// every conversion goes through a real upcoming date, not a fixed offset.
//
// Not for text written once and read by everyone (an announcement, a Discord
// post): the writer's zone would be wrong for every reader. Discord posts use
// Discord's own <t:...> timestamps instead.

import { HALT_START_MINUTE, HALT_END_MINUTE, PRE_MARKET_START_MINUTE, PRE_MARKET_LOCK_MINUTE } from './marketHours';

const THURSDAY = 4;

/** The next moment (or today's, if still ahead) at `minuteUTC` on UTC weekday `day`. */
const nextUtcMoment = (minuteUTC, day = null, now = new Date()) => {
  const d = new Date(now);
  d.setUTCHours(Math.floor(minuteUTC / 60), minuteUTC % 60, 0, 0);
  if (day !== null) {
    while (d.getUTCDay() !== day) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
};

const timePart = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayPart = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });

/** The viewer's zone abbreviation right now, e.g. "CDT". */
export const zoneName = (d = new Date()) =>
  d.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').pop();

/** "Sep 23, 4:00 PM CDT" — any timestamp, in the viewer's zone. */
export const formatDateTime = (ms) => {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
};

/** "4:00 PM CDT" — a daily UTC time in the viewer's zone. */
export const localDailyTime = (minuteUTC) => {
  const d = nextUtcMoment(minuteUTC);
  return `${timePart(d)} ${zoneName(d)}`;
};

/** "Thu 4:00 PM CDT" — a weekly UTC time (default Thursday) in the viewer's zone. */
export const localWeeklyTime = (minuteUTC, day = THURSDAY) => {
  const d = nextUtcMoment(minuteUTC, day);
  return `${dayPart(d)} ${timePart(d)} ${zoneName(d)}`;
};

/**
 * "Thu 8:00 AM–4:00 PM CDT", or "Thu 10:00 PM – Fri 6:00 AM JST" when the
 * window crosses midnight for the viewer.
 */
export const localWeeklyRange = (startMinuteUTC, endMinuteUTC, day = THURSDAY) => {
  const a = nextUtcMoment(startMinuteUTC, day);
  const b = new Date(a.getTime() + (endMinuteUTC - startMinuteUTC) * 60000);
  const sameDay = a.toDateString() === b.toDateString();
  return sameDay
    ? `${dayPart(a)} ${timePart(a)}–${timePart(b)} ${zoneName(b)}`
    : `${dayPart(a)} ${timePart(a)} – ${dayPart(b)} ${timePart(b)} ${zoneName(b)}`;
};

/** The weekly market schedule, in the viewer's zone. Call at render time. */
export const marketTimes = () => ({
  halt: localWeeklyRange(HALT_START_MINUTE, HALT_END_MINUTE),
  preMarket: localWeeklyRange(PRE_MARKET_START_MINUTE, PRE_MARKET_LOCK_MINUTE),
  reopen: localWeeklyTime(HALT_END_MINUTE),
  preMarketOpens: localWeeklyTime(PRE_MARKET_START_MINUTE),
  reopenTime: localDailyTime(HALT_END_MINUTE),
  preMarketTime: localDailyTime(PRE_MARKET_START_MINUTE),
});
