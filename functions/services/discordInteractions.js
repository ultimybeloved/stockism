'use strict';

const { cf } = require('../fnConfig');
const admin = require('firebase-admin');
const axios = require('axios');
const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const {
  ADMIN_UID, STARTING_CASH, BASE_IMPACT, BASE_LIQUIDITY, MAX_PRICE_CHANGE_PERCENT,
  DAILY_DROP_JACKPOT_CHANCE, DAILY_DROP_HIGH_TIER_FRACTION, DAILY_DROP_HIGH_TIER_CAP,
  DAILY_DROP_NORMAL_SHARE_VALUES, DAILY_DROP_NORMAL_SHARE_WEIGHTS,
  DAILY_DROP_NORMAL_VARIETY_VALUES, DAILY_DROP_NORMAL_VARIETY_WEIGHTS,
  DAILY_DROP_JACKPOT_SHARES_MIN, DAILY_DROP_JACKPOT_SHARES_MAX,
  DAILY_DROP_JACKPOT_VARIETY_MIN, DAILY_DROP_JACKPOT_VARIETY_MAX,
} = require('../constants');
const { writeNotification, sendDiscordMessage } = require('../helpers');

function weightedRandom(values, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < values.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return values[i];
  }
  return values[values.length - 1];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Hands out `totalShares` round-robin across the selected stocks, but never
// gives a stock more than its cap. Leftover shares (when every pick is capped)
// are simply not awarded. Zero-share picks are dropped from the result.
function distributeShares(selectedStocks, prices, totalShares, capFor) {
  const picks = selectedStocks.map(stock => ({
    ticker: stock.ticker,
    name: stock.name,
    shares: 0,
    currentPrice: prices[stock.ticker] || stock.basePrice,
    _cap: capFor(stock),
  }));
  let remaining = totalShares;
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (const p of picks) {
      if (remaining <= 0) break;
      if (p.shares < p._cap) { p.shares += 1; remaining -= 1; progressed = true; }
    }
  }
  return picks.filter(p => p.shares > 0).map(({ _cap, ...p }) => p);
}

async function rollDailyStock() {
  const isJackpot = Math.random() < DAILY_DROP_JACKPOT_CHANCE;

  const marketDoc = await db.collection('market').doc('current').get();
  const prices = marketDoc.data()?.prices || {};
  const launchedTickers = marketDoc.data()?.launchedTickers || [];
  const tradeableChars = CHARACTERS.filter(c =>
    !c.ipoRequired || launchedTickers.includes(c.ticker)
  ).filter(c => prices[c.ticker] != null);
  if (tradeableChars.length === 0) return { picks: [], isJackpot: false };

  // "High tier" = the priciest slice by LIVE price (basePrice has drifted far
  // below current prices, so live price is the only honest measure of value).
  const byPrice = [...tradeableChars].sort((a, b) => (prices[b.ticker] || 0) - (prices[a.ticker] || 0));
  const highCount = Math.max(1, Math.round(byPrice.length * DAILY_DROP_HIGH_TIER_FRACTION));
  const highTierPool = byPrice.slice(0, highCount);
  const highTierTickers = new Set(highTierPool.map(c => c.ticker));

  const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

  if (isJackpot) {
    // Jackpot is drawn entirely from high-tier stocks and stays generous.
    const totalShares = randInt(DAILY_DROP_JACKPOT_SHARES_MIN, DAILY_DROP_JACKPOT_SHARES_MAX);
    const varietyCount = Math.min(
      randInt(DAILY_DROP_JACKPOT_VARIETY_MIN, DAILY_DROP_JACKPOT_VARIETY_MAX),
      highTierPool.length,
      totalShares
    );
    const selected = shuffle(highTierPool).slice(0, varietyCount);
    const picks = distributeShares(selected, prices, totalShares, () => totalShares);
    return { picks, isJackpot: true };
  }

  // Normal roll: few shares, and any high-tier stock is capped at 1 — you can
  // still hit it, you just can't stack value off a lucky draw.
  const totalShares = weightedRandom(DAILY_DROP_NORMAL_SHARE_VALUES, DAILY_DROP_NORMAL_SHARE_WEIGHTS);
  const varietyCount = Math.min(
    weightedRandom(DAILY_DROP_NORMAL_VARIETY_VALUES, DAILY_DROP_NORMAL_VARIETY_WEIGHTS),
    totalShares,
    tradeableChars.length
  );
  const selected = shuffle(tradeableChars).slice(0, varietyCount);
  const picks = distributeShares(selected, prices, totalShares,
    (c) => highTierTickers.has(c.ticker) ? DAILY_DROP_HIGH_TIER_CAP : totalShares);
  return { picks, isJackpot: false };
}

exports.discordInteractions = cf().https.onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  // Verify Discord signature
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey || publicKey === 'PASTE_YOUR_PUBLIC_KEY_HERE') {
    console.error('DISCORD_PUBLIC_KEY not configured');
    return res.status(500).send('Server misconfigured');
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const rawBody = req.rawBody;

  if (!signature || !timestamp || !rawBody) {
    return res.status(401).send('Invalid request');
  }

  const isValid = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  const interaction = req.body;

  // Handle PING (required for endpoint verification)
  if (interaction.type === InteractionType.PING) {
    return res.json({ type: InteractionResponseType.PONG });
  }

  // Handle button clicks
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const customId = interaction.data?.custom_id;

    if (customId === 'claim_daily_stock') {
      const discordUserId = interaction.member?.user?.id || interaction.user?.id;
      const appId = interaction.application_id;
      const interactionToken = interaction.token;
      const messageId = interaction.message?.id;

      if (!discordUserId) {
        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Could not identify your Discord account.',
            flags: 64 // Ephemeral
          }
        });
      }

      // Send deferred ephemeral response immediately (avoids 3-second timeout)
      res.json({ type: 5, data: { flags: 64 } });

      // Helper to edit the deferred response via webhook
      const editOriginal = async (payload) => {
        await axios.patch(
          `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`,
          payload,
          { headers: { 'Content-Type': 'application/json' } }
        );
      };

      try {
        // Find user with this discordId
        const usersSnap = await db.collection('users')
          .where('discordId', '==', discordUserId)
          .limit(1)
          .get();

        if (usersSnap.empty) {
          await editOriginal({
            content: '🔗 Your Discord isn\'t linked to a Stockism account yet!\n\n' +
              '**Link now:** https://stockism.app/link-discord\n\n' +
              'Once linked, come back and click the button again — this doesn\'t count as your daily claim!',
          });
          return;
        }

        const userDoc = usersSnap.docs[0];
        const uid = userDoc.id;
        const userData = userDoc.data();

        // Check if this drop has expired (72-hour window)
        if (messageId) {
          const messageTimestamp = Number(BigInt(messageId) >> 22n) + 1420070400000;
          const ageHours = (Date.now() - messageTimestamp) / (1000 * 60 * 60);
          if (ageHours > 72) {
            await editOriginal({
              content: '⏰ This drop has expired! Daily drops are only claimable for 72 hours.',
            });
            return;
          }
        }

        // Atomically reserve this claim to prevent double-claim race conditions
        // (user can click the button twice while it's buffering — without a transaction,
        // both requests pass the "already claimed" check and award separate rolls)
        if (messageId) {
          let alreadyClaimed = false;
          try {
            await db.runTransaction(async (tx) => {
              const freshDoc = await tx.get(db.collection('users').doc(uid));
              const freshClaimed = freshDoc.data().claimedDailyStockMessages || [];
              if (freshClaimed.includes(messageId)) {
                alreadyClaimed = true;
                return;
              }
              tx.update(freshDoc.ref, {
                claimedDailyStockMessages: admin.firestore.FieldValue.arrayUnion(messageId)
              });
            });
          } catch (txErr) {
            console.error('Daily stock claim reservation failed:', txErr);
            await editOriginal({
              content: '❌ Something went wrong reserving your claim. Try again in a moment!',
            });
            return;
          }

          if (alreadyClaimed) {
            await editOriginal({
              content: '⏰ You already claimed from this drop! Wait for the next one.',
            });
            return;
          }
        }

        // Roll the loot
        const { picks, isJackpot } = await rollDailyStock();

        if (picks.length === 0) {
          await editOriginal({
            content: '❌ No stocks available right now. Try again later!',
          });
          return;
        }

        // Fetch current market prices for buy-side price impact
        const marketRef = db.collection('market').doc('current');
        const marketDoc = await marketRef.get();
        const prices = marketDoc.data()?.prices || {};

        // Build Firestore updates (claimedDailyStockMessages was already written
        // by the reservation transaction above)
        const updates = {
          lastDailyStockClaim: admin.firestore.FieldValue.serverTimestamp(),
          lastDailyStockResult: {
            picks: picks.map(p => ({
              ticker: p.ticker,
              name: p.name,
              shares: p.shares,
              currentPrice: p.currentPrice
            })),
            isJackpot,
            claimedAt: new Date().toISOString()
          }
        };

        const currentHoldings = userData.holdings || {};
        const currentCostBasis = userData.costBasis || {};

        for (const pick of picks) {
          const existingShares = currentHoldings[pick.ticker] || 0;
          const existingCost = currentCostBasis[pick.ticker] || 0;
          const newShares = existingShares + pick.shares;
          // Weighted average cost basis: free shares have $0 cost
          const newCostBasis = existingShares > 0
            ? (existingCost * existingShares) / newShares
            : 0;
          updates[`holdings.${pick.ticker}`] = newShares;
          updates[`costBasis.${pick.ticker}`] = newCostBasis;
        }

        // Apply buy-side price impact (simulates buy pressure for free shares)
        const timestamp = Date.now();
        const newPrices = { ...prices };
        const marketUpdates = {};

        for (const pick of picks) {
          const currentPrice = newPrices[pick.ticker];
          if (!currentPrice || currentPrice <= 0) continue;

          let priceImpact = currentPrice * BASE_IMPACT * Math.sqrt(pick.shares / BASE_LIQUIDITY);
          const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
          priceImpact = Math.min(priceImpact, maxImpact);

          newPrices[pick.ticker] = Math.round((currentPrice + priceImpact) * 100) / 100;

          marketUpdates[`priceHistory.${pick.ticker}`] = admin.firestore.FieldValue.arrayUnion({
            timestamp,
            price: newPrices[pick.ticker]
          });
        }

        marketUpdates.prices = newPrices;

        await db.collection('users').doc(uid).update(updates);
        await marketRef.update(marketUpdates);

        // Build response embed (using post-impact prices)
        const totalShares = picks.reduce((sum, p) => sum + p.shares, 0);
        const stockList = picks.map(p => {
          const displayPrice = newPrices[p.ticker] || p.currentPrice;
          return `**${p.name}** ($${p.ticker}) — ${p.shares} share${p.shares > 1 ? 's' : ''} (worth $${(p.shares * displayPrice).toFixed(2)})`;
        }).join('\n');

        const totalValue = picks.reduce((sum, p) => sum + (p.shares * (newPrices[p.ticker] || p.currentPrice)), 0);

        // Send web notification
        await writeNotification(uid, {
          type: 'system',
          title: isJackpot ? '🎰 Jackpot! Daily Stock Claim' : '🎁 Daily Stock Claimed',
          message: `You received ${totalShares} free share${totalShares !== 1 ? 's' : ''} worth $${totalValue.toFixed(2)}!`,
          data: {}
        });

        const embed = isJackpot
          ? {
            title: '🎰💰 JACKPOT!! 💰🎰',
            description: `You hit the **JACKPOT**! Here\'s what you got:\n\n${stockList}\n\n**Total: ${totalShares} shares worth $${totalValue.toFixed(2)}!**`,
            color: 0xFFD700,
            footer: { text: 'Incredible luck! 🍀' }
          }
          : {
            title: '🎁 Daily Stock Claimed!',
            description: `Here\'s what you got:\n\n${stockList}\n\n**Total: ${totalShares} share${totalShares > 1 ? 's' : ''} worth $${totalValue.toFixed(2)}**`,
            color: 0x00D166,
            footer: { text: 'Come back tomorrow for more!' }
          };

        await editOriginal({ embeds: [embed] });

      } catch (err) {
        console.error('Daily stock claim error:', err);
        try {
          await editOriginal({
            content: '❌ Something went wrong. Try again in a moment!',
          });
        } catch (followUpErr) {
          console.error('Failed to send error follow-up:', followUpErr.message);
        }
      }
      return;
    }

    if (customId === 'view_last_claim') {
      const discordUserId = interaction.member?.user?.id || interaction.user?.id;

      if (!discordUserId) {
        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Could not identify your Discord account.',
            flags: 64
          }
        });
      }

      try {
        const usersSnap = await db.collection('users')
          .where('discordId', '==', discordUserId)
          .limit(1)
          .get();

        if (usersSnap.empty) {
          return res.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '🔗 Your Discord isn\'t linked to a Stockism account yet!\n\n' +
                '**Link now:** https://stockism.app/link-discord',
              flags: 64
            }
          });
        }

        const userData = usersSnap.docs[0].data();
        const lastResult = userData.lastDailyStockResult;

        if (!lastResult || !lastResult.picks || lastResult.picks.length === 0) {
          return res.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '📋 No daily stock claims on record yet. Click **Claim Free Stock** to get your first!',
              flags: 64
            }
          });
        }

        const totalShares = lastResult.picks.reduce((sum, p) => sum + p.shares, 0);
        const stockList = lastResult.picks.map(p =>
          `**${p.name}** ($${p.ticker}) — ${p.shares} share${p.shares > 1 ? 's' : ''} (worth $${(p.shares * p.currentPrice).toFixed(2)})`
        ).join('\n');
        const totalValue = lastResult.picks.reduce((sum, p) => sum + (p.shares * p.currentPrice), 0);

        const claimedDate = lastResult.claimedAt
          ? new Date(lastResult.claimedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'Unknown date';

        const embed = lastResult.isJackpot
          ? {
            title: '🎰💰 Last Claim — JACKPOT! 💰🎰',
            description: `**Claimed:** ${claimedDate}\n\n${stockList}\n\n**Total: ${totalShares} shares worth $${totalValue.toFixed(2)}**`,
            color: 0xFFD700
          }
          : {
            title: '📋 Your Last Daily Claim',
            description: `**Claimed:** ${claimedDate}\n\n${stockList}\n\n**Total: ${totalShares} share${totalShares > 1 ? 's' : ''} worth $${totalValue.toFixed(2)}**`,
            color: 0x5865F2
          };

        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [embed],
            flags: 64
          }
        });

      } catch (err) {
        console.error('View last claim error:', err);
        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Something went wrong. Try again in a moment!',
            flags: 64
          }
        });
      }
    }
  }

  // Unknown interaction type — acknowledge
  return res.json({ type: InteractionResponseType.PONG });
});
