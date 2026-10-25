// The weekly suspicious-account report, DMed to the admin.
//
// The alt and coordination scans already write their findings to
// watchlist_alerts, and DM the high ones as they happen. This gathers the
// week's into one private message: groups of linked accounts (including the
// medium pairs that never get a DM), coordinated pushes, repeat names and
// blocked signups. The text is built in suspicionReportText.ts.
//
// Cost: once a week it reads the open alerts, every coordinated-push alert
// (dozens) and the blocked-signup timestamps (a few hundred), plus one user doc
// per linked account. It writes only its heartbeat.

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { cf } from '../shared/fnConfig';
import { ADMIN_DISCORD_USER_ID } from '../shared/constants';
import { sendDiscordDM, pxe } from '../shared/discordApi';
import { reportError } from '../shared/sentry';
import { recordHeartbeat } from '../shared/activity';
import {
  buildSuspicionReport,
  linkedGroups,
  REPORT_WEEK_MS,
  type ReportAlert,
  type ReportMember,
} from './suspicionReportText';

const db = admin.firestore();

const msOf = (t: unknown) => (t as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;

/** Build this week's report. */
export async function runSuspicionReport(now = Date.now()) {
  const alerts = db.collection('watchlist_alerts');
  // No index on timestamp, so the age filters run here, on small sets.
  const [open, pushes, signups] = await Promise.all([
    alerts.where('reviewed', '==', false).get(),
    alerts.where('type', '==', 'coordinated_pressure').get(),
    alerts.where('type', '==', 'signup_blocked').select('timestamp').get(),
  ]);
  const byId = new Map<string, ReportAlert>();
  for (const d of [...open.docs, ...pushes.docs]) {
    const x = d.data();
    byId.set(d.id, { ...(x as ReportAlert), at: msOf(x.timestamp) });
  }
  const list = [...byId.values()];

  const uids = [...new Set(linkedGroups(list, now).flat())];
  const members: Record<string, ReportMember> = {};
  if (uids.length) {
    const docs = await db.getAll(...uids.map((u) => db.collection('users').doc(u)));
    for (const d of docs) {
      const u = d.data() || {};
      members[d.id] = {
        name: u.displayName || d.id,
        banned: !!u.isBanned,
        value: (u.portfolioValue || 0) - (u.marginUsed || 0),
      };
    }
  }
  const blockedSignups = signups.docs.filter((d) => now - msOf(d.data().timestamp) <= REPORT_WEEK_MS).length;
  return buildSuspicionReport(list, members, blockedSignups, now, pxe('inspect'));
}

async function sendReport() {
  const text = await runSuspicionReport();
  if (!ADMIN_DISCORD_USER_ID) {
    logger.warn('ADMIN_DISCORD_USER_ID not set; weekly suspicious-account report not sent.');
    return false;
  }
  return sendDiscordDM(ADMIN_DISCORD_USER_ID, text);
}

/**
 * Wednesday 16:00 UTC: the end of the mission week, before the Thursday halt,
 * so there is time to act before the next week opens.
 */
export const weeklySuspicionReport = cf({ timeoutSeconds: 120 })
  .pubsub.schedule('0 16 * * 3')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const sent = await sendReport();
      logger.info(`Weekly suspicion report ${sent ? 'sent' : 'not sent'}`);
      await recordHeartbeat('weeklySuspicionReport');
    } catch (err) {
      reportError(err, { where: 'weeklySuspicionReport' });
      throw err;
    }
  });
