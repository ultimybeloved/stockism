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
// per linked account and per connection a blocked signup came from. It writes
// only its heartbeat.

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { cf } from '../shared/fnConfig';
import { ADMIN_DISCORD_USER_ID } from '../shared/constants';
import { sendDiscordDM, pxe } from '../shared/discordApi';
import { reportError } from '../shared/sentry';
import { recordHeartbeat } from '../shared/activity';
import { ipTrackingKey } from '../shared/accountGuards';
import {
  buildSuspicionReport,
  linkedGroups,
  REPORT_WEEK_MS,
  type ReportAlert,
  type ReportMember,
  type ReportSignup,
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
    alerts.where('type', '==', 'signup_blocked').select('timestamp', 'details', 'ip').get(),
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
  const week = signups.docs.map((d) => d.data()).filter((x) => now - msOf(x.timestamp) <= REPORT_WEEK_MS);
  return buildSuspicionReport(list, members, await describeSignups(week), now, pxe('inspect'));
}

/**
 * Who each refused signup was trying to join: the banned group a ban blocked
 * the connection for, or the accounts already filling the connection.
 */
async function describeSignups(alerts: FirebaseFirestore.DocumentData[]): Promise<ReportSignup[]> {
  const out: ReportSignup[] = [];
  for (const a of alerts) {
    const details = String(a.details || '');
    const name = details.match(/signup "([^"]+)"/)?.[1] || 'unknown';
    const key = a.ip ? ipTrackingKey(String(a.ip)) : null;
    if (/blocked network/.test(details)) {
      const blocked = key ? (await db.collection('blockedNetworks').doc(key).get()).data() : undefined;
      out.push({ name, kind: 'banned', reason: blocked?.reason, linked: blocked?.group || [] });
    } else if (/already has|already exist/.test(details)) {
      const accounts = key
        ? Object.keys((await db.collection('ipTracking').doc(key).get()).data()?.accounts || {})
        : [];
      const docs = accounts.length ? await db.getAll(...accounts.map((u) => db.collection('users').doc(u))) : [];
      const linked = docs.map((d) => `${d.data()?.displayName || d.id}${d.data()?.isBanned ? ' (banned)' : ''}`);
      out.push({ name, kind: 'cap', linked });
    } else {
      out.push({ name, kind: /disposable/.test(details) ? 'email' : 'other', linked: [] });
    }
  }
  return out;
}

async function sendReport() {
  const messages = await runSuspicionReport();
  if (!ADMIN_DISCORD_USER_ID) {
    logger.warn('ADMIN_DISCORD_USER_ID not set; weekly suspicious-account report not sent.');
    return false;
  }
  let sent = true;
  for (const m of messages) sent = (await sendDiscordDM(ADMIN_DISCORD_USER_ID, m)) && sent;
  return sent;
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
