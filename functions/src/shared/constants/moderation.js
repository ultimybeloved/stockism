'use strict';
// Alt-account and coordinated-pressure detection.

// ============================================
// ALT ACCOUNT DETECTION
// ============================================
// The watchlist in watchlist.js only ever tracked accounts an admin had already
// flagged by hand, so a pair nobody suspected could trade from the same house
// for months without raising anything. These drive the scan that goes looking
// on its own (services/altDetection.js).
// ── Coordinated-pressure detection ───────────────────────────────────────────
// Alt detection answers "is this one person with many accounts". This answers a
// different question: "are several DIFFERENT people pushing the same stock the
// same way". Nothing detected that until 2026-09-19, so the only incidents that
// ever reached the admin were the ones players got loud enough about.
//
// Impact, not share count or dollars, so the thresholds mean the same thing on
// a $9 stock and a $2,000 one.
const COORD_SCAN_WINDOW_DAYS = 3; // days of trades each scan reads
const COORD_MIN_ACCOUNTS = 2; // distinct accounts pushing one way
const COORD_MIN_COMBINED_IMPACT = 0.08; // 8% of combined same-day pressure
const COORD_MIN_EACH_IMPACT = 0.01; // ignore an account that barely took part
// A cluster this tight is very unlikely to be independent. Reported separately
// because it is the strongest signal: on 2026-09-17 six accounts shorted $SHNG
// inside 21 minutes, four of them covering within four minutes of each other.
const COORD_TIGHT_WINDOW_MS = 30 * 60 * 1000;
const COORD_HIGH_COMBINED_IMPACT = 0.15; // 15%+ combined lands as high severity
// What a push made each participant is measured over this long from the
// cluster's start: the dump, the short, the cover and the buy-back all land in
// it, and a later ordinary trade does not.
const COORD_PROFIT_WINDOW_MS = 48 * 60 * 60 * 1000;
// "All in, on borrowed money": one stock is at least this share of a player's
// holdings, and they owe at least this share of their gross value, while
// buying in an upward cluster. Reported to the admin, never blocked.
const COORD_ALL_IN_SHARE = 0.6;
const COORD_ALL_IN_BORROWED = 0.25;

const ALT_SCAN_WINDOW_DAYS = 30; // how far back through trade records each scan looks
const ALT_SCAN_MAX_TRADES = 60000; // safety cap so one scan can't run away with reads
// An IPv6 address is rotated by the ISP constantly, but the first four groups
// (the /64 prefix) stay put — that prefix is the household. Collapsing to it is
// what turns "25 different addresses" into "one home connection".
const ALT_IPV6_PREFIX_GROUPS = 4;
// A network carrying more accounts than this is treated as shared infrastructure
// (school, office, mobile carrier, VPN exit) and is too weak to flag alone.
const ALT_CROWDED_NETWORK_LIMIT = 5;
// Sharing this many separate networks with someone is not a coincidence.
const ALT_SHARED_NETWORKS_HIGH = 3;
const ALT_REALERT_MS = 30 * 24 * 60 * 60 * 1000; // don't re-nag about the same pair inside a month
const ALT_STATE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // prune remembered pairs older than this
// Alt findings are circumstantial and name players who have done nothing proven,
// so they go to the admin's DMs, never to the public Discord channel. Kept in the
// environment rather than here because the repo is on GitHub and this ties a real
// Discord account to it; the scan just skips the DM if it is unset.
const ADMIN_DISCORD_USER_ID = process.env.ADMIN_DISCORD_USER_ID || '';

module.exports = {
  COORD_SCAN_WINDOW_DAYS,
  COORD_MIN_ACCOUNTS,
  COORD_MIN_COMBINED_IMPACT,
  COORD_MIN_EACH_IMPACT,
  COORD_TIGHT_WINDOW_MS,
  COORD_HIGH_COMBINED_IMPACT,
  COORD_PROFIT_WINDOW_MS,
  COORD_ALL_IN_SHARE,
  COORD_ALL_IN_BORROWED,
  ALT_SCAN_WINDOW_DAYS,
  ALT_SCAN_MAX_TRADES,
  ALT_IPV6_PREFIX_GROUPS,
  ALT_CROWDED_NETWORK_LIMIT,
  ALT_SHARED_NETWORKS_HIGH,
  ALT_REALERT_MS,
  ALT_STATE_TTL_MS,
  ADMIN_DISCORD_USER_ID,
};
