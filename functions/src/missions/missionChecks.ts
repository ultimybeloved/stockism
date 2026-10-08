// Server-side mission completion verification.
//
// Internal module — NOT exported through functions/src/index.js. Required by
// missions.js (to gate reward claims) and discordCommands.js (to show progress
// in /missions). It lives here rather than inside missions.js so the Discord bot
// can read completion state without a second, drifting copy of the rules.
//
// Each check takes (progress, userData, prices) and returns a boolean.

import { CREW_MEMBERS } from '../shared/constants';
import { DAILY_MISSIONS, WEEKLY_MISSIONS } from '../shared/crews';
import type { UserData } from '../shared/types';

/** users/{uid}.dailyMissions[date]: what the player did that day. */
export interface DailyProgress {
  boughtCrewMember?: boolean;
  tradesCount?: number;
  boughtAny?: boolean;
  soldAny?: boolean;
  tradeVolume?: number;
  boughtRival?: boolean;
  boughtUnderdog?: boolean;
  crewSharesBought?: number;
}

/** users/{uid}.weeklyMissions[weekId]: the week so far. */
export interface WeeklyProgress {
  tradeValue?: number;
  tradeVolume?: number;
  tradeCount?: number;
  tradingDays?: Record<string, boolean>;
  checkinDays?: Record<string, boolean>;
  startPortfolioValue?: number;
  startGrantedValue?: number;
}

// A mission's target. A mission with none can never be met (x >= undefined was false before).
const req = (mission: { requirement?: number } | undefined) => mission?.requirement ?? Infinity;

type MissionCheck<P> = (progress: P, userData: UserData, prices?: Record<string, number> | null) => boolean;

export const DAILY_MISSION_CHECKS: Record<string, MissionCheck<DailyProgress>> = {
  // Action-based: require something the player did today.
  BUY_CREW_MEMBER: (dp) => !!dp.boughtCrewMember,
  MAKE_TRADES: (dp) => (dp.tradesCount || 0) >= 5,
  BUY_ANY_STOCK: (dp) => !!dp.boughtAny,
  SELL_ANY_STOCK: (dp) => !!dp.soldAny,
  TRADE_VOLUME: (dp) => (dp.tradeVolume || 0) >= req(DAILY_MISSIONS.TRADE_VOLUME),
  RIVAL_TRADER: (dp) => !!dp.boughtRival,
  UNDERDOG_INVESTOR: (dp) => !!dp.boughtUnderdog,
  CREW_ACCUMULATOR: (dp) => (dp.crewSharesBought || 0) >= 20,
  // Composition-based: a percentage you actively maintain (fair across sizes).
  CREW_MAJORITY: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const holdings = userData.holdings || {};
    const total = Object.values(holdings).reduce((s, v) => s + v, 0);
    if (total <= 0) return false;
    const crewShares = CREW_MEMBERS[crew]!.reduce((s, t) => s + (holdings[t] || 0), 0);
    return (crewShares / total) * 100 >= 50;
  },
};

export const WEEKLY_MISSION_CHECKS: Record<string, MissionCheck<WeeklyProgress>> = {
  // Activity-based: a week's worth of trading / consistency.
  MARKET_WHALE: (wp) => (wp.tradeValue || 0) >= req(WEEKLY_MISSIONS.MARKET_WHALE),
  VOLUME_KING: (wp) => (wp.tradeVolume || 0) >= req(WEEKLY_MISSIONS.VOLUME_KING),
  TRADING_MACHINE: (wp) => (wp.tradeCount || 0) >= req(WEEKLY_MISSIONS.TRADING_MACHINE),
  SHARE_MOGUL: (wp) => (wp.tradeVolume || 0) >= req(WEEKLY_MISSIONS.SHARE_MOGUL),
  TRADE_MASTER: (wp) => (wp.tradeCount || 0) >= req(WEEKLY_MISSIONS.TRADE_MASTER),
  TRADING_STREAK: (wp) => Object.keys(wp.tradingDays || {}).length >= req(WEEKLY_MISSIONS.TRADING_STREAK),
  DAILY_GRINDER: (wp) => Object.keys(wp.checkinDays || {}).length >= req(WEEKLY_MISSIONS.DAILY_GRINDER),
  // Composition-based: a percentage of portfolio value you actively maintain.
  CREW_MAXIMALIST: (wp, userData, prices) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const holdings = userData.holdings || {};
    let totalVal = 0,
      crewVal = 0;
    Object.entries(holdings).forEach(([t, s]) => {
      if (s > 0) {
        const v = s * ((prices || {})[t] || 0);
        totalVal += v;
        if (CREW_MEMBERS[crew]!.includes(t)) crewVal += v;
      }
    });
    return totalVal > 0 && (crewVal / totalVal) * 100 >= req(WEEKLY_MISSIONS.CREW_MAXIMALIST);
  },
  // Growth is percentage-based so small accounts aren't locked out by flat
  // dollar targets.
  PORTFOLIO_BUILDER: (wp, userData) => earnedGrowthPct(wp, userData) >= req(WEEKLY_MISSIONS.PORTFOLIO_BUILDER),
  PORTFOLIO_MOONSHOT: (wp, userData) => earnedGrowthPct(wp, userData) >= req(WEEKLY_MISSIONS.PORTFOLIO_MOONSHOT),
};

/**
 * This week's growth with free money taken out: check-ins, dividends, daily
 * drop stock, mission rewards, and ladder/prediction flows (grantedValue). Until
 * 2026-09-28 it counted all of it, so a small account completed both growth
 * missions on a week of check-ins and drops without trading at all. A week
 * recorded before startGrantedValue existed deducts nothing rather than guess.
 * Mirrored in src/utils/missionProgress.ts.
 */
function earnedGrowthPct(wp: WeeklyProgress, userData: UserData) {
  const startValue = wp.startPortfolioValue || 0;
  if (startValue <= 0) return -Infinity;
  const granted = userData.grantedValue || 0;
  const grantedThisWeek = granted - (wp.startGrantedValue ?? granted);
  return (((userData.portfolioValue || 0) - grantedThisWeek - startValue) / startValue) * 100;
}
