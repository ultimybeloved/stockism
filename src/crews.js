// ============================================
// CREWS SYSTEM
// ============================================

export const CREWS = {
  ALLIED: {
    id: 'ALLIED',
    name: 'Allied',
    color: '#FFD700',
    emblem: '🏛️',
    members: ['BDNL', 'LDNL', 'VSCO', 'ZACK', 'JAY', 'VIN', 'AHN']
  },
  BIG_DEAL: {
    id: 'BIG_DEAL',
    name: 'Big Deal',
    color: '#3B82F6',
    emblem: '🤝',
    members: ['JAKE', 'SWRD', 'JSN', 'BRAD', 'LINE', 'SINU']
  },
  FIST_GANG: {
    id: 'FIST_GANG',
    name: 'Fist Gang',
    color: '#EF4444',
    emblem: '👊',
    members: ['GAP', 'ELIT', 'JYNG', 'TOM']
  },
  GOD_DOG: {
    id: 'GOD_DOG',
    name: 'God Dog',
    color: '#8B5CF6',
    emblem: '🐕',
    members: ['GDOG']
  },
  SECRET_FRIENDS: {
    id: 'SECRET_FRIENDS',
    name: 'Secret Friends',
    color: '#EC4899',
    emblem: '🤫',
    members: ['GOO', 'LOGN', 'SAM']
  },
  HOSTEL: {
    id: 'HOSTEL',
    name: 'Hostel',
    color: '#F97316',
    emblem: '🏠',
    members: ['ELI', 'SLLY', 'CHAE']
  },
  WTJC: {
    id: 'WTJC',
    name: 'WTJC',
    color: '#14B8A6',
    emblem: '🐯',
    members: ['TOM', 'SRMK']
  },
  WORKERS: {
    id: 'WORKERS',
    name: 'Workers',
    color: '#22C55E',
    emblem: '⚒️',
    members: ['WRKR', 'BANG', 'CAPG', 'JYNG', 'NOMN']
  },
  YAMAZAKI: {
    id: 'YAMAZAKI',
    name: 'Yamazaki Syndicate',
    color: '#DC2626',
    emblem: '⛩️',
    members: ['GUN', 'SHNG', 'SHRO']
  }
};

// Create a map for quick lookup
export const CREW_MAP = {};
Object.values(CREWS).forEach(crew => {
  CREW_MAP[crew.id] = crew;
});

// ============================================
// SHOP PINS
// ============================================

export const SHOP_PINS = {
  // Cheap ($500-1,000)
  STAR: {
    id: 'STAR',
    name: 'Star',
    emoji: '⭐',
    price: 500,
    description: 'A simple star'
  },
  FIRE: {
    id: 'FIRE',
    name: 'Fire',
    emoji: '🔥',
    price: 500,
    description: 'You\'re on fire'
  },
  LIGHTNING: {
    id: 'LIGHTNING',
    name: 'Lightning',
    emoji: '⚡',
    price: 750,
    description: 'Quick and powerful'
  },
  SKULL: {
    id: 'SKULL',
    name: 'Skull',
    emoji: '💀',
    price: 1000,
    description: 'Fear me'
  },
  CROWN_BASIC: {
    id: 'CROWN_BASIC',
    name: 'Bronze Crown',
    emoji: '👑',
    price: 1000,
    description: 'Royalty starter pack'
  },

  // Mid ($2,000-5,000)
  GLASSES: {
    id: 'GLASSES',
    name: 'Glasses',
    emoji: '👓',
    price: 2000,
    description: 'See clearly now'
  },
  CIGARETTE: {
    id: 'CIGARETTE',
    name: 'Cigarette',
    emoji: '🚬',
    price: 2500,
    description: 'Cool and composed'
  },
  BANDANA: {
    id: 'BANDANA',
    name: 'Bandana',
    emoji: '🎀',
    price: 2500,
    description: 'Style points'
  },
  KNIFE: {
    id: 'KNIFE',
    name: 'Knife',
    emoji: '🗡️',
    price: 3000,
    description: 'Watch your back'
  },
  MUSCLE: {
    id: 'MUSCLE',
    name: 'Muscle',
    emoji: '💪',
    price: 3500,
    description: 'Strength is everything'
  },
  MONEY_BAG: {
    id: 'MONEY_BAG',
    name: 'Money Bag',
    emoji: '💰',
    price: 5000,
    description: 'Filthy rich'
  },

  // Expensive ($10,000-25,000)
  DIAMOND: {
    id: 'DIAMOND',
    name: 'Diamond',
    emoji: '💎',
    price: 10000,
    description: 'Unbreakable'
  },
  GHOST: {
    id: 'GHOST',
    name: 'Ghost',
    emoji: '👻',
    price: 12000,
    description: 'Now you see me...'
  },
  DRAGON: {
    id: 'DRAGON',
    name: 'Dragon',
    emoji: '🐉',
    price: 15000,
    description: 'Legendary beast'
  },
  ALIEN: {
    id: 'ALIEN',
    name: 'Alien',
    emoji: '👽',
    price: 18000,
    description: 'Out of this world'
  },
  INFINITY: {
    id: 'INFINITY',
    name: 'Infinity',
    emoji: '♾️',
    price: 25000,
    description: 'Unlimited power'
  }
};

// Create array sorted by price for shop display
export const SHOP_PINS_LIST = Object.values(SHOP_PINS).sort((a, b) => a.price - b.price);

// ============================================
// DAILY MISSIONS
// ============================================

export const DAILY_MISSIONS = {
  BUY_CREW_MEMBER: {
    id: 'BUY_CREW_MEMBER',
    name: 'Crew Support',
    description: 'Buy shares of any crew member',
    reward: 50,
    checkType: 'BUY_CREW'
  },
  HOLD_CREW_SHARES: {
    id: 'HOLD_CREW_SHARES',
    name: 'Loyal Holder',
    description: 'Hold 10+ shares of crew members',
    reward: 25,
    checkType: 'HOLD_CREW',
    requirement: 10
  },
  MAKE_TRADES: {
    id: 'MAKE_TRADES',
    name: 'Active Trader',
    description: 'Make 3 trades today',
    reward: 30,
    checkType: 'TRADE_COUNT',
    requirement: 3
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
