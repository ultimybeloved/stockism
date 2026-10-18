// ============================================
// CREWS SYSTEM
// ============================================

export interface Crew {
  id: string;
  name: string;
  color: string;
  emblem: string;
  icon: string;
  members: string[];
}

export interface Mission {
  id: string;
  name: string;
  description: string;
  reward: number;
  checkType: string;
  requirement?: number;
  /** Only offered to players in a crew. */
  crewOnly?: boolean;
}

export interface ShopPin {
  id: string;
  name: string;
  image: string;
  description: string;
  price: number;
  collection: string;
  /** Only buyable once the player's best check-in streak reaches this. */
  requiredCheckinStreak?: number;
}

export interface PinCollection {
  id: string;
  name: string;
  active: boolean;
  limited: boolean;
  expiresAt: number | null;
  pins: string[];
}

export const CREWS: Record<string, Crew> = {
  ALLIED: {
    id: 'ALLIED',
    name: 'Allied',
    color: '#767676',
    emblem: '🏛️',
    icon: '/crews/allied.png',
    members: ['BDNL', 'LDNL', 'VSCO', 'ZACK', 'JAY', 'VIN', 'AHN'],
  },
  BIG_DEAL: {
    id: 'BIG_DEAL',
    name: 'Big Deal',
    color: '#aa8439',
    emblem: '🤝',
    icon: '/crews/big deal.png',
    members: ['JAKE', 'SWRD', 'JSN', 'BRAD', 'LINE', 'SINU', 'LUAH'],
  },
  FIST_GANG: {
    id: 'FIST_GANG',
    name: 'Fist Gang',
    color: '#7e4e42',
    emblem: '👊',
    icon: '/crews/fist gang.png',
    members: [
      'GAP',
      'ELIT',
      'JYNG',
      'TOM',
      'KWON',
      'DNCE',
      'GNTL',
      'MMA',
      'LIAR',
      'NOH',
      'TAXI',
      'HANT',
      'GWON',
      'MNSK',
      'EUNH',
      'SUIT',
      'DOGH',
      'TOAD',
      'POLR',
    ],
  },
  GOD_DOG: {
    id: 'GOD_DOG',
    name: 'God Dog',
    color: '#162141',
    emblem: '🐕',
    icon: '/crews/god dog.png',
    members: ['GDOG', 'MIRO', 'EDEN'],
  },
  HOSTEL: {
    id: 'HOSTEL',
    name: 'Hostel',
    color: '#b1b39e',
    emblem: '🏠',
    icon: '/crews/hostel.png',
    members: ['ELI', 'SLLY', 'CHAE', 'MAX', 'DJO', 'ZAMI', 'RYAN'],
  },
  KITAE_UNION: {
    id: 'KITAE_UNION',
    name: 'Kitae Kim Union',
    color: '#7a1b2e',
    emblem: '🪓',
    icon: '/crews/kitae union.png',
    // Mirrors the SHDW fund. SNGH left Workers for the Union.
    members: [
      'KTAE',
      'DG',
      'GNTL',
      'GOO',
      'SAM',
      'SHMN',
      'SAMC',
      'YONG',
      'PAJU',
      'PHNG',
      'CROW',
      'COP',
      'RYU',
      'SWMP',
      'JEON',
      'SCHN',
      'SIN',
      'TONG',
      'ISU',
      'SNGH',
    ],
  },
  SECRET_FRIENDS: {
    id: 'SECRET_FRIENDS',
    name: 'Secret Friends',
    color: '#f3c404',
    emblem: '🤫',
    icon: '/crews/secret friends.png',
    members: ['GOO', 'LOGN', 'SAM', 'ALEX', 'SHMN'],
  },
  WTJC: {
    id: 'WTJC',
    name: 'White Tiger Job Center',
    color: '#FFFFFF',
    emblem: '🐯',
    icon: '/crews/wtjc.png',
    members: ['TOM', 'SRMK', 'SGUI', 'YCHL', 'SERA', 'MMA', 'LIAR', 'NOH'],
  },
  WORKERS: {
    id: 'WORKERS',
    name: 'Workers',
    color: '#000000',
    emblem: '⚒️',
    icon: '/crews/workers.png',
    members: [
      'WRKR',
      'BANG',
      'CAPG',
      'JYNG',
      'NOMN',
      'NEKO',
      'DOOR',
      'JINJ',
      'DRMA',
      'HYOT',
      'OLDF',
      'SHKO',
      'HIKO',
      'DOC',
      'NO1',
      'DOC2',
      'TAEJ',
      'HPRK',
    ],
  },
  YAMAZAKI: {
    id: 'YAMAZAKI',
    name: 'Yamazaki Syndicate',
    color: '#f3c803',
    emblem: '⛩️',
    icon: '/crews/yamazaki.png',
    members: [
      'GUN',
      'SHNG',
      'SHRO',
      'SHKO',
      'HIKO',
      'SOMI',
      'YADV',
      'REI',
      'IJA',
      'KMSH',
      'SUMO',
      'OYA',
      'TCHI',
      'IKO',
      'YOKO',
      'RED',
      'URAM',
      'BLUE',
      'BRCR',
      'GRVS',
    ],
  },
};

// Create a map for quick lookup
export const CREW_MAP: Record<string, Crew> = {};
Object.values(CREWS).forEach((crew) => {
  CREW_MAP[crew.id] = crew;
});

// ============================================
// SHOP PINS - LOOKISM THEMED
// ============================================

export const PIN_COLLECTIONS: Record<string, PinCollection> = {
  alpha_rewards: {
    id: 'alpha_rewards',
    name: 'Alpha Tester Rewards',
    active: false, // retired from shop — kept so existing owners still display the badge
    limited: true,
    expiresAt: null,
    pins: ['alpha_tester'],
  },
  // j_high_og5 collection removed — it used ripped official collab art. Owners
  // were refunded (base price + 50%) via the one-time refundJHighPins admin op.
  // The 2026-10 drop: original pixel art, always on sale.
  shop_2026: {
    id: 'shop_2026',
    name: 'Shop Pins',
    active: true,
    limited: false,
    expiresAt: null,
    pins: ['black_card', 'ui_eye', 'mongkol_gold', 'newsboy_cap', 'polycoria', 'shiba', 'mongkol_red'],
  },
};

export const SHOP_PINS: Record<string, ShopPin> = {
  alpha_tester: {
    id: 'alpha_tester',
    name: 'Alpha Tester',
    image: 'ui/stockism.svg',
    description: 'Exclusive badge for early supporters',
    price: 1,
    collection: 'alpha_rewards',
  },
  // J High pins (jay/jace/vasco/zack/daniel) removed — ripped official art.
  black_card: {
    id: 'black_card',
    name: 'Black Card',
    image: 'shop/black_card.svg',
    description: 'A card for players who never check the price.',
    price: 100000,
    collection: 'shop_2026',
  },
  ui_eye: {
    id: 'ui_eye',
    name: 'Ultra-Instinct',
    image: 'shop/ui_eye.svg',
    description: 'An eye that sees every move coming.',
    price: 75000,
    collection: 'shop_2026',
  },
  mongkol_gold: {
    id: 'mongkol_gold',
    name: 'Gold Mongkol',
    image: 'shop/mongkol_gold.svg',
    description: "A gold fighter's headband.",
    price: 50000,
    collection: 'shop_2026',
  },
  newsboy_cap: {
    id: 'newsboy_cap',
    name: "Gapryong's Cap",
    image: 'shop/newsboy_cap.svg',
    description: 'A newsboy cap fit for a legend.',
    price: 50000,
    collection: 'shop_2026',
  },
  polycoria: {
    id: 'polycoria',
    name: 'Polycoria',
    image: 'shop/polycoria.svg',
    description: 'An eye with more than one pupil.',
    price: 35000,
    collection: 'shop_2026',
  },
  shiba: {
    id: 'shiba',
    name: 'Shiba',
    image: 'shop/shiba.svg',
    description: 'A very good boy.',
    price: 10000,
    collection: 'shop_2026',
  },
  mongkol_red: {
    id: 'mongkol_red',
    name: 'Red Mongkol',
    image: 'shop/mongkol_red.svg',
    description: "A red fighter's headband.",
    price: 5000,
    collection: 'shop_2026',
  },
};

export const getActiveShopPins = () => {
  return Object.values(PIN_COLLECTIONS)
    .filter((c) => c.active)
    .map((c) => ({
      ...c,
      pins: c.pins.map((id) => SHOP_PINS[id]).filter((p): p is ShopPin => !!p),
    }));
};

// ============================================
// DAILY MISSIONS
// ============================================

// Missions 2.0 (2026-10-22). Every mission rewards a real trade or a portfolio
// balance you keep, and throwaway trades can't finish them:
// - a trade counts only if it is worth 1% of your net worth ($50 to $500,
//   rules/missions missionMinTrade)
// - a buy counts only while you still hold the shares when you claim
// - a sell counts only on shares you've held a day or more
// Players without a crew get the missions not marked crewOnly.
export const DAILY_MISSIONS: Record<string, Mission> = {
  BUY_CREW_MEMBER: {
    id: 'BUY_CREW_MEMBER',
    name: 'Crew Support',
    description: 'Buy a member of your crew and keep the shares',
    reward: 100,
    checkType: 'BUY_CREW',
    crewOnly: true,
  },
  RIVAL_TRADER: {
    id: 'RIVAL_TRADER',
    name: 'Rival Trader',
    description: "Buy a rival crew's member and keep the shares",
    reward: 75,
    checkType: 'BUY_RIVAL',
    crewOnly: true,
  },
  UNDERDOG_INVESTOR: {
    id: 'UNDERDOG_INVESTOR',
    name: 'Underdog Investor',
    description: 'Buy a stock priced under $20 and keep the shares',
    reward: 75,
    checkType: 'BUY_UNDERDOG',
  },
  BARGAIN_HUNTER: {
    id: 'BARGAIN_HUNTER',
    name: 'Bargain Hunter',
    description: 'Buy a stock that is down 5%+ this week and keep the shares',
    reward: 100,
    checkType: 'BUY_BARGAIN',
    requirement: 5,
  },
  SPREAD_OUT: {
    id: 'SPREAD_OUT',
    name: 'Spread Out',
    description: 'Buy 3 different stocks today and keep them',
    reward: 125,
    checkType: 'BUY_SPREAD',
    requirement: 3,
  },
  PROFIT_TAKER: {
    id: 'PROFIT_TAKER',
    name: 'Profit Taker',
    description: "Sell shares you've held at least a day",
    reward: 75,
    checkType: 'SELL_HELD',
  },
  CUT_LOSSES: {
    id: 'CUT_LOSSES',
    name: 'Cut Your Losses',
    description: "Sell shares you've held at least a day for less than you paid",
    reward: 75,
    checkType: 'SELL_LOSS',
  },
  ORDER_FILLED: {
    id: 'ORDER_FILLED',
    name: 'Order Filled',
    description: 'Have a limit order fill today',
    reward: 100,
    checkType: 'LIMIT_FILL',
  },
  CREW_MAJORITY: {
    id: 'CREW_MAJORITY',
    name: 'Crew Majority',
    description: 'Have 50%+ of your stock value in your crew',
    reward: 125,
    checkType: 'CREW_MAJORITY',
    requirement: 50,
    crewOnly: true,
  },
};

// ============================================
// WEEKLY MISSIONS
// ============================================

// Each week is your Call plus one mission from WEEKLY_MISSIONS. A week runs from
// the Thursday reopen (21:00 UTC) to the next one (rules/missions).

// The Call: pick a stock and up or down from the Thursday reopen to the end of
// Saturday. It is scored on the next chapter halt, from the price when the halt
// began to the price at the 20:55 lock, and paid automatically. A move under
// minMove either way is a push and pays nothing.
export const WEEKLY_CALL = {
  reward: 500,
  bigReward: 1000,
  /** Paid on every Call when no stock moved during the halt (a chapter break). */
  breakReward: 250,
  minMove: 0.01,
  bigMove: 0.1,
};

export const CALL_MISSION: Mission = {
  id: 'WEEKLY_CALL',
  name: 'Your Call',
  description: 'Pick a stock and call it up or down for the next chapter',
  reward: WEEKLY_CALL.reward,
  checkType: 'CALL',
};

export const WEEKLY_MISSIONS: Record<string, Mission> = {
  TRADING_STREAK: {
    id: 'TRADING_STREAK',
    name: 'Trading Streak',
    description: 'Make a real trade on 5 different days',
    reward: 600,
    checkType: 'WEEKLY_TRADING_DAYS',
    requirement: 5,
  },
  DAILY_GRINDER: {
    id: 'DAILY_GRINDER',
    name: 'Daily Grinder',
    description: 'Check in on 7 days this week',
    reward: 500,
    checkType: 'WEEKLY_CHECKIN_STREAK',
    requirement: 7,
  },
  BUY_AND_HOLD: {
    id: 'BUY_AND_HOLD',
    name: 'Buy and Hold',
    description: 'Buy a stock Thursday to Saturday and still own it on Wednesday',
    reward: 500,
    checkType: 'WEEKLY_BUY_HOLD',
  },
  DIVERSIFIED: {
    id: 'DIVERSIFIED',
    name: 'Diversified',
    description: 'Hold 5+ stocks with none over 40% of your stock value',
    reward: 500,
    checkType: 'WEEKLY_DIVERSIFIED',
    requirement: 5,
  },
  CREW_MAXIMALIST: {
    id: 'CREW_MAXIMALIST',
    name: 'Crew Maximalist',
    description: 'Have 80%+ of your stock value in your crew',
    reward: 600,
    checkType: 'WEEKLY_CREW_PERCENT',
    requirement: 80,
    crewOnly: true,
  },
  PORTFOLIO_BUILDER: {
    id: 'PORTFOLIO_BUILDER',
    name: 'Portfolio Builder',
    description: 'Grow your portfolio value by 15%+ this week',
    reward: 750,
    checkType: 'WEEKLY_PORTFOLIO_GROWTH',
    requirement: 15, // percent growth from the week's starting value
  },
};

// ============================================
// CREW RIVALRIES
// ============================================
// Crew missions until 2026-10-22. Every Thursday reopen crews are paired 1 vs 1
// by how many active players they have (a 3-way when the count is odd), never
// the same opponent two weeks running. A crew's score is the share of its
// active members (checked in or claimed a mission that week) who finished
// qualifyMissions missions while in the crew. Members who qualified are paid at
// the next reopen: winReward on the winning crew, loseReward on the losing one,
// times the underdog bonus. A tie is a win for both. The winners' crest glows
// for the next week.
export const RIVALRY = {
  qualifyMissions: 5,
  winReward: 1500,
  loseReward: 500,
};

const seededShuffle = <T>(items: T[], seed: number): T[] => {
  const out = [...items];
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

const missionPool = (missions: Record<string, Mission>, crewId: string | null | undefined) =>
  Object.values(missions).filter((m) => !m.crewOnly || !!crewId);

const textSeed = (text: string) => text.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

// The week's missions: the Call, then one weekly picked by crew and week.
export const getWeeklyMissions = (crewId: string | null | undefined, weekId: string, rerollSeed = 0): Mission[] => {
  const pool = missionPool(WEEKLY_MISSIONS, crewId);
  const seed = textSeed(`${crewId || 'solo'}-${weekId}`) * 31 + rerollSeed;
  return [CALL_MISSION, pool[Math.abs(seed) % pool.length]!];
};

// Today's 3 daily missions, picked by date and crew.
export const getDailyMissions = (today: string, crewId: string | null | undefined, rerollSeed = 0): Mission[] => {
  const dateSeed = today.split('-').reduce((acc, num) => acc + parseInt(num), 0);
  const seed = dateSeed + (crewId ? textSeed(crewId) : 0) + rerollSeed;
  return seededShuffle(missionPool(DAILY_MISSIONS, crewId), seed).slice(0, 3);
};

// ============================================
// PIN SLOT COSTS
// ============================================

export const PIN_SLOT_COSTS = {
  EXTRA_ACHIEVEMENT_SLOT: 5000,
  EXTRA_SHOP_SLOT: 7500,
};

// ============================================
// UNDERDOG BONUS
// ============================================

// Crews with fewer active players earn a reward multiplier for the following
// week. Computed every Thursday reopen by weeklyCrewRankings from last week's activity
// (trades, mission claims, or check-ins) and stored in the public
// market/crewStats doc:
//   multiplier = 1 + ((maxActive - crewActive) / maxActive) * (MAX - 1)
// The most active crew gets 1x; an empty crew gets the full max. It applies to
// daily and weekly missions and rivalry payouts. Because it recomputes weekly, an
// influx of new members shrinks the bonus on its own — no cap juggling needed.
export const CREW_UNDERDOG_MULT_MAX = 2;

// Read a crew's current multiplier off the market/crewStats doc.
// Falls back to 1x when the doc hasn't been computed yet.
export const getCrewMultiplier = (
  crewStats: { multipliers?: Record<string, unknown> } | null | undefined,
  crewId: string,
): number => {
  const m = crewStats?.multipliers?.[crewId];
  return typeof m === 'number' && m >= 1 ? Math.min(m, CREW_UNDERDOG_MULT_MAX) : 1;
};

// ============================================
// LEAVE PENALTY + REJOIN LOCKOUT
// ============================================

// Portfolio share (cash + holdings) taken when leaving or switching crews.
// Single source of truth for backend (via functions/src/shared/constants/) and all
// frontend warning text. Was 0.15 until 2026-07-19; lowered alongside the
// crew overhaul so players can migrate to underdog crews.
export const CREW_SWITCH_PENALTY = 0.05;

// Leaving a crew locks you out of that specific crew for 30 days (stored on
// the user doc as crewLockouts: { crewId: expiresAtMs }). This replaced the
// old permanent exile, which made every crew choice one-way and trapped
// players in dead crews forever.
export const CREW_REJOIN_LOCKOUT_DAYS = 30;

// ============================================
// FREE SWITCH EVENT
// ============================================
// A launch window where moving INTO one crew is free: no portfolio penalty, no
// 30-day lockout on the crew being left, and a pre-existing lockout on the
// event crew does not block entry. Everything else still applies — the 24h
// change cooldown, the debt check, and leaving the event crew later costs the
// normal penalty.
//
// Self-expiring: once endsAt passes, switching behaves normally again with no
// deploy needed to turn it off. Set to null when no event is running.
//
// The server derives all of this from the destination crew itself. The client
// can never claim a free switch.
export const CREW_SWITCH_EVENT = {
  crewId: 'KITAE_UNION',
  endsAt: Date.UTC(2026, 7, 14, 21, 0), // 2026-08-14 21:00 UTC
};

export const isFreeSwitchTarget = (crewId: string, now: number = Date.now()): boolean =>
  !!CREW_SWITCH_EVENT && crewId === CREW_SWITCH_EVENT.crewId && now < CREW_SWITCH_EVENT.endsAt;
