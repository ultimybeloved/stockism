// ============================================
// ACHIEVEMENTS SYSTEM
// ============================================

export interface Achievement {
  id: string;
  name: string;
  emoji: string;
  description: string;
  hint: string;
  /** Badge image under public/pins/ (pixel art). Shown instead of the emoji. */
  icon?: string;
  revocable?: boolean;
}

export const ACHIEVEMENTS = {
  // Trading milestones
  FIRST_BLOOD: {
    id: 'FIRST_BLOOD',
    name: 'First Blood',
    emoji: '🎯',
    icon: 'achievements/first_blood.svg',
    description: 'Make your first trade',
    hint: 'Buy or sell any stock',
  },
  SHARK: {
    id: 'SHARK',
    name: 'Shark',
    emoji: '🦈',
    icon: 'achievements/shark.svg',
    description: 'Execute a single trade worth $1,000+',
    hint: 'Go big or go home',
  },
  DIVERSIFIED: {
    id: 'DIVERSIFIED',
    name: 'Diversified',
    emoji: '🎨',
    icon: 'achievements/diversified.svg',
    description: 'Hold 5+ different characters at once',
    hint: "Don't put all your eggs in one basket",
  },

  // Profit milestones
  BULL_RUN: {
    id: 'BULL_RUN',
    name: 'Bull Run',
    emoji: '📈',
    icon: 'achievements/bull_run.svg',
    description: 'Sell a stock for 25%+ profit',
    hint: 'Buy low, sell high',
  },
  DIAMOND_HANDS: {
    id: 'DIAMOND_HANDS',
    name: 'Diamond Hands',
    emoji: '🙌',
    icon: 'achievements/diamond_hands.svg',
    description: 'Hold through a 30% dip and recover to profit',
    hint: 'Hold strong through the storm',
  },
  COLD_BLOODED: {
    id: 'COLD_BLOODED',
    name: 'Cold Blooded',
    emoji: '❄️',
    icon: 'achievements/cold_blooded.svg',
    description: 'Profit from closing a short position',
    hint: 'Bet against the market and win',
  },

  // Portfolio milestones
  BROKE_2K: {
    id: 'BROKE_2K',
    name: 'Breaking Even... Kinda',
    emoji: '💵',
    icon: 'achievements/broke_2k.svg',
    description: 'Reach $2,500 portfolio value',
    hint: 'Build your wealth',
  },
  BROKE_5K: {
    id: 'BROKE_5K',
    name: 'High Roller',
    emoji: '🎰',
    icon: 'achievements/broke_5k.svg',
    description: 'Reach $5,000 portfolio value',
    hint: 'Keep growing',
  },
  BROKE_10K: {
    id: 'BROKE_10K',
    name: 'Big Shot',
    emoji: '🌟',
    icon: 'achievements/broke_10k.svg',
    description: 'Reach $10,000 portfolio value',
    hint: "You're getting serious",
  },
  BROKE_25K: {
    id: 'BROKE_25K',
    name: 'Tycoon',
    emoji: '🏛️',
    icon: 'achievements/broke_25k.svg',
    description: 'Reach $25,000 portfolio value',
    hint: 'Market domination',
  },
  BROKE_50K: {
    id: 'BROKE_50K',
    name: 'Well Established',
    emoji: '🏦',
    icon: 'achievements/broke_50k.svg',
    description: 'Reach $50,000 portfolio value',
    hint: "You're a force to be reckoned with",
  },
  BROKE_100K: {
    id: 'BROKE_100K',
    name: 'Six Figures',
    emoji: '💎',
    icon: 'achievements/broke_100k.svg',
    description: 'Reach $100,000 portfolio value',
    hint: 'Welcome to the big leagues',
  },
  BROKE_250K: {
    id: 'BROKE_250K',
    name: 'Market Shark',
    emoji: '🐋',
    icon: 'achievements/broke_250k.svg',
    description: 'Reach $250,000 portfolio value',
    hint: 'The market fears you',
  },
  BROKE_500K: {
    id: 'BROKE_500K',
    name: 'Untouchable',
    emoji: '👑',
    icon: 'achievements/broke_500k.svg',
    description: 'Reach $500,000 portfolio value',
    hint: 'Nobody can stop you',
  },
  BROKE_1M: {
    id: 'BROKE_1M',
    name: 'First Million',
    emoji: '🏆',
    icon: 'achievements/broke_1m.svg',
    description: 'Reach $1,000,000 portfolio value',
    hint: "You've made it",
  },

  // Prediction milestones
  ORACLE: {
    id: 'ORACLE',
    name: 'Oracle',
    emoji: '🔮',
    icon: 'achievements/oracle.svg',
    description: 'Win 3 prediction bets',
    hint: 'See the future',
  },
  PROPHET: {
    id: 'PROPHET',
    name: 'Prophet',
    emoji: '📿',
    icon: 'achievements/prophet.svg',
    description: 'Win 10 prediction bets',
    hint: 'Your foresight is legendary',
  },
  TRUE_BELIEVER: {
    id: 'TRUE_BELIEVER',
    name: 'True Believer',
    emoji: '🔭',
    description: 'Hold a long-term prediction position until it resolves',
    hint: 'Conviction pays off',
  },

  // Dedication milestones
  DEDICATED_7: {
    id: 'DEDICATED_7',
    name: 'Regular',
    emoji: '📅',
    icon: 'achievements/dedicated_7.svg',
    description: 'Check in 7 days total',
    hint: 'Keep coming back',
  },
  DEDICATED_14: {
    id: 'DEDICATED_14',
    name: 'Committed',
    emoji: '🔄',
    icon: 'achievements/dedicated_14.svg',
    description: 'Check in 14 days total',
    hint: 'Two weeks strong',
  },
  DEDICATED_30: {
    id: 'DEDICATED_30',
    name: 'Devoted',
    emoji: '✨',
    icon: 'achievements/dedicated_30.svg',
    description: 'Check in 30 days total',
    hint: 'A month of dedication',
  },
  DEDICATED_100: {
    id: 'DEDICATED_100',
    name: 'Legendary',
    emoji: '🏆',
    icon: 'achievements/dedicated_100.svg',
    description: 'Check in 100 days total',
    hint: 'True commitment',
  },

  // Leaderboard
  TOP_10: {
    id: 'TOP_10',
    name: 'Contender',
    emoji: '🥉',
    icon: 'achievements/top_10.svg',
    description: 'Reach the top 10 on the leaderboard',
    hint: 'Climb the ranks',
  },
  TOP_3: {
    id: 'TOP_3',
    name: 'Elite',
    emoji: '🥈',
    icon: 'achievements/top_3.svg',
    description: 'Reach the top 3 on the leaderboard',
    hint: 'Almost at the top',
  },
  TOP_1: {
    id: 'TOP_1',
    name: 'Champion',
    emoji: '🥇',
    icon: 'achievements/top_1.svg',
    description: 'Reach #1 on the leaderboard',
    hint: 'The very best',
  },

  // Special
  TRADER_20: {
    id: 'TRADER_20',
    name: 'Active Trader',
    emoji: '📊',
    icon: 'achievements/trader_20.svg',
    description: 'Complete 20 trades',
    hint: 'Keep trading',
  },
  TRADER_100: {
    id: 'TRADER_100',
    name: 'Day Trader',
    emoji: '💹',
    icon: 'achievements/trader_100.svg',
    description: 'Complete 100 trades',
    hint: 'Trading is your life now',
  },

  // Collection
  UNIFIER: {
    id: 'UNIFIER',
    name: 'Unifier of Seoul',
    emoji: '🗺️',
    icon: 'achievements/unifier.svg',
    description: 'Hold a full share of every character',
    hint: "Gotta catch 'em all",
  },

  // Ladder Game
  COMPULSIVE_GAMBLER: {
    id: 'COMPULSIVE_GAMBLER',
    name: 'Compulsive Gambler',
    emoji: '🎲',
    icon: 'achievements/compulsive_gambler.svg',
    description: 'Earn $2,500 net profit in the Ladder Game',
    hint: 'Lady luck is on your side',
  },
  ADDICTED: {
    id: 'ADDICTED',
    name: 'Addicted',
    emoji: '🃏',
    icon: 'achievements/addicted.svg',
    description: 'Place 100 bets of $50+ in the Ladder Game',
    hint: 'You can stop anytime... right?',
  },

  // Profit - special
  NPC_LOVER: {
    id: 'NPC_LOVER',
    name: 'NPC Lover',
    emoji: '💜',
    icon: 'achievements/npc_lover.svg',
    description: 'Earn $1,000 total profit from non-crew characters',
    hint: 'The underdogs need love too',
  },

  // Market impact
  MONOPOLY: {
    id: 'MONOPOLY',
    name: 'Monopoly',
    emoji: '🏗️',
    icon: 'achievements/monopoly.svg',
    description: 'Buy so much stock that you increase its price by 5% (the max)',
    hint: 'Go all in on a single buy',
  },

  // Ladder Game - competitive
  CASINO_CHAMPION: {
    id: 'CASINO_CHAMPION',
    name: 'Casino Champion',
    emoji: '🎰',
    icon: 'achievements/casino_champion.svg',
    description: 'Place 1st on the Ladder Game leaderboard',
    hint: 'Top of the gambling world',
  },

  // Weekly profits
  PROFIT_CHAMPION: {
    id: 'PROFIT_CHAMPION',
    name: 'Profit Champion',
    emoji: '💰',
    icon: 'achievements/profit_champion.svg',
    description: 'Place 1st in weekly portfolio gains',
    hint: 'Best trader of the week',
  },

  // Prediction - underdog
  UNDERDOG: {
    id: 'UNDERDOG',
    name: 'Underdog',
    emoji: '🐶',
    icon: 'achievements/underdog.svg',
    description: 'Win a prediction where less than 20% of the pool backed your side',
    hint: 'Bet against the crowd and win',
  },

  // Profit - special
  DISCOUNT_DEACON: {
    id: 'DISCOUNT_DEACON',
    name: 'Discount Deacon',
    emoji: '🏷️',
    icon: 'achievements/discount_deacon.svg',
    description: 'Make a trade resulting in a dollar profit ending in .99',
    hint: '$9.99 profit, $24.99 profit...',
  },

  // Community
  DISCORD_LINKED: {
    id: 'DISCORD_LINKED',
    name: 'Plugged In',
    emoji: '🔗',
    icon: 'crests/discord.svg',
    description: 'Link your Discord account to your Stockism profile',
    hint: 'Connect your Discord from the profile page',
    revocable: false,
  },

  // Daily Mission milestones
  MISSION_10: {
    id: 'MISSION_10',
    name: 'Task Runner',
    emoji: '📋',
    icon: 'achievements/mission_10.svg',
    description: 'Complete 10 daily missions',
    hint: 'Stay on task',
  },
  MISSION_50: {
    id: 'MISSION_50',
    name: 'Mission Master',
    emoji: '🎖️',
    icon: 'achievements/mission_50.svg',
    description: 'Complete 50 daily missions',
    hint: 'Dedicated to the grind',
  },
  MISSION_100: {
    id: 'MISSION_100',
    name: 'Mission Legend',
    emoji: '🎗️',
    icon: 'achievements/mission_100.svg',
    description: 'Complete 100 daily missions',
    hint: 'Never miss a mission',
  },

  // Investor milestones
  DIVIDEND_DEMON: {
    id: 'DIVIDEND_DEMON',
    name: 'Dividend Demon',
    emoji: '😈',
    icon: 'achievements/dividend_demon.svg',
    description: 'Hold any ETF for 50 consecutive days',
    hint: 'Be patient and let dividends stack up',
  },
  TOPPED_OFF: {
    id: 'TOPPED_OFF',
    name: 'Topped Off',
    emoji: '🎯',
    icon: 'achievements/topped_off.svg',
    description: 'Sell a stock at its all-time high',
    hint: 'Perfect timing',
  },
  JIHOISM: {
    id: 'JIHOISM',
    name: 'Jihoism',
    emoji: '💸',
    icon: 'achievements/jihoism.svg',
    description: 'Lose your entire Ladder Game balance',
    hint: 'You know what you did',
  },
  THATS_A_BIG_DEAL: {
    id: 'THATS_A_BIG_DEAL',
    name: "That's a Big Deal",
    emoji: '📉',
    icon: 'achievements/big_deal.svg',
    description: 'Buy a bullish stock at its 7-day low',
    hint: 'Buy the dip while others are scared',
  },
  YOURE_A_WORKER: {
    id: 'YOURE_A_WORKER',
    name: "You're a Worker",
    emoji: '💪',
    icon: 'achievements/youre_a_worker.svg',
    description: 'Gain 25%+ of your net worth in a single week',
    hint: 'Put in the work',
  },
  ANIMAL_INSTINCT: {
    id: 'ANIMAL_INSTINCT',
    name: 'Animal Instinct',
    emoji: '🐾',
    icon: 'achievements/animal_instinct.svg',
    description: 'Earn $250 combined profit from Ryan, Eden, Miro, or Enu',
    hint: 'The animals are worth investing in',
  },

  // Crew crown — granted by the weekly crew head rotation (backend)
  CROWNED: {
    id: 'CROWNED',
    name: 'Crowned',
    emoji: '🫅',
    icon: 'achievements/crowned.svg',
    description: 'Become crew head',
    hint: "Have the biggest portfolio among your crew's active members",
  },
  DYNASTY: {
    id: 'DYNASTY',
    name: 'Dynasty',
    emoji: '⚜️',
    icon: 'achievements/dynasty.svg',
    description: 'Hold the crew crown 4 weeks in a row',
    hint: 'Stay on top for a month straight',
  },
  USURPER: {
    id: 'USURPER',
    name: 'Usurper',
    emoji: '🗡️',
    icon: 'achievements/usurper.svg',
    description: 'Take the crown from a crew head who held it 4+ weeks',
    hint: 'End a dynasty',
  },
} satisfies Record<string, Achievement>;

/** Lookup by an id that arrived as a plain string (from the server or a user doc). */
export const ACHIEVEMENT_MAP: Record<string, Achievement> = ACHIEVEMENTS;

/** The "unlocked" toast for an achievement: message plus its badge image, if it has one. */
export const achievementToast = (a: Achievement, suffix = ''): [string, string | null] => [
  `${a.icon ? '' : `🏆 ${a.emoji} `}${a.name} unlocked!${suffix}`,
  a.icon ? `/pins/${a.icon}` : null,
];

// Achievement IDs for easy checking
export const ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS);
