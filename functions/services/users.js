'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const { ADMIN_UID, UNVERIFIED_STARTING_CASH, MAX_ACCOUNTS_PER_IP, IP_ACCOUNT_CAP_ENABLED, IP_SLOT_RELEASE_MS, CHECKIN_STREAK_REWARDS } = require('../constants');
const { isBannedUsername, containsProfanity, validateUsernameFormat, sendDiscordMessage, checkBanned, checkDiscordWall, touchLastActive } = require('../helpers');
const { isDisposableEmailLive } = require('../disposableEmail');
const { countIpAccounts } = require('../ipCap');

// Deletes the orphaned Firebase Auth account left behind when a signup is hard-
// blocked (disposable email, IP cap, watched IP). The browser creates the auth
// login before calling createUser, so without this a blocked signup keeps a
// usable login that can sit around and retry. Best-effort — never masks the
// original block error. Never called for retryable failures (e.g. name taken).
async function cleanupBlockedAuthUser(uid) {
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    console.error(`Failed to delete blocked auth user ${uid}:`, e.message);
  }
}

/**
 * Creates a new user with case-insensitive unique username.
 *
 * Atomically:
 * 1. Checks if lowercase username is available
 * 2. Reserves the username in usernames collection
 * 3. Creates the user document
 *
 * @param {string} displayName - The desired display name (3-20 chars, at least 3 letters/numbers, up to 2 non-repeating underscores not at the ends)
 * @returns {Object} - { success: true } or throws error
 */
exports.createUser = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
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

  validateUsernameFormat(trimmed);

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

  // Block disposable / temp-mail signups outright. The email comes from the
  // verified auth token, so it can't be spoofed. This is the main defense
  // against the throwaway-email alt ring — a rotating VPN beats the per-IP cap,
  // but the temp-mail domain is the same vector every time. The live check
  // includes a daily-updated community list, so fresh rotating domains get
  // blocked without a deploy; on network failure it degrades to bundled lists.
  const signupEmail = (context.auth.token && context.auth.token.email) || null;
  if (await isDisposableEmailLive(signupEmail)) {
    const emailDomain = signupEmail.slice(signupEmail.lastIndexOf('@') + 1).toLowerCase();
    await db.collection('watchlist_alerts').add({
      type: 'signup_blocked',
      relatedUID: uid,
      ip: context.rawRequest?.ip || null,
      action: 'blocked',
      details: `Blocked signup "${trimmed}" — disposable email domain (${emailDomain})`,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    await cleanupBlockedAuthUser(uid);
    throw new functions.https.HttpsError(
      'permission-denied',
      'Disposable email addresses are not allowed. Please sign up with a permanent email.'
    );
  }

  // Watched IP check — block alt accounts from watched IPs
  let autoLinkData = null;
  const signupIp = context.rawRequest?.ip || 'unknown';
  const sanitizedSignupIp = signupIp !== 'unknown' ? signupIp.replace(/[.:/]/g, '_') : null;

  // Per-IP signup controls (admin exempt) are enforced INSIDE the create
  // transaction below, not here. The old version read the IP count before the
  // transaction and only recorded the new account afterward, so a burst of
  // signups from one VPN exit IP all read the same stale count and all slipped
  // past the cap. Doing the count-and-reserve inside the transaction makes it
  // atomic: concurrent signups on the same IP serialize, so the 3rd correctly
  // sees 2 and is rejected. `requiresDiscordLink` is set there too.
  let requiresDiscordLink = false;
  let capBlockInfo = null; // set by the transaction when the IP cap rejects this signup

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

            await cleanupBlockedAuthUser(uid);
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

      // Fallback for legacy accounts that predate the reservation system and have no
      // doc in `usernames`: also scan the users collection for the same lowercase name,
      // so a different-case duplicate (e.g. "SandyGnow" vs "sandygnow") is still blocked
      // even when no reservation doc exists. Relies on displayNameLower being set on old
      // docs, which the username backfill (migrateUsernames) populates.
      const dupSnap = await transaction.get(
        db.collection('users').where('displayNameLower', '==', displayNameLower).limit(1)
      );
      if (!dupSnap.empty && dupSnap.docs[0].id !== uid) {
        throw new functions.https.HttpsError(
          'already-exists',
          'This username is already taken.'
        );
      }

      // IP cap (atomic). Read the IP's account history inside the transaction so
      // the count-and-reserve can't race. Reserving this account's slot below is
      // part of the same transaction as the user doc, so concurrent burst
      // signups on one IP serialize and the cap holds exactly.
      const ipTrackingRef = (uid !== ADMIN_UID && sanitizedSignupIp)
        ? db.collection('ipTracking').doc(sanitizedSignupIp)
        : null;
      if (ipTrackingRef) {
        const ipTrackDoc = await transaction.get(ipTrackingRef);
        const ipTrackData = ipTrackDoc.exists ? ipTrackDoc.data() : {};
        const { liveAccounts, recentlyDeleted, effectiveAccounts } =
          countIpAccounts(ipTrackData, uid, Date.now(), IP_SLOT_RELEASE_MS);

        // Another live account already on this network → require Discord link.
        if (liveAccounts >= 1) requiresDiscordLink = true;

        if (IP_ACCOUNT_CAP_ENABLED && effectiveAccounts >= MAX_ACCOUNTS_PER_IP) {
          capBlockInfo = { effectiveAccounts, liveAccounts, recentlyDeleted };
          throw new functions.https.HttpsError(
            'permission-denied',
            `Account creation is limited to ${MAX_ACCOUNTS_PER_IP} accounts per network.`
          );
        }
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
        lastActive: Date.now(),
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

      // Reserve this account's per-IP slot in the SAME transaction, so the cap
      // count above and this write commit together (replaces the old post-commit
      // ipTracking write that allowed the race).
      if (ipTrackingRef) {
        transaction.set(ipTrackingRef, {
          accounts: { [uid]: Date.now() },
          lastUpdated: Date.now()
        }, { merge: true });
      }
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

    // Signup announcements to Discord were removed on purpose (June 2026):
    // broadcasting new usernames was the troll-signup payoff. Don't add them back.

    // (signup IP is recorded inside the create transaction above — see "Reserve
    // this account's per-IP slot")

    return { success: true };
  } catch (error) {
    // IP cap rejected this signup: log the block alert and remove the orphaned
    // auth login (done here, outside the transaction, so it runs exactly once).
    if (capBlockInfo) {
      try {
        await db.collection('watchlist_alerts').add({
          type: 'signup_blocked',
          relatedUID: uid,
          ip: signupIp !== 'unknown' ? signupIp : null,
          action: 'blocked',
          details: `Blocked signup "${trimmed}" — network already has ${capBlockInfo.effectiveAccounts} account(s) (${capBlockInfo.liveAccounts} active, ${capBlockInfo.recentlyDeleted} recently deleted; cap ${MAX_ACCOUNTS_PER_IP})`,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (alertErr) {
        console.error('Failed to write cap-block alert:', alertErr.message);
      }
      await cleanupBlockedAuthUser(uid);
    }
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
exports.migrateUsernames = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Only admin can run this.');
  }

  const dryRun = data && data.dryRun === true;
  const results = { scanned: 0, usersUpdated: 0, reservationsWritten: 0, conflicts: [], errors: [], dryRun };

  try {
    const usersSnapshot = await db.collection('users').get();
    results.scanned = usersSnapshot.size;

    // Group every account by the lowercase form of its display name.
    const groups = new Map(); // lower -> [{ uid, displayName, currentLower, createdAtMs, portfolioValue, isBot }]
    usersSnapshot.forEach((docSnap) => {
      const u = docSnap.data();
      if (!u.displayName || typeof u.displayName !== 'string') {
        results.errors.push({ uid: docSnap.id, error: 'No displayName' });
        return;
      }
      const lower = u.displayName.toLowerCase();

      // Normalize createdAt to millis so the oldest account wins the name.
      let createdAtMs = Infinity;
      const c = u.createdAt;
      if (c) {
        if (typeof c.toMillis === 'function') createdAtMs = c.toMillis();
        else if (typeof c === 'number') createdAtMs = c;
        else if (typeof c._seconds === 'number') createdAtMs = c._seconds * 1000;
      }

      if (!groups.has(lower)) groups.set(lower, []);
      groups.get(lower).push({
        uid: docSnap.id,
        displayName: u.displayName,
        currentLower: u.displayNameLower || null,
        createdAtMs,
        portfolioValue: u.portfolioValue || 0,
        isBot: !!u.isBot,
      });
    });

    // Build all writes, committing in chunks well under Firestore's 500/batch cap.
    let batch = db.batch();
    let ops = 0;
    const flush = async (force) => {
      if (ops === 0) return;
      if (force || ops >= 450) {
        if (!dryRun) await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };

    for (const [lower, entries] of groups) {
      // Rightful owner: prefer a real account over a bot, then the oldest, then uid.
      entries.sort((a, b) =>
        (a.isBot - b.isBot) || (a.createdAtMs - b.createdAtMs) || a.uid.localeCompare(b.uid)
      );
      const keeper = entries[0];

      // Reserve (or repoint) the name to the keeper. A clean set, not a merge, so a
      // reservation a newer duplicate grabbed gets handed back to the rightful owner.
      batch.set(db.collection('usernames').doc(lower), {
        uid: keeper.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        backfilled: true,
      });
      ops++; results.reservationsWritten++;
      await flush(false);

      // Make sure displayNameLower is set/correct on every account in the group, so the
      // signup fallback query can see them.
      for (const e of entries) {
        if (e.currentLower !== lower) {
          batch.update(db.collection('users').doc(e.uid), { displayNameLower: lower });
          ops++; results.usersUpdated++;
          await flush(false);
        }
      }

      // Two or more live accounts sharing one name is a collision to resolve by hand.
      if (entries.length > 1) {
        results.conflicts.push({
          username: lower,
          keep: { uid: keeper.uid, displayName: keeper.displayName, portfolioValue: keeper.portfolioValue },
          rename: entries.slice(1).map(e => ({
            uid: e.uid, displayName: e.displayName, portfolioValue: e.portfolioValue, isBot: e.isBot,
          })),
        });
      }
    }
    await flush(true);

    // Surface each collision in the existing Watchlist alerts feed for cleanup.
    if (!dryRun) {
      for (const conf of results.conflicts) {
        const renameList = conf.rename
          .map(r => `${r.displayName} (${r.uid}, $${Math.round(r.portfolioValue)})`)
          .join(', ');
        await db.collection('watchlist_alerts').add({
          type: 'duplicate_username',
          action: 'flagged',
          relatedUID: conf.keep.uid,
          details: `Duplicate name "${conf.username}": keep ${conf.keep.displayName} (${conf.keep.uid}, oldest). Rename: ${renameList}`,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    return {
      ...results,
      message: dryRun
        ? `Dry run: scanned ${results.scanned}, found ${results.conflicts.length} collision(s). No writes.`
        : `Reserved ${results.reservationsWritten} name(s), fixed ${results.usersUpdated} user doc(s), flagged ${results.conflicts.length} collision(s).`,
    };
  } catch (error) {
    console.error('Username backfill error:', error);
    throw new functions.https.HttpsError('internal', 'Backfill failed: ' + error.message);
  }
});

/**
 * Check if a username is available (case-insensitive).
 * Public function for real-time availability checking.
 *
 * @param {string} displayName - The username to check
 * @returns {Object} - { available: boolean }
 */
exports.checkUsername = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
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

exports.changeDisplayName = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const newDisplayName = data.displayName;

  if (!newDisplayName || typeof newDisplayName !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Display name is required.');
  }

  const trimmed = newDisplayName.trim();

  validateUsernameFormat(trimmed);

  const newNameLower = trimmed.toLowerCase();

  if (isBannedUsername(newNameLower)) throw new functions.https.HttpsError('invalid-argument', 'This username is not allowed.');
  if (containsProfanity(trimmed)) throw new functions.https.HttpsError('invalid-argument', 'Username contains inappropriate language.');

  const userRef = db.collection('users').doc(uid);
  const newUsernameRef = db.collection('usernames').doc(newNameLower);

  // Fallback for legacy accounts with no reservation doc: scan users by lowercase
  // name. Best-effort pre-check; the reservation doc read inside the transaction
  // is the authoritative uniqueness guard.
  const dupSnap = await db.collection('users').where('displayNameLower', '==', newNameLower).limit(1).get();
  if (!dupSnap.empty && dupSnap.docs[0].id !== uid) throw new functions.https.HttpsError('already-exists', 'That username is already taken.');

  // Single transaction so the $10k cost, the cooldown, and the username
  // reservation all commit together — two concurrent changes can't double-spend.
  return db.runTransaction(async (transaction) => {
    const [userDoc, existingDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(newUsernameRef),
    ]);

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

    if (existingDoc.exists) throw new functions.https.HttpsError('already-exists', 'That username is already taken.');

    if (oldNameLower) transaction.delete(db.collection('usernames').doc(oldNameLower));
    transaction.set(newUsernameRef, { uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    transaction.update(userRef, {
      displayName: trimmed,
      displayNameLower: newNameLower,
      previousDisplayName: oldDisplayName,
      nameChangedAt: admin.firestore.FieldValue.serverTimestamp(),
      cash: admin.firestore.FieldValue.increment(-NAME_CHANGE_COST),
    });

    return { success: true };
  });
});

const COSMETIC_CATALOG = {
  name_gold:         { type: 'nameColor',   price: 5000  },
  name_crimson:      { type: 'nameColor',   price: 5000  },
  name_emerald:      { type: 'nameColor',   price: 5000  },
  name_sapphire:     { type: 'nameColor',   price: 5000  },
  name_violet:       { type: 'nameColor',   price: 5000  },
  name_rose:         { type: 'nameColor',   price: 5000  },
  name_cyan:         { type: 'nameColor',   price: 5000  },
  name_silver:       { type: 'nameColor',   price: 5000  },
  name_tangerine:    { type: 'nameColor',   price: 5000  },
  glow_gold:         { type: 'rowGlow',     price: 15000 },
  glow_crimson:      { type: 'rowGlow',     price: 15000 },
  glow_neon:         { type: 'rowGlow',     price: 15000 },
  glow_pink:         { type: 'rowGlow',     price: 15000 },
  glow_sapphire:     { type: 'rowGlow',     price: 15000 },
  glow_violet:       { type: 'rowGlow',     price: 15000 },
  glow_cyan:         { type: 'rowGlow',     price: 15000 },
  glow_orange:       { type: 'rowGlow',     price: 15000 },
  glow_silver:       { type: 'rowGlow',     price: 15000 },
  backdrop_royal:    { type: 'rowBackdrop', price: 25000 },
  backdrop_inferno:  { type: 'rowBackdrop', price: 25000 },
  backdrop_frost:    { type: 'rowBackdrop', price: 25000 },
  backdrop_blush:    { type: 'rowBackdrop', price: 25000 },
  backdrop_verdant:  { type: 'rowBackdrop', price: 25000 },
  backdrop_gilded:   { type: 'rowBackdrop', price: 25000 },
  backdrop_midnight: { type: 'rowBackdrop', price: 25000 },
  backdrop_onyx:     { type: 'rowBackdrop', price: 25000 },
  backdrop_lagoon:   { type: 'rowBackdrop', price: 25000 },
};

exports.purchaseCosmetic = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

  const { cosmeticId } = data || {};
  const cosmetic = COSMETIC_CATALOG[cosmeticId];
  if (!cosmetic) throw new functions.https.HttpsError('invalid-argument', 'Invalid cosmetic.');

  const uid = context.auth.uid;
  touchLastActive(uid);
  const userRef = db.collection('users').doc(uid);

  // Transaction so two concurrent purchases can't both pass the cash check and
  // overspend the same balance into the negative.
  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    if (userData.isBot || userData.isBanned) throw new functions.https.HttpsError('permission-denied', 'Action not allowed.');
    if ((userData.ownedCosmetics || []).includes(cosmeticId)) throw new functions.https.HttpsError('already-exists', 'You already own this cosmetic.');
    if ((userData.cash || 0) < cosmetic.price) throw new functions.https.HttpsError('failed-precondition', 'Not enough cash.');

    transaction.update(userRef, {
      ownedCosmetics: admin.firestore.FieldValue.arrayUnion(cosmeticId),
      cash: admin.firestore.FieldValue.increment(-cosmetic.price),
    });

    return { success: true };
  });
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
exports.deleteAccount = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
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

    // Tombstone the linked Discord account so it can't immediately verify a fresh
    // account and re-claim the $3k starting cash (the create → gamble → delete →
    // remake loop). The slot frees up after DISCORD_RELINK_COOLDOWN_MS; deleting
    // again later just resets the clock (merge overwrites deletedAt).
    if (userData.discordId) {
      try {
        await db.collection('discordTombstones').doc(String(userData.discordId)).set({
          deletedAt: Date.now(),
          lastUid: uid
        }, { merge: true });
      } catch (e) { /* best-effort — never block deletion on this */ }
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

exports.dailyCheckin = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
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

      // Streak-based reward: escalates with the consecutive-day streak, then caps.
      const rewardIndex = Math.min(newStreak - 1, CHECKIN_STREAK_REWARDS.length - 1);
      const checkinReward = CHECKIN_STREAK_REWARDS[rewardIndex];

      // Compute week ID for weekly missions
      const weekStartDate = new Date(now);
      weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay() + 1);
      if (weekStartDate > now) weekStartDate.setDate(weekStartDate.getDate() - 7);
      const checkinWeekId = weekStartDate.toISOString().split('T')[0];

      // Update user document
      const updates = {
        cash: (userData.cash || 0) + checkinReward,
        lastCheckin: Timestamp.now(),
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
        // New player — initialize with $500. The whole grant is non-withdrawable
        // "house chips": it can be played but not cashed out to main cash, so the
        // check-in stake can't be looped into free spendable cash via the ladder.
        ladderTopUpAmount = 500;
        updates.ladderGameInitialized = true;
        transaction.set(ladderRef, {
          uid,
          displayName: userData.displayName || 'Anonymous',
          balance: 500,
          nonWithdrawable: 500,
          totalDeposited: 0,
          totalWon: 0,
          totalLost: 0,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          currentStreak: 0,
          bestStreak: 0,
          lastPlayed: null,
          createdAt: FieldValue.serverTimestamp()
        });
      } else {
        // Existing player — top up to $100 if below. The topped-up amount is also
        // non-withdrawable so it can fund play but never be cashed out.
        const ladderBalance = ladderDoc.data().balance || 0;
        if (ladderBalance < 100) {
          ladderTopUpAmount = 100 - ladderBalance;
          transaction.update(ladderRef, {
            balance: 100,
            nonWithdrawable: FieldValue.increment(ladderTopUpAmount)
          });
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
exports.recordTrade = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
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
