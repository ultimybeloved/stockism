'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { ADMIN_UID } = require('../constants');

exports.addWatchedUser = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { userId, reason, maxAccountsPerIP } = data;

  if (!userId || typeof userId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'User ID required.');
  }

  const maxAccounts = Number(maxAccountsPerIP) || 1;

  // Fetch user info
  const userDoc = await db.collection('users').doc(userId).get();
  const displayName = userDoc.exists ? userDoc.data().displayName : 'Unknown';

  // Collect known IPs from ipTracking
  const knownIPs = {};
  const ipTrackingSnap = await db.collection('ipTracking').get();
  for (const ipDoc of ipTrackingSnap.docs) {
    const accounts = ipDoc.data().accounts || {};
    if (accounts[userId]) {
      const rawIp = ipDoc.id;
      knownIPs[rawIp] = {
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        accounts: [userId]
      };

      // Create reverse lookup
      await db.collection('watchedIPs').doc(rawIp).set({
        watchedUserId: userId,
        maxAccountsPerIP: maxAccounts,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  await db.collection('watchedUsers').doc(userId).set({
    displayName,
    reason: reason || '',
    maxAccountsPerIP: maxAccounts,
    linkedAccounts: [],
    knownIPs,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
    addedBy: context.auth.uid,
    isActive: true
  });

  await db.collection('watchlist_alerts').add({
    type: 'user_added',
    watchedUID: userId,
    relatedUID: null,
    ip: null,
    action: 'flagged',
    details: `Added "${displayName}" to watchlist. Reason: ${reason || 'None'}. Found ${Object.keys(knownIPs).length} known IPs.`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, displayName, knownIPCount: Object.keys(knownIPs).length };
});

/**
 * Remove (deactivate) a user from the watchlist
 */
exports.removeWatchedUser = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { userId } = data;
  if (!userId) throw new functions.https.HttpsError('invalid-argument', 'User ID required.');

  const watchedDoc = await db.collection('watchedUsers').doc(userId).get();
  if (!watchedDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not on watchlist.');
  }

  await db.collection('watchedUsers').doc(userId).update({ isActive: false });

  // Remove reverse IP lookups
  const knownIPs = watchedDoc.data().knownIPs || {};
  for (const ipId of Object.keys(knownIPs)) {
    const watchedIpDoc = await db.collection('watchedIPs').doc(ipId).get();
    if (watchedIpDoc.exists && watchedIpDoc.data().watchedUserId === userId) {
      await db.collection('watchedIPs').doc(ipId).delete();
    }
  }

  await db.collection('watchlist_alerts').add({
    type: 'user_removed',
    watchedUID: userId,
    relatedUID: null,
    ip: null,
    action: 'flagged',
    details: `Removed "${watchedDoc.data().displayName}" from watchlist`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});

/**
 * Manually link an alt account to a watched user
 */
exports.linkAltAccount = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { watchedUserId, altAccountId } = data;
  if (!watchedUserId || !altAccountId) {
    throw new functions.https.HttpsError('invalid-argument', 'Both user IDs required.');
  }

  const watchedDoc = await db.collection('watchedUsers').doc(watchedUserId).get();
  if (!watchedDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Watched user not found.');
  }

  const altDoc = await db.collection('users').doc(altAccountId).get();
  const altName = altDoc.exists ? altDoc.data().displayName : 'Unknown';

  // Check if already linked
  const alreadyLinked = (watchedDoc.data().linkedAccounts || []).some(a => a.uid === altAccountId);
  if (alreadyLinked) {
    throw new functions.https.HttpsError('already-exists', 'This account is already linked.');
  }

  const newLinked = {
    uid: altAccountId,
    displayName: altName,
    linkedVia: 'manual',
    ip: null,
    linkedAt: Date.now()
  };

  await db.collection('watchedUsers').doc(watchedUserId).update({
    linkedAccounts: admin.firestore.FieldValue.arrayUnion(newLinked)
  });

  await db.collection('watchlist_alerts').add({
    type: 'account_linked',
    watchedUID: watchedUserId,
    relatedUID: altAccountId,
    ip: null,
    action: 'linked',
    details: `Manually linked "${altName}" as alt of "${watchedDoc.data().displayName}"`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, altName };
});

/**
 * Add an IP address to a watched user
 */
exports.addWatchedIP = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { userId, ip } = data;
  if (!userId || !ip) {
    throw new functions.https.HttpsError('invalid-argument', 'User ID and IP required.');
  }

  const watchedDoc = await db.collection('watchedUsers').doc(userId).get();
  if (!watchedDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Watched user not found.');
  }

  const sanitizedIp = ip.replace(/[.:/]/g, '_');
  const watchedData = watchedDoc.data();

  // Add to watched user's knownIPs
  await db.collection('watchedUsers').doc(userId).update({
    [`knownIPs.${sanitizedIp}`]: {
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      accounts: [userId]
    }
  });

  // Create reverse lookup
  await db.collection('watchedIPs').doc(sanitizedIp).set({
    watchedUserId: userId,
    maxAccountsPerIP: watchedData.maxAccountsPerIP || 1,
    addedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('watchlist_alerts').add({
    type: 'ip_added',
    watchedUID: userId,
    relatedUID: null,
    ip,
    action: 'flagged',
    details: `Manually added IP ${ip} to "${watchedData.displayName}"`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});

/**
 * Get all active watched users (admin panel)
 */
exports.getWatchlist = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const watchedSnap = await db.collection('watchedUsers').where('isActive', '==', true).get();
  const watchedUsers = [];

  for (const doc of watchedSnap.docs) {
    const d = doc.data();
    watchedUsers.push({
      id: doc.id,
      displayName: d.displayName,
      reason: d.reason,
      maxAccountsPerIP: d.maxAccountsPerIP,
      linkedAccounts: d.linkedAccounts || [],
      knownIPs: d.knownIPs || {},
      addedAt: d.addedAt,
      isActive: d.isActive
    });
  }

  // Fetch recent alerts
  const alertsSnap = await db.collection('watchlist_alerts')
    .orderBy('timestamp', 'desc')
    .limit(50)
    .get();

  const alerts = alertsSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toMillis?.() || doc.data().timestamp
  }));

  return { watchedUsers, alerts };
});

// ============================================
// PRICE ALERTS
// ============================================


// ============================================
// Auto circuit breakers removed — organic price surges are expected behavior.
// Use the manual market halt in the admin panel for genuine emergencies.

// ============================================
// ============================================
// TRADE-TIME WATCHED-IP TRACKING
// ============================================
// Called fire-and-forget from executeTrade after a successful buy/short.
// If the trade came from a watched IP, auto-link unknown accounts to the
// watched user and keep knownIPs fresh. (This used to live in the unused
// validateTrade callable, where it never actually ran.)
const trackWatchedIpTrade = async (uid, displayName, ip) => {
  if (!ip || ip === 'unknown') return;
  try {
    const sanitizedIp = ip.replace(/[.:/]/g, '_');
    const watchedIpDoc = await db.collection('watchedIPs').doc(sanitizedIp).get();
    if (!watchedIpDoc.exists) return;

    const { watchedUserId } = watchedIpDoc.data();
    const watchedUserDoc = await db.collection('watchedUsers').doc(watchedUserId).get();
    if (!watchedUserDoc.exists || !watchedUserDoc.data().isActive) return;

    const watchedData = watchedUserDoc.data();
    const knownUIDs = (watchedData.linkedAccounts || []).map(a => a.uid);
    knownUIDs.push(watchedUserId);

    if (!knownUIDs.includes(uid)) {
      // Unknown account trading from a watched IP — auto-link it
      await db.collection('watchedUsers').doc(watchedUserId).update({
        linkedAccounts: admin.firestore.FieldValue.arrayUnion({
          uid,
          displayName: displayName || uid,
          linkedVia: 'ip',
          ip,
          linkedAt: Date.now()
        }),
        [`knownIPs.${sanitizedIp}.lastSeen`]: Date.now(),
        [`knownIPs.${sanitizedIp}.accounts`]: admin.firestore.FieldValue.arrayUnion(uid)
      });
      await db.collection('watchlist_alerts').add({
        type: 'account_linked',
        watchedUID: watchedUserId,
        relatedUID: uid,
        ip,
        action: 'linked',
        details: `Auto-linked "${displayName || uid}" — traded from watched IP`,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      return;
    }

    // Known watched account — track IP freshness, flag genuinely new IPs
    const knownIPs = watchedData.knownIPs || {};
    if (!knownIPs[sanitizedIp]) {
      await db.collection('watchedUsers').doc(watchedUserId).update({
        [`knownIPs.${sanitizedIp}`]: { firstSeen: Date.now(), lastSeen: Date.now(), accounts: [uid] }
      });
      await db.collection('watchlist_alerts').add({
        type: 'new_ip_detected',
        watchedUID: watchedUserId,
        relatedUID: uid,
        ip,
        action: 'flagged',
        details: `Known watched account "${displayName || uid}" seen on new IP`,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await db.collection('watchedUsers').doc(watchedUserId).update({
        [`knownIPs.${sanitizedIp}.lastSeen`]: Date.now(),
        [`knownIPs.${sanitizedIp}.accounts`]: admin.firestore.FieldValue.arrayUnion(uid)
      });
    }
  } catch (err) {
    console.error('trackWatchedIpTrade error:', err.message);
  }
};

exports.trackWatchedIpTrade = trackWatchedIpTrade;
