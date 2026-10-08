// The weekly Thursday halt and the pre-market window inside it.

// ============================================
// WEEKLY TRADING HALT (Thursday 13:00–21:00 UTC)
// ============================================
export const WEEKLY_HALT_WEEKDAY = 4; // Thursday (Date#getUTCDay)
export const WEEKLY_HALT_START_MINUTE = 780; // 13 * 60
export const WEEKLY_HALT_END_MINUTE = 1260; // 21 * 60
export const PRE_MARKET_START_MINUTE = 1230; // 20:30 UTC
export const PRE_MARKET_LOCK_MINUTE = 1255; // 20:55 UTC — no placements or cancellations after this; auction settles 20:56
// Where a chapter review's price history is folded down to a single point, and
// what that point is stamped with. Every stock gets the SAME instant so the
// review reads as one event instead of bursts of activity at whatever times the
// adjustments happened to be made. Must sit before the 20:55 lock and the 20:56
// auction, or the review would appear to land after fills priced off it.
export const REVIEW_COLLAPSE_MINUTE = 1254; // 20:54 UTC
// Max-buy headroom for pre-market orders: opening ask can sit up to ~5%
// (auction impact cap) + spread above the queue-time price, so placement
// validates against price * this buffer. Keep in sync with src/constants/economy.ts.
export const PRE_MARKET_MAX_BUY_BUFFER = 1.06;
// A single ticker's total short value (existing + new) can't exceed this
// fraction of portfolio equity.
export const SHORT_CONCENTRATION_CAP = 0.5;

export const isWeeklyTradingHalt = () => {
  const now = new Date();
  if (now.getUTCDay() !== WEEKLY_HALT_WEEKDAY) return false;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= WEEKLY_HALT_START_MINUTE && utcMins < WEEKLY_HALT_END_MINUTE;
};

// ── Telling players WHEN ─────────────────────────────────────────────────────
// The server doesn't know a player's time zone, so anything it says about time
// is either a countdown ("in 3h 12m", right everywhere) or, on Discord, a
// <t:...> tag Discord shows in each reader's own zone. Never a bare "21:00
// UTC". The site shows the same moments in local time (src/utils/localTime.ts).

/** ms until the next Thursday (or `weekday`) at `minuteUTC`. */
export const msUntilWeekly = (minuteUTC: number, weekday = WEEKLY_HALT_WEEKDAY, now = Date.now()) => {
  const d = new Date(now);
  d.setUTCHours(Math.floor(minuteUTC / 60), minuteUTC % 60, 0, 0);
  while (d.getUTCDay() !== weekday || d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime() - now;
};

/** "3h 12m", "45m", "2d 4h". */
export const formatWait = (ms: number) => {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  return h ? `${h}h ${m}m` : `${m}m`;
};

/** A Discord timestamp tag: each reader sees it in their own zone. Styles: t f F R. */
export const discordTime = (ms: number, style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

// Shared by every side-game that closes with the market (event shares, weekly
// bets, IPO shares). One message so the halt never explains itself two ways.
export const chapterReviewHaltMsg = () =>
  `Market closed for chapter review. Trading resumes in ${formatWait(msUntilWeekly(WEEKLY_HALT_END_MINUTE))}.`;
