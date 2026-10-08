'use strict';
// Seasons and their tiers.

// ── Seasons ──────────────────────────────────────────────────────────────────
// Mirror of src/constants/seasons.js — keep both in sync. The rules these feed
// are explained at the top of functions/src/season/seasonTiers.js.
const SEASON_TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
// Platinum and Diamond are shares of the season board, handed out when the
// season ends. Fixed return targets were dropped on 2026-09-13: one hot month
// (median active player +34% while the index made +5%) can't say what a whole
// arc will look like, so any number set from it is trivial or impossible next arc.
const SEASON_PLATINUM_TOP_SHARE = 0.15;
const SEASON_DIAMOND_TOP_SHARE = 0.05;
// Diamond also needs the market beaten in this share of the season's weeks...
const SEASON_DIAMOND_BEAT_SHARE = 0.75;
// ...and no single character above this share of invested money at ANY weekly
// checkpoint. Permanent for the season on purpose: dodging it means selling down
// before every Thursday and buying back after, paying price impact both ways.
// 16 of 39 measurable active players were over 90% in one character.
const SEASON_DIAMOND_MAX_CONCENTRATION = 0.6;
// A checkpoint only counts toward that limit when at least this share of the
// player's money is invested. Someone sitting almost all in cash with one small
// position is not "all in on one character", even though that position is 100%
// of what they hold.
const SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED = 0.25;
// Bronze is earned by turning up, not by performance — see the note in
// src/constants/seasons.js for why a losing season must still pay something.
const SEASON_BRONZE_ACTIVE_WEEKS = 2;
// A season baseline below this is not a meaningful denominator; the same reason
// LEADERBOARD_PERCENT_MIN_BASELINE exists.
const SEASON_MIN_BASELINE = 1000;
// Tiers that hand out a permanent title when the season ends. The lower tiers
// still show on the card and board, they just don't pay a title: a title every
// active player owns means nothing. Pinned on each season's rules at start.
const SEASON_TITLED_TIERS = Object.freeze(['gold', 'platinum', 'diamond']);
// Size divisions, by value when a player's season baseline was pinned. Platinum
// and Diamond are ranked WITHIN a division: on 2026-09-18 the median 30-day
// return was about the same at every size (+13% to +21%), but the best Rookie
// made +2,785% and the best Titan +90%, so one shared board handed the top
// places to small accounts that can swing further. Also used by the admin return
// distribution readout. `max: null` = no upper bound (Firestore can't store Infinity).
const SEASON_DIVISIONS = Object.freeze([
  Object.freeze({ id: 'rookie', label: 'Rookie', min: 0, max: 10000 }),
  Object.freeze({ id: 'trader', label: 'Trader', min: 10000, max: 50000 }),
  Object.freeze({ id: 'whale', label: 'Whale', min: 50000, max: 200000 }),
  Object.freeze({ id: 'titan', label: 'Titan', min: 200000, max: null }),
]);

module.exports = {
  SEASON_TIER_ORDER,
  SEASON_PLATINUM_TOP_SHARE,
  SEASON_DIAMOND_TOP_SHARE,
  SEASON_DIAMOND_BEAT_SHARE,
  SEASON_DIAMOND_MAX_CONCENTRATION,
  SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED,
  SEASON_BRONZE_ACTIVE_WEEKS,
  SEASON_MIN_BASELINE,
  SEASON_TITLED_TIERS,
  SEASON_DIVISIONS,
};
