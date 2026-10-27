// GENERATED from src/crews.ts by `npm run sync:chars`. Do not edit.
// ============================================
// CREWS SYSTEM
// ============================================

import { flairCrewsOf } from './rules/flairCrews';

export interface Crew {
  id: string;
  name: string;
  color: string;
  emblem: string;
  icon: string;
  /** The crew's fund ticker; null = deliberately none. */
  etf: string | null;
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
  /** Only offered to players whose crew has flair crews. */
  flairOnly?: boolean;
  /** In the rotation from this UTC date (dailies) or week id (weeklies) on. */
  addedFrom?: string;
  /** Daily only: offered only to players holding a short (holdsShortForMissions). */
  shortHoldersOnly?: boolean;
  /** Out of the rotation from this UTC date (dailies) or week id (weeklies) on. */
  retiredFrom?: string;
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
    etf: 'ALLY',
    members: ['BDNL', 'LDNL', 'VSCO', 'ZACK', 'JAY', 'VIN', 'AHN'],
  },
  BIG_DEAL: {
    id: 'BIG_DEAL',
    name: 'Big Deal',
    color: '#aa8439',
    emblem: '🤝',
    icon: '/crews/big deal.png',
    etf: 'DEAL',
    members: ['JAKE', 'SWRD', 'JSN', 'BRAD', 'LINE', 'SINU', 'LUAH', 'RYAN'],
  },
  FIST_GANG: {
    id: 'FIST_GANG',
    name: 'Fist Gang',
    color: '#7e4e42',
    emblem: '👊',
    icon: '/crews/fist gang.png',
    etf: 'FIST',
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
    etf: null,
    members: ['GDOG', 'MIRO', 'EDEN'],
  },
  HOSTEL: {
    id: 'HOSTEL',
    name: 'Hostel',
    color: '#b1b39e',
    emblem: '🏠',
    icon: '/crews/hostel.png',
    etf: 'HSTL',
    members: ['ELI', 'SLLY', 'CHAE', 'MAX', 'DJO', 'ZAMI'],
  },
  KITAE_UNION: {
    id: 'KITAE_UNION',
    name: "Kitae Kim's Union",
    color: '#7a1b2e',
    emblem: '🪓',
    icon: '/crews/kitae union.png',
    // Mirrors the SHDW fund. SNGH left Workers for the Union.
    etf: 'SHDW',
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
    etf: 'SCRT',
    members: ['GOO', 'LOGN', 'SAM', 'ALEX', 'SHMN'],
  },
  WTJC: {
    id: 'WTJC',
    name: 'White Tiger Job Center',
    color: '#FFFFFF',
    emblem: '🐯',
    icon: '/crews/wtjc.png',
    etf: 'WTJC',
    members: ['TOM', 'SRMK', 'SGUI', 'YCHL', 'SERA', 'MMA', 'LIAR', 'NOH'],
  },
  WORKERS: {
    id: 'WORKERS',
    name: 'Workers',
    color: '#000000',
    emblem: '⚒️',
    icon: '/crews/workers.png',
    etf: 'VVIP',
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
    etf: 'YAMA',
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

// Missions 3 (2026-10-27): a trade counts if it is at least 1 share or $50
// worth (rules/missions missionTradeCounts). Nothing has to be kept or held a
// day. Missions still never pay for just owning something: each one is a trade
// you made, or a percentage of your portfolio you keep.
// Players without a crew get the missions not marked crewOnly.
export const DAILY_MISSIONS: Record<string, Mission> = {
  BUY_CREW_MEMBER: {
    id: 'BUY_CREW_MEMBER',
    name: 'Crew Support',
    description: 'Buy any stock from your crew',
    reward: 100,
    checkType: 'BUY_CREW',
    crewOnly: true,
  },
  RIVAL_TRADER: {
    id: 'RIVAL_TRADER',
    name: 'Rival Trader',
    description: 'Buy a stock from another crew',
    reward: 75,
    checkType: 'BUY_RIVAL',
    crewOnly: true,
  },
  UNDERDOG_INVESTOR: {
    id: 'UNDERDOG_INVESTOR',
    name: 'Underdog Investor',
    description: 'Buy a stock priced under $20',
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
    retiredFrom: '2026-10-29', // merged into Buy the Dip
  },
  SPREAD_OUT: {
    id: 'SPREAD_OUT',
    name: 'Spread Out',
    description: 'Buy 3 different stocks',
    reward: 125,
    checkType: 'BUY_SPREAD',
    requirement: 3,
  },
  PROFIT_TAKER: {
    id: 'PROFIT_TAKER',
    name: 'Profit Taker',
    description: 'Sell a stock for more than you paid',
    reward: 75,
    checkType: 'SELL_HELD',
  },
  CUT_LOSSES: {
    id: 'CUT_LOSSES',
    name: 'Cut Your Losses',
    description: 'Sell a stock for less than you paid',
    reward: 75,
    checkType: 'SELL_LOSS',
  },
  ORDER_FILLED: {
    id: 'ORDER_FILLED',
    name: 'Order Filled',
    description: 'Have a limit order fill today',
    reward: 100,
    checkType: 'LIMIT_FILL',
    retiredFrom: '2026-10-25',
  },
  CREW_MAJORITY: {
    id: 'CREW_MAJORITY',
    name: 'Crew Majority',
    description: 'Have 50%+ of your stock value in your crew',
    reward: 125,
    checkType: 'CREW_MAJORITY',
    requirement: 50,
    crewOnly: true,
    retiredFrom: '2026-10-24',
  },
  SHORT_SELLER: {
    id: 'SHORT_SELLER',
    name: 'Short Seller',
    description: 'Open a short',
    reward: 100,
    checkType: 'SHORT_OPEN',
  },
  COVERED: {
    id: 'COVERED',
    name: 'Covered',
    description: 'Close a short',
    reward: 100,
    checkType: 'COVER_PROFIT',
    shortHoldersOnly: true,
  },
  BASKET_BUYER: {
    id: 'BASKET_BUYER',
    name: 'Basket Buyer',
    description: 'Buy any ETF',
    reward: 75,
    checkType: 'BUY_ETF',
  },
  BUY_THE_DIP: {
    id: 'BUY_THE_DIP',
    name: 'Buy the Dip',
    description: 'Buy a stock that is down today',
    reward: 75,
    checkType: 'BUY_DIP',
  },
  RIDE_THE_WAVE: {
    id: 'RIDE_THE_WAVE',
    name: 'Ride the Wave',
    description: 'Buy a stock that is up today',
    reward: 75,
    checkType: 'BUY_MOMENTUM',
    requirement: 5,
  },
  BLUE_CHIP: {
    id: 'BLUE_CHIP',
    name: 'Blue Chip',
    description: 'Buy a Legendary or Epic stock',
    reward: 100,
    checkType: 'BUY_BLUE_CHIP',
  },
  FLAIR_SUPPORT: {
    id: 'FLAIR_SUPPORT',
    name: 'Flair Support',
    description: 'Buy any stock from your flair crew',
    reward: 100,
    checkType: 'BUY_FLAIR',
    crewOnly: true,
    flairOnly: true,
    addedFrom: '2026-10-29',
  },
  CREW_FUND: {
    id: 'CREW_FUND',
    name: 'Crew Fund',
    description: "Buy your crew's ETF",
    reward: 100,
    checkType: 'BUY_CREW_ETF',
    crewOnly: true,
    addedFrom: '2026-10-29',
  },
};

// ============================================
// WEEKLY MISSIONS
// ============================================

// Each week is Opening Bell plus one mission from WEEKLY_MISSIONS. A week runs
// from the Thursday reopen (21:00 UTC) to the next one (rules/missions).

// Opening Bell is every week's first mission: an order that filled in the
// opening auction that started the week (rules/missions auctionWeekId). The
// auction fills minutes before the week begins, so it can't be a surprise draw.
export const OPENING_BELL: Mission = {
  id: 'OPENING_BELL',
  name: 'Opening Bell',
  description: 'Make a trade in the first 24 hours of the week',
  reward: 500,
  checkType: 'WEEKLY_AUCTION',
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
    description: 'Check in on 5 days this week',
    reward: 500,
    checkType: 'WEEKLY_CHECKIN_STREAK',
    requirement: 5,
  },
  BUY_AND_HOLD: {
    id: 'BUY_AND_HOLD',
    name: 'Buy and Hold',
    description: 'Buy a stock Thursday to Saturday and still own it on Wednesday',
    reward: 500,
    checkType: 'WEEKLY_BUY_HOLD',
    retiredFrom: '2026-10-29',
  },
  DIVERSIFIED: {
    id: 'DIVERSIFIED',
    name: 'Diversified',
    description: 'Hold 5+ stocks with none over 40% of your stock value',
    reward: 500,
    checkType: 'WEEKLY_DIVERSIFIED',
    requirement: 5,
    retiredFrom: '2026-10-29',
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
  BEAT_THE_MARKET: {
    id: 'BEAT_THE_MARKET',
    name: 'Beat the Market',
    description: 'Grow your portfolio more than the market index this week',
    reward: 600,
    checkType: 'WEEKLY_BEAT_MARKET',
  },
  SHOPPING_SPREE: {
    id: 'SHOPPING_SPREE',
    name: 'Shopping Spree',
    description: 'Buy 5 different stocks this week',
    reward: 500,
    checkType: 'WEEKLY_BUY_SPREAD',
    requirement: 5,
  },
  MISSION_MACHINE: {
    id: 'MISSION_MACHINE',
    name: 'Mission Machine',
    description: 'Finish 10 daily missions this week',
    reward: 600,
    checkType: 'WEEKLY_DAILY_CLAIMS',
    requirement: 10,
  },
  FORTUNE_TELLER: {
    id: 'FORTUNE_TELLER',
    name: 'Fortune Teller',
    description: 'Place a prediction bet or buy Futures this week',
    reward: 500,
    checkType: 'WEEKLY_PREDICTION',
  },
  DIP_COLLECTOR: {
    id: 'DIP_COLLECTOR',
    name: 'Dip Collector',
    description: 'Buy 3 different stocks that are down 10%+ this week',
    reward: 600,
    checkType: 'WEEKLY_BUY_DIPS',
    requirement: 3,
  },
  STEADY_CLIMBER: {
    id: 'STEADY_CLIMBER',
    name: 'Steady Climber',
    description: 'Grow your portfolio value by 5%+ this week',
    reward: 400,
    checkType: 'WEEKLY_PORTFOLIO_GROWTH',
    requirement: 5,
    addedFrom: '2026-10-29',
  },
  CREW_TOUR: {
    id: 'CREW_TOUR',
    name: 'Crew Tour',
    description: 'Buy stocks from 3 different crews this week',
    reward: 500,
    checkType: 'WEEKLY_CREW_TOUR',
    requirement: 3,
    addedFrom: '2026-10-29',
  },
  FLAIR_TOUR: {
    id: 'FLAIR_TOUR',
    name: 'Flair Tour',
    description: 'Buy 3 different stocks from your flair crew this week (or all of them, if it has fewer)',
    reward: 600,
    checkType: 'WEEKLY_FLAIR_TOUR',
    requirement: 3,
    crewOnly: true,
    flairOnly: true,
    addedFrom: '2026-10-29',
  },
};

// ============================================
// CREW RIVALRIES
// ============================================
// Crew missions until 2026-10-22. Every Thursday reopen crews are paired 1 vs 1
// by how many active players they have (a 3-way when the count is odd), never
// the same opponent two weeks running. A crew's score is the share of its
// members who finished at least one mission that week who finished
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

// The missions on offer on `when` (a UTC date, or a week id for weeklies).
// Flair missions go to every crew with flair crews, whatever flair the player
// picked, so changing flair never reshuffles the list.
const missionPool = (missions: Record<string, Mission>, crewId: string | null | undefined, when: string) =>
  Object.values(missions).filter(
    (m) =>
      (!m.crewOnly || !!crewId) &&
      (!m.flairOnly || flairCrewsOf(crewId).length > 0) &&
      (!m.addedFrom || when >= m.addedFrom) &&
      (!m.retiredFrom || when < m.retiredFrom),
  );

const textSeed = (text: string) => text.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

// The week's missions: Opening Bell, then one weekly picked by crew and week.
export const getWeeklyMissions = (crewId: string | null | undefined, weekId: string, rerollSeed = 0): Mission[] => {
  const pool = missionPool(WEEKLY_MISSIONS, crewId, weekId);
  const seed = textSeed(`${crewId || 'solo'}-${weekId}`) * 31 + rerollSeed;
  return [OPENING_BELL, pool[Math.abs(seed) % pool.length]!];
};

// From this UTC date Covered goes only to short holders, until 2026-10-29, when
// any close counts and everyone can be offered it. Earlier days keep the old
// pool so no list reshuffles mid-day.
export const DAILY_POOL_CHANGE = '2026-10-24';
const SHORTS_ONLY_UNTIL = '2026-10-29';

// Today's 3 daily missions, picked by date and crew. holdsShort comes from
// rules/missionProgress holdsShortForMissions.
export const getDailyMissions = (
  today: string,
  crewId: string | null | undefined,
  rerollSeed = 0,
  holdsShort = false,
): Mission[] => {
  const dateSeed = today.split('-').reduce((acc, num) => acc + parseInt(num), 0);
  const seed = dateSeed + (crewId ? textSeed(crewId) : 0) + rerollSeed;
  const shortsOnly = (m: Mission) =>
    today >= DAILY_POOL_CHANGE && today < SHORTS_ONLY_UNTIL && !!m.shortHoldersOnly && !holdsShort;
  const pool = missionPool(DAILY_MISSIONS, crewId, today).filter((m) => !shortsOnly(m));
  return seededShuffle(pool, seed).slice(0, 3);
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
// A window where each player gets ONE free switch into any of the event's
// crews: no portfolio penalty, no 30-day lockout on the crew being left, and a
// pre-existing lockout on the destination does not block entry. Everything
// else still applies: the 24h change cooldown, the debt check, and leaving
// later costs the normal penalty. Joining from no crew is always free and
// doesn't use it up.
//
// The switch that uses it stamps `freeCrewSwitchUsed: <event id>` on the user
// doc, so a new event with a new id hands everyone a fresh one.
//
// Self-expiring: once endsAt passes, switching behaves normally again with no
// deploy needed to turn it off. Set to null when no event is running.
//
// The server derives all of this from the destination crew and the user doc.
// The client can never claim a free switch.
export interface CrewSwitchEvent {
  id: string;
  crewIds: string[];
  endsAt: number;
}

// Flair crews launch: one free move into any crew that has flair crews, for
// players who want to rep one. Keep crewIds in step with src/rules/flairCrews.ts.
export const CREW_SWITCH_EVENT: CrewSwitchEvent | null = {
  id: 'flair_2026_10',
  crewIds: ['ALLIED', 'BIG_DEAL', 'SECRET_FRIENDS', 'HOSTEL', 'FIST_GANG', 'WORKERS', 'KITAE_UNION'],
  endsAt: Date.UTC(2026, 10, 3, 21, 0), // 2026-11-03 21:00 UTC
};

/** True while the event runs and this player hasn't used their free switch yet. */
export const hasFreeSwitch = (
  player: { freeCrewSwitchUsed?: unknown } | null | undefined,
  now: number = Date.now(),
): boolean =>
  !!CREW_SWITCH_EVENT && now < CREW_SWITCH_EVENT.endsAt && player?.freeCrewSwitchUsed !== CREW_SWITCH_EVENT.id;

/** True when this player switching into crewId right now would be free. */
export const isFreeSwitchTarget = (
  crewId: string,
  player: { freeCrewSwitchUsed?: unknown } | null | undefined,
  now: number = Date.now(),
): boolean => hasFreeSwitch(player, now) && CREW_SWITCH_EVENT!.crewIds.includes(crewId);
