// ============================================
// CREWS SYSTEM
// ============================================

export const CREWS = {
  ALLIED: {
    id: 'ALLIED',
    name: 'Allied',
    color: '#767676',
    emblem: '🏛️',
    icon: '/crews/allied.png',
    members: ['BDNL', 'LDNL', 'VSCO', 'ZACK', 'JAY', 'VIN', 'AHN']
  },
  BIG_DEAL: {
    id: 'BIG_DEAL',
    name: 'Big Deal',
    color: '#aa8439',
    emblem: '🤝',
    icon: '/crews/big deal.png',
    members: ['JAKE', 'SWRD', 'JSN', 'BRAD', 'LINE', 'SINU', 'LUAH']
  },
  FIST_GANG: {
    id: 'FIST_GANG',
    name: 'Fist Gang',
    color: '#a91a2c',
    emblem: '👊',
    icon: '/crews/fist gang.png',
    members: ['GAP', 'ELIT', 'JYNG', 'TOM', 'KWON', 'DNCE', 'GNTL', 'MMA', 'LIAR', 'NOH', 'TAXI', 'HANT', 'GWON', 'MNSK']
  },
  GOD_DOG: {
    id: 'GOD_DOG',
    name: 'God Dog',
    color: '#162141',
    emblem: '🐕',
    icon: '/crews/god dog.png',
    members: ['GDOG', 'MIRO', 'EDEN']
  },
  SECRET_FRIENDS: {
    id: 'SECRET_FRIENDS',
    name: 'Secret Friends',
    color: '#f3c404',
    emblem: '🤫',
    icon: '/crews/secret friends.png',
    members: ['GOO', 'LOGN', 'SAM', 'ALEX', 'SHMN']
  },
  HOSTEL: {
    id: 'HOSTEL',
    name: 'Hostel',
    color: '#b1b39e',
    emblem: '🏠',
    icon: '/crews/hostel.png',
    members: ['ELI', 'SLLY', 'CHAE', 'MAX', 'DJO', 'ZAMI', 'RYAN']
  },
  WTJC: {
    id: 'WTJC',
    name: 'White Tiger Job Center',
    color: '#FFFFFF',
    emblem: '🐯',
    icon: '/crews/wtjc.png',
    members: ['TOM', 'SRMK', 'SGUI', 'YCHL', 'SERA', 'MMA', 'LIAR', 'NOH']
  },
  WORKERS: {
    id: 'WORKERS',
    name: 'Workers',
    color: '#000000',
    emblem: '⚒️',
    icon: '/crews/workers.png',
    members: ['WRKR', 'BANG', 'CAPG', 'JYNG', 'NOMN', 'NEKO', 'DOOR', 'JINJ', 'DRMA', 'HYOT', 'OLDF', 'SHKO', 'HIKO', 'DOC', 'NO1', 'DOC2', 'TAEJ', 'HPRK', 'SNGH']
  },
  YAMAZAKI: {
    id: 'YAMAZAKI',
    name: 'Yamazaki Syndicate',
    color: '#f3c803',
    emblem: '⛩️',
    icon: '/crews/yamazaki.png',
    members: ['GUN', 'SHNG', 'SHRO', 'SHKO', 'HIKO', 'SOMI', 'YADV', 'REI', 'IJA', 'KMSH', 'SUMO']
  }
};

// Create a map for quick lookup
export const CREW_MAP = {};
Object.values(CREWS).forEach(crew => {
  CREW_MAP[crew.id] = crew;
});

// ============================================
// SHOP PINS - LOOKISM THEMED
// ============================================

export const PIN_COLLECTIONS = {
  alpha_rewards: {
    id: 'alpha_rewards',
    name: 'Alpha Tester Rewards',
    active: false, // retired from shop — kept so existing owners still display the badge
    limited: true,
    expiresAt: null,
    pins: ['alpha_tester']
  }
  // j_high_og5 collection removed — it used ripped official collab art. Owners
  // were refunded (base price + 50%) via the one-time refundJHighPins admin op.
};

export const SHOP_PINS = {
  alpha_tester: {
    id: 'alpha_tester',
    name: 'Alpha Tester',
    image: 'alpha/stockism_logo.png',
    description: 'Exclusive badge for early supporters',
    price: 1,
    collection: 'alpha_rewards'
  }
  // J High pins (jay/jace/vasco/zack/daniel) removed — ripped official art.
};

export const getActiveShopPins = () => {
  return Object.values(PIN_COLLECTIONS)
    .filter(c => c.active)
    .map(c => ({
      ...c,
      pins: c.pins.map(id => SHOP_PINS[id]).filter(Boolean)
    }));
};

// ============================================
// DAILY MISSIONS
// ============================================

// Every daily mission rewards an ACTION you take today (buy/sell/trade) or a
// portfolio COMPOSITION you actively maintain (percentage in crew). Missions
// that paid out for a static holding you already had were removed - they were
// free recurring income for zero effort.
export const DAILY_MISSIONS = {
  // ============================================
  // TRADING ACTIONS
  // ============================================
  BUY_CREW_MEMBER: {
    id: 'BUY_CREW_MEMBER',
    name: 'Crew Support',
    description: 'Buy shares of any crew member',
    reward: 100,
    checkType: 'BUY_CREW'
  },
  MAKE_TRADES: {
    id: 'MAKE_TRADES',
    name: 'Active Trader',
    description: 'Make 5 trades today',
    reward: 100,
    checkType: 'TRADE_COUNT',
    requirement: 5
  },
  BUY_ANY_STOCK: {
    id: 'BUY_ANY_STOCK',
    name: 'Market Buyer',
    description: 'Buy any stock today',
    reward: 75,
    checkType: 'BUY_ANY'
  },
  SELL_ANY_STOCK: {
    id: 'SELL_ANY_STOCK',
    name: 'Profit Taker',
    description: 'Sell any stock today',
    reward: 75,
    checkType: 'SELL_ANY'
  },
  TRADE_VOLUME: {
    id: 'TRADE_VOLUME',
    name: 'Volume Trader',
    description: 'Trade 100+ total shares today',
    reward: 100,
    checkType: 'TRADE_VOLUME',
    requirement: 100
  },
  RIVAL_TRADER: {
    id: 'RIVAL_TRADER',
    name: 'Rival Trader',
    description: 'Buy shares of a rival crew member today',
    reward: 75,
    checkType: 'RIVAL_TRADER'
  },
  UNDERDOG_INVESTOR: {
    id: 'UNDERDOG_INVESTOR',
    name: 'Underdog Investor',
    description: 'Buy a character priced under $20 today',
    reward: 75,
    checkType: 'UNDERDOG_INVESTOR'
  },
  CREW_ACCUMULATOR: {
    id: 'CREW_ACCUMULATOR',
    name: 'Crew Accumulator',
    description: 'Buy 20+ total shares of crew members today',
    reward: 150,
    checkType: 'CREW_ACCUMULATOR',
    requirement: 20
  },

  // ============================================
  // CREW LOYALTY (percentage-based, scales fairly across account sizes)
  // ============================================
  CREW_MAJORITY: {
    id: 'CREW_MAJORITY',
    name: 'Crew Majority',
    description: 'Have 50%+ of your holdings in crew members',
    reward: 125,
    checkType: 'CREW_MAJORITY',
    requirement: 50
  }
};

// ============================================
// WEEKLY MISSIONS (Harder - 2 randomly assigned per crew each week)
// Week starts Monday 12:00am
// ============================================

// Weekly missions reward a week's worth of ACTIVITY (trade value/volume/count,
// trading + checkin streaks, portfolio growth) or an actively-maintained crew
// COMPOSITION (percentage of value in crew). Static-snapshot missions that paid
// out just for holding a position were removed - they auto-completed every week
// with no effort and favoured big established accounts.
export const WEEKLY_MISSIONS = {
  // ============================================
  // TRADING VOLUME
  // ============================================
  MARKET_WHALE: {
    id: 'MARKET_WHALE',
    name: 'Market Whale',
    description: 'Accumulate $20,000+ in total trade value this week',
    reward: 750,
    checkType: 'WEEKLY_TRADE_VALUE',
    requirement: 20000
  },
  VOLUME_KING: {
    id: 'VOLUME_KING',
    name: 'Volume King',
    description: 'Trade 200+ total shares this week',
    reward: 500,
    checkType: 'WEEKLY_TRADE_VOLUME',
    requirement: 200
  },
  TRADING_MACHINE: {
    id: 'TRADING_MACHINE',
    name: 'Trading Machine',
    description: 'Make 40+ trades this week',
    reward: 400,
    checkType: 'WEEKLY_TRADE_COUNT',
    requirement: 40
  },
  SHARE_MOGUL: {
    id: 'SHARE_MOGUL',
    name: 'Share Mogul',
    description: 'Trade 400+ total shares this week',
    reward: 700,
    checkType: 'WEEKLY_TRADE_VOLUME',
    requirement: 400
  },
  TRADE_MASTER: {
    id: 'TRADE_MASTER',
    name: 'Trade Master',
    description: 'Make 75+ trades this week',
    reward: 600,
    checkType: 'WEEKLY_TRADE_COUNT',
    requirement: 75
  },

  // ============================================
  // CONSISTENCY
  // ============================================
  TRADING_STREAK: {
    id: 'TRADING_STREAK',
    name: 'Trading Streak',
    description: 'Make at least 1 trade on 5 different days',
    reward: 600,
    checkType: 'WEEKLY_TRADING_DAYS',
    requirement: 5
  },
  DAILY_GRINDER: {
    id: 'DAILY_GRINDER',
    name: 'Daily Grinder',
    description: 'Check in every day this week (7 days)',
    reward: 500,
    checkType: 'WEEKLY_CHECKIN_STREAK',
    requirement: 7
  },

  // ============================================
  // CREW LOYALTY (percentage-based, scales fairly across account sizes)
  // ============================================
  CREW_MAXIMALIST: {
    id: 'CREW_MAXIMALIST',
    name: 'Crew Maximalist',
    description: 'Have 80%+ of portfolio value in crew members',
    reward: 600,
    checkType: 'WEEKLY_CREW_PERCENT',
    requirement: 80
  },

  // ============================================
  // PORTFOLIO GROWTH
  // ============================================
  PORTFOLIO_BUILDER: {
    id: 'PORTFOLIO_BUILDER',
    name: 'Portfolio Builder',
    description: 'Grow your portfolio value by 15%+ this week',
    reward: 750,
    checkType: 'WEEKLY_PORTFOLIO_GROWTH',
    requirement: 15 // percent growth from the week's starting value
  },
  PORTFOLIO_MOONSHOT: {
    id: 'PORTFOLIO_MOONSHOT',
    name: 'Portfolio Moonshot',
    description: 'Grow your portfolio value by 35%+ this week',
    reward: 1000,
    checkType: 'WEEKLY_PORTFOLIO_GROWTH',
    requirement: 35 // percent growth from the week's starting value
  }
};

// ============================================
// CREW MISSION REWARDS + CONTRIBUTION MINIMUMS
// ============================================
// This file is the single source of truth for crew rosters and mission
// economy values. The backend copy (functions/crews.js) is generated by
// `npm run sync:chars` - never edit that file directly.

// Crew mission payouts, claimed per player once the crew-wide goal is met.
// Each one requires a real personal trading contribution to claim (see
// CREW_CONTRIB). The old "Full Roster" and "Open Recruitment" missions were
// removed: their crew goals were near-permanently true for any active crew, so
// every member collected the payout every week for doing nothing.
export const CREW_MISSION_REWARDS = {
  CREW_BUY_500: 500,
  CREW_SELL_500: 400,
  CREW_VOLUME: 500
};

// Minimum personal contribution required to claim a crew mission payout.
// The crew goal stays collective; these stop one-share freeloading.
export const CREW_CONTRIB = {
  BUY_SHARES: 50,   // shares of your crew's stocks you personally bought
  SELL_SHARES: 50,  // shares of your crew's stocks you personally sold
  VOLUME: 500       // dollars of crew-stock trade volume you personally generated
};

// The buy / sell / volume crew goals only count trades of the crew's OWN
// roster stocks, so the target scales with roster size. Otherwise a 3-member
// crew (God Dog) and a 19-member crew (Workers) would chase the same number
// using very different amounts of stock and manpower.
export const CREW_BUY_PER_MEMBER = 100;
export const CREW_SELL_PER_MEMBER = 100;
export const CREW_VOLUME_PER_MEMBER = 2000;
export const CREW_BUY_MIN = 300;
export const CREW_SELL_MIN = 300;
export const CREW_VOLUME_MIN = 6000;

export const getCrewBuyTarget = (memberCount) =>
  Math.max(CREW_BUY_MIN, CREW_BUY_PER_MEMBER * (memberCount || 0));
export const getCrewSellTarget = (memberCount) =>
  Math.max(CREW_SELL_MIN, CREW_SELL_PER_MEMBER * (memberCount || 0));
export const getCrewVolumeTarget = (memberCount) =>
  Math.max(CREW_VOLUME_MIN, CREW_VOLUME_PER_MEMBER * (memberCount || 0));

// Helper function to get current week identifier (Monday 12:00am start)
export const getWeekId = (date = new Date()) => {
  const d = new Date(date);
  // Get Monday of current week (UTC to match server)
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0]; // Returns "YYYY-MM-DD" of Monday
};

// Helper to check if we're in a new week
export const isNewWeek = (lastWeekId) => {
  return getWeekId() !== lastWeekId;
};

// Deterministic random selection based on crew ID and week
export const getCrewWeeklyMissions = (crewId, weekId, rerollSeed = 0) => {
  const seed = `${crewId}-${weekId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  hash = hash + rerollSeed; // Apply reroll offset

  const missionKeys = Object.keys(WEEKLY_MISSIONS);
  const count = missionKeys.length;

  const idx1 = Math.abs(hash) % count;
  const idx2 = Math.abs(hash * 31) % count;
  const finalIdx2 = idx2 === idx1 ? (idx2 + 1) % count : idx2;

  return [
    WEEKLY_MISSIONS[missionKeys[idx1]],
    WEEKLY_MISSIONS[missionKeys[finalIdx2]]
  ];
};

// Deterministic daily mission selection based on date and crew
export const getDailyMissions = (today, crewId, rerollSeed = 0) => {
  const allMissions = Object.values(DAILY_MISSIONS);

  const dateSeed = today.split('-').reduce((acc, num) => acc + parseInt(num), 0);
  const crewSeed = crewId ? crewId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
  const seed = dateSeed + crewSeed + rerollSeed;

  const shuffled = [...allMissions];
  let currentSeed = seed;
  const seededRandom = () => {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  };

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, 3);
};

// ============================================
// PIN SLOT COSTS
// ============================================

export const PIN_SLOT_COSTS = {
  EXTRA_ACHIEVEMENT_SLOT: 5000,
  EXTRA_SHOP_SLOT: 7500
};

// ============================================
// UNDERDOG BONUS
// ============================================

// Crews with fewer active players earn a reward multiplier for the following
// week. Computed every Monday by weeklyCrewRankings from last week's activity
// (trades, mission claims, or check-ins) and stored in the public
// market/crewStats doc:
//   multiplier = 1 + ((maxActive - crewActive) / maxActive) * (MAX - 1)
// The most active crew gets 1x; an empty crew gets the full max. It applies to
// daily, weekly, and crew mission payouts. Because it recomputes weekly, an
// influx of new members shrinks the bonus on its own — no cap juggling needed.
export const CREW_UNDERDOG_MULT_MAX = 2;

// Read a crew's current multiplier off the market/crewStats doc.
// Falls back to 1x when the doc hasn't been computed yet.
export const getCrewMultiplier = (crewStats, crewId) => {
  const m = crewStats?.multipliers?.[crewId];
  return typeof m === 'number' && m >= 1 ? Math.min(m, CREW_UNDERDOG_MULT_MAX) : 1;
};

// ============================================
// LEAVE PENALTY + REJOIN LOCKOUT
// ============================================

// Portfolio share (cash + holdings) taken when leaving or switching crews.
// Single source of truth for backend (via functions/constants.js) and all
// frontend warning text. Was 0.15 until 2026-07-19; lowered alongside the
// crew overhaul so players can migrate to underdog crews.
export const CREW_SWITCH_PENALTY = 0.05;

// Leaving a crew locks you out of that specific crew for 30 days (stored on
// the user doc as crewLockouts: { crewId: expiresAtMs }). This replaced the
// old permanent exile, which made every crew choice one-way and trapped
// players in dead crews forever.
export const CREW_REJOIN_LOCKOUT_DAYS = 30;
