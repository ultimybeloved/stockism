'use strict';
// Server-side mission completion verification.
//
// Internal module — NOT exported through functions/index.js. Required by
// missions.js (to gate reward claims) and discordCommands.js (to show progress
// in /missions). It lives here rather than inside missions.js so the Discord bot
// can read completion state without a second, drifting copy of the rules.
//
// Each check takes (progress, userData, prices) and returns a boolean.

const { CREW_MEMBERS } = require('../constants');
const { DAILY_MISSIONS, WEEKLY_MISSIONS } = require('../crews');

const DAILY_MISSION_CHECKS = {
  // Action-based: require something the player did today.
  BUY_CREW_MEMBER: (dp) => !!dp.boughtCrewMember,
  MAKE_TRADES: (dp) => (dp.tradesCount || 0) >= 5,
  BUY_ANY_STOCK: (dp) => !!dp.boughtAny,
  SELL_ANY_STOCK: (dp) => !!dp.soldAny,
  TRADE_VOLUME: (dp) => (dp.tradeVolume || 0) >= DAILY_MISSIONS.TRADE_VOLUME.requirement,
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
    const crewShares = CREW_MEMBERS[crew].reduce((s, t) => s + (holdings[t] || 0), 0);
    return (crewShares / total) * 100 >= 50;
  }
};

const WEEKLY_MISSION_CHECKS = {
  // Activity-based: a week's worth of trading / consistency.
  MARKET_WHALE: (wp) => (wp.tradeValue || 0) >= WEEKLY_MISSIONS.MARKET_WHALE.requirement,
  VOLUME_KING: (wp) => (wp.tradeVolume || 0) >= WEEKLY_MISSIONS.VOLUME_KING.requirement,
  TRADING_MACHINE: (wp) => (wp.tradeCount || 0) >= WEEKLY_MISSIONS.TRADING_MACHINE.requirement,
  SHARE_MOGUL: (wp) => (wp.tradeVolume || 0) >= WEEKLY_MISSIONS.SHARE_MOGUL.requirement,
  TRADE_MASTER: (wp) => (wp.tradeCount || 0) >= WEEKLY_MISSIONS.TRADE_MASTER.requirement,
  TRADING_STREAK: (wp) => Object.keys(wp.tradingDays || {}).length >= WEEKLY_MISSIONS.TRADING_STREAK.requirement,
  DAILY_GRINDER: (wp) => Object.keys(wp.checkinDays || {}).length >= WEEKLY_MISSIONS.DAILY_GRINDER.requirement,
  // Composition-based: a percentage of portfolio value you actively maintain.
  CREW_MAXIMALIST: (wp, userData, prices) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const holdings = userData.holdings || {};
    let totalVal = 0, crewVal = 0;
    Object.entries(holdings).forEach(([t, s]) => {
      if (s > 0) { const v = s * ((prices || {})[t] || 0); totalVal += v; if (CREW_MEMBERS[crew].includes(t)) crewVal += v; }
    });
    return totalVal > 0 && (crewVal / totalVal) * 100 >= WEEKLY_MISSIONS.CREW_MAXIMALIST.requirement;
  },
  // Growth is percentage-based so big accounts can't auto-complete on free
  // cash income and small accounts aren't locked out by flat dollar targets
  PORTFOLIO_BUILDER: (wp, userData) => {
    const startValue = wp.startPortfolioValue || 0;
    if (startValue <= 0) return false;
    const growthPct = (((userData.portfolioValue || 0) - startValue) / startValue) * 100;
    return growthPct >= WEEKLY_MISSIONS.PORTFOLIO_BUILDER.requirement;
  },
  PORTFOLIO_MOONSHOT: (wp, userData) => {
    const startValue = wp.startPortfolioValue || 0;
    if (startValue <= 0) return false;
    const growthPct = (((userData.portfolioValue || 0) - startValue) / startValue) * 100;
    return growthPct >= WEEKLY_MISSIONS.PORTFOLIO_MOONSHOT.requirement;
  }
};

module.exports = { DAILY_MISSION_CHECKS, WEEKLY_MISSION_CHECKS };
