import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { cf } from '../shared/fnConfig';
import { reportError } from '../shared/sentry';
import { recordHeartbeat } from '../shared/activity';
import { writeNotification } from '../shared/notifications';
import { sendDiscordDM, pxe } from '../shared/discordApi';
import { ADMIN_UID } from '../shared/constants';
import { auditHaltWindow, haltWindowOn } from './haltAuditCore';

const db = admin.firestore();

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/**
 * Weekly check that nothing moved prices during the Thursday halt
 * (the automated form of `npm run audit:halt`).
 *
 * 21:05 UTC: after the halt ends at 21:00 and after the 20:54 collapse has
 * stashed the review detail. Silent when every move inside the window is
 * tagged. Otherwise it tells the admin privately (bell + Discord DM) and
 * reports to Sentry; never a public channel. The heartbeat lets the job
 * watchdog catch it if it stops running.
 */
export const haltPriceAudit = cf()
  .pubsub.schedule('5 21 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const { start, end } = haltWindowOn(Date.now());
      const [live, stash] = await Promise.all([
        db.collection('market').doc('priceHistory').get(),
        db.collection('market').doc('reviewDetail').get(),
      ]);
      const audit = auditHaltWindow(live.data() || {}, stash.data(), start, end);

      if (audit.untagged.length === 0) {
        logger.info('haltPriceAudit: OK', { total: audit.total, bySource: audit.bySource });
      } else {
        const lines = audit.untagged.map((b) => `${hhmm(b.at)} UTC: ${b.tickers.map((t) => `$${t}`).join(', ')}`);
        const message =
          `Something moved prices during today's halt without a label. ` +
          `${audit.untagged.length} unexplained move(s):\n${lines.join('\n')}`;
        reportError(new Error(`Halt price audit: ${audit.untagged.length} untagged batch(es)`), {
          where: 'haltPriceAudit',
          untagged: audit.untagged,
          bySource: audit.bySource,
        });
        await writeNotification(ADMIN_UID, { type: 'system', title: '⚠️ Halt price audit', message });
        const adminDoc = await db.collection('users').doc(ADMIN_UID).get();
        await sendDiscordDM(adminDoc.data()?.discordId, `${pxe('warning')} **Halt price audit**\n${message}`);
      }
      await recordHeartbeat('haltPriceAudit');
    } catch (err) {
      reportError(err, { where: 'haltPriceAudit' });
    }
    return null;
  });
