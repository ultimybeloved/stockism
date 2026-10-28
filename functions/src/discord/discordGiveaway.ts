// The Enter button on a bot giveaway post (admin/giveawayCore.ts). Internal
// module for discordInteractions.ts. Entering needs a Discord linked to a
// Stockism account that isn't banned; the entry is keyed by Discord id, and
// one Discord links one account forever, so one person gets one entry.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Response } from 'express';
import { pxe } from '../shared/discordApi';
import { reportError } from '../shared/sentry';
import { holdAck } from './discordAck';
import { refreshEntryCount } from '../admin/giveawayCore';
import { buttonRow, callerDiscordId, findUserByDiscordId, linkButton, EPHEMERAL } from './discordCommands';
import type { Interaction } from './discordCommands';

const db = admin.firestore();

type ButtonInteraction = Interaction & {
  id: string;
  token: string;
  application_id: string;
  data: { custom_id?: string };
};

export const handleGiveawayButton = async (i: ButtonInteraction, res: Response) => {
  const id = String(i.data.custom_id).split(':')[2] || '';
  const discordId = callerDiscordId(i);
  const release = await holdAck(i, res, { type: 5, data: { flags: EPHEMERAL } });
  const reply = (content: string, components?: object[]) =>
    fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, ...(components ? { components } : {}) }),
    });
  try {
    const user = await findUserByDiscordId(discordId);
    if (!user) {
      await reply(
        `${pxe('link')} To enter, link this Discord to your Stockism account first. Then press Enter again.`,
        [buttonRow(linkButton('Link account', 'https://stockism.app/link-discord', 'link'))],
      );
      return;
    }
    if (user.data.isBanned || user.data.isBot) {
      await reply(`${pxe('error')} This account can't enter giveaways.`);
      return;
    }
    const ref = db.collection('giveaways').doc(id);
    const entryRef = ref.collection('entries').doc(discordId!);
    const result = await db.runTransaction(async (tx) => {
      const [g, entry] = await Promise.all([tx.get(ref), tx.get(entryRef)]);
      if (!g.exists || g.data()!.status !== 'open' || g.data()!.endsAt <= Date.now())
        return { state: 'closed' as const };
      if (entry.exists) return { state: 'already' as const, endsAt: g.data()!.endsAt as number };
      tx.set(entryRef, { uid: user.uid, name: user.data.displayName || null, at: Date.now() });
      tx.update(ref, { entries: FieldValue.increment(1) });
      return { state: 'in' as const, endsAt: g.data()!.endsAt as number };
    });
    const when = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;
    if (result.state === 'closed') await reply(`${pxe('hourglass')} This giveaway has ended.`);
    else if (result.state === 'already')
      await reply(
        `${pxe('success')} You're already entered as **${user.data.displayName}**. Winners are drawn ${when(result.endsAt)}.`,
      );
    else
      await reply(
        `${pxe('success')} You're in as **${user.data.displayName}**! Winners are drawn ${when(result.endsAt)}, and prizes go straight to your account.`,
      );
    // Show the new count on the post right away. A failed edit (a Discord rate
    // limit in a rush) is caught up by the runGiveaways job.
    if (result.state === 'in')
      await refreshEntryCount(id).catch((err) => reportError(err, { where: 'giveawayCount', id }));
  } catch (err) {
    reportError(err, { where: 'handleGiveawayButton', id });
    await reply(`${pxe('error')} Something went wrong. Try again in a minute.`).catch(() => {});
  } finally {
    release();
  }
};
