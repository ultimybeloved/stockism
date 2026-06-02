'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { ADMIN_UID, UNVERIFIED_STARTING_CASH, MAX_ACCOUNTS_PER_IP, IP_ACCOUNT_CAP_ENABLED, IP_SLOT_RELEASE_MS } = require('../constants');
const { isBannedUsername, containsProfanity, sendDiscordMessage, checkBanned, checkDiscordWall } = require('../helpers');

/**
 * Creates a new user with case-insensitive unique username.
 *
 * Atomically:
 * 1. Checks if lowercase username is available
 * 2. Reserves the username in usernames collection
 * 3. Creates the user document
 *
 * @param {string} displayName - The desired display name (1-20 chars, alphanumeric + underscore)
 * @returns {Object} - { success: true } or throws error
 */
exports.createUser = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in to create a user profile.'
    );
  }

  const uid = context.auth.uid;
  const displayName = data.displayName;

  // Validate displayName
  if (!displayName || typeof displayName !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Display name is required.'
    );
  }

  const trimmed = displayName.trim();

  if (trimmed.length < 3) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username must be at least 3 characters.'
    );
  }

  if (trimmed.length > 20) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username must be 20 characters or less.'
    );
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username can only contain letters, numbers, and underscores.'
    );
  }

  const displayNameLower = trimmed.toLowerCase();

  // Check if username is banned
  if (isBannedUsername(displayNameLower)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'This username is not allowed.'
    );
  }

  // Check for profanity
  if (containsProfanity(trimmed)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username contains inappropriate language. Please choose a different name.'
    );
  }

  // Watched IP check — block alt accounts from watched IPs
  let autoLinkData = null;
  const signupIp = context.rawRequest?.ip || 'unknown';
  const sanitizedSignupIp = signupIp !== 'unknown' ? signupIp.replace(/[.:/]/g, '_') : null;

  // Per-IP signup controls (admin exempt). One read of the IP's account history drives
  // two things: (1) a hard cap block when the network is full, and (2) flagging this
  // account for Discord verification when the network already has another account.
  let requiresDiscordLink = false;
  if (uid !== ADMIN_UID && sanitizedSignupIp) {
    try {
      const ipTrackDoc = await db.collection('ipTracking').doc(sanitizedSignupIp).get();
      const ipTrackData = ipTrackDoc.exists ? ipTrackDoc.data() : {};
      // Count live accounts plus recently-deleted ones: a deleted account holds its
      // slot for IP_SLOT_RELEASE_MS so it can't be deleted-and-remade to dodge the cap.
      const liveAccounts = Object.keys(ipTrackData.accounts || {}).length;
      const capNow = Date.now();
      const recentlyDeleted = Object.values(ipTrackData.deletedAccounts || {})
        .filter(deletedAt => capNow - deletedAt < IP_SLOT_RELEASE_MS).length;
      const effectiveAccounts = liveAccounts + recentlyDeleted;

      // (2) Suspected alt: another live account already exists on this network, so make
      // this one link Discord before it can do anything. The flag lifts once linked.
      if (liveAccounts >= 1) requiresDiscordLink = true;

      // (1) Hard cap block (when enabled).
      if (IP_ACCOUNT_CAP_ENABLED && effectiveAccounts >= MAX_ACCOUNTS_PER_IP) {
        await db.collection('watchlist_alerts').add({
          type: 'signup_blocked',
          relatedUID: uid,
          ip: signupIp,
          action: 'blocked',
          details: `Blocked signup "${trimmed}" — network already has ${effectiveAccounts} account(s) (${liveAccounts} active, ${recentlyDeleted} recently deleted; cap ${MAX_ACCOUNTS_PER_IP})`,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        throw new functions.https.HttpsError(
          'permission-denied',
          `Account creation is limited to ${MAX_ACCOUNTS_PER_IP} accounts per network.`
        );
      }
    } catch (capErr) {
      if (capErr instanceof functions.https.HttpsError) throw capErr;
      console.error('Signup IP check error:', capErr);
    }
  }

  if (signupIp !== 'unknown') {
    try {
      const watchedIpDoc = await db.collection('watchedIPs').doc(sanitizedSignupIp).get();
      if (watchedIpDoc.exists) {
        const watchedIpData = watchedIpDoc.data();
        const watchedUserDoc = await db.collection('watchedUsers').doc(watchedIpData.watchedUserId).get();

        if (watchedUserDoc.exists && watchedUserDoc.data().isActive) {
          const watchedData = watchedUserDoc.data();
          const maxAccounts = watchedData.maxAccountsPerIP || 1;
          const linkedAccounts = watchedData.linkedAccounts || [];

          // Count total linked accounts
          const activeAccounts = linkedAccounts.length;

          if (activeAccounts >= maxAccounts) {
            // Block account creation
            await db.collection('watchlist_alerts').add({
              type: 'account_blocked',
              watchedUID: watchedIpData.watchedUserId,
              relatedUID: uid,
              ip: signupIp,
              action: 'blocked',
              details: `Blocked signup "${trimmed}" — ${activeAccounts} active accounts already exist from watched IP`,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            throw new functions.https.HttpsError(
              'permission-denied',
              'Account creation temporarily restricted from this network.'
            );
          } else {
            // Under limit — flag for auto-link after transaction succeeds
            autoLinkData = {
              watchedUserId: watchedIpData.watchedUserId,
              watchedDisplayName: watchedData.displayName || watchedIpData.watchedUserId,
              sanitizedSignupIp,
              signupIp,
              activeAccounts,
              maxAccounts
            };
          }
        }
      }
    } catch (ipCheckError) {
      if (ipCheckError instanceof functions.https.HttpsError) throw ipCheckError;
      console.error('Watched IP check error during signup:', ipCheckError);
    }
  }

  // Use a transaction to atomically check and create
  try {
    await db.runTransaction(async (transaction) => {
      const usernameRef = db.collection('usernames').doc(displayNameLower);
      const userRef = db.collection('users').doc(uid);

      // Check if username is already taken (including deleted usernames)
      const usernameDoc = await transaction.get(usernameRef);
      if (usernameDoc.exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'This username is already taken.'
        );
      }

      // Check if user already has a profile
      const userDoc = await transaction.get(userRef);
      if (userDoc.exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'User profile already exists.'
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();

      // Reserve the username
      transaction.set(usernameRef, {
        uid: uid,
        createdAt: now
      });

      // Create the user document
      transaction.set(userRef, {
        displayName: trimmed,
        displayNameLower: displayNameLower,
        cash: UNVERIFIED_STARTING_CASH,
        holdings: {},
        portfolioValue: UNVERIFIED_STARTING_CASH,
        portfolioHistory: [{ timestamp: Date.now(), value: UNVERIFIED_STARTING_CASH }],
        lastCheckin: null,
        createdAt: now,
        achievements: [],
        totalCheckins: 0,
        totalTrades: 0,
        peakPortfolioValue: UNVERIFIED_STARTING_CASH,
        predictionWins: 0,
        costBasis: {},
        lendingUnlocked: false,
        isBankrupt: false,
        onboardingComplete: false,
        startingCashUnlocked: false,
        signupIp: sanitizedSignupIp || null,
        requiresDiscordLink
      });
    });

    // Auto-link to watched user after successful account creation
    if (autoLinkData) {
      try {
        // Re-check for duplicates before linking (prevents duplicate entries from concurrent requests)
        const watchedSnap = await db.collection('watchedUsers').doc(autoLinkData.watchedUserId).get();
        const alreadyLinked = watchedSnap.exists && (watchedSnap.data().linkedAccounts || []).some(a => a.uid === uid);

        if (!alreadyLinked) {
          const newLinked = {
            uid,
            displayName: trimmed,
            linkedVia: 'ip',
            ip: autoLinkData.signupIp,
            linkedAt: Date.now()
          };

          await db.collection('watchedUsers').doc(autoLinkData.watchedUserId).update({
            linkedAccounts: admin.firestore.FieldValue.arrayUnion(newLinked),
            [`knownIPs.${autoLinkData.sanitizedSignupIp}.lastSeen`]: Date.now(),
            [`knownIPs.${autoLinkData.sanitizedSignupIp}.accounts`]: admin.firestore.FieldValue.arrayUnion(uid)
          });

          await db.collection('watchlist_alerts').add({
            type: 'account_linked',
            watchedUID: autoLinkData.watchedUserId,
            relatedUID: uid,
            ip: autoLinkData.signupIp,
            action: 'linked',
            details: `Auto-linked new account "${trimmed}" from watched IP`,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

        }
      } catch (linkError) {
        console.error('Auto-link after signup failed:', linkError);
      }
    }

    // Send Discord notification for new user signup
    try {
      const authProvider = context.auth.token.firebase?.sign_in_provider || 'unknown';
      const providerEmoji = {
        'google.com': '🔵',
        'twitter.com': '🐦',
        'password': '📧',
        'unknown': '🔑'
      };

      const embed = {
        color: 0x00ff00, // Green
        title: '🎉 New User Joined!',
        description: `**${trimmed}** just joined Stockism`,
        fields: [
          {
            name: 'Sign-up Method',
            value: `${providerEmoji[authProvider] || '🔑'} ${authProvider === 'google.com' ? 'Google' : authProvider === 'twitter.com' ? 'Twitter' : authProvider === 'password' ? 'Email' : 'Other'}`,
            inline: true
          },
          {
            name: 'Starting Cash',
            value: `$${UNVERIFIED_STARTING_CASH.toLocaleString()}`,
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Stockism - Where Lookism characters become investments'
        }
      };

      await sendDiscordMessage(null, [embed], 'signups');
    } catch (discordError) {
      console.error('Failed to send Discord signup notification:', discordError);
      // Don't fail user creation if Discord notification fails
    }

    // Record signup IP in ipTracking
    if (signupIp !== 'unknown') {
      try {
        const sanitizedIp = signupIp.replace(/[.:/]/g, '_');
        await db.collection('ipTracking').doc(sanitizedIp).set({
          accounts: { [uid]: Date.now() },
          lastUpdated: Date.now()
        }, { merge: true });
      } catch (e) {
        console.error('Failed to record signup IP:', e);
      }
    }

    return { success: true };
  } catch (error) {
    // Re-throw HttpsErrors as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    // Wrap other errors
    console.error('Error creating user:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to create user profile. Please try again.'
    );
  }
});

/**
 * Migrates existing users to the usernames collection.
 * Admin-only function to be run once after deployment.
 *
 * @returns {Object} - { migrated: number, conflicts: Array, errors: Array }
 */
exports.migrateUsernames = functions.https.onCall(async (data, context) => {
  // Verify admin
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can run migrations.'
    );
  }

  const results = {
    migrated: 0,
    conflicts: [],
    errors: []
  };

  try {
    // Get all users
    const usersSnapshot = await db.collection('users').get();

    // Track lowercase names to detect conflicts
    const seenNames = new Map(); // lowercase -> { uid, displayName }

    // First pass: detect conflicts
    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const displayName = userData.displayName;

      if (!displayName) {
        results.errors.push({
          uid: doc.id,
          error: 'No displayName found'
        });
        return;
      }

      const lower = displayName.toLowerCase();

      if (seenNames.has(lower)) {
        // Conflict detected
        const existing = seenNames.get(lower);
        results.conflicts.push({
          username: lower,
          users: [
            { uid: existing.uid, displayName: existing.displayName },
            { uid: doc.id, displayName: displayName }
          ]
        });
      } else {
        seenNames.set(lower, { uid: doc.id, displayName });
      }
    });

    // If there are conflicts, don't migrate - return conflicts for manual resolution
    if (results.conflicts.length > 0) {
      return {
        ...results,
        message: 'Conflicts detected. Please resolve manually before migrating.',
        migrated: 0
      };
    }

    // Second pass: migrate non-conflicting usernames
    const batch = db.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500;

    for (const [lower, { uid, displayName }] of seenNames) {
      const usernameRef = db.collection('usernames').doc(lower);
      const userRef = db.collection('users').doc(uid);

      batch.set(usernameRef, {
        uid: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Also update user doc with displayNameLower for consistency
      batch.update(userRef, {
        displayNameLower: lower
      });

      batchCount++;
      results.migrated++;

      // Commit batch if at limit
      if (batchCount >= MAX_BATCH_SIZE) {
        await batch.commit();
        batchCount = 0;
      }
    }

    // Commit remaining
    if (batchCount > 0) {
      await batch.commit();
    }

    return {
      ...results,
      message: `Successfully migrated ${results.migrated} usernames.`
    };
  } catch (error) {
    console.error('Migration error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Migration failed: ' + error.message
    );
  }
});

/**
 * Check if a username is available (case-insensitive).
 * Public function for real-time availability checking.
 *
 * @param {string} displayName - The username to check
 * @returns {Object} - { available: boolean }
 */
exports.checkUsername = functions.https.onCall(async (data, context) => {
  const displayName = data.displayName;

  if (!displayName || typeof displayName !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Display name is required.'
    );
  }

  const trimmed = displayName.trim();

  if (trimmed.length < 3 || trimmed.length > 20) {
    return { available: false, reason: 'Invalid length' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { available: false, reason: 'Invalid characters' };
  }

  const lower = trimmed.toLowerCase();

  // Check if username is banned
  if (isBannedUsername(lower)) {
    return { available: false, reason: 'Username not allowed' };
  }

  const usernameDoc = await db.collection('usernames').doc(lower).get();

  // Username is taken if the document exists (even if marked as deleted)
  return {
    available: !usernameDoc.exists,
    reason: usernameDoc.exists ? 'Username taken' : null
  };
});

exports.changeDisplayName = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const newDisplayName = data.displayName;

  if (!newDisplayName || typeof newDisplayName !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Display name is required.');
  }

  const trimmed = newDisplayName.trim();

  if (trimmed.length < 3) throw new functions.https.HttpsError('invalid-argument', 'Username must be at least 3 characters.');
  if (trimmed.length > 20) throw new functions.https.HttpsError('invalid-argument', 'Username must be 20 characters or less.');
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) throw new functions.https.HttpsError('invalid-argument', 'Username can only contain letters, numbers, and underscores.');

  const newNameLower = trimmed.toLowerCase();

  if (isBannedUsername(newNameLower)) throw new functions.https.HttpsError('invalid-argument', 'This username is not allowed.');
  if (containsProfanity(trimmed)) throw new functions.https.HttpsError('invalid-argument', 'Username contains inappropriate language.');

  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

  const userData = userDoc.data();
  if (userData.isBot || userData.isBanned) throw new functions.https.HttpsError('permission-denied', 'Action not allowed.');

  // Cooldown: 14 days between changes
  if (userData.nameChangedAt) {
    const msSinceChange = Date.now() - userData.nameChangedAt.toMillis();
    const cooldownMs = 14 * 24 * 60 * 60 * 1000;
    if (msSinceChange < cooldownMs) {
      const daysLeft = Math.ceil((cooldownMs - msSinceChange) / (24 * 60 * 60 * 1000));
      throw new functions.https.HttpsError('failed-precondition', `You can change your name again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`);
    }
  }

  const oldDisplayName = userData.displayName;
  const oldNameLower = userData.displayNameLower;

  if (newNameLower === oldNameLower) throw new functions.https.HttpsError('invalid-argument', 'That is already your current name.');

  const NAME_CHANGE_COST = 10000;
  if ((userData.cash || 0) < NAME_CHANGE_COST) {
    throw new functions.https.HttpsError('failed-precondition', `Name change costs $${NAME_CHANGE_COST.toLocaleString()}. You don't have enough cash.`);
  }

  // Check uniqueness
  const existingDoc = await db.collection('usernames').doc(newNameLower).get();
  if (existingDoc.exists) throw new functions.https.HttpsError('already-exists', 'That username is already taken.');

  const batch = db.batch();
  batch.delete(db.collection('usernames').doc(oldNameLower));
  batch.set(db.collection('usernames').doc(newNameLower), { uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  batch.update(userRef, {
    displayName: trimmed,
    displayNameLower: newNameLower,
    previousDisplayName: oldDisplayName,
    nameChangedAt: admin.firestore.FieldValue.serverTimestamp(),
    cash: admin.firestore.FieldValue.increment(-NAME_CHANGE_COST),
  });
  await batch.commit();

  return { success: true };
});

const COSMETIC_CATALOG = {
  name_gold:         { type: 'nameColor',   price: 5000  },
  name_crimson:      { type: 'nameColor',   price: 5000  },
  name_emerald:      { type: 'nameColor',   price: 5000  },
  name_sapphire:     { type: 'nameColor',   price: 5000  },
  name_violet:       { type: 'nameColor',   price: 5000  },
  glow_gold:         { type: 'rowGlow',     price: 15000 },
  glow_crimson:      { type: 'rowGlow',     price: 15000 },
  glow_neon:         { type: 'rowGlow',     price: 15000 },
  backdrop_royal:    { type: 'rowBackdrop', price: 25000 },
  backdrop_inferno:  { type: 'rowBackdrop', price: 25000 },
  backdrop_frost:    { type: 'rowBackdrop', price: 25000 },
};

exports.purchaseCosmetic = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

  const { cosmeticId } = data || {};
  const cosmetic = COSMETIC_CATALOG[cosmeticId];
  if (!cosmetic) throw new functions.https.HttpsError('invalid-argument', 'Invalid cosmetic.');

  const uid = context.auth.uid;
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

  const userData = userDoc.data();
  if (userData.isBot || userData.isBanned) throw new functions.https.HttpsError('permission-denied', 'Action not allowed.');
  if ((userData.ownedCosmetics || []).includes(cosmeticId)) throw new functions.https.HttpsError('already-exists', 'You already own this cosmetic.');
  if ((userData.cash || 0) < cosmetic.price) throw new functions.https.HttpsError('failed-precondition', 'Not enough cash.');

  await userRef.update({
    ownedCosmetics: admin.firestore.FieldValue.arrayUnion(cosmeticId),
    cash: admin.firestore.FieldValue.increment(-cosmetic.price),
  });

  return { success: true };
});

/**
 * Deletes a user account and all associated data.
 *
 * Atomically:
 * 1. Deletes the user document from users collection
 * 2. Marks the username as deleted (keeps it reserved to prevent reuse)
 * 3. Deletes the Firebase Auth account
 *
 * @param {string} confirmUsername - Must match the user's display name to confirm deletion
 * @returns {Object} - { success: true } or throws error
 */
exports.deleteAccount = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in to delete your account.'
    );
  }

  const uid = context.auth.uid;
  const confirmUsername = data.confirmUsername;

  // Validate confirmation username is provided
  if (!confirmUsername || typeof confirmUsername !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username confirmation is required.'
    );
  }

  try {
    // Get user document to verify username match
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'User profile not found.'
      );
    }

    const userData = userDoc.data();
    const displayName = userData.displayName;
    const displayNameLower = userData.displayNameLower;

    // Verify the confirmation username matches (case-insensitive)
    if (confirmUsername.toLowerCase() !== displayName.toLowerCase()) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Username confirmation does not match.'
      );
    }

    // Mark username as deleted (but keep reserved) first, so the name stays
    // claimed even if a later step fails.
    if (displayNameLower) {
      const usernameRef = db.collection('usernames').doc(displayNameLower);
      await usernameRef.set({
        deleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedUid: uid
      }, { merge: true });
    }

    // Recursively delete the user document AND its subcollections
    // (notifications, portfolioHistory, etc.). Firestore does not cascade, so a
    // plain doc delete would orphan that data forever.
    await db.recursiveDelete(userRef);

    // Release this account's per-IP slot, but only after IP_SLOT_RELEASE_MS. We drop
    // it from the live `accounts` map and tombstone it in `deletedAccounts` with the
    // deletion time; the signup cap counts recent tombstones, so the slot stays held
    // for ~a month. This kills the pump → delete → remake loop without permanently
    // locking out genuine deleters.
    if (userData.signupIp) {
      try {
        await db.collection('ipTracking').doc(userData.signupIp).update({
          [`accounts.${uid}`]: admin.firestore.FieldValue.delete(),
          [`deletedAccounts.${uid}`]: Date.now()
        });
      } catch (e) { /* IP tracking doc may not exist */ }
    }

    // Delete the Firebase Auth account
    await admin.auth().deleteUser(uid);

    return { success: true };
  } catch (error) {
    // Re-throw HttpsErrors as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    // Wrap other errors
    console.error('Error deleting account:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to delete account. Please try again.'
    );
  }
});

exports.dailyCheckin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { ladderTopUp } = data; // Boolean flag for first-time ladder initialization

  try {
    return await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }

      const userData = userDoc.data();
      checkBanned(userData);
      checkDiscordWall(userData);
      const now = new Date();
      const today = now.toISOString().split('T')[0];

      // Handle both string (old format) and Timestamp (new format)
      let lastCheckinDate = null;
      if (userData.lastCheckin) {
        if (typeof userData.lastCheckin === 'string') {
          // Old format: "Mon Jan 27 2025" from toDateString()
          // Convert to YYYY-MM-DD for comparison
          const parsedDate = new Date(userData.lastCheckin);
          if (!isNaN(parsedDate.getTime())) {
            lastCheckinDate = parsedDate.toISOString().split('T')[0];
          }
        } else if (typeof userData.lastCheckin.toDate === 'function') {
          // New format: Firestore Timestamp
          lastCheckinDate = userData.lastCheckin.toDate().toISOString().split('T')[0];
        } else if (userData.lastCheckin.seconds) {
          // Fallback: Plain timestamp object with seconds
          lastCheckinDate = new Date(userData.lastCheckin.seconds * 1000).toISOString().split('T')[0];
        }
      }

      // Check if already checked in today
      if (lastCheckinDate === today) {
        throw new functions.https.HttpsError('failed-precondition', 'Already checked in today.');
      }

      // Calculate streak
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = yesterday.toISOString().split('T')[0];

      const currentStreak = userData.checkinStreak || 0;
      const newStreak = lastCheckinDate === yesterdayDate ? currentStreak + 1 : 1;
      const maxCheckinStreak = Math.max(userData.maxCheckinStreak || 0, newStreak);

      // Flat $300 daily check-in reward
      const checkinReward = 300;

      // Compute week ID for weekly missions
      const weekStartDate = new Date(now);
      weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay() + 1);
      if (weekStartDate > now) weekStartDate.setDate(weekStartDate.getDate() - 7);
      const checkinWeekId = weekStartDate.toISOString().split('T')[0];

      // Update user document
      const updates = {
        cash: (userData.cash || 0) + checkinReward,
        lastCheckin: admin.firestore.Timestamp.now(),
        checkinStreak: newStreak,
        maxCheckinStreak,
        totalCheckins: (userData.totalCheckins || 0) + 1,
        // Mission tracking (server-side)
        [`dailyMissions.${today}.checkedIn`]: true,
        [`weeklyMissions.${checkinWeekId}.checkinDays.${today}`]: true
      };

      // Ladder game: $500 start for new players, top up to $100 if below for existing
      const ladderRef = db.collection('ladderGameUsers').doc(uid);
      const ladderDoc = await transaction.get(ladderRef);
      let ladderTopUpAmount = 0;

      if (!ladderDoc.exists) {
        // New player — initialize with $500
        ladderTopUpAmount = 500;
        updates.ladderGameInitialized = true;
        transaction.set(ladderRef, {
          uid,
          displayName: userData.displayName || 'Anonymous',
          balance: 500,
          totalDeposited: 0,
          totalWon: 0,
          totalLost: 0,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          currentStreak: 0,
          bestStreak: 0,
          lastPlayed: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Existing player — top up to $100 if below
        const ladderBalance = ladderDoc.data().balance || 0;
        if (ladderBalance < 100) {
          ladderTopUpAmount = 100 - ladderBalance;
          transaction.update(ladderRef, { balance: 100 });
        }
      }

      // Append check-in to transaction log
      const existingLog = userData.transactionLog || [];
      const checkinEntry = {
        type: 'CHECKIN',
        timestamp: Date.now(),
        bonus: checkinReward,
        cashBefore: userData.cash || 0,
        cashAfter: (userData.cash || 0) + checkinReward
      };
      updates.transactionLog = [...existingLog, checkinEntry].slice(-100);

      transaction.update(userRef, updates);

      return {
        success: true,
        reward: checkinReward,
        newStreak,
        ladderTopUpAmount,
        totalCheckins: updates.totalCheckins
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Daily checkin error:', error);
    throw new functions.https.HttpsError('internal', 'Checkin failed: ' + error.message);
  }
});

/**
 * Records and validates a completed trade (legacy - may be unused)
 * Logs for auditing, detects suspicious patterns
 */
exports.recordTrade = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in.'
    );
  }

  const uid = context.auth.uid;
  const { ticker, action, amount, price, totalValue, cashBefore, cashAfter, portfolioAfter } = data;

  // Ban check
  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.exists) checkBanned(userSnap.data());

  try {
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Record in transaction log
    const tradeRecord = {
      uid,
      ticker,
      action,
      amount,
      price,
      totalValue,
      cashBefore,
      cashAfter,
      portfolioAfter,
      timestamp: now,
      ip: context.rawRequest?.ip || 'unknown'
    };

    // Store in a separate trades collection for auditing
    await db.collection('trades').add(tradeRecord);

    // Check for suspicious patterns
    const recentTradesSnap = await db.collection('trades')
      .where('uid', '==', uid)
      .where('timestamp', '>', new Date(Date.now() - 60000)) // Last minute
      .get();

    const tradeCount = recentTradesSnap.size;

    // Flag suspicious activity (>10 trades per minute)
    if (tradeCount > 10) {
      console.warn(`SUSPICIOUS ACTIVITY: User ${uid} made ${tradeCount} trades in 1 minute`);

      // Log to admin collection for review
      await db.collection('admin').doc('suspicious_activity').set({
        [uid]: {
          timestamp: now,
          tradeCount,
          reason: 'Excessive trading frequency',
          recentTrade: tradeRecord
        }
      }, { merge: true });

      // Send Discord alert if configured
      try {
        await sendDiscordMessage(`⚠️ **Suspicious Activity Detected**\nUser: ${uid}\nTrades in 1 minute: ${tradeCount}\nAction: Manual review required`);
      } catch (err) {
        console.error('Failed to send Discord alert:', err);
      }
    }

    return { success: true, recorded: true };

  } catch (error) {
    console.error('Trade recording error:', error);
    // Don't throw - recording failure shouldn't block the trade
    return { success: false, error: error.message };
  }
});
