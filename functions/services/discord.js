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