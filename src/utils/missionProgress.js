// Pure mission progress calculators for the missions modal.
// Mirrors how the backend credits missions — display logic only.

// Daily mission progress from today's dailyProgress record.
export const getDailyMissionProgress = (mission, { holdings, dailyProgress, crewMembers }) => {
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
      return { complete: trades >= mission.requirement, progress: trades, target: mission.requirement };
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
      return { complete: volume >= mission.requirement, progress: volume, target: mission.requirement };
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
      return { complete: crewSharesBought >= mission.requirement, progress: crewSharesBought, target: mission.requirement };
    }

    // ============================================
    // CREW LOYALTY (percentage you actively maintain)
    // ============================================
    case 'CREW_MAJORITY': {
      const totalShares = Object.values(holdings).reduce((sum, s) => sum + s, 0);
      const crewShares = crewMembers.reduce((sum, ticker) => sum + (holdings[ticker] || 0), 0);
      const percent = totalShares > 0 ? (crewShares / totalShares) * 100 : 0;
      return { complete: percent >= mission.requirement, progress: Math.floor(percent), target: mission.requirement };
    }

    default:
      return { complete: false, progress: 0, target: 1 };
  }
};

// Weekly (crew) mission progress from this week's weeklyProgress record.
export const getWeeklyMissionProgress = (mission, { holdings, weeklyProgress: wp, prices, crewMembers, portfolioValue }) => {
  switch (mission.checkType) {
    // ============================================
    // TRADING VOLUME
    // ============================================
    case 'WEEKLY_TRADE_VALUE': {
      const value = wp.tradeValue || 0;
      return {
        complete: value >= mission.requirement,
        progress: Math.floor(value),
        target: mission.requirement
      };
    }
    case 'WEEKLY_TRADE_VOLUME': {
      const volume = wp.tradeVolume || 0;
      return {
        complete: volume >= mission.requirement,
        progress: volume,
        target: mission.requirement
      };
    }
    case 'WEEKLY_TRADE_COUNT': {
      const count = wp.tradeCount || 0;
      return {
        complete: count >= mission.requirement,
        progress: count,
        target: mission.requirement
      };
    }

    // ============================================
    // CONSISTENCY
    // ============================================
    case 'WEEKLY_TRADING_DAYS': {
      const days = Object.keys(wp.tradingDays || {}).length;
      return {
        complete: days >= mission.requirement,
        progress: days,
        target: mission.requirement
      };
    }
    case 'WEEKLY_CHECKIN_STREAK': {
      const days = Object.keys(wp.checkinDays || {}).length;
      return {
        complete: days >= mission.requirement,
        progress: days,
        target: mission.requirement
      };
    }

    // ============================================
    // CREW LOYALTY
    // ============================================
    case 'WEEKLY_CREW_PERCENT': {
      // Calculate % of portfolio in crew members by value
      let totalValue = 0;
      let crewValue = 0;
      Object.entries(holdings).forEach(([ticker, shares]) => {
        if (shares > 0) {
          const price = prices[ticker] || 0;
          const value = shares * price;
          totalValue += value;
          if (crewMembers.includes(ticker)) {
            crewValue += value;
          }
        }
      });
      const percent = totalValue > 0 ? (crewValue / totalValue) * 100 : 0;
      return {
        complete: percent >= mission.requirement,
        progress: Math.floor(percent),
        target: mission.requirement
      };
    }

    // ============================================
    // PORTFOLIO GROWTH
    // ============================================
    case 'WEEKLY_PORTFOLIO_GROWTH': {
      // requirement is percent growth from the week's starting value
      const startValue = wp.startPortfolioValue || portfolioValue;
      const growthPct = startValue > 0 ? ((portfolioValue - startValue) / startValue) * 100 : 0;
      return {
        complete: growthPct >= mission.requirement,
        progress: Math.max(0, Math.floor(growthPct)),
        target: mission.requirement
      };
    }

    default:
      return { complete: false, progress: 0, target: 1 };
  }
};

// Days until the weekly missions reset (next Monday, UTC)
export const getDaysUntilWeeklyReset = () => {
  const day = new Date().getUTCDay();
  return day === 0 ? 1 : (8 - day);
};
