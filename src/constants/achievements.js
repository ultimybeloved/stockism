// ============================================
// ACHIEVEMENTS SYSTEM
// ============================================

export const ACHIEVEMENTS = {
  // Trading milestones
  FIRST_BLOOD: {
    id: 'FIRST_BLOOD',
    name: 'First Blood',
    emoji: '🎯',
    description: 'Make your first trade',
    hint: 'Buy or sell any stock'
  },
  SHARK: {
    id: 'SHARK',
    name: 'Shark',
    emoji: '🦈',
    description: 'Execute a single trade worth $1,000+',
    hint: 'Go big or go home'
  },
  DIVERSIFIED: {
    id: 'DIVERSIFIED',
    name: 'Diversified',
    emoji: '🎨',
    description: 'Hold 5+ different characters at once',
    hint: 'Don\'t put all your eggs in one basket'
  },

  // Profit milestones
  BULL_RUN: {
    id: 'BULL_RUN',
    name: 'Bull Run',
    emoji: '📈',
    description: 'Sell a stock for 25%+ profit',
    hint: 'Buy low, sell high'
  },
  DIAMOND_HANDS: {
    id: 'DIAMOND_HANDS',
    name: 'Diamond Hands',
    emoji: '🙌',
    description: 'Hold through a 30% dip and recover to profit',
    hint: 'Hold strong through the storm'
  },
  COLD_BLOODED: {
    id: 'COLD_BLOODED',
    name: 'Cold Blooded',
    emoji: '❄️',
    description: 'Profit from closing a short position',
    hint: 'Bet against the market and win'
  },

  // Portfolio milestones
  BROKE_2K: {
    id: 'BROKE_2K',
    name: 'Breaking Even... Kinda',
    emoji: '💵',
    description: 'Reach $2,500 portfolio value',
    hint: 'Build your wealth'
  },
  BROKE_5K: {
    id: 'BROKE_5K',
    name: 'High Roller',
    emoji: '🎰',
    description: 'Reach $5,000 portfolio value',
    hint: 'Keep growing'
  },
  BROKE_10K: {
    id: 'BROKE_10K',
    name: 'Big Shot',
    emoji: '🌟',
    description: 'Reach $10,000 portfolio value',
    hint: 'You\'re getting serious'
  },
  BROKE_25K: {
    id: 'BROKE_25K',
    name: 'Tycoon',
    emoji: '🏛️',
    description: 'Reach $25,000 portfolio value',
    hint: 'Market domination'
  },

  // Prediction milestones
  ORACLE: {
    id: 'ORACLE',
    name: 'Oracle',
    emoji: '🔮',
    description: 'Win 3 prediction bets',
    hint: 'See the future'
  },
  PROPHET: {
    id: 'PROPHET',
    name: 'Prophet',
    emoji: '📿',
    description: 'Win 10 prediction bets',
    hint: 'Your foresight is legendary'
  },

  // Dedication milestones
  DEDICATED_7: {
    id: 'DEDICATED_7',
    name: 'Regular',
    emoji: '📅',
    description: 'Check in 7 days total',
    hint: 'Keep coming back'
  },
  DEDICATED_14: {
    id: 'DEDICATED_14',
    name: 'Committed',
    emoji: '🔄',
    description: 'Check in 14 days total',
    hint: 'Two weeks strong'
  },
  DEDICATED_30: {
    id: 'DEDICATED_30',
    name: 'Devoted',
    emoji: '✨',
    description: 'Check in 30 days total',
    hint: 'A month of dedication'
  },
  DEDICATED_100: {
    id: 'DEDICATED_100',
    name: 'Legendary',
    emoji: '🏆',
    description: 'Check in 100 days total',
    hint: 'True commitment'
  },

  // Leaderboard
  TOP_10: {
    id: 'TOP_10',
    name: 'Contender',
    emoji: '🥉',
    description: 'Reach the top 10 on the leaderboard',
    hint: 'Climb the ranks'
  },
  TOP_3: {
    id: 'TOP_3',
    name: 'Elite',
    emoji: '🥈',
    description: 'Reach the top 3 on the leaderboard',
    hint: 'Almost at the top'
  },
  TOP_1: {
    id: 'TOP_1',
    name: 'Champion',
    emoji: '🥇',
    description: 'Reach #1 on the leaderboard',
    hint: 'The very best'
  },

  // Special
  TRADER_20: {
    id: 'TRADER_20',
    name: 'Active Trader',
    emoji: '📊',
    description: 'Complete 20 trades',
    hint: 'Keep trading'
  },
  TRADER_100: {
    id: 'TRADER_100',
    name: 'Day Trader',
    emoji: '💹',
    description: 'Complete 100 trades',
    hint: 'Trading is your life now'
  },

  // Daily Mission milestones
  MISSION_10: {
    id: 'MISSION_10',
    name: 'Task Runner',
    emoji: '📋',
    description: 'Complete 10 daily missions',
    hint: 'Stay on task'
  },
  MISSION_50: {
    id: 'MISSION_50',
    name: 'Mission Master',
    emoji: '🎖️',
    description: 'Complete 50 daily missions',
    hint: 'Dedicated to the grind'
  },
  MISSION_100: {
    id: 'MISSION_100',
    name: 'Mission Legend',
    emoji: '🎗️',
    description: 'Complete 100 daily missions',
    hint: 'Never miss a mission'
  }
};

// Achievement IDs for easy checking
export const ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS);
