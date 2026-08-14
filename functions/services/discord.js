'use strict';

const { cf, requireAppCheck } = require('../fnConfig');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const crypto = require('crypto');
const { ADMIN_UID, STARTING_CASH, UNVERIFIED_STARTING_CASH, BASE_IMPACT, BASE_LIQUIDITY, MAX_PRICE_CHANGE_PERCENT, DISCORD_DAILY_DROP_CHANNEL, DISCORD_LINK_NONCE_TTL_MS } = require('../constants');
const { writeNotification, sendDiscordMessage, isDiscordRelinkBlocked, getDiscordBinding, isDiscordBindingLocked, bindDiscordToUid, grantedValueUpdate } = require('../helpers');


/**
 * Park a new signup's Discord details until they have picked a name.
 *
 * Signing up through Discord used to write the Firestore profile right here,
 * taking the Discord username as the display name unchecked. That skipped every
 * gate the other signup paths run — username format, profanity and banned-name
 * screening, the usernames reservation that makes names unique, the per-IP
 * account cap — because those all live in createUser, which was never called.
 *
 * So the profile is no longer created here. Only the Firebase Auth user is, and
 * the client lands on the same "pick a username" step every other signup sees
 * (useAuthUser shows it whenever a signed-in user has no profile). createUser
 * then consumes this record to attach the Discord link.
 */
const DISCORD_PENDING = 'discordPending';
const stashPendingDiscord = (uid, discordId, discordUsername) =>
  db.collection(DISCORD_PENDING).doc(uid).set({
    discordId,
    discordUsername: discordUsername || null,
    createdAt: Date.now(),
  });

// Discord OAuth Authentication
exports.discordAuth = cf().https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', 'https://stockism.app');

  const code = req.query.code;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    // NOTE: this redirect URI and the stockism.app domain (CORS above) are hardcoded and
    // must exactly match the redirect URIs registered in the Discord Developer Portal
    // (Stockism login app). If the domain, region, or project ID changes, update both
    // places here AND the portal, or Discord login breaks.
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
    // True when this is a brand-new signup that still has to choose a name.
    let needsName = false;

    // First, check if a Firestore user already has this discordId
    const discordSnap = await db.collection('users')
      .where('discordId', '==', discordId)
      .limit(1)
      .get();

    // Nobody holds this Discord right now, but it may still belong to someone:
    // self-serve unlink leaves a binding behind. Honour it at ANY age — the
    // binding's expiry only governs whether another account may CLAIM the
    // Discord, not where it logs in. Without this the email branch below would
    // spawn a duplicate account for a player who was only trying to log back in.
    let boundUid = null;
    if (discordSnap.empty) {
      const binding = await getDiscordBinding(discordId);
      const candidate = binding && binding.uid;
      if (candidate && (await db.collection('users').doc(candidate).get()).exists) {
        boundUid = candidate;
      }
    }

    if (!discordSnap.empty) {
      // Existing user found by discordId
      firebaseUid = discordSnap.docs[0].id;
    } else if (boundUid) {
      // Unlinked earlier — re-attach it to the account that owns it.
      firebaseUid = boundUid;
      await db.collection('users').doc(boundUid).update({
        discordId: discordId,
        discordUsername: username
      });
    } else if (await isDiscordRelinkBlocked(discordId)) {
      // No live account for this Discord, and it was on a recently-deleted one.
      // Block creating a fresh account (anti recycle / troll-account loop).
      return res.redirect('https://stockism.app/?discord_error=recently_deleted');
    } else if (email) {
      // Look up by email. Only getUserByEmail may throw "not found" here — the
      // link writes below must stay outside this try, or any Firestore hiccup
      // would fall through to the create branch and make a duplicate account.
      let existingUser = null;
      try {
        existingUser = await admin.auth().getUserByEmail(email);
      } catch (error) {
        existingUser = null;
      }

      if (existingUser) {
        firebaseUid = existingUser.uid;
        const existingRef = db.collection('users').doc(firebaseUid);
        const existingDoc = await existingRef.get();
        const linkedDiscordId = existingDoc.exists ? existingDoc.data().discordId : null;

        // Never overwrite a different Discord that is already on the account.
        // Overwriting silently released the old Discord ID for reuse elsewhere
        // (see discordLink below for why that matters). Logging in still works.
        if (existingDoc.exists && !linkedDiscordId) {
          const authLinkUpdate = { discordId: discordId, discordUsername: username };
          // Same one-time unlock discordLink grants, so verifying by logging in
          // with Discord is worth exactly what verifying from the profile page is.
          if (existingDoc.data().startingCashUnlocked === false) {
            authLinkUpdate.cash = admin.firestore.FieldValue.increment(STARTING_CASH - UNVERIFIED_STARTING_CASH);
            authLinkUpdate.startingCashUnlocked = true;
            Object.assign(authLinkUpdate, grantedValueUpdate(STARTING_CASH - UNVERIFIED_STARTING_CASH));
          }
          await existingRef.update(authLinkUpdate);
        }
      } else {
        // Brand new player: create only the AUTH user and stash the Discord
        // details. The Firestore profile is created later by createUser, once
        // they have chosen a name — see stashPendingDiscord.
        const newUser = await admin.auth().createUser({
          email: email,
          displayName: username,
          photoURL: avatarURL
        });
        firebaseUid = newUser.uid;
        await stashPendingDiscord(firebaseUid, discordId, username);
        needsName = true;
      }
    } else {
      // No email from Discord — same deal, auth user only.
      const newUser = await admin.auth().createUser({
        displayName: username,
        photoURL: avatarURL
      });
      firebaseUid = newUser.uid;
      await stashPendingDiscord(firebaseUid, discordId, username);
      needsName = true;
    }

    // Create custom Firebase token
    const customToken = await admin.auth().createCustomToken(firebaseUid);

    // New signups carry their Discord name back as a SUGGESTION for the name
    // picker. It is only a prefill — createUser re-validates it server-side, so
    // nothing here is trusted.
    const suggestion = needsName ? `&discord_name=${encodeURIComponent(username)}` : '';
    return res.redirect(`https://stockism.app/?discord_token=${customToken}${suggestion}`);

  } catch (error) {
    console.error('Discord auth error:', error);
    return res.redirect('https://stockism.app/?discord_error=true');
  }
});

const DISCORD_LINK_NONCES = 'discordLinkNonces';

/**
 * Step 1 of linking: mint a single-use code for the signed-in user and hand it
 * back so the client can put it in the OAuth `state` param.
 *
 * The `state` used to be the raw Firebase UID. Discord echoes state back
 * verbatim and never checks it, so anyone could put someone else's UID in the
 * authorize URL and staple their own Discord onto that account. This proves the
 * person who started the flow was signed in as that account.
 */
exports.startDiscordLink = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first');
  }
  const uid = context.auth.uid;

  // Drop this user's earlier codes so abandoned flows don't pile up. Only ever
  // a handful, and it keeps the collection self-cleaning without a schedule.
  const stale = await db.collection(DISCORD_LINK_NONCES).where('uid', '==', uid).get();
  await Promise.all(stale.docs.map(d => d.ref.delete()));

  const state = crypto.randomBytes(16).toString('hex');
  await db.collection(DISCORD_LINK_NONCES).doc(state).set({
    uid,
    createdAt: Date.now()
  });

  return { state };
});

/**
 * Resolves the OAuth `state` back to the UID that started the flow, burning the
 * code so it can't be replayed. Returns null if it is missing, already used or
 * older than DISCORD_LINK_NONCE_TTL_MS.
 */
const consumeDiscordLinkState = async (state) => {
  if (!/^[a-f0-9]{32}$/.test(state)) return null;
  const ref = db.collection(DISCORD_LINK_NONCES).doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.delete();
  const { uid, createdAt } = snap.data();
  if (Date.now() - (createdAt || 0) > DISCORD_LINK_NONCE_TTL_MS) return null;
  return uid || null;
};

// Discord Link — links Discord to an existing Stockism account (no new account created)
exports.discordLink = cf().https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://stockism.app');

  const code = req.query.code;
  const state = req.query.state; // single-use code from startDiscordLink

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

    // Resolve who started this flow. Burns the code, so a stale or replayed
    // link just fails and the player clicks Link Discord again. A raw Firebase
    // UID is NOT accepted here — Discord echoes state back without checking it,
    // so that let anyone staple their Discord onto someone else's account.
    const uid = await consumeDiscordLinkState(state);
    if (!uid) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=link_expired');
    }

    // Verify the Firebase UID is a real user
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=user_not_found');
    }

    // Refuse to move an account onto a different Discord. Relinking used to
    // overwrite discordId in place, which quietly freed the old Discord for
    // reuse — one Discord could then walk across unlimited accounts, handing
    // each one the verified starting cash, a Discord-wall pass and a fresh
    // claim on the same daily drop (drop claims dedupe per Stockism account,
    // not per Discord). Admins can free a link with adminUnlinkDiscord.
    const currentDiscordId = userDoc.data().discordId;
    if (currentDiscordId && currentDiscordId !== discordId) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=already_has_discord');
    }

    // Check if this Discord is already linked to another account
    const existingSnap = await db.collection('users')
      .where('discordId', '==', discordId)
      .limit(1)
      .get();

    if (!existingSnap.empty && existingSnap.docs[0].id !== uid) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=already_linked');
    }

    // Nobody holds it, but unlinking reserves a Discord to its account for
    // DISCORD_BINDING_TTL_MS. Without that, self-serve unlink would hand one
    // Discord an endless supply of starting-cash unlocks, repeat daily-drop
    // claims and Discord-wall passes across fresh accounts. adminFreeDiscord
    // releases it early when the hold is catching an honest player.
    if (await isDiscordBindingLocked(discordId, uid)) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=bound_to_other_account');
    }

    // Block linking a Discord that was on a recently-deleted account — otherwise
    // the create → grab the verified $3k → gamble → delete → remake loop works by
    // re-linking the same Discord to each fresh account. Frees up after the cooldown.
    if (await isDiscordRelinkBlocked(discordId)) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=recently_deleted');
    }

    // Link Discord to the existing account
    const linkUpdate = {
      discordId: discordId,
      discordUsername: discordUsername
    };

    // One-time: unlock full starting cash on first Discord verification (anti-alt gate).
    // Must be `=== false`, not `!== true`: createUser always writes the flag, so only
    // accounts that actually started on the unverified $1,000 are owed the difference.
    // Accounts predating the gate (May 2026) have no flag at all and already started
    // with the full amount — `!== true` paid them another $2,000 on any relink.
    if (userDoc.data().startingCashUnlocked === false && !currentDiscordId) {
      linkUpdate.cash = admin.firestore.FieldValue.increment(STARTING_CASH - UNVERIFIED_STARTING_CASH);
      linkUpdate.startingCashUnlocked = true;
      Object.assign(linkUpdate, grantedValueUpdate(STARTING_CASH - UNVERIFIED_STARTING_CASH));
    }

    // Award DISCORD_LINKED achievement if not already earned
    const currentAchievements = userDoc.data().achievements || [];
    if (!currentAchievements.includes('DISCORD_LINKED')) {
      linkUpdate.achievements = admin.firestore.FieldValue.arrayUnion('DISCORD_LINKED');
      linkUpdate['achievementDates.DISCORD_LINKED'] = Date.now();
    }

    await db.collection('users').doc(uid).update(linkUpdate);

    return res.redirect('https://stockism.app/profile?discord_link=success');
  } catch (error) {
    const discordError = error.response && error.response.data
      ? JSON.stringify(error.response.data)
      : error.message || 'unknown';
    console.error('Discord link error:', discordError);
    return res.redirect(`https://stockism.app/profile?discord_link=error&reason=${encodeURIComponent(discordError)}`);
  }
});

/**
 * Disconnect your own Discord (Profile → Discord → Unlink).
 *
 * Players shouldn't need an admin to detach their own account, but a released
 * Discord must not immediately verify a DIFFERENT account, so this reserves it
 * to the current one for DISCORD_BINDING_TTL_MS before letting go. Re-linking it
 * here works straight away; linking it elsewhere waits out the week. An admin
 * can release it now with adminUnlinkDiscord or adminFreeDiscord.
 *
 * startingCashUnlocked is left alone, so re-linking can never re-pay the
 * one-time verification bonus.
 */
exports.unlinkOwnDiscord = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first');
  }
  const uid = context.auth.uid;

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Account not found');
  }

  const userData = userSnap.data();
  const discordId = userData.discordId;
  if (!discordId) {
    return { success: true, alreadyUnlinked: true };
  }

  // Reserve BEFORE releasing. If this write fails the Discord stays attached,
  // which is the safe direction — an unreserved free Discord is the exploit.
  const owner = await bindDiscordToUid(discordId, uid, userData.discordUsername);
  if (owner !== uid) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This Discord is reserved to a different account. Contact an admin.'
    );
  }

  await userRef.update({
    discordId: admin.firestore.FieldValue.delete(),
    discordUsername: admin.firestore.FieldValue.delete()
  });

  return {
    success: true,
    alreadyUnlinked: false,
    // The wall re-engages the moment the Discord comes off, so the UI can warn.
    walled: !!userData.requiresDiscordLink
  };
});

// Builds the drop post. Shared by the schedule and the admin re-run so a
// manually posted drop is byte-for-byte the same message players normally get.
const buildDailyDropMessage = () => ({
  embeds: [{
    title: '🎁 Daily Free Stock Drop!',
    description: 'Click the button below to claim your free daily stock(s)!\n\n' +
      '**How it works:**\n' +
      '• Every claim gives you a **main pull** from the rare and epic stocks\n' +
      '• On top of that you get **bonus shares** of cheaper characters\n' +
      '• Small chance of a **legendary bonus** share on any roll\n' +
      '• Hit the **jackpot** (3% chance) for a full legendary haul\n\n' +
      '*Your Discord must be linked to your Stockism account to claim.*',
    color: 0x00D166,
    footer: { text: 'Resets daily • One claim per user' }
  }],
  components: [
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
  ],
});

const postDailyDrop = async () => {
  const { embeds, components } = buildDailyDropMessage();
  await sendDiscordMessage(null, embeds, DISCORD_DAILY_DROP_CHANNEL, components);
};

/**
 * Daily scheduled function — posts the claim button to Discord.
 * Runs at 10 AM Eastern (14:00 UTC) every day.
 */
exports.dailyFreeStock = cf().pubsub
  .schedule('0 14 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    await postDailyDrop();
    console.log(`Daily free stock claim message posted to channel ${DISCORD_DAILY_DROP_CHANNEL}`);
    return null;
  });

/**
 * Manual re-run of the daily drop (admin only).
 *
 * NOT idempotent, unlike the market-report triggers: every drop message is a
 * separately claimable 72-hour window, so posting a second one hands every
 * linked player another full claim. That is the point (event drops), but it
 * doubles the day's payout — the admin button warns before firing.
 */
exports.triggerDailyFreeStock = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  try {
    await postDailyDrop();
    return { success: true };
  } catch (error) {
    console.error('Error in triggerDailyFreeStock:', error);
    return { success: false, error: error.message };
  }
});

/**
 * Discord Interactions Webhook — handles button clicks for daily stock claim.
 * Must be registered as the Interactions Endpoint URL in Discord Developer Portal.
 */