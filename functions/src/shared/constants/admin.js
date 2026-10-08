'use strict';
// Admin identity and admin tool limits.

// How many players the leaderboard backups keep, richest first.
const BACKUP_TOP_USERS = 100;

// ============================================
// ADMIN OPS
// ============================================
const REINSTATE_CASH_DEFAULT = 1000; // cash given when admin reinstates a bankrupt user

// ============================================
// MISSION REWARDS
// ============================================
// Daily/weekly mission payouts live on the mission definitions in crews.js
// (claimMissionReward reads them off the assigned mission). Crew mission
// values are re-exported from crews.js below so services keep importing
// everything from this hub.

// ============================================
// ADMIN
// ============================================
// Set via functions/.env in production; fallback for local dev only.
// This is the admin account's Firebase UID — every admin-only function checks against it.
const ADMIN_UID = process.env.ADMIN_UID || '4usiVxPmHLhmitEKH2HfCpbx4Yi1';

// Why an admin moved someone's cash. Recorded on every adjustment in
// `adminCashLog`, because "why is this player holding $50k" is unanswerable a
// month later otherwise.
const ADMIN_MEMO_MAX_LENGTH = 200;

// How many cash-log rows the admin panel pulls in one go. The panel filters the
// page it already has rather than re-querying, so this is also the size of the
// window the "given away" total is calculated over.
const ADMIN_CASH_LOG_PAGE_MAX = 200;

module.exports = {
  BACKUP_TOP_USERS,
  REINSTATE_CASH_DEFAULT,
  ADMIN_UID,
  ADMIN_MEMO_MAX_LENGTH,
  ADMIN_CASH_LOG_PAGE_MAX,
};
