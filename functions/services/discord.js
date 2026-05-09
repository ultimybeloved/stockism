'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { ADMIN_UID, STARTING_CASH, BASE_IMPACT, BASE_LIQUIDITY, MAX_PRICE_CHANGE_PERCENT } = require('../constants');
const { writeNotification, sendDiscordMessage } = require('../helpers');

// Discord OAuth Authentication
exports.discordAuth = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', 'https://stockism.app');

  const code = req.query.code;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = 'https://us-central1-stockism-abb28.cloudfunctions.net/discordAuth';

    // Exchange code for access token
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const accessToken = tokenResponse.data.access_token;

    // Get Discord user info
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const discordUser = userResponse.data;
    const discordId = discordUser.id;
    const username = discordUser.username;
    const email = discordUser.email;
    const avatarURL = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png`
      : null;

    // Create or get Firebase user
    let firebaseUid;

    // First, check if a Firestore user already has this discordId
    const discordSnap = await db.collection('users')
      .where('discordId', '==', discordId)
      .limit(1)
      .get();

    if (!discordSnap.empty) {
      // Existing user found by discordId
      firebaseUid = discordSnap.docs[0].id;
    } else if (email) {
      // Try to find by email
      try {
        const existingUser = await admin.auth().getUserByEmail(email);
        firebaseUid = existingUser.uid;
        // Store discordId on existing user
        await db.collection('users').doc(firebaseUid).update({
          discordId: discordId,
          discordUsername: username
        });
      } catch (error) {
        // User doesn't exist, create new one with email
        const newUser = await admin.auth().createUser({
          email: email,
          displayName: username,
          photoURL: avatarURL
        });
        firebaseUid = newUser.uid;

        await db.collection('users').doc(firebaseUid).set({
          displayName: username,
          displayNameLower: username.toLowerCase(),
          discordId: discordId,
          discordUsername: username,
          cash: STARTING_CASH,
          holdings: {},
          portfolioValue: STARTING_CASH,
          portfolioHistory: [{ timestamp: Date.now(), value: STARTING_CASH }],
          lastCheckin: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          achievements: [],
          totalCheckins: 0,
          totalTrades: 0,
          peakPortfolioValue: STARTING_CASH,
          predictionWins: 0,
          costBasis: {},
          lendingUnlocked: false,
          isBankrupt: false,
          onboardingComplete: false
        });
      }
    } else {
      // No email from Discord — create user without email
      const newUser = await admin.auth().createUser({
        displayName: username,
        photoURL: avatarURL
      });
      firebaseUid = newUser.uid;

      await db.collection('users').doc(firebaseUid).set({
        displayName: username,
        displayNameLower: username.toLowerCase(),
        discordId: discordId,
        discordUsername: username,
        cash: STARTING_CASH,
        holdings: {},
        portfolioValue: STARTING_CASH,
        portfolioHistory: [{ timestamp: Date.now(), value: STARTING_CASH }],
        lastCheckin: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        achievements: [],
        totalCheckins: 0,
        totalTrades: 0,
        peakPortfolioValue: STARTING_CASH,
        predictionWins: 0,
        costBasis: {},
        lendingUnlocked: false,
        isBankrupt: false,
        onboardingComplete: false
      });
    }

    // Create custom Firebase token
    const customToken = await admin.auth().createCustomToken(firebaseUid);

    // Redirect to app with token
    return res.redirect(`https://stockism.app/?discord_token=${customToken}`);

  } catch (error) {
    console.error('Discord auth error:', error);
    return res.redirect('https://stockism.app/?discord_error=true');
  }
});

// Discord Link — links Discord to an existing Stockism account (no new account created)
exports.discordLink = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://stockism.app');

  const code = req.query.code;
  const state = req.query.state; // Firebase UID passed as state

  if (!code || !state) {
    return res.status(400).send('Missing authorization code or user ID');
  }

  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = 'https://us-central1-stockism-abb28.cloudfunctions.net/discordLink';

    // Exchange code for access token
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;

    // Get Discord user info
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const discordId = userResponse.data.id;
    const discordUsername = userResponse.data.username;

    // Verify the Firebase UID (state) is a real user
    const userDoc = await db.collection('users').doc(state).get();
    if (!userDoc.exists) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=user_not_found');
    }

    // Check if this Discord is already linked to another account
    const existingSnap = await db.collection('users')
      .where('discordId', '==', discordId)
      .limit(1)
      .get();

    if (!existingSnap.empty && existingSnap.docs[0].id !== state) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=already_linked');
    }

    // Link Discord to the existing account
    const linkUpdate = {
      discordId: discordId,
      discordUsername: discordUsername
    };

    // Award DISCORD_LINKED achievement if not already earned
    const currentAchievements = userDoc.data().achievements || [];
    if (!currentAchievements.includes('DISCORD_LINKED')) {
      linkUpdate.achievements = admin.firestore.FieldValue.arrayUnion('DISCORD_LINKED');
      linkUpdate['achievementDates.DISCORD_LINKED'] = Date.now();
    }

    await db.collection('users').doc(state).update(linkUpdate);

    return res.redirect('https://stockism.app/profile?discord_link=success');
  } catch (error) {
    const discordError = error.response && error.response.data
      ? JSON.stringify(error.response.data)
      : error.message || 'unknown';
    console.error('Discord link error:', discordError);
    return res.redirect(`https://stockism.app/profile?discord_link=error&reason=${encodeURIComponent(discordError)}`);
  }
});

// DAILY FREE STOCK CLAIM (Discord Button)
// ============================================

/**
 * Weighted random pick from an array using weights.
 * values[i] has weight weights[i].
 */
function weightedRandom(values, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < values.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return values[i];
  }
  return values[values.length - 1];
}

/**
 * Roll loot for the daily free stock claim.
 * Returns { picks: [{ ticker, name, shares, currentPrice }], isJackpot }
 */
async function rollDailyStock() {
  const JACKPOT_CHANCE = 0.03;
  const isJackpot = Math.random() < JACKPOT_CHANCE;

  let totalShares, varietyCount;

  if (isJackpot) {
    totalShares = Math.floor(Math.random() * 5) + 6; // 6-10
    varietyCount = Math.floor(Math.random() * 3) + 3; // 3-5
  } else {
    totalShares = weightedRandom([1, 2, 3, 4, 5], [35, 30, 20, 10, 5]);
    varietyCount = weightedRandom([1, 2, 3], [70, 25, 5]);
  }

  // Cap variety to total shares (can't have 3 different stocks with only 1 share)
  varietyCount = Math.min(varietyCount, totalShares);

  // Get tradeable stocks from market data
  const marketDoc = await db.collection('market').doc('current').get();
  const prices = marketDoc.data()?.prices || {};
  const launchedTickers = marketDoc.data()?.launchedTickers || [];

  const tradeableChars = CHARACTERS.filter(c =>
    !c.ipoRequired || launchedTickers.includes(c.ticker)
  ).filter(c => prices[c.ticker] != null);

  if (tradeableChars.length === 0) {
    return { picks: [], isJackpot: false };
  }

  // Pick random unique stocks
  const shuffled = [...tradeableChars].sort(() => Math.random() - 0.5);
  const selectedStocks = shuffled.slice(0, Math.min(varietyCount, shuffled.length));

  // Distribute shares across selected stocks
  const picks = selectedStocks.map(stock => ({
    ticker: stock.ticker,
    name: stock.name,
    shares: 0,
    currentPrice: prices[stock.ticker] || stock.basePrice
  }));

  for (let i = 0; i < totalShares; i++) {
    picks[i % picks.length].shares += 1;
  }

  return { picks, isJackpot };
}

/**
 * Daily scheduled function — posts the claim button to Discord.
 * Runs at 10 AM Eastern (14:00 UTC) every day.
 */
exports.dailyFreeStock = functions.pubsub
  .schedule('0 14 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    const embed = {
      title: '🎁 Daily Free Stock Drop!',
      description: 'Click the button below to claim your free daily stock(s)!\n\n' +
        '**How it works:**\n' +
        '• You get 1-5 random shares of random characters\n' +
        '• Lucky rolls get even more variety\n' +
        '• Hit the **jackpot** (super rare!) for 6-10 shares across multiple characters\n\n' +
        '*Your Discord must be linked to your Stockism account to claim.*',
      color: 0x00D166,
      footer: { text: 'Resets daily • One claim per user' }
    };

    const components = [
      {
        type: 1, // Action Row
        components: [
          {
            type: 2, // Button
            style: 1, // Primary (blurple)
            label: '🎲 Claim Free Stock',
            custom_id: 'claim_daily_stock'
          },
          {
            type: 2, // Button
            style: 2, // Secondary (gray)
            label: '📋 View Last Claim',
            custom_id: 'view_last_claim'
          }
        ]
      }
    ];

    await sendDiscordMessage(null, [embed], '1483767343581761658', components);
    console.log('Daily free stock claim message posted to channel 1483767343581761658');
    return null;
  });

/**
 * Discord Interactions Webhook — handles button clicks for daily stock claim.
 * Must be registered as the Interactions Endpoint URL in Discord Developer Portal.
 */
exports.discordInteractions = functions.https.onRequest(async (req, res) => {
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

// ─── TICKER ROLLBACK DIAGNOSTIC ──────────────────────────────────────────────
exports.diagnoseTickerRollback = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { ticker, startTimestamp } = data;
  if (!ticker || !startTimestamp) {
    throw new functions.https.HttpsError('invalid-argument', 'ticker and startTimestamp required');
  }

  const startDate = new Date(startTimestamp);

  // 1. Get price at start from priceHistory
  const marketSnap = await db.collection('market').doc('current').get();
  const marketData = marketSnap.data() || {};
  const currentPrice = (marketData.prices || {})[ticker] || 0;
  const priceHistory = (marketData.priceHistory || {})[ticker] || [];

  // Find price closest to (but before) startTimestamp
  let priceAtStart = currentPrice;
  const startMs = startDate.getTime();
  let closestBefore = null;
  for (const entry of priceHistory) {
    const entryMs = entry.timestamp?._seconds
      ? entry.timestamp._seconds * 1000
      : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
        : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
    if (entryMs <= startMs && (!closestBefore || entryMs > closestBefore.ms)) {
      closestBefore = { ms: entryMs, price: entry.price };
    }
  }
  if (closestBefore) priceAtStart = closestBefore.price;

  // 2. Query all trades for this ticker after startTimestamp
  const tradesSnap = await db.collection('trades')
    .where('ticker', '==', ticker)
    .where('timestamp', '>', startDate)
    .get();

  const trades = [];
  tradesSnap.forEach(doc => {
    const t = doc.data();
    const ts = t.timestamp?._seconds
      ? t.timestamp._seconds * 1000
      : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
    trades.push({ ...t, _ts: ts, id: doc.id });
  });
  trades.sort((a, b) => a._ts - b._ts);

  // 3. Group by uid
  const userMap = {};
  for (const t of trades) {
    if (!userMap[t.uid]) {
      userMap[t.uid] = { buys: [], sells: [], shorts: [], covers: [] };
    }
    const action = (t.action || '').toLowerCase();
    if (action === 'buy') {
      userMap[t.uid].buys.push(t);
    } else if (action === 'sell') {
      userMap[t.uid].sells.push(t);
    } else if (action === 'short') {
      userMap[t.uid].shorts.push(t);
    } else if (action === 'cover') {
      userMap[t.uid].covers.push(t);
    }
  }

  const uids = Object.keys(userMap);

  // Fetch user docs
  const userDocs = {};
  for (const uid of uids) {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) userDocs[uid] = snap.data();
  }

  // Build per-user breakdown
  const userBreakdowns = [];
  const profiteers = []; // users with positive net cash flow

  for (const uid of uids) {
    const { buys, sells, shorts, covers } = userMap[uid];
    const userData = userDocs[uid] || {};

    const totalTrades = buys.length + sells.length + shorts.length + covers.length;

    // Skip users with no actual trades (defensive)
    if (totalTrades === 0) continue;

    const sharesBought = buys.reduce((s, t) => s + (t.amount || 0), 0);
    const cashSpent = buys.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesSold = sells.reduce((s, t) => s + (t.amount || 0), 0);
    const cashReceived = sells.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesShorted = shorts.reduce((s, t) => s + (t.amount || 0), 0);
    const cashFromShorts = shorts.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesCovered = covers.reduce((s, t) => s + (t.amount || 0), 0);
    const cashToCover = covers.reduce((s, t) => s + (t.totalValue || 0), 0);

    // Net cash: money in (sells + shorts) minus money out (buys + covers)
    const netCashFlow = (cashReceived + cashFromShorts) - (cashSpent + cashToCover);
    const currentHoldings = (userData.holdings || {})[ticker] || 0;
    const netSharesTraded = sharesBought - sharesSold;
    const giftedShares = Math.max(0, currentHoldings - netSharesTraded);

    const firstSellTs = sells.length > 0 ? Math.min(...sells.map(s => s._ts)) : null;
    const firstShortTs = shorts.length > 0 ? Math.min(...shorts.map(s => s._ts)) : null;
    // Earliest cash-generating trade (sell or short)
    const firstCashInTs = [firstSellTs, firstShortTs].filter(Boolean).length > 0
      ? Math.min(...[firstSellTs, firstShortTs].filter(Boolean))
      : null;

    const entry = {
      uid,
      displayName: userData.displayName || 'Unknown',
      isBot: userData.isBot || false,
      sharesBought,
      cashSpent: Math.round(cashSpent * 100) / 100,
      sharesSold,
      cashReceived: Math.round(cashReceived * 100) / 100,
      sharesShorted,
      cashFromShorts: Math.round(cashFromShorts * 100) / 100,
      sharesCovered,
      cashToCover: Math.round(cashToCover * 100) / 100,
      netCashFlow: Math.round(netCashFlow * 100) / 100,
      currentHoldings,
      currentCash: Math.round((userData.cash || 0) * 100) / 100,
      giftedShares,
      totalTrades,
      firstSellTs,
      firstCashInTs
    };

    userBreakdowns.push(entry);
    if (netCashFlow > 0 && firstCashInTs) {
      profiteers.push({ uid, netCashFlow, firstCashInTs, displayName: entry.displayName });
    }
  }

  // Sort by net cash flow descending
  userBreakdowns.sort((a, b) => b.netCashFlow - a.netCashFlow);

  // 4. Ripple effects — what did profiteers buy after selling ticker?
  const rippleByTicker = {};
  const userRipples = {};

  for (const p of profiteers) {
    // Get all non-ticker trades after first cash-generating trade
    const otherTradesSnap = await db.collection('trades')
      .where('uid', '==', p.uid)
      .where('timestamp', '>', new Date(p.firstCashInTs))
      .get();

    let spentOnOthers = 0;
    const byTicker = {};

    otherTradesSnap.forEach(doc => {
      const t = doc.data();
      if (t.ticker === ticker) return; // skip same ticker
      const action = (t.action || '').toLowerCase();
      if (action !== 'buy') return;
      const cost = t.totalValue || 0;
      spentOnOthers += cost;
      byTicker[t.ticker] = (byTicker[t.ticker] || 0) + cost;
    });

    // Cap at their profit from the target ticker
    const cappedSpent = Math.min(spentOnOthers, p.netCashFlow);

    if (cappedSpent > 0) {
      userRipples[p.uid] = {
        displayName: p.displayName,
        shroProfit: Math.round(p.netCashFlow * 100) / 100,
        spentOnOtherStocks: Math.round(cappedSpent * 100) / 100,
        breakdown: {}
      };

      // Scale per-ticker amounts if we capped
      const scale = spentOnOthers > 0 ? cappedSpent / spentOnOthers : 0;
      for (const [t, amount] of Object.entries(byTicker)) {
        const scaled = Math.round(amount * scale * 100) / 100;
        userRipples[p.uid].breakdown[t] = scaled;
        rippleByTicker[t] = (rippleByTicker[t] || 0) + scaled;
      }
    }
  }

  // Round ripple totals
  for (const t of Object.keys(rippleByTicker)) {
    rippleByTicker[t] = Math.round(rippleByTicker[t] * 100) / 100;
  }

  // Sort ripple by amount
  const sortedRipple = Object.entries(rippleByTicker)
    .sort((a, b) => b[1] - a[1])
    .map(([t, amount]) => ({ ticker: t, amount }));

  // 5. Summary
  const totalCashOut = userBreakdowns
    .filter(u => u.netCashFlow > 0)
    .reduce((s, u) => s + u.netCashFlow, 0);
  const totalCashIntoOthers = Object.values(rippleByTicker).reduce((s, v) => s + v, 0);

  const summary = {
    ticker,
    priceAtStart: Math.round(priceAtStart * 100) / 100,
    currentPrice: Math.round(currentPrice * 100) / 100,
    priceInflation: priceAtStart > 0
      ? Math.round(((currentPrice - priceAtStart) / priceAtStart) * 10000) / 100
      : 0,
    totalUsers: userBreakdowns.length,
    totalTrades: trades.length,
    totalCashOut: Math.round(totalCashOut * 100) / 100,
    cashIntoOtherStocks: Math.round(totalCashIntoOthers * 100) / 100,
    cashSittingAsCash: Math.round((totalCashOut - totalCashIntoOthers) * 100) / 100,
    windowStart: startDate.toISOString()
  };

  return {
    summary,
    users: userBreakdowns,
    rippleByTicker: sortedRipple,
    userRipples
  };
});

// ─── TICKER RECOVERY ────────────────────────────────────────────────────────
exports.recoverTicker = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { ticker, startTimestamp, rollbackToTimestamp, dryRun } = data;
  if (!ticker || !startTimestamp || !rollbackToTimestamp) {
    throw new functions.https.HttpsError('invalid-argument', 'ticker, startTimestamp, and rollbackToTimestamp required');
  }

  // 1. Re-run diagnostic server-side (don't trust client data)
  const startDate = new Date(startTimestamp);

  const marketSnap = await db.collection('market').doc('current').get();
  const marketData = marketSnap.data() || {};
  const currentPrice = (marketData.prices || {})[ticker] || 0;

  // Look up price at rollback timestamp from priceHistory
  const fullHistory = ((marketData.priceHistory || {})[ticker] || []);
  let targetPrice = null;
  for (const entry of fullHistory) {
    const entryTs = entry.timestamp?._seconds
      ? entry.timestamp._seconds * 1000
      : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
        : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
    if (entryTs <= rollbackToTimestamp) {
      targetPrice = entry.price;
    }
  }
  // Fallback: check archived price history if live array had no match
  if (targetPrice === null) {
    const archiveSnap = await db.collection('market').doc('current')
      .collection('price_history').doc(ticker).get();
    if (archiveSnap.exists) {
      const archiveData = archiveSnap.data();
      const archiveHistory = archiveData.history || [];
      for (const entry of archiveHistory) {
        const entryTs = entry.timestamp?._seconds
          ? entry.timestamp._seconds * 1000
          : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
            : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
        if (entryTs <= rollbackToTimestamp) {
          targetPrice = entry.price;
        }
      }
    }
  }

  if (targetPrice === null) {
    throw new functions.https.HttpsError('not-found', `No price history found at or before rollback timestamp for ${ticker}`);
  }

  // Query all trades for this ticker after startTimestamp
  const tradesSnap = await db.collection('trades')
    .where('ticker', '==', ticker)
    .where('timestamp', '>', startDate)
    .get();

  const trades = [];
  tradesSnap.forEach(doc => {
    const t = doc.data();
    const ts = t.timestamp?._seconds
      ? t.timestamp._seconds * 1000
      : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
    trades.push({ ...t, _ts: ts, id: doc.id });
  });

  // Group by uid
  const userMap = {};
  for (const t of trades) {
    if (!userMap[t.uid]) {
      userMap[t.uid] = { buys: [], sells: [], shorts: [], covers: [] };
    }
    const action = (t.action || '').toLowerCase();
    if (action === 'buy') userMap[t.uid].buys.push(t);
    else if (action === 'sell') userMap[t.uid].sells.push(t);
    else if (action === 'short') userMap[t.uid].shorts.push(t);
    else if (action === 'cover') userMap[t.uid].covers.push(t);
  }

  const uids = Object.keys(userMap);

  // Fetch user docs
  const userDocs = {};
  for (const uid of uids) {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) userDocs[uid] = snap.data();
  }

  // Build per-user net cash flow
  const clawbacks = [];
  const holdersAffected = [];
  let totalClawedBack = 0;
  let totalUnrecoverable = 0;

  const recoveryId = `recover_${ticker}_${Date.now()}`;

  for (const uid of uids) {
    const { buys, sells, shorts, covers } = userMap[uid];
    const userData = userDocs[uid] || {};

    // Skip bots
    if (userData.isBot) continue;

    const totalTrades = buys.length + sells.length + shorts.length + covers.length;
    if (totalTrades === 0) continue;

    const cashSpent = buys.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashReceived = sells.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashFromShorts = shorts.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashToCover = covers.reduce((s, t) => s + (t.totalValue || 0), 0);
    const netCashFlow = (cashReceived + cashFromShorts) - (cashSpent + cashToCover);

    // Track holders who will see value drop from price reset
    const currentHoldings = (userData.holdings || {})[ticker] || 0;
    if (currentHoldings > 0 && targetPrice < currentPrice) {
      const valueDrop = currentHoldings * (currentPrice - targetPrice);
      holdersAffected.push({
        uid,
        displayName: userData.displayName || 'Unknown',
        holdings: currentHoldings,
        valueDrop: Math.round(valueDrop * 100) / 100
      });
    }

    // Only claw back from profiteers
    if (netCashFlow <= 0) continue;

    // Check for existing recovery log (idempotent)
    const repairLog = userData._repairLog || [];
    if (repairLog.some(entry => entry.recoveryId === recoveryId)) continue;

    const previousCash = Math.round((userData.cash || 0) * 100) / 100;
    const clawbackAmount = Math.round(netCashFlow * 100) / 100;
    const newCash = Math.max(0, previousCash - clawbackAmount);
    const actualClawback = Math.round((previousCash - newCash) * 100) / 100;
    const wasFloored = actualClawback < clawbackAmount;

    if (wasFloored) {
      totalUnrecoverable += (clawbackAmount - actualClawback);
    }
    totalClawedBack += actualClawback;

    clawbacks.push({
      uid,
      displayName: userData.displayName || 'Unknown',
      previousCash,
      newCash,
      clawbackAmount,
      actualClawback,
      wasFloored
    });
  }

  totalClawedBack = Math.round(totalClawedBack * 100) / 100;
  totalUnrecoverable = Math.round(totalUnrecoverable * 100) / 100;

  // Build new price history: keep entries before rollback, add flat line
  const keptHistory = [];
  let removedCount = 0;
  for (const entry of fullHistory) {
    const entryTs = entry.timestamp?._seconds
      ? entry.timestamp._seconds * 1000
      : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
        : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
    if (entryTs <= rollbackToTimestamp) {
      keptHistory.push(entry);
    } else {
      removedCount++;
    }
  }
  // Add flat line anchors
  const newHistoryEntries = [
    { timestamp: rollbackToTimestamp, price: targetPrice },
    { timestamp: Date.now(), price: targetPrice }
  ];
  const newHistory = [...keptHistory, ...newHistoryEntries];

  const result = {
    dryRun: !!dryRun,
    ticker,
    priceReset: { from: Math.round(currentPrice * 100) / 100, to: targetPrice },
    clawbacks,
    holdersAffected,
    totalClawedBack,
    totalUnrecoverable,
    historyRewrite: { removedEntries: removedCount, keptEntries: keptHistory.length, newTotalEntries: newHistory.length }
  };

  // If dry run, return preview only
  if (dryRun) return result;

  // 2. Execute writes
  const batch = db.batch();

  // Reset price and rewrite price history
  batch.update(db.collection('market').doc('current'), {
    [`prices.${ticker}`]: targetPrice,
    [`priceHistory.${ticker}`]: newHistory
  });

  // Claw back cash from profiteers
  for (const cb of clawbacks) {
    const userRef = db.collection('users').doc(cb.uid);
    batch.update(userRef, {
      cash: cb.newCash,
      _repairLog: admin.firestore.FieldValue.arrayUnion({
        recoveryId,
        type: 'ticker_recovery',
        ticker,
        clawbackAmount: cb.actualClawback,
        previousCash: cb.previousCash,
        newCash: cb.newCash,
        timestamp: new Date().toISOString()
      })
    });
  }

  await batch.commit();

  return result;
});

// ─── DROP AUDIT ─────────────────────────────────────────────────────────────
exports.auditUserDrops = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { uid, username } = data;
  if (!uid && !username) {
    throw new functions.https.HttpsError('invalid-argument', 'uid or username required');
  }

  // Find user
  let userSnap;
  if (uid) {
    userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found');
  } else {
    const q = await db.collection('users').where('displayName', '==', username).limit(1).get();
    if (q.empty) throw new functions.https.HttpsError('not-found', 'User not found');
    userSnap = q.docs[0];
  }

  const userData = userSnap.data();
  const userId = userSnap.id;
  const claimedMessages = userData.claimedDailyStockMessages || [];

  // Extract timestamps from Discord snowflake IDs
  const DISCORD_EPOCH = 1420070400000n;
  const claimTimestamps = claimedMessages.map(id => {
    try {
      const snowflake = BigInt(id);
      const ms = Number((snowflake >> 22n) + DISCORD_EPOCH);
      return ms;
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => a - b);

  // Calculate expected claims (1 per day since first claim)
  const firstClaim = claimTimestamps.length > 0 ? claimTimestamps[0] : null;
  const now = Date.now();
  const daysSinceFirst = firstClaim ? Math.floor((now - firstClaim) / (24 * 60 * 60 * 1000)) + 1 : 0;

  // Get market prices
  const marketSnap = await db.collection('market').doc('current').get();
  const marketData = marketSnap.data() || {};
  const prices = marketData.prices || {};

  // Get ALL trades for this user
  const tradesSnap = await db.collection('trades').where('uid', '==', userId).get();
  const trades = tradesSnap.docs.map(d => d.data());

  // Calculate gifted shares per ticker
  const holdings = userData.holdings || {};
  const giftedSharesByTicker = {};
  let totalGiftedValue = 0;

  for (const [ticker, held] of Object.entries(holdings)) {
    if (held <= 0) continue;
    const tickerTrades = trades.filter(t => t.ticker === ticker);
    const bought = tickerTrades.filter(t => t.action === 'buy').reduce((s, t) => s + (t.amount || 0), 0);
    const sold = tickerTrades.filter(t => t.action === 'sell').reduce((s, t) => s + (t.amount || 0), 0);
    const netTraded = bought - sold;
    const gifted = Math.max(0, held - netTraded);
    if (gifted > 0) {
      const price = prices[ticker] || 0;
      giftedSharesByTicker[ticker] = { shares: gifted, price, value: Math.round(gifted * price * 100) / 100 };
      totalGiftedValue += gifted * price;
    }
  }

  totalGiftedValue = Math.round(totalGiftedValue * 100) / 100;

  // Claim frequency analysis — group claims by day
  const claimsByDay = {};
  for (const ts of claimTimestamps) {
    const day = new Date(ts).toISOString().split('T')[0];
    claimsByDay[day] = (claimsByDay[day] || 0) + 1;
  }

  // Find days with suspicious multi-claims
  const suspiciousDays = Object.entries(claimsByDay)
    .filter(([, count]) => count > 3)
    .sort((a, b) => b[1] - a[1])
    .map(([day, count]) => ({ day, count }));

  return {
    uid: userId,
    displayName: userData.displayName || 'Unknown',
    totalClaims: claimedMessages.length,
    expectedClaims: daysSinceFirst,
    excessClaims: Math.max(0, claimedMessages.length - daysSinceFirst),
    firstClaimDate: firstClaim ? new Date(firstClaim).toISOString() : null,
    claimTimestamps,
    claimsByDay,
    suspiciousDays,
    giftedSharesByTicker,
    totalGiftedValue,
    cash: Math.round((userData.cash || 0) * 100) / 100
  };
});

