// The ladder side game.

// ============================================
// LADDER GAME
// ============================================
export const LADDER_GAME_INITIAL_BALANCE = 500; // starting balance for new ladder game users
export const LADDER_LEADERBOARD_SIZE = 50; // rows the ladder board shows
// Ladder docs outlive deleted and banned accounts, so the board reads deeper
// than it shows and drops the ones that shouldn't hold a slot. 3x covers the
// ~35% of that collection currently orphaned.
export const LADDER_LEADERBOARD_OVERFETCH = 3;
export const LADDER_MIN_BET = 1; // ladder bets are whole dollars only; decimals are floored away (no decimals = no rounding exploit)
export const LADDER_HIGH_BET_THRESHOLD = 50; // bets at or above this count toward ADDICTED achievement
export const LADDER_ACHIEVEMENT_PROFIT = 2500; // net profit needed for COMPULSIVE_GAMBLER achievement
export const LADDER_ACHIEVEMENT_HIGH_BETS = 100; // high-bet games needed for ADDICTED achievement

// The withdrawal tax is defined in the shared rule module rules/ladder.
export {
  LADDER_WITHDRAW_PRINCIPAL_FEE_RATE,
  LADDER_WITHDRAW_RUSH_RATE,
  LADDER_WITHDRAW_PROFIT_BRACKETS,
} from '../rules/ladder';
