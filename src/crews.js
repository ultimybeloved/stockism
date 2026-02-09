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
    members: ['GAP', 'ELIT', 'JYNG', 'TOM', 'KWON', 'DNCE', 'GNTL', 'MMA', 'LIAR', 'NOH']
  },
  GOD_DOG: {
    id: 'GOD_DOG',
    name: 'God Dog',
    color: '#162141',
    emblem: '🐕',
    icon: '/crews/god dog.png',
    members: ['GDOG']
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
    members: ['WRKR', 'BANG', 'CAPG', 'JYNG', 'NOMN', 'NEKO', 'DOOR', 'JINJ', 'DRMA', 'HYOT', 'OLDF', 'SHKO', 'HIKO', 'DOC', 'NO1']
  },
  YAMAZAKI: {
    id: 'YAMAZAKI',
    name: 'Yamazaki Syndicate',
    color: '#f3c803',
    emblem: '⛩️',
    icon: '/crews/yamazaki.png',
    members: ['GUN', 'SHNG', 'SHRO', 'SHKO', 'HIKO', 'SOMI']
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

export const SHOP_PINS = {
  alpha_tester: {
    id: 'alpha_tester',
    name: 'Stockism Alpha Tester Badge',
    emoji: '🎖️',
    image: 'stockism_logo.png',
    description: 'Exclusive badge for early supporters',
    price: 1
  }
};

// Create array sorted by price for shop display
export const SHOP_PINS_LIST = Object.values(SHOP_PINS).sort((a, b) => a.price - b.price);

// ============================================
// DAILY MISSIONS
// ============================================

export const DAILY_MISSIONS = {
  // ============================================
  // ORIGINAL 3
  // ============================================
  BUY_CREW_MEMBER: {
    id: 'BUY_CREW_MEMBER',
    name: 'Crew Support',
    description: 'Buy shares of any crew member',
    reward: 150,
    checkType: 'BUY_CREW'
  },
  HOLD_CREW_SHARES: {
    id: 'HOLD_CREW_SHARES',
    name: 'Loyal Holder',
    description: 'Hold 10+ shares of crew members',
    reward: 75,
    checkType: 'HOLD_CREW',
    requirement: 10
  },
  MAKE_TRADES: {
    id: 'MAKE_TRADES',
    name: 'Active Trader',
    description: 'Make 3 trades today',
    reward: 100,
    checkType: 'TRADE_COUNT',
    requirement: 3
  },
  
  // ============================================
  // GENERAL TRADING (4)
  // ============================================
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
  HOLD_LARGE_POSITION: {
    id: 'HOLD_LARGE_POSITION',
    name: 'Big Believer',
    description: 'Hold 25+ shares of any single character',
    reward: 125,
    checkType: 'HOLD_LARGE',
    requirement: 25
  },
  TRADE_VOLUME: {
    id: 'TRADE_VOLUME',
    name: 'Volume Trader',
    description: 'Trade 10+ total shares today',
    reward: 100,
    checkType: 'TRADE_VOLUME',
    requirement: 10
  },
  
  // ============================================
  // CREW LOYALTY (4)
  // ============================================
  CREW_MAJORITY: {
    id: 'CREW_MAJORITY',
    name: 'Crew Majority',
    description: 'Have 50%+ of your holdings in crew members',
    reward: 125,
    checkType: 'CREW_MAJORITY',
    requirement: 50
  },
  CREW_COLLECTOR: {
    id: 'CREW_COLLECTOR',
    name: 'Crew Collector',
    description: 'Own shares of 3+ different crew members',
    reward: 100,
    checkType: 'CREW_COLLECTOR',
    requirement: 3
  },
  FULL_ROSTER: {
    id: 'FULL_ROSTER',
    name: 'Full Roster',
    description: 'Own at least 1 share of every crew member',
    reward: 200,
    checkType: 'FULL_ROSTER'
  },
  CREW_LEADER: {
    id: 'CREW_LEADER',
    name: 'Crew Leader',
    description: 'Be the top holder of any crew member stock',
    reward: 150,
    checkType: 'CREW_LEADER'
  },
  
  // ============================================
  // CREW VS CREW (2)
  // ============================================
  RIVAL_TRADER: {
    id: 'RIVAL_TRADER',
    name: 'Rival Trader',
    description: 'Buy shares of a rival crew member today',
    reward: 75,
    checkType: 'RIVAL_TRADER'
  },
  SPY_GAME: {
    id: 'SPY_GAME',
    name: 'Spy Game',
    description: 'Own shares in 3+ different crews',
    reward: 100,
    checkType: 'SPY_GAME',
    requirement: 3
  },
  
  // ============================================
  // CHARACTER-SPECIFIC (3)
  // ============================================
  TOP_DOG: {
    id: 'TOP_DOG',
    name: 'Top Dog',
    description: 'Own shares of the highest-priced character',
    reward: 100,
    checkType: 'TOP_DOG'
  },
  UNDERDOG_INVESTOR: {
    id: 'UNDERDOG_INVESTOR',
    name: 'Underdog Investor',
    description: 'Buy a character priced under $20 today',
    reward: 75,
    checkType: 'UNDERDOG_INVESTOR'
  },
  
  // ============================================
  // CREW VALUE (2)
  // ============================================
  BALANCED_CREW: {
    id: 'BALANCED_CREW',
    name: 'Balanced Crew',
    description: 'Own at least 5 shares of 2+ different crew members',
    reward: 100,
    checkType: 'BALANCED_CREW',
    requirement: 2
  },
  CREW_ACCUMULATOR: {
    id: 'CREW_ACCUMULATOR',
    name: 'Crew Accumulator',
    description: 'Buy 10+ total shares of crew members today',
    reward: 150,
    checkType: 'CREW_ACCUMULATOR',
    requirement: 10
  }
};

// ============================================
// WEEKLY MISSIONS (Harder - 2 randomly assigned per crew each week)
// Week starts Monday 12:00am
// ============================================

export const WEEKLY_MISSIONS = {
  // ============================================
  // TRADING VOLUME (3)
  // ============================================
  MARKET_WHALE: {
    id: 'MARKET_WHALE',
    name: 'Market Whale',
    description: 'Accumulate $10,000+ in total trade value this week',
    reward: 750,
    checkType: 'WEEKLY_TRADE_VALUE',
    requirement: 10000
  },
  VOLUME_KING: {
    id: 'VOLUME_KING',
    name: 'Volume King',
    description: 'Trade 100+ total shares this week',
    reward: 500,
    checkType: 'WEEKLY_TRADE_VOLUME',
    requirement: 100
  },
  TRADING_MACHINE: {
    id: 'TRADING_MACHINE',
    name: 'Trading Machine',
    description: 'Make 25+ trades this week',
    reward: 400,
    checkType: 'WEEKLY_TRADE_COUNT',
    requirement: 25
  },

  // ============================================
  // CONSISTENCY (2)
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
  // CREW LOYALTY (3)
  // ============================================
  CREW_MAXIMALIST: {
    id: 'CREW_MAXIMALIST',
    name: 'Crew Maximalist',
    description: 'Have 80%+ of portfolio value in crew members',
    reward: 600,
    checkType: 'WEEKLY_CREW_PERCENT',
    requirement: 80
  },
  CREW_HOARDER: {
    id: 'CREW_HOARDER',
    name: 'Crew Hoarder',
    description: 'Accumulate 50+ total shares of crew members',
    reward: 500,
    checkType: 'WEEKLY_CREW_SHARES',
    requirement: 50
  },
  FULL_CREW_OWNERSHIP: {
    id: 'FULL_CREW_OWNERSHIP',
    name: 'Full Crew Ownership',
    description: 'Own 5+ shares of EVERY crew member',
    reward: 1000,
    checkType: 'WEEKLY_FULL_CREW',
    requirement: 5
  },

  // ============================================
  // PORTFOLIO (2)
  // ============================================
  DIVERSIFICATION_MASTER: {
    id: 'DIVERSIFICATION_MASTER',
    name: 'Diversification Master',
    description: 'Own shares in 5+ different crews simultaneously',
    reward: 500,
    checkType: 'WEEKLY_CREW_DIVERSITY',
    requirement: 5
  },
  PORTFOLIO_BUILDER: {
    id: 'PORTFOLIO_BUILDER',
    name: 'Portfolio Builder',
    description: 'Grow your portfolio value by $2000+ this week',
    reward: 750,
    checkType: 'WEEKLY_PORTFOLIO_GROWTH',
    requirement: 2000
  },

  // ============================================
  // HIGHER-TIER TRADING (2)
  // ============================================
  SHARE_MOGUL: {
    id: 'SHARE_MOGUL',
    name: 'Share Mogul',
    description: 'Trade 250+ total shares this week',
    reward: 700,
    checkType: 'WEEKLY_TRADE_VOLUME',
    requirement: 250
  },
  TRADE_MASTER: {
    id: 'TRADE_MASTER',
    name: 'Trade Master',
    description: 'Make 50+ trades this week',
    reward: 600,
    checkType: 'WEEKLY_TRADE_COUNT',
    requirement: 50
  },

  // ============================================
  // PORTFOLIO SNAPSHOT (3)
  // ============================================
  HEAVY_BAGS: {
    id: 'HEAVY_BAGS',
    name: 'Heavy Bags',
    description: 'Hold 200+ total shares across all positions',
    reward: 600,
    checkType: 'WEEKLY_TOTAL_SHARES',
    requirement: 200
  },
  PENNY_COLLECTOR: {
    id: 'PENNY_COLLECTOR',
    name: 'Penny Collector',
    description: 'Own 50+ shares of stocks priced under $25',
    reward: 500,
    checkType: 'WEEKLY_PENNY_SHARES',
    requirement: 50
  },
  BLUE_CHIP_INVESTOR: {
    id: 'BLUE_CHIP_INVESTOR',
    name: 'Blue Chip Investor',
    description: 'Own shares in 3+ stocks priced over $100',
    reward: 600,
    checkType: 'WEEKLY_BLUE_CHIPS',
    requirement: 3
  },

  // ============================================
  // SHORTS & GROWTH (2)
  // ============================================
  SHORT_KING: {
    id: 'SHORT_KING',
    name: 'Short King',
    description: 'Have 3+ active short positions at the same time',
    reward: 700,
    checkType: 'WEEKLY_SHORT_COUNT',
    requirement: 3
  },
  PORTFOLIO_MOONSHOT: {
    id: 'PORTFOLIO_MOONSHOT',
    name: 'Portfolio Moonshot',
    description: 'Grow your portfolio value by $5,000+ this week',
    reward: 1000,
    checkType: 'WEEKLY_PORTFOLIO_GROWTH',
    requirement: 5000
  }
};

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
export const getCrewWeeklyMissions = (crewId, weekId) => {
  // Create a seed from crew ID and week
  const seed = `${crewId}-${weekId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  const missionKeys = Object.keys(WEEKLY_MISSIONS);
  const count = missionKeys.length;

  // Get two different missions deterministically
  const idx1 = Math.abs(hash) % count;
  const idx2 = Math.abs(hash * 31) % count;
  const finalIdx2 = idx2 === idx1 ? (idx2 + 1) % count : idx2;

  return [
    WEEKLY_MISSIONS[missionKeys[idx1]],
    WEEKLY_MISSIONS[missionKeys[finalIdx2]]
  ];
};

// ============================================
// PIN SLOT COSTS
// ============================================

export const PIN_SLOT_COSTS = {
  EXTRA_ACHIEVEMENT_SLOT: 5000,
  EXTRA_SHOP_SLOT: 7500
};

// ============================================
// CREW DIVIDEND RATE
// ============================================

export const CREW_DIVIDEND_RATE = 0.01; // 1% daily dividend on crew member holdings
