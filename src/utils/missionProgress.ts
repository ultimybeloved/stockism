import type { Mission } from '../crews';
import type { PriceMap, ShareMap } from '../types';

// Pure mission progress calculators for the missions modal.
// Mirrors how the backend credits missions — display logic only.

// Daily mission progress from today's dailyProgress record.
export interface MissionProgress {
  complete: boolean;
  progress: number;
  target: number;
}

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

export interface WeeklyProgress {
  tradeValue?: number;
  tradeVolume?: number;
  tradeCount?: number;
  tradingDays?: Record<string, unknown>;
  checkinDays?: Record<string, unknown>;
  startPortfolioValue?: number;
  startGrantedValue?: number;
  startMarginUsed?: number;
}

// Share of the portfolio's stock value held in crew members, 0-100. By value,
// not share count: counting shares let a pile of cheap crew stock pass for
// "most of your portfolio" (Crew Majority until 2026-10-14).
// Mirrors crewValuePercent in functions/src/missions/missionChecks.ts.
export const crewValuePercent = (holdings: ShareMap, prices: PriceMap, crewMembers: string[]) => {
  let totalValue = 0;
  let crewValue = 0;
  for (const [ticker, shares] of Object.entries(holdings)) {
    if (shares <= 0) continue;
    const value = shares * (prices[ticker] || 0);
    totalValue += value;
    if (crewMembers.includes(ticker)) crewValue += value;
  }
  return totalValue > 0 ? (crewValue / totalValue) * 100 : 0;
};

export const getDailyMissionProgress = (
  mission: Mission,
  {
    holdings,
    prices,
    dailyProgress,
    crewMembers,
  }: { holdings: ShareMap; prices: PriceMap; dailyProgress: DailyProgress; crewMembers: string[] },
): MissionProgress => {
  // Every check type that compares against `requirement` defines one.
  const req = mission.requirement as number;
  switch (mission.checkType) {
    // ============================================
    // TRADING ACTIONS (something done today)
    // ============================================
    case 'BUY_CREW': {
      const bought = dailyProgress.boughtCrewMember || false;
      return { complete: bought, progress: bought ? 1 : 0, target: 1 };
    }
    case 'TRADE_COUNT': {
      const trades = dailyProgress.tradesCount || 0;
      return { complete: trades >= req, progress: trades, target: req };
    }
    case 'BUY_ANY': {
      const bought = dailyProgress.boughtAny || false;
      return { complete: bought, progress: bought ? 1 : 0, target: 1 };
    }
    case 'SELL_ANY': {
      const sold = dailyProgress.soldAny || false;
      return { complete: sold, progress: sold ? 1 : 0, target: 1 };
    }
    case 'TRADE_VOLUME': {
      const volume = dailyProgress.tradeVolume || 0;
      return { complete: volume >= req, progress: volume, target: req };
    }
    case 'RIVAL_TRADER': {
      const bought = dailyProgress.boughtRival || false;
      return { complete: bought, progress: bought ? 1 : 0, target: 1 };
    }
    case 'UNDERDOG_INVESTOR': {
      const bought = dailyProgress.boughtUnderdog || false;
      return { complete: bought, progress: bought ? 1 : 0, target: 1 };
    }
    case 'CREW_ACCUMULATOR': {
      const crewSharesBought = dailyProgress.crewSharesBought || 0;
      return {
        complete: crewSharesBought >= req,
        progress: crewSharesBought,
        target: req,
      };
    }

    // ============================================
    // CREW LOYALTY (percentage you actively maintain)
    // ============================================
    case 'CREW_MAJORITY': {
      const percent = crewValuePercent(holdings, prices, crewMembers);
      return { complete: percent >= req, progress: Math.floor(percent), target: req };
    }

    default:
      return { complete: false, progress: 0, target: 1 };
  }
};

// Weekly (crew) mission progress from this week's weeklyProgress record.
export const getWeeklyMissionProgress = (
  mission: Mission,
  {
    holdings,
    weeklyProgress: wp,
    prices,
    crewMembers,
    portfolioValue,
    grantedValue = 0,
    marginUsed = 0,
  }: {
    holdings: ShareMap;
    weeklyProgress: WeeklyProgress;
    prices: PriceMap;
    crewMembers: string[];
    portfolioValue: number;
    grantedValue?: number;
    marginUsed?: number;
  },
): MissionProgress => {
  // Every check type that compares against `requirement` defines one.
  const req = mission.requirement as number;
  switch (mission.checkType) {
    // ============================================
    // TRADING VOLUME
    // ============================================
    case 'WEEKLY_TRADE_VALUE': {
      const value = wp.tradeValue || 0;
      return {
        complete: value >= req,
        progress: Math.floor(value),
        target: req,
      };
    }
    case 'WEEKLY_TRADE_VOLUME': {
      const volume = wp.tradeVolume || 0;
      return {
        complete: volume >= req,
        progress: volume,
        target: req,
      };
    }
    case 'WEEKLY_TRADE_COUNT': {
      const count = wp.tradeCount || 0;
      return {
        complete: count >= req,
        progress: count,
        target: req,
      };
    }

    // ============================================
    // CONSISTENCY
    // ============================================
    case 'WEEKLY_TRADING_DAYS': {
      const days = Object.keys(wp.tradingDays || {}).length;
      return {
        complete: days >= req,
        progress: days,
        target: req,
      };
    }
    case 'WEEKLY_CHECKIN_STREAK': {
      const days = Object.keys(wp.checkinDays || {}).length;
      return {
        complete: days >= req,
        progress: days,
        target: req,
      };
    }

    // ============================================
    // CREW LOYALTY
    // ============================================
    case 'WEEKLY_CREW_PERCENT': {
      const percent = crewValuePercent(holdings, prices, crewMembers);
      return {
        complete: percent >= req,
        progress: Math.floor(percent),
        target: req,
      };
    }

    // ============================================
    // PORTFOLIO GROWTH
    // ============================================
    case 'WEEKLY_PORTFOLIO_GROWTH': {
      // requirement is percent growth from the week's starting value, with free
      // money received this week taken out. Mirror of earnedGrowthPct in
      // functions/src/missions/missionChecks.js.
      // Margin debt comes off both ends, so borrowing isn't growth.
      const startValue = (wp.startPortfolioValue || portfolioValue) - (wp.startMarginUsed || 0);
      const grantedThisWeek = grantedValue - (wp.startGrantedValue ?? grantedValue);
      const nowValue = portfolioValue - marginUsed;
      const growthPct = startValue > 0 ? ((nowValue - grantedThisWeek - startValue) / startValue) * 100 : 0;
      return {
        complete: growthPct >= req,
        progress: Math.max(0, Math.floor(growthPct)),
        target: req,
      };
    }

    default:
      return { complete: false, progress: 0, target: 1 };
  }
};

// Days until the weekly missions reset (next Monday, UTC)
export const getDaysUntilWeeklyReset = (): number => {
  const day = new Date().getUTCDay();
  return day === 0 ? 1 : 8 - day;
};
