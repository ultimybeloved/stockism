// Discord giveaways: the bot's post, the draw and the payouts. Internal module,
// used by adminGiveaways.ts (create, end, the scheduled finisher) and not
// listed in services.ts. Rules (tiers, draws, the draw itself) live in
// rules/giveaways.
//
// giveaways/{id}: title, text, channelId, messageId, roleIds, endsAt (ms),
//   status open | drawing | ended | cancelled, tiers, entries (count),
//   winners [{ tier, uid, discordId, name }], createdBy, createdAt.
// giveaways/{id}/entries/{discordId}: { uid, name, at }. One per Discord.
// giveaways/{id}/payouts/{uid}_{tier}: written in the payout transaction, so
//   a finisher that runs twice never pays a prize twice. One person can hold
//   several (a prize in each draw, plus an everyone prize).
// Rules deny all of it to clients; the admin panel reads through callables.
import { randomInt } from 'crypto';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { COSMETIC_CATALOG, FLAIR_CREW_EMOJIS, PIXEL_CREW_EMOJIS } from '../shared/constants';
import { PIN_COLLECTIONS, SHOP_PINS } from '../shared/crews';
import { ownEntry } from '../shared/lookup';
import { flairOf } from '../shared/rules/flairCrews';
import { discordApi, pxButton, pxe, sendDiscordDM } from '../shared/discordApi';
import { grantedValueUpdate, netWorthOf } from '../shared/equity';
import { recordLedger } from '../shared/ledger';
import { writeNotification } from '../shared/notifications';
import { reportError } from '../shared/sentry';
import {
  drawOf,
  drawWinners,
  prizeLabel,
  winsCanStack,
  type GiveawayPrize,
  type GiveawayTier,
} from '../shared/rules/giveaways';

const db = admin.firestore();

export interface Giveaway {
  title: string;
  text?: string;
  channelId: string;
  messageId?: string;
  roleIds?: string[];
  endsAt: number;
  status: 'open' | 'drawing' | 'ended' | 'cancelled';
  tiers: GiveawayTier[];
  entries?: number;
  shownEntries?: number;
  winners?: {
    tier: number;
    uid: string;
    discordId: string;
    name: string;
    crew?: string | null;
    flair?: string | null;
  }[];
  announced?: boolean;
}

export const giveawayRef = (id: string) => db.collection('giveaways').doc(id);
export const enterButtonId = (id: string) => `giveaway:enter:${id}`;

// Names a cosmetic or a pin collection, for prize labels.
const nameOf = (id: string) => ownEntry(COSMETIC_CATALOG, id)?.name ?? ownEntry(PIN_COLLECTIONS, id)?.name;
const label = (p: GiveawayPrize) => prizeLabel(p, nameOf);
const ts = (ms: number, style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;
// A winner as Discord shows them: the mention, then their flair crew's crest
// if they picked one, else their crew's pixel crest.
const winnerTag = (w: { discordId: string; crew?: string | null; flair?: string | null }) =>
  [`<@${w.discordId}>`, (w.flair && FLAIR_CREW_EMOJIS[w.flair]) || (w.crew && PIXEL_CREW_EMOJIS[w.crew])]
    .filter(Boolean)
    .join(' ');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "a, b, and c"
const listWords = (xs: string[]) =>
  xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;

/** One prize line for the post: what it is, who can get it. */
const tierLine = (t: GiveawayTier) => {
  const base = t.everyone
    ? `${pxe('gift')} Everyone who enters gets **${label(t.prize)}**`
    : `${pxe('gift')} **${label(t.prize)}** to ${plural(t.winners, 'winner')}`;
  return t.skipTop ? `${base} (not open to the top ${t.skipTop} on the leaderboard)` : base;
};

/**
 * The prize lines, grouped under "Draw 1", "Draw 2" headings when there is
 * more than one draw. Everyone tiers come last, outside any draw.
 * `extra(i)` appends to tier i (the winners, once it has ended).
 */
const prizeLines = (tiers: GiveawayTier[], extra: (i: number) => string, gap: string) => {
  const drawn = tiers.map((t, i) => ({ t, i })).filter(({ t }) => !t.everyone);
  const draws = [...new Set(drawn.map(({ t }) => drawOf(t)))].sort((a, b) => a - b);
  const blocks = draws.map((d) => {
    const lines = drawn.filter(({ t }) => drawOf(t) === d).map(({ t, i }) => tierLine(t) + extra(i));
    return draws.length > 1 ? [`**Draw ${d}**`, ...lines].join('\n') : lines.join(gap);
  });
  const everyone = tiers.map((t, i) => ({ t, i })).filter(({ t }) => t.everyone);
  if (everyone.length) blocks.push(everyone.map(({ t }) => tierLine(t)).join('\n'));
  return blocks.join('\n\n');
};

/** The post's embed and button, for the live, ended or cancelled giveaway. */
export function giveawayMessage(id: string, g: Giveaway) {
  const ended = g.status === 'ended';
  const won = (i: number) => (g.winners || []).filter((w) => w.tier === i);
  const prizes = prizeLines(
    g.tiers,
    (i) => (ended && won(i).length ? `\n${won(i).map(winnerTag).join(', ')}` : ''),
    ended ? '\n\n' : '\n',
  );
  const entries = g.entries || 0;
  const stackRule = winsCanStack(g.tiers)
    ? 'One entry per person. Nobody wins twice in the same draw, but you can win in more than one.'
    : 'One entry per person. Nobody wins twice.';
  const footer =
    g.status === 'open'
      ? `${pxe('hourglass')} Ends ${ts(g.endsAt)} (${ts(g.endsAt, 'R')})\n${pxe('gift')} Press **Enter** to join. Emoji reactions don't count.\n${pxe('link')} Your Discord must be linked to your Stockism account to enter. ${stackRule}\n${plural(entries, 'entry', 'entries')} so far.`
      : g.status === 'cancelled'
        ? `${pxe('error')} This giveaway was cancelled.`
        : `${pxe('trophy')} Ended ${ts(g.endsAt)} with ${plural(entries, 'entry', 'entries')}. Prizes are paid out automatically.`;
  const embed = {
    title: g.title,
    description: [g.text, prizes, footer].filter(Boolean).join('\n\n'),
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

/** Re-renders the post with the latest entry count (after an entry, or the backstop job). */
export async function refreshEntryCount(id: string) {
  const ref = giveawayRef(id);
  const g = (await ref.get()).data() as Giveaway | undefined;
  if (!g || g.status !== 'open') return;
  await refreshGiveawayPost(id, g);
  await ref.update({ shownEntries: g.entries || 0 });
}

// The saved net-worth board is what players see as the leaderboard; it is
// rebuilt whenever someone opens the page. Older than this and the draw ranks
// the biggest accounts itself instead.
const BOARD_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Leaderboard rank by uid (1 = top), for prizes closed to the top players. */
async function leaderboardRanks(): Promise<Map<string, number>> {
  const board = (await db.collection('leaderboard').doc('global').get()).data();
  let ids = ((board?.entries || []) as { userId: string }[]).map((e) => e.userId);
  if (!ids.length || Date.now() - (board?.generatedAt || 0) > BOARD_MAX_AGE_MS) {
    const top = await db.collection('users').orderBy('portfolioValue', 'desc').limit(200).get();
    ids = top.docs
      .filter((d) => !d.data().isBot && !d.data().isBanned)
      .sort((a, b) => netWorthOf(b.data()) - netWorthOf(a.data()))
      .map((d) => d.id);
    logger.info('giveaway draw: leaderboard board missing or old, ranked the top accounts directly');
  }
  return new Map(ids.map((uid, i) => [uid, i + 1]));
}

const pick = <T>(xs: T[]) => xs[randomInt(0, xs.length)]!;

/** Pays one prize to one winner, once. Returns the prize in words, or false if it was paid already. */
async function payPrize(id: string, w: { tier: number; uid: string }, prize: GiveawayPrize) {
  const userRef = db.collection('users').doc(w.uid);
  const markRef = giveawayRef(id).collection('payouts').doc(`${w.uid}_${w.tier}`);
  return db.runTransaction(async (tx) => {
    const [userSnap, mark] = await Promise.all([tx.get(userRef), tx.get(markRef)]);
    if (mark.exists || !userSnap.exists) return false;
    const user = userSnap.data()!;
    const detail = { giveaway: id, tier: w.tier };
    let credit = 0;
    let said: string;
    let paid: Record<string, unknown> = { ...prize };
    if (prize.kind === 'cash') {
      const after = (user.cash || 0) + prize.amount;
      // Free money: booked so percent-return boards can net it out.
      tx.update(userRef, { cash: after, ...grantedValueUpdate(prize.amount) });
      recordLedger(tx, { uid: w.uid, type: 'giveaway_prize', amount: prize.amount, cashAfter: after, ref: id, detail });
      said = label(prize);
    } else if (prize.kind === 'credit') {
      credit = prize.amount;
      said = label(prize);
    } else if (prize.kind === 'cosmetic') {
      const price = COSMETIC_CATALOG[prize.cosmeticId]?.price || 0;
      if ((user.ownedCosmetics || []).includes(prize.cosmeticId)) {
        // Already owned: the item's shop price as credit instead, so the win still counts.
        credit = price;
        said = `${label({ kind: 'credit', amount: price })} (you already had ${label(prize)})`;
      } else {
        tx.update(userRef, { ownedCosmetics: FieldValue.arrayUnion(prize.cosmeticId) });
        recordLedger(tx, {
          uid: w.uid,
          type: 'giveaway_prize',
          account: 'cosmetics',
          amount: price,
          ref: prize.cosmeticId,
          detail,
        });
        said = label(prize);
      }
    } else {
      // A random pin from the collection, one they don't own if there is one.
      const pins = (ownEntry(PIN_COLLECTIONS, prize.collection)?.pins || []).filter((p) => ownEntry(SHOP_PINS, p));
      if (!pins.length) throw new Error(`giveaway ${id}: pin collection ${prize.collection} is empty`);
      const owned: string[] = user.ownedShopPins || [];
      const fresh = pins.filter((p) => !owned.includes(p));
      const pin = SHOP_PINS[pick(fresh.length ? fresh : pins)]!;
      paid = { ...prize, pinId: pin.id };
      if (fresh.length) {
        tx.update(userRef, { ownedShopPins: FieldValue.arrayUnion(pin.id) });
        recordLedger(tx, {
          uid: w.uid,
          type: 'giveaway_prize',
          account: 'cosmetics',
          amount: pin.price,
          ref: pin.id,
          detail,
        });
        said = `the ${pin.name} pin`;
      } else {
        // They own the whole set: that pin's price as credit instead.
        credit = pin.price;
        said = `${label({ kind: 'credit', amount: pin.price })} (you already had every pin in the set)`;
      }
    }
    if (credit > 0) {
      const after = (user.shopCredit || 0) + credit;
      tx.update(userRef, { shopCredit: after });
      recordLedger(tx, {
        uid: w.uid,
        type: 'giveaway_prize',
        account: 'credit',
        amount: credit,
        cashAfter: after,
        ref: id,
        detail,
      });
    }
    tx.set(markRef, { prize: paid, at: FieldValue.serverTimestamp() });
    return said;
  });
}

/** Loads the entrants still linked to an account in good standing. */
async function eligiblePool(id: string) {
  const entries = (await giveawayRef(id).collection('entries').get()).docs;
  const pool: { uid: string; discordId: string; name: string; crew: string | null; flair: string | null }[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    const users = await db.getAll(...chunk.map((e) => db.collection('users').doc(e.data().uid as string)));
    chunk.forEach((e, k) => {
      const u = users[k]!.data();
      if (!u || u.isBanned || u.isBot || u.discordId !== e.id) return;
      pool.push({
        uid: users[k]!.id,
        discordId: e.id,
        name: u.displayName || users[k]!.id,
        crew: u.crew || null,
        flair: flairOf(u)?.id || null,
      });
    });
  }
  return pool;
}

/**
 * Draws and pays a giveaway that is due (or ended early by an admin). Safe to
 * run twice or to resume after a crash: the open -> drawing switch is a
 * transaction, the winners are stored before anyone is paid, payouts are
 * marked per prize, and the announcement is flagged before it is posted.
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

  // Draw once.
  let g = (await ref.get()).data() as Giveaway;
  if (!g.winners) {
    const pool = await eligiblePool(id);
    const ranks = g.tiers.some((t) => t.skipTop) ? await leaderboardRanks() : new Map<string, number>();
    const winners = drawWinners(
      pool,
      g.tiers,
      () => randomInt(0, 1_000_000_000) / 1_000_000_000,
      (e) => ranks.get(e.uid) ?? null,
    ).map(({ tier, entrant }) => ({ tier, ...entrant }));
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as Giveaway;
      if (!cur.winners) tx.update(ref, { winners, eligible: pool.length });
    });
    g = (await ref.get()).data() as Giveaway;
  }

  // Pay person by person, so someone who won several prizes gets one message.
  const byUid = new Map<string, NonNullable<Giveaway['winners']>>();
  for (const w of g.winners || []) byUid.set(w.uid, [...(byUid.get(w.uid) || []), w]);
  for (const [uid, wins] of byUid) {
    const said: string[] = [];
    for (const w of wins) {
      try {
        const paid = await payPrize(id, w, g.tiers[w.tier]!.prize);
        if (paid) said.push(paid);
      } catch (err) {
        // The next scheduled run retries anything left unpaid.
        reportError(err, { where: 'finishGiveaway.pay', id, uid, tier: w.tier });
      }
    }
    if (!said.length) continue;
    const text = `You won ${listWords(said)} in the ${g.title} giveaway! It's in your account now.`;
    try {
      await writeNotification(uid, {
        type: 'system',
        title: '🎁 You won a giveaway',
        message: text,
        data: { giveaway: id },
      });
      await sendDiscordDM(wins[0]!.discordId, `${pxe('party')} ${text}`);
    } catch (err) {
      reportError(err, { where: 'finishGiveaway.notify', id, uid });
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
    const winners = g.winners || [];
    const lines = g.tiers.map((t, i) => {
      const won = winners.filter((w) => w.tier === i);
      if (!won.length) return null;
      return t.everyone
        ? `**${label(t.prize)}:** everyone who entered (${plural(won.length, 'player')})`
        : `**${label(t.prize)}:** ${won.map(winnerTag).join(', ')}`;
    });
    // Mention only drawn winners; an everyone prize would ping every entrant.
    const mentioned = [...new Set(winners.filter((w) => !g.tiers[w.tier]?.everyone).map((w) => w.discordId))];
    const content = winners.length
      ? `${pxe('party')} **${g.title}** winners!\n\n${lines.filter(Boolean).join('\n')}\n\nPrizes have been deposited into your accounts. Congratulations!`
      : `${pxe('error')} **${g.title}** ended with no eligible entries, so there are no winners.`;
    const r = await discordApi('post', `/channels/${g.channelId}/messages`, {
      body: {
        content,
        allowed_mentions: { users: mentioned.slice(0, 100) },
        ...(g.messageId ? { message_reference: { message_id: g.messageId, fail_if_not_exists: false } } : {}),
      },
    });
    if (r.status >= 300) logger.warn(`giveaway ${id}: winners post failed ${r.status}`, r.data);
  }
  return g;
}
