// Mission Autopilot (shop perk, rules/economy): once a day, claim the day's and
// the week's missions for every account that owns it. The paying itself is
// claimMission, the same path as a player pressing Claim.
//
// 00:05 UTC, just after the daily missions reset, so an owner's missions read
// as done all day. The week's two missions open Thursday 21:00 UTC and are
// picked up by the next run, which leaves the whole week to reach the 5
// missions a Rivalry needs. Cost: one query plus a handful of writes per owner.

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { cf } from '../shared/fnConfig';
import { reportError } from '../shared/sentry';
import { recordHeartbeat } from '../shared/activity';
import { autoClaimMissions } from './claimMission';

export const missionAutopilot = cf({ timeoutSeconds: 300 })
  .pubsub.schedule('5 0 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const owners = await admin.firestore().collection('users').where('missionAutopilot', '==', true).get();
      let paid = 0;
      for (const doc of owners.docs) paid += await autoClaimMissions(doc.id);
      logger.info(`Mission autopilot: ${paid} missions claimed for ${owners.size} owners`);
      await recordHeartbeat('missionAutopilot');
    } catch (err) {
      reportError(err, { where: 'missionAutopilot' });
      throw err;
    }
  });
