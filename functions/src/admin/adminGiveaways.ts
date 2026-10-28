// Discord giveaways from the admin panel: start one (the bot posts it with an
// Enter button), list them, end one early or cancel it, and the scheduled job
// that draws and pays the ones that are due. The post, the draw and the
// payouts live in giveawayCore.ts; entering is a button on the bot
// (discord/discordGiveaway.ts).
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { cf, requireAdmin } from '../shared/fnConfig';
import { COSMETIC_CATALOG } from '../shared/constants';
import { discordApi } from '../shared/discordApi';
import { logAdminAction } from '../shared/adminLog';
import { reportError } from '../shared/sentry';
import {
  GIVEAWAY_MAX_MS,
  GIVEAWAY_MIN_MS,
  GIVEAWAY_TEXT_MAX,
  GIVEAWAY_TITLE_MAX,
  tierProblem,
  type GiveawayTier,
} from '../shared/rules/giveaways';
import { finishGiveaway, giveawayMessage, giveawayRef, refreshGiveawayPost, type Giveaway } from './giveawayCore';

const db = admin.firestore();
const SNOWFLAKE = /^\d{17,20}$/;
const bad = (msg: string) => new functions.https.HttpsError('invalid-argument', msg);
// Control characters out (newlines stay, for the message text).
// eslint-disable-next-line no-control-regex -- strips control characters on purpose
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f]/g;
const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(CONTROL, '')
    .trim()
    .slice(0, max);

export const adminCreateGiveaway = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const title = clean(data?.title, GIVEAWAY_TITLE_MAX);
  const text = clean(data?.text, GIVEAWAY_TEXT_MAX);
  const channelId = String(data?.channelId || '');
  const roleId = data?.roleId ? String(data.roleId) : null;
  const endsAt = Number(data?.endsAt);
  const tiers = data?.tiers as GiveawayTier[];
  if (!title) throw bad('Give it a title.');
  if (!SNOWFLAKE.test(channelId)) throw bad('Pick a channel.');
  if (roleId && !SNOWFLAKE.test(roleId)) throw bad('That role id is not valid.');
  const now = Date.now();
  if (!Number.isFinite(endsAt) || endsAt < now + GIVEAWAY_MIN_MS || endsAt > now + GIVEAWAY_MAX_MS) {
    throw bad('The end time must be at least 10 minutes and at most 30 days away.');
  }
  const problem = tierProblem(tiers, (id) => !!COSMETIC_CATALOG[id] && !COSMETIC_CATALOG[id]!.earned);
  if (problem) throw bad(problem);
  const cleanTiers: GiveawayTier[] = tiers.map((t) => ({
    winners: t.winners,
    prize:
      t.prize.kind === 'cosmetic'
        ? { kind: 'cosmetic', cosmeticId: t.prize.cosmeticId }
        : { kind: t.prize.kind, amount: t.prize.amount },
  }));

  const ref = db.collection('giveaways').doc();
  const g: Giveaway = { title, text, channelId, roleId, endsAt, status: 'open', tiers: cleanTiers, entries: 0 };
  const r = await discordApi('post', `/channels/${channelId}/messages`, {
    body: {
      ...giveawayMessage(ref.id, g),
      ...(roleId ? { content: `<@&${roleId}>`, allowed_mentions: { roles: [roleId] } } : {}),
    },
  });
  const messageId = (r.data as { id?: string })?.id;
  if (r.status >= 300 || !messageId) {
    throw new functions.https.HttpsError('internal', `Discord refused the post (${r.status}). Nothing was started.`);
  }
  await ref.set({ ...g, messageId, createdBy: context.auth!.uid, createdAt: now });
  await logAdminAction(context, { action: 'giveaway_start', detail: { id: ref.id, title, tiers: cleanTiers, endsAt } });
  return { id: ref.id, messageId };
});

export const adminListGiveaways = cf().https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db.collection('giveaways').orderBy('createdAt', 'desc').limit(20).get();
  return { giveaways: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
});

/** End early (draws and pays now) or cancel (no winners). */
export const adminEndGiveaway = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const id = String(data?.id || '');
  const ref = giveawayRef(id);
  if (data?.cancel) {
    const g = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No such giveaway.');
      const cur = snap.data() as Giveaway;
      if (cur.status !== 'open')
        throw new functions.https.HttpsError('failed-precondition', 'Only an open giveaway can be cancelled.');
      tx.update(ref, { status: 'cancelled', endedAt: Date.now() });
      return { ...cur, status: 'cancelled' as const };
    });
    await refreshGiveawayPost(id, g);
    await logAdminAction(context, { action: 'giveaway_cancel', detail: { id, title: g.title } });
    return { status: 'cancelled' };
  }
  const g = await finishGiveaway(id);
  if (!g) throw new functions.https.HttpsError('failed-precondition', 'That giveaway is not open.');
  await logAdminAction(context, {
    action: 'giveaway_end_early',
    detail: { id, title: g.title, winners: g.winners?.length || 0 },
  });
  return { status: g.status, winners: g.winners?.length || 0 };
});

/**
 * Every 5 minutes: draw and pay giveaways that are due, finish any a crash
 * left half done, and keep the entry count on open posts current.
 */
export const runGiveaways = cf()
  .pubsub.schedule('every 5 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const snap = await db.collection('giveaways').where('status', 'in', ['open', 'drawing']).get();
    const now = Date.now();
    for (const d of snap.docs) {
      const g = d.data() as Giveaway;
      try {
        if (g.status === 'drawing' || g.endsAt <= now) {
          await finishGiveaway(d.id);
        } else if ((g.entries || 0) !== (g.shownEntries || 0)) {
          await refreshGiveawayPost(d.id, g);
          await d.ref.update({ shownEntries: g.entries || 0 });
        }
      } catch (err) {
        reportError(err, { where: 'runGiveaways', id: d.id });
      }
    }
    logger.info(`runGiveaways: ${snap.size} live`);
    return null;
  });
