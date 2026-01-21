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
    members: ['GAP', 'ELIT', 'JYNG', 'TOM', 'KWON', 'DNCE', 'GNTL']
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
    members: ['TOM', 'SRMK', 'SGUI', 'YCHL', 'SERA']
  },
  WORKERS: {
    id: 'WORKERS',
    name: 'Workers',
    color: '#000000',
    emblem: '⚒️',
    icon: '/crews/workers.png',
    members: ['WRKR', 'BANG', 'CAPG', 'JYNG', 'NOMN', 'NEKO', 'DOOR', 'JINJ', 'DRMA', 'HYOT', 'OLDF', 'SHKO', 'HIKO']
  },
  YAMAZAKI: {
    id: 'YAMAZAKI',
    name: 'Yamazaki Syndicate',
    color: '#f3c803',
    emblem: '⛩️',
    icon: '/crews/yamazaki.png',
    members: ['GUN', 'SHNG', 'SHRO', 'SHKO', 'HIKO']
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
  // ============================================
  // SHOP PINS - Coming Soon!
  // Custom pins will be added here later
  // ============================================
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
