// Admin bulk actions on a hand-picked group of players: grant cash, or send a
// bell message (and optionally a Discord DM).
//
// The panel picks the group (a crew, new this week, a filtered list) and sends
// the uids. Cash goes through applyCashChange one player at a time, the same
// path as a single edit, so every grant gets its own ledger entry, cash log
// line with the memo, history entry and notification. One player failing
// (deleted, banned) is reported back and never stops the rest.
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { cf, requireAdmin } from '../shared/fnConfig';
import { writeNotification } from '../shared/notifications';
import { sendDiscordDM } from '../shared/discordApi';
import { logAdminAction } from '../shared/adminLog';
import { applyCashChange, parseCashRequest } from './adminCashCore';

const db = admin.firestore();
const MAX_PLAYERS = 500;
const TITLE_MAX = 80;
const BODY_MAX = 600;

const clean = (v: unknown, max: number) =>
  String(v || '')
    // eslint-disable-next-line no-control-regex -- strips control characters except newlines on purpose
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .trim()
    .slice(0, max);

export const adminBulkAction = cf({ timeoutSeconds: 540, memory: '512MB' }).https.onCall(async (data, context) => {
  requireAdmin(context);
  const raw: string[] = Array.isArray(data?.uids) ? data.uids.map(String) : [];
  const uids = [...new Set(raw)].filter((u) => u && u.length <= 128 && !u.includes('/'));
  if (!uids.length) throw new functions.https.HttpsError('invalid-argument', 'Pick at least one player');
  if (uids.length > MAX_PLAYERS) {
    throw new functions.https.HttpsError('invalid-argument', `At most ${MAX_PLAYERS} players at a time`);
  }

  const failed: { uid: string; reason: string }[] = [];
  let done = 0;

  if (data?.action === 'cash') {
    // Validate once up front so a bad amount or missing memo fails before anyone is paid.
    const template = parseCashRequest({ userId: uids[0], mode: 'add', amount: Number(data.amount), memo: data.memo });
    if (template.amount <= 0) throw new functions.https.HttpsError('invalid-argument', 'Amount must be above $0');
    for (const uid of uids) {
      try {
        await applyCashChange(context, { ...template, userId: uid });
        done++;
      } catch (err) {
        failed.push({ uid, reason: (err as Error).message });
      }
    }
    await logAdminAction(context, {
      action: 'bulk_cash',
      detail: { players: uids.length, paid: done, amount: template.amount, memo: template.memo },
    });
    return { done, failed };
  }

  if (data?.action === 'message') {
    const title = clean(data.title, TITLE_MAX);
    const message = clean(data.message, BODY_MAX);
    if (!title || !message) throw new functions.https.HttpsError('invalid-argument', 'Write a title and a message');
    const alsoDm = !!data.discord;
    const snaps = [];
    for (let i = 0; i < uids.length; i += 300) {
      const refs = uids.slice(i, i + 300).map((u) => db.collection('users').doc(u));
      snaps.push(...(await db.getAll(...refs, { fieldMask: ['discordId', 'isBot'] })));
    }
    let dms = 0;
    for (const s of snaps) {
      if (!s.exists || s.data()?.isBot) {
        failed.push({ uid: s.id, reason: 'No such player' });
        continue;
      }
      await writeNotification(s.id, { type: 'system', title, message });
      done++;
      const discordId = s.data()?.discordId;
      if (alsoDm && discordId) {
        // Players who block DMs still get the bell message.
        if (await sendDiscordDM(String(discordId), `**${title}**\n${message}`).catch(() => false)) dms++;
      }
    }
    await logAdminAction(context, {
      action: 'bulk_message',
      detail: { players: uids.length, sent: done, dms, title, message },
    });
    return { done, dms, failed };
  }

  throw new functions.https.HttpsError('invalid-argument', 'Unknown action');
});
