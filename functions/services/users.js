'use strict';
// Account lifecycle: creating an account and deleting one.
//
// Username/profile edits live in userProfile.js and the daily check-in reward
// moved to missions.js — this file is only about an account coming into or
// going out of existence, which is where the anti-abuse gates matter.

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const { ADMIN_UID, STARTING_CASH, UNVERIFIED_STARTING_CASH, MAX_ACCOUNTS_PER_IP, IP_ACCOUNT_CAP_ENABLED, IP_SLOT_RELEASE_MS } = require('../constants');
const { isBannedUsername, isTargetedHarassment, containsProfanity, validateUsernameFormat, checkBanned, isDiscordBindingLocked, grantedValueUpdate } = require('../helpers');
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
/**
 * Attach the Discord link a Discord signup arrived with.
 *
 * discordAuth creates only the Auth user and parks the Discord details in
 * `discordPending/{uid}`, so that signing up through Discord goes through the
 * same name rules as every other signup. This applies the link afterwards,
 * paying the one-time verification top-up exactly as discordLink does — the
 * account was just created on UNVERIFIED_STARTING_CASH, so they land on the same
 * full amount a Discord signup has always given.
 *
 * Re-checks ownership at this moment rather than trusting the parked record:
 * minutes can pass while someone picks a name, and the Discord may have been
 * claimed in between.
 */
const applyPendingDiscordLink = async (uid) => {
  const pendingRef = db.collection('discordPending').doc(uid);
  const pending = await pendingRef.get();
  if (!pending.exists) return false;

  const { discordId, discordUsername } = pending.data();
  await pendingRef.delete();
  if (!discordId) return false;

  const taken = await db.collection('users').where('discordId', '==', discordId).limit(1).get();
  if (!taken.empty && taken.docs[0].id !== uid) return false;
  if (await isDiscordBindingLocked(discordId, uid)) return false;

  await db.collection('users').doc(uid).update({
    discordId,
    discordUsername: discordUsername || null,
    cash: admin.firestore.FieldValue.increment(STARTING_CASH - UNVERIFIED_STARTING_CASH),
    startingCashUnlocked: true,
    achievements: admin.firestore.FieldValue.arrayUnion('DISCORD_LINKED'),
    'achievementDates.DISCORD_LINKED': Date.now(),
    ...grantedValueUpdate(STARTING_CASH - UNVERIFIED_STARTING_CASH),
  });
  return true;
};

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

  // Another player's name welded to an insult. None of the words involved are
  // profanity on their own, so nothing above catches these.
  if (isTargetedHarassment(trimmed)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username targets another player. Please choose a different name.'
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

      // Season baseline. Baselines are otherwise only pinned by adminStartSeason,
      // which runs once, over the players who exist at that moment — so anyone
      // who signed up mid-season had no baseline, and the scoring functions skip
      // a player without one. They could never rank, never earn a tier and never
      // win a title for the season they joined in, which is the opposite of what
      // seasons are for. Pin it here so a new player is in the running from the
      // moment they start. Their starting cash is the baseline; the $2,000 the
      // Discord unlock adds later is booked as granted value and nets back out.
      const seasonSnap = await transaction.get(db.collection('market').doc('season'));
      const activeSeason = (seasonSnap.exists && seasonSnap.data().status === 'active')
        ? seasonSnap.data()
        : null;

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
        lastPortfolioSnapshot: { timestamp: Date.now(), value: UNVERIFIED_STARTING_CASH },
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
        requiresDiscordLink,
        ...(activeSeason ? {
          seasonBaseline: {
            seasonId: activeSeason.id,
            value: UNVERIFIED_STARTING_CASH,
            granted: 0,
            ladderFlow: 0,
            pinnedAt: Date.now(),
          }
        } : {})
      });

      // Seed the permanent history subcollection with the starting point
      transaction.set(userRef.collection('portfolioHistory').doc(), {
        timestamp: Date.now(),
        value: UNVERIFIED_STARTING_CASH
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

    // Signed up through Discord? discordAuth parked the details rather than
    // building the profile itself, so attach the link now that a validated name
    // exists. Done after the transaction and best-effort: the account is already
    // created, and a failure here leaves them able to link from their profile.
    try {
      await applyPendingDiscordLink(uid);
    } catch (err) {
      console.error('Failed to apply pending Discord link:', err);
    }

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

    // Banned accounts can't self-delete: deletion would erase the ban record
    // and free the account up for a fresh-cash remake.
    checkBanned(userData);

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
