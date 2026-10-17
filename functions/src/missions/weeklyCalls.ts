// Weekly Calls: pick a stock and call it up or down for the next chapter.
//
// Picks open at the Thursday reopen and close at the end of Saturday. The Call
// is scored on the halt that ends its week: the price when the halt began
// (weeklyCallsLock, 13:00 UTC) against the price at the 20:55 lock
// (weeklyCallsResolve), before the opening auction. Nobody can trade inside
// that window, so a player can't move their own Call. Wins pay automatically
// and count as a finished mission, Rivalries included (callResolution.ts).

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { cf, requireAppCheck } from '../shared/fnConfig';
import { ADMIN_UID } from '../shared/constants';
import { CHARACTER_MAP } from '../shared/characters';
import { isRosterTicker } from '../shared/roster';
import { checkBanned, checkDiscordWall } from '../shared/accountGuards';
import { touchLastActive, recordHeartbeat } from '../shared/activity';
import { reportError } from '../shared/sentry';
import { getWeekId } from '../shared/tradeRecords';
import { callPicksOpen, type CallDirection } from '../shared/rules/missions';
import { lockCallBaseline, resolveWeeklyCalls } from './callResolution';
const db = admin.firestore();

export const makeWeeklyCall = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  const uid = context.auth.uid;
  touchLastActive(uid, 'missions');

  const ticker = typeof data?.ticker === 'string' ? data.ticker.trim().toUpperCase() : '';
  const direction = data?.direction as CallDirection;
  if (!ticker || !['up', 'down'].includes(direction)) {
    throw new functions.https.HttpsError('invalid-argument', 'Pick a stock and up or down.');
  }
  // The admin sets the chapter prices a Call is scored on.
  if (uid === ADMIN_UID) throw new functions.https.HttpsError('permission-denied', 'Admins sit Calls out.');

  const now = Date.now();
  if (!callPicksOpen(now)) {
    throw new functions.https.HttpsError('failed-precondition', 'Calls open again at the Thursday reopen.');
  }
  const weekId = getWeekId(now);
  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (tx) => {
    const [userDoc, marketDoc] = await Promise.all([tx.get(userRef), tx.get(marketRef)]);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    const userData = userDoc.data()!;
    checkBanned(userData);
    checkDiscordWall(userData);
    if (userData.isBot) throw new functions.https.HttpsError('permission-denied', 'Bots sit Calls out.');

    const market = marketDoc.data() || {};
    const meta = CHARACTER_MAP[ticker];
    const listed = !meta?.ipoRequired || (market.launchedTickers || []).includes(ticker);
    if (!meta || !isRosterTicker(ticker) || !listed || !((market.prices || {})[ticker] > 0)) {
      throw new functions.https.HttpsError('invalid-argument', 'That stock is not trading.');
    }

    // Changing your mind is fine until picks close: scoring only starts at the halt.
    const call = { ticker, direction, at: now };
    tx.update(userRef, { [`weeklyMissions.${weekId}.call`]: call });
    return { success: true, call };
  });
});

/** Thursday 13:00 UTC: the prices every Call is scored from. */
export const weeklyCallsLock = cf()
  .pubsub.schedule('0 13 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await lockCallBaseline();
      await recordHeartbeat('weeklyCallsLock');
    } catch (err) {
      reportError(err, { where: 'weeklyCallsLock' });
    }
    return null;
  });

/** Thursday 20:55 UTC: the price lock, before the opening auction fills. */
export const weeklyCallsResolve = cf({ timeoutSeconds: 300 })
  .pubsub.schedule('55 20 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await resolveWeeklyCalls();
      await recordHeartbeat('weeklyCallsResolve');
    } catch (err) {
      reportError(err, { where: 'weeklyCallsResolve' });
    }
    return null;
  });
