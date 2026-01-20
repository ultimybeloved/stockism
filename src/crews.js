// ============================================
// CREWS SYSTEM
// ============================================

export const CREWS = {
  ALLIED: {
    id: 'ALLIED',
    name: 'Allied',
    color: '#FFD700',
    emblem: '🏛️',
    icon: '/crews/allied.png',
    members: ['BDNL', 'LDNL', 'VSCO', 'ZACK', 'JAY', 'VIN', 'AHN']
  },
  BIG_DEAL: {
    id: 'BIG_DEAL',
    name: 'Big Deal',
    color: '#3B82F6',
    emblem: '🤝',
    icon: '/crews/big deal.png',
    members: ['JAKE', 'SWRD', 'JSN', 'BRAD', 'LINE', 'SINU', 'LUAH']
  },
  FIST_GANG: {
    id: 'FIST_GANG',
    name: 'Fist Gang',
    color: '#EF4444',
    emblem: '👊',
    icon: '/crews/fist gang.png',
    members: ['GAP', 'ELIT', 'JYNG', 'TOM', 'KWON', 'DNCE', 'GNTL']
  },
  GOD_DOG: {
    id: 'GOD_DOG',
    name: 'God Dog',
    color: '#8B5CF6',
    emblem: '🐕',
    icon: '/crews/god dog.png',
    members: ['GDOG']
  },
  SECRET_FRIENDS: {
    id: 'SECRET_FRIENDS',
    name: 'Secret Friends',
    color: '#EC4899',
    emblem: '🤫',
    icon: '/crews/secret friends.png',
    members: ['GOO', 'LOGN', 'SAM', 'ALEX', 'SHMN']
  },
  HOSTEL: {
    id: 'HOSTEL',
    name: 'Hostel',
    color: '#F97316',
    emblem: '🏠',
    icon: '/crews/hostel.png',
    members: ['ELI', 'SLLY', 'CHAE', 'MAX', 'DJO', 'ZAMI', 'RYAN']
  },
  WTJC: {
    id: 'WTJC',
    name: 'White Tiger Job Center',
    color: '#14B8A6',
    emblem: '🐯',
    icon: '/crews/wtjc.png',
    members: ['TOM', 'SRMK', 'SGUI', 'YCHL', 'SERA']
  },
  WORKERS: {
    id: 'WORKERS',
    name: 'Workers',
    color: '#22C55E',
    emblem: '⚒️',
    icon: '/crews/workers.png',
    members: ['WRKR', 'BANG', 'CAPG', 'JYNG', 'NOMN', 'NEKO', 'DOOR', 'JINJ', 'DRMA', 'HYOT', 'OLDF', 'SHKO', 'HIKO']
  },
  YAMAZAKI: {
    id: 'YAMAZAKI',
    name: 'Yamazaki Syndicate',
    color: '#DC2626',
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

// Create a ticker-to-crew lookup map
export const TICKER_TO_CREW = {};
Object.values(CREWS).forEach(crew => {
  crew.members.forEach(ticker => {
    TICKER_TO_CREW[ticker] = crew;
  });
});

export const getCrewByTicker = (ticker) => {
  return TICKER_TO_CREW[ticker] || null;
};

// ============================================
// SHOP PINS - LOOKISM THEMED
// ============================================

export const SHOP_PINS = {
  // ============================================
  // CHEAP ($500-1,500) - Common References
  // ============================================
  SECOND_BODY: {
    id: 'SECOND_BODY',
    name: 'Second Body',
    emoji: '👥',
    price: 500,
    description: 'Two bodies, one soul'
  },
  GLASSES_DANIEL: {
    id: 'GLASSES_DANIEL',
    name: 'Daniel\'s Glasses',
    emoji: '👓',
    price: 500,
    description: 'The iconic round frames'
  },
  FRIED_CHICKEN: {
    id: 'FRIED_CHICKEN',
    name: 'Fried Chicken',
    emoji: '🍗',
    price: 500,
    description: 'Daniel\'s part-time job'
  },
  CONVENIENCE_STORE: {
    id: 'CONVENIENCE_STORE',
    name: '24/7 Shift',
    emoji: '🏪',
    price: 750,
    description: 'Working the night shift'
  },
  RAMEN: {
    id: 'RAMEN',
    name: 'Instant Ramen',
    emoji: '🍜',
    price: 750,
    description: 'Broke boy meals'
  },
  SCHOOL_BAG: {
    id: 'SCHOOL_BAG',
    name: 'J High Bag',
    emoji: '🎒',
    price: 750,
    description: 'J High student'
  },
  PHONE_CRACK: {
    id: 'PHONE_CRACK',
    name: 'Cracked Phone',
    emoji: '📱',
    price: 1000,
    description: 'Another fight, another screen'
  },
  BANDAGE: {
    id: 'BANDAGE',
    name: 'Battle Scar',
    emoji: '🩹',
    price: 1000,
    description: 'Proof of survival'
  },
  ROOFTOP: {
    id: 'ROOFTOP',
    name: 'Rooftop',
    emoji: '🏗️',
    price: 1000,
    description: 'Where beef gets settled'
  },
  CIGARETTE: {
    id: 'CIGARETTE',
    name: 'Cigarette',
    emoji: '🚬',
    price: 1500,
    description: 'Cool delinquent vibes'
  },
  
  // ============================================
  // MID ($2,000-5,000) - Character Items
  // ============================================
  BRASS_KNUCKLES: {
    id: 'BRASS_KNUCKLES',
    name: 'Brass Knuckles',
    emoji: '🥊',
    price: 2000,
    description: 'Street fighting essentials'
  },
  TATTOO: {
    id: 'TATTOO',
    name: 'Crew Tattoo',
    emoji: '🐉',
    price: 2500,
    description: 'Inked for life'
  },
  GOLD_CHAIN: {
    id: 'GOLD_CHAIN',
    name: 'Gold Chain',
    emoji: '⛓️',
    price: 2500,
    description: 'Drip or drown'
  },
  GYM_RAT: {
    id: 'GYM_RAT',
    name: 'Gym Membership',
    emoji: '🏋️',
    price: 3000,
    description: 'Get those gains'
  },
  KATANA: {
    id: 'KATANA',
    name: 'Katana',
    emoji: '⚔️',
    price: 3500,
    description: 'Goo\'s weapon of choice'
  },
  GUN_GLASSES: {
    id: 'GUN_GLASSES',
    name: 'Gun\'s Shades',
    emoji: '🕶️',
    price: 4000,
    description: 'The man, the myth, the glasses'
  },
  WHITE_SUIT: {
    id: 'WHITE_SUIT',
    name: 'White Suit',
    emoji: '🤵',
    price: 4500,
    description: 'Charles Choi energy'
  },
  MONEY_STACK: {
    id: 'MONEY_STACK',
    name: 'Workers Stack',
    emoji: '💵',
    price: 5000,
    description: 'Eugene approved'
  },
  
  // ============================================
  // EXPENSIVE ($7,500-15,000) - Iconic Moments
  // ============================================
  SLEEPING: {
    id: 'SLEEPING',
    name: 'Body Swap',
    emoji: '😴',
    price: 7500,
    description: 'Fall asleep, wake up different'
  },
  FIST: {
    id: 'FIST',
    name: 'One Punch',
    emoji: '👊',
    price: 8000,
    description: 'UI Daniel activated'
  },
  INVISIBLE: {
    id: 'INVISIBLE',
    name: 'Invisible',
    emoji: '👻',
    price: 10000,
    description: 'Small Daniel in public'
  },
  KING_CROWN: {
    id: 'KING_CROWN',
    name: 'King\'s Crown',
    emoji: '👑',
    price: 10000,
    description: 'Ruler of the streets'
  },
  BEAST_MODE: {
    id: 'BEAST_MODE',
    name: 'Beast Mode',
    emoji: '🔥',
    price: 12000,
    description: 'Unlimited power awakened'
  },
  FOUR_CREWS: {
    id: 'FOUR_CREWS',
    name: 'Four Crews',
    emoji: '4️⃣',
    price: 12500,
    description: 'The major powers'
  },
  DOG_TAG: {
    id: 'DOG_TAG',
    name: 'God Dog Tag',
    emoji: '🏷️',
    price: 15000,
    description: 'Johan\'s legacy'
  },
  
  // ============================================
  // LEGENDARY ($20,000-50,000) - Ultimate Pins
  // ============================================
  GAPRYONG_FIST: {
    id: 'GAPRYONG_FIST',
    name: 'Gapryong\'s Fist',
    emoji: '✊',
    price: 20000,
    description: 'The legend himself'
  },
  JAMES_LEE: {
    id: 'JAMES_LEE',
    name: 'DG',
    emoji: '🎭',
    price: 25000,
    description: 'The First Generation King'
  },
  GUN_GOO: {
    id: 'GUN_GOO',
    name: 'Gun & Goo',
    emoji: '⚡',
    price: 30000,
    description: 'The untouchable duo'
  },
  THREE_CREWS: {
    id: 'THREE_CREWS',
    name: 'Big 3 Affiliate',
    emoji: '🏆',
    price: 35000,
    description: 'Workers, Big Deal, Hostel'
  },
  UI_DANIEL: {
    id: 'UI_DANIEL',
    name: 'UI Daniel',
    emoji: '💀',
    price: 40000,
    description: 'Unconscious instinct'
  },
  FIRST_GEN: {
    id: 'FIRST_GEN',
    name: '1st Generation',
    emoji: '🐐',
    price: 50000,
    description: 'The OG legends'
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
