// Discord giveaways: the bot's post, the draw and the payouts. Internal module,
// used by adminGiveaways.ts (create, end, the scheduled finisher) and not
// listed in services.ts. Rules (tiers, the draw) live in rules/giveaways.
//
// giveaways/{id}: title, text, channelId, messageId, roleId, endsAt (ms),
//   status open | drawing | ended | cancelled, tiers, entries (count),
//   winners [{ tier, uid, discordId, name }], createdBy, createdAt.
// giveaways/{id}/entries/{discordId}: { uid, name, at }. One per Discord.
// giveaways/{id}/payouts/{uid}: written in the payout transaction, so a
//   finisher that runs twice never pays anyone twice.
// Rules deny all of it to clients; the admin panel reads through callables.
import { randomInt } from 'crypto';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { COSMETIC_CATALOG } from '../shared/constants';
import { discordApi, pxButton, pxe, sendDiscordDM } from '../shared/discordApi';
import { grantedValueUpdate } from '../shared/equity';
import { recordLedger } from '../shared/ledger';
import { writeNotification } from '../shared/notifications';
import { reportError } from '../shared/sentry';
import { drawWinners, prizeLabel, type GiveawayPrize, type GiveawayTier } from '../shared/rules/giveaways';

const db = admin.firestore();

export interface Giveaway {
  title: string;
  text?: string;
  channelId: string;
  messageId?: string;
  roleId?: string | null;
  endsAt: number;
  status: 'open' | 'drawing' | 'ended' | 'cancelled';
  tiers: GiveawayTier[];
  entries?: number;
  shownEntries?: number;
  winners?: { tier: number; uid: string; discordId: string; name: string }[];
  announced?: boolean;
}

export const giveawayRef = (id: string) => db.collection('giveaways').doc(id);
export const enterButtonId = (id: string) => `giveaway:enter:${id}`;

const cosmeticName = (id: string) => COSMETIC_CATALOG[id]?.name;
const label = (p: GiveawayPrize) => prizeLabel(p, cosmeticName);
const ts = (ms: number, style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The post's embed and button, for the live, ended or cancelled giveaway. */
export function giveawayMessage(id: string, g: Giveaway) {
  const prizes = g.tiers.map((t) => {
    const line = `${pxe('gift')} **${label(t.prize)}** to ${plural(t.winners, 'winner')}`;
    const won = (g.winners || []).filter((w) => w.tier === g.tiers.indexOf(t));
    return g.status === 'ended' && won.length ? `${line}\n${won.map((w) => `<@${w.discordId}>`).join(' ')}` : line;
  });
  const entries = g.entries || 0;
  const footer =
    g.status === 'open'
      ? `${pxe('hourglass')} Ends ${ts(g.endsAt)} (${ts(g.endsAt, 'R')})\n${pxe('link')} Your Discord must be linked to your Stockism account to enter. One entry per person. Nobody wins twice.\n${plural(entries, 'entry')} so far.`
      : g.status === 'cancelled'
        ? `${pxe('error')} This giveaway was cancelled.`
        : `${pxe('trophy')} Ended ${ts(g.endsAt)} with ${plural(entries, 'entry')}. Prizes are paid out automatically.`;
  const embed = {
    title: g.title,
    description: [g.text, prizes.join('\n\n'), footer].filter(Boolean).join('\n\n'),
    color: g.status === 'open' ? 0xf97316 : 0x71717a,
  };
  const components =
    g.status === 'open'
      ? [
          {
            type: 1,
            components: [
              { type: 2, style: 3, label: 'Enter', custom_id: enterButtonId(id), emoji: pxButton('gift') },
              {
                type: 2,
                style: 5,
                label: 'Link account',
                url: 'https://stockism.app/link-discord',
                emoji: pxButton('link'),
              },
            ],
          },
        ]
      : [];
  return { embeds: [embed], components };
}

/** Re-renders the post in place. Fail-soft: the giveaway itself is in Firestore. */
export async function refreshGiveawayPost(id: string, g: Giveaway) {
  if (!g.messageId) return;
  const r = await discordApi('patch', `/channels/${g.channelId}/messages/${g.messageId}`, {
    body: giveawayMessage(id, g),
  });
  if (r.status >= 300) logger.warn(`giveaway ${id}: post edit failed ${r.status}`, r.data);
}

/** Pays one winner, once. Returns false if they were paid already. */
async function payWinner(id: string, w: { tier: number; uid: string }, prize: GiveawayPrize, title: string) {
  const userRef = db.collection('users').doc(w.uid);
  const markRef = giveawayRef(id).collection('payouts').doc(w.uid);
  return db.runTransaction(async (tx) => {
    const [userSnap, mark] = await Promise.all([tx.get(userRef), tx.get(markRef)]);
    if (mark.exists || !userSnap.exists) return false;
    const user = userSnap.data()!;
    const detail = { giveaway: id, tier: w.tier };
    let given: GiveawayPrize = prize;
    if (prize.kind === 'cosmetic' && (user.ownedCosmetics || []).includes(prize.cosmeticId)) {
      // Already owned: the item's shop price as credit instead, so the win still counts.
      given = { kind: 'credit', amount: COSMETIC_CATALOG[prize.cosmeticId]?.price || 0 };
    }
    if (given.kind === 'credit') {
      const after = (user.shopCredit || 0) + given.amount;
      tx.update(userRef, { shopCredit: after });
      recordLedger(tx, {
        uid: w.uid,
        type: 'giveaway_prize',
        account: 'credit',
        amount: given.amount,
        cashAfter: after,
        ref: id,
        detail,
      });
    } else if (given.kind === 'cash') {
      const after = (user.cash || 0) + given.amount;
      // Free money: booked so percent-return boards can net it out.
      tx.update(userRef, { cash: after, ...grantedValueUpdate(given.amount) });
      recordLedger(tx, { uid: w.uid, type: 'giveaway_prize', amount: given.amount, cashAfter: after, ref: id, detail });
    } else {
      tx.update(userRef, { ownedCosmetics: FieldValue.arrayUnion(given.cosmeticId) });
      recordLedger(tx, {
        uid: w.uid,
        type: 'giveaway_prize',
        account: 'cosmetics',
        amount: COSMETIC_CATALOG[given.cosmeticId]?.price || 0,
        ref: given.cosmeticId,
        detail,
      });
    }
    tx.set(markRef, { prize: given, at: FieldValue.serverTimestamp() });
    return { given, discordId: user.discordId as string | undefined, title };
  });
}

/**
 * Draws and pays a giveaway that is due (or ended early by an admin). Safe to
 * run twice or to resume after a crash: the open -> drawing switch is a
 * transaction, the winners are stored before anyone is paid, payouts are
 * marked per winner, and the announcement is flagged before it is posted.
 */
export async function finishGiveaway(id: string): Promise<Giveaway | null> {
  const ref = giveawayRef(id);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const g = snap.data() as Giveaway;
    if (g.status === 'open') tx.update(ref, { status: 'drawing', drawStartedAt: Date.now() });
    return g.status === 'open' || g.status === 'drawing' ? g : null;
  });
  if (!claimed) return null;

  // Draw once. Only entries still linked to an account in good standing count.
  let g = (await ref.get()).data() as Giveaway;
  if (!g.winners) {
    const entries = await ref.collection('entries').get();
    const pool: { uid: string; discordId: string; name: string }[] = [];
    for (const e of entries.docs) {
      const uid = e.data().uid as string;
      const u = (await db.collection('users').doc(uid).get()).data();
      if (!u || u.isBanned || u.isBot || u.discordId !== e.id) continue;
      pool.push({ uid, discordId: e.id, name: u.displayName || uid });
    }
    const winners = drawWinners(pool, g.tiers, () => randomInt(0, 1_000_000_000) / 1_000_000_000).map(
      ({ tier, entrant }) => ({ tier, ...entrant }),
    );
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as Giveaway;
      if (!cur.winners) tx.update(ref, { winners, eligible: pool.length });
    });
    g = (await ref.get()).data() as Giveaway;
  }

  for (const w of g.winners || []) {
    try {
      const paid = await payWinner(id, w, g.tiers[w.tier]!.prize, g.title);
      if (!paid) continue;
      const text = `You won ${label(paid.given)} in the ${g.title} giveaway! It's in your account now.`;
      await writeNotification(w.uid, {
        type: 'system',
        title: '🎁 You won a giveaway',
        message: text,
        data: { giveaway: id },
      });
      if (paid.discordId) await sendDiscordDM(paid.discordId, `${pxe('party')} ${text}`);
    } catch (err) {
      // The next scheduled run retries anyone left unpaid.
      reportError(err, { where: 'finishGiveaway.pay', id, uid: w.uid });
    }
  }

  const announce = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as Giveaway;
    if (cur.announced) return false;
    tx.update(ref, { announced: true, status: 'ended', endedAt: Date.now() });
    return true;
  });
  g = (await ref.get()).data() as Giveaway;
  if (announce) {
    await refreshGiveawayPost(id, g);
    const lines = g.tiers.map((t, i) => {
      const won = (g.winners || []).filter((w) => w.tier === i);
      return won.length ? `**${label(t.prize)}:** ${won.map((w) => `<@${w.discordId}>`).join(' ')}` : null;
    });
    const content = (g.winners || []).length
      ? `${pxe('party')} **${g.title}** winners!\n\n${lines.filter(Boolean).join('\n')}\n\nPrizes are already in your accounts. Congratulations!`
      : `${pxe('error')} **${g.title}** ended with no eligible entries, so there are no winners.`;
    const r = await discordApi('post', `/channels/${g.channelId}/messages`, {
      body: {
        content,
        allowed_mentions: { users: (g.winners || []).map((w) => w.discordId) },
        ...(g.messageId ? { message_reference: { message_id: g.messageId, fail_if_not_exists: false } } : {}),
      },
    });
    if (r.status >= 300) logger.warn(`giveaway ${id}: winners post failed ${r.status}`, r.data);
  }
  return g;
}
