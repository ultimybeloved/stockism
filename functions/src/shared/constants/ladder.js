'use strict';
// The ladder side game.

// ============================================
// LADDER GAME
// ============================================
const LADDER_GAME_INITIAL_BALANCE = 500; // starting balance for new ladder game users
const LADDER_LEADERBOARD_SIZE = 50; // rows the ladder board shows
// Ladder docs outlive deleted and banned accounts, so the board reads deeper
// than it shows and drops the ones that shouldn't hold a slot. 3x covers the
// ~35% of that collection currently orphaned.
const LADDER_LEADERBOARD_OVERFETCH = 3;
const LADDER_MIN_BET = 1; // ladder bets are whole dollars only; decimals are floored away (no decimals = no rounding exploit)
const LADDER_HIGH_BET_THRESHOLD = 50; // bets at or above this count toward ADDICTED achievement
const LADDER_ACHIEVEMENT_PROFIT = 2500; // net profit needed for COMPULSIVE_GAMBLER achievement
const LADDER_ACHIEVEMENT_HIGH_BETS = 100; // high-bet games needed for ADDICTED achievement

// Withdrawal tax — keep in sync with src/constants/economy.js
const LADDER_WITHDRAW_PRINCIPAL_FEE_RATE = 0.05; // flat 5% on the portion that is deposited principal coming back
const LADDER_WITHDRAW_RUSH_RATE = 0.15; // +15% of the whole withdrawal if any deposit landed within LADDER_DEPOSIT_WINDOW_MS
// Lifetime-progressive brackets over cumulative profit withdrawn (not per-withdrawal,
// so splitting withdrawals can't dodge a bracket). upTo = upper bound of cumulative
// profit withdrawn that the rate applies to.
const LADDER_WITHDRAW_PROFIT_BRACKETS = [
  { upTo: 1000, rate: 0.15 },
  { upTo: 5000, rate: 0.3 },
  { upTo: Infinity, rate: 0.45 },
];

module.exports = {
  LADDER_GAME_INITIAL_BALANCE,
  LADDER_LEADERBOARD_SIZE,
  LADDER_LEADERBOARD_OVERFETCH,
  LADDER_MIN_BET,
  LADDER_HIGH_BET_THRESHOLD,
  LADDER_ACHIEVEMENT_PROFIT,
  LADDER_ACHIEVEMENT_HIGH_BETS,
  LADDER_WITHDRAW_PRINCIPAL_FEE_RATE,
  LADDER_WITHDRAW_RUSH_RATE,
  LADDER_WITHDRAW_PROFIT_BRACKETS,
};
