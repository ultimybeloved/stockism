// How far a player is toward the achievements that are a simple count. Only
// counters already on the user doc are used, so progress costs no extra reads.
// Targets must match the server checks (functions/src/users/portfolio.ts,
// predictions, missions, tradeEffects); achievementProgress.test.ts pins them.
import type { UserData } from '../../../types';

export interface AchievementProgress {
  current: number;
  target: number;
  money?: boolean;
}

type Counter = { read: (u: UserData) => number; money?: boolean };

const trades: Counter = { read: (u) => u.totalTrades || 0 };
const checkins: Counter = { read: (u) => u.totalCheckins || 0 };
const missions: Counter = { read: (u) => u.totalMissionsCompleted || 0 };
const wins: Counter = { read: (u) => u.predictionWins || 0 };
// Same net worth the server checks: portfolio value minus margin borrowed.
const worth: Counter = { read: (u) => (u.portfolioValue || 0) - (u.marginUsed || 0), money: true };
const npc: Counter = { read: (u) => u.npcProfit || 0, money: true };
const holdings: Counter = { read: (u) => Object.values(u.holdings || {}).filter((s) => s > 0).length };

const TARGETS: Record<string, [Counter, number]> = {
  TRADER_20: [trades, 20],
  TRADER_100: [trades, 100],
  DIVERSIFIED: [holdings, 5],
  NPC_LOVER: [npc, 1000],
  BROKE_2K: [worth, 2500],
  BROKE_5K: [worth, 5000],
  BROKE_10K: [worth, 10000],
  BROKE_25K: [worth, 25000],
  BROKE_50K: [worth, 50000],
  BROKE_100K: [worth, 100000],
  BROKE_250K: [worth, 250000],
  BROKE_500K: [worth, 500000],
  BROKE_1M: [worth, 1000000],
  ORACLE: [wins, 3],
  PROPHET: [wins, 10],
  DEDICATED_7: [checkins, 7],
  DEDICATED_14: [checkins, 14],
  DEDICATED_30: [checkins, 30],
  DEDICATED_100: [checkins, 100],
  MISSION_10: [missions, 10],
  MISSION_50: [missions, 50],
  MISSION_100: [missions, 100],
};

/** Progress toward a locked counted achievement, or null if it isn't a count. */
export const achievementProgress = (id: string, user: UserData | null | undefined): AchievementProgress | null => {
  const entry = TARGETS[id];
  if (!entry || !user) return null;
  const [counter, target] = entry;
  return { current: Math.max(0, Math.min(counter.read(user), target)), target, money: counter.money };
};
