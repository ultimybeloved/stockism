'use strict';

const { cf } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { ADMIN_UID, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, MAX_DAILY_IMPACT, MAX_PRICE_CHANGE_PERCENT, MAX_TRADES_PER_TICKER_24H, TWENTY_FOUR_HOURS_MS } = require('../constants');
const { writeNotification, writeFeedEntry, sendDiscordMessage, calculateMarginalImpact, pruneAndSumTradeHistory } = require('../helpers');


exports.weeklyMarketSummary = cf().pubsub
  .schedule('0 0 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) return null;

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};

      // Get all users
      const usersSnap = await db.collection('users').get();
      const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculate weekly stats
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

      // Weekly price changes
      const weeklyChanges = [];
      Object.entries(prices).forEach(([ticker, currentPrice]) => {
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return;

        let priceWeekAgo = history[0].price;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= weekAgo) {
            priceWeekAgo = history[i].price;
            break;
          }
        }

        const change = priceWeekAgo > 0 ? ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100 : 0;
        weeklyChanges.push({ ticker, price: currentPrice, change, priceWeekAgo });
      });

      weeklyChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      const topGainer = weeklyChanges.find(s => s.change > 0);
      const topLoser = weeklyChanges.find(s => s.change < 0);

      // Weekly volume
      let weeklyVolume = 0;
      let weeklyTrades = 0;
      users.forEach(user => {
        const txLog = user.transactionLog || [];
        txLog.forEach(tx => {
          if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.timestamp > weekAgo) {
            weeklyVolume += tx.totalCost || tx.totalRevenue || 0;
            weeklyTrades++;
          }
        });
      });

      // Top portfolios
      const topPortfolios = users
        .filter(u => u.portfolioValue > 0)
        .sort((a, b) => b.portfolioValue - a.portfolioValue)
        .slice(0, 5);

      // Build comprehensive embed
      const embed = {
        title: '📈 Weekly Market Report',
        description: `Week ending ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        color: 0x4ECDC4,
        fields: [
          {
            name: '📊 Weekly Activity',
            value: `${weeklyTrades} trades\n$${weeklyVolume.toLocaleString(undefined, {maximumFractionDigits: 0})} total volume\n${users.length} active traders`,
            inline: false
          },
          {
            name: '🚀 Biggest Mover (Up)',
            value: topGainer ? `**${topGainer.ticker}**\n$${topGainer.priceWeekAgo.toFixed(2)} → $${topGainer.price.toFixed(2)}\n+${topGainer.change.toFixed(1)}%` : 'None',
            inline: true
          },
          {
            name: '📉 Biggest Mover (Down)',
            value: topLoser ? `**${topLoser.ticker}**\n$${topLoser.priceWeekAgo.toFixed(2)} → $${topLoser.price.toFixed(2)}\n${topLoser.change.toFixed(1)}%` : 'None',
            inline: true
          },
          {
            name: '🏆 Top 5 Portfolios',
            value: topPortfolios.map((u, i) =>
              `${i + 1}. ${u.displayName || 'Anonymous'} - $${u.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`
            ).join('\n') || 'None',
            inline: false
          }
        ],
        footer: {
          text: 'Next report: Next Sunday 7 PM EST'
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      return null;
    } catch (error) {
      console.error('Error in weeklyMarketSummary:', error);
      return null;
    }
  });

/**
 * Weekly Leaderboard - Runs Mondays at 01:00 UTC
 */
exports.weeklyLeaderboard = cf().pubsub
  .schedule('0 1 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        console.log('No users found');
        return null;
      }

      // Calculate portfolio values and sort
      const traders = [];
      usersSnapshot.forEach(doc => {
        const user = doc.data();
        if (!user.isBankrupt) {
          traders.push({
            username: user.displayName,
            portfolioValue: user.portfolioValue || user.cash || 0
          });
        }
      });

      traders.sort((a, b) => b.portfolioValue - a.portfolioValue);
      const top5 = traders.slice(0, 5);

      const leaderboardText = top5.map((trader, idx) => {
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][idx];
        return `${medal} **${trader.username}** - $${trader.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`;
      }).join('\n');

      const embed = {
        color: 0xFFD700, // Gold
        title: '🏆 Weekly Leaderboard',
        description: leaderboardText,
        footer: {
          text: `Total Active Traders: ${traders.length}`
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      console.log('Weekly leaderboard sent');
      return null;
    } catch (error) {
      console.error('Error in weekly leaderboard:', error);
      return null;
    }
  });

/**
 * Weekly Crew Rankings - Runs Mondays at 01:30 UTC
 */
exports.weeklyCrewRankings = cf().pubsub
  .schedule('30 1 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        console.log('No users found');
        return null;
      }

      // Crew data structure
      const crews = {
        'ALLIED': { name: 'Allied', emblem: '🏛️', members: [], totalCash: 0, weeklyGain: 0 },
        'BIG_DEAL': { name: 'Big Deal', emblem: '🤝', members: [], totalCash: 0, weeklyGain: 0 },
        'FIST_GANG': { name: 'Fist Gang', emblem: '👊', members: [], totalCash: 0, weeklyGain: 0 },
        'GOD_DOG': { name: 'God Dog', emblem: '🐕', members: [], totalCash: 0, weeklyGain: 0 },
        'SECRET_FRIENDS': { name: 'Secret Friends', emblem: '🤫', members: [], totalCash: 0, weeklyGain: 0 },
        'HOSTEL': { name: 'Hostel', emblem: '🏠', members: [], totalCash: 0, weeklyGain: 0 },
        'WTJC': { name: 'White Tiger Job Center', emblem: '🐯', members: [], totalCash: 0, weeklyGain: 0 },
        'WORKERS': { name: 'Workers', emblem: '⚒️', members: [], totalCash: 0, weeklyGain: 0 },
        'YAMAZAKI': { name: 'Yamazaki Syndicate', emblem: '⛩️', members: [], totalCash: 0, weeklyGain: 0 }
      };

      // Get week-old data for comparison
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

      usersSnapshot.forEach(doc => {
        const user = doc.data();
        const crew = user.crew;

        if (crew && crews[crew]) {
          const portfolioValue = user.portfolioValue || user.cash || 0;

          crews[crew].members.push({
            username: user.displayName,
            portfolioValue: portfolioValue
          });
          crews[crew].totalCash += portfolioValue;

          // Calculate weekly gain from portfolio history
          if (user.portfolioHistory && Array.isArray(user.portfolioHistory)) {
            const weekOldEntry = user.portfolioHistory.find(h => h.timestamp >= oneWeekAgo);
            if (weekOldEntry) {
              const weeklyGain = portfolioValue - weekOldEntry.value;
              crews[crew].weeklyGain += weeklyGain;
            }
          }
        }
      });

      // Sort crews by total cash
      const sortedCrews = Object.values(crews)
        .filter(crew => crew.members.length > 0)
        .sort((a, b) => b.totalCash - a.totalCash);

      // Build embed fields
      const fields = sortedCrews.map((crew, idx) => {
        // Sort members by portfolio value
        crew.members.sort((a, b) => b.portfolioValue - a.portfolioValue);
        const top5Members = crew.members.slice(0, 5);

        // Calculate average
        const avgCash = crew.members.length > 0 ? crew.totalCash / crew.members.length : 0;

        // Top 50 total (or all if less than 50)
        const top50 = crew.members.slice(0, 50);
        const top50Total = top50.reduce((sum, m) => sum + m.portfolioValue, 0);
        const consolidatedNote = crew.members.length <= 50 ? ' (same as total)' : '';

        // Build top 5 list
        let top5Text = top5Members.map((m, i) =>
          `${i + 1}. ${m.username} - $${m.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`
        ).join('\n');

        // Add blank spaces if less than 5 members
        if (top5Members.length < 5) {
          for (let i = top5Members.length; i < 5; i++) {
            top5Text += `\n${i + 1}. `;
          }
        }

        const weeklyGainText = crew.weeklyGain >= 0
          ? `+$${crew.weeklyGain.toLocaleString(undefined, {maximumFractionDigits: 2})}`
          : `-$${Math.abs(crew.weeklyGain).toLocaleString(undefined, {maximumFractionDigits: 2})}`;

        return {
          name: `${idx + 1}. ${crew.emblem} ${crew.name}`,
          value: `**Members:** ${crew.members.length}\n` +
                 `**Total Cash:** $${crew.totalCash.toLocaleString(undefined, {maximumFractionDigits: 2})}\n` +
                 `**Top 50 Total:** $${top50Total.toLocaleString(undefined, {maximumFractionDigits: 2})}${consolidatedNote}\n` +
                 `**Average:** $${avgCash.toLocaleString(undefined, {maximumFractionDigits: 2})}\n` +
                 `**Weekly Gain:** ${weeklyGainText}\n\n` +
                 `**Top 5:**\n${top5Text}`,
          inline: false
        };
      });

      const embed = {
        color: 0x5865F2, // Discord blurple
        title: '⚔️ Weekly Crew Rankings',
        description: '*Crews ranked by total cash among all members*',
        fields: fields,
        footer: {
          text: 'Note: Some crews have fewer than 5 members as the game is still early. Rankings will balance out as more players join.'
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      console.log('Weekly crew rankings sent');
      return null;
    } catch (error) {
      console.error('Error in weekly crew rankings:', error);
      return null;
    }
  });


/**
 * Create bot traders - Admin only
 */
