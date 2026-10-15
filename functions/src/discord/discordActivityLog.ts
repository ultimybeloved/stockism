// Who uses the bot, and how: one `discordActivity/{discordId}` doc per Discord
// account that has ever run a command or pressed a bot button, linked or not.
// The admin panel's Discord activity screen and player file read it.
//
// Internal module (not in services.ts): discordInteractions calls it once per
// interaction. One small write each; it never throws, so a failed stamp can
// never cost a player their command.
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';

interface InteractionLike {
  guild_id?: string;
  member?: { user?: { id?: string; username?: string; global_name?: string | null } };
  user?: { id?: string; username?: string; global_name?: string | null };
}

// Command and button names are Discord-controlled strings; keep them to safe
// map keys so a strange custom_id can never write an odd field path.
const keyOf = (name: string) => name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'unknown';

export async function recordDiscordActivity(interaction: InteractionLike, name: string) {
  const who = interaction.member?.user || interaction.user;
  if (!who?.id) return;
  const key = keyOf(name);
  try {
    await admin
      .firestore()
      .collection('discordActivity')
      .doc(who.id)
      .set(
        {
          discordId: who.id,
          username: who.username || null,
          globalName: who.global_name || null,
          lastAt: Date.now(),
          lastCommand: key,
          lastGuildId: interaction.guild_id || null,
          total: FieldValue.increment(1),
          counts: { [key]: FieldValue.increment(1) },
          lastByCommand: { [key]: Date.now() },
        },
        { merge: true },
      );
  } catch (err) {
    logger.warn('recordDiscordActivity failed:', (err as Error).message);
  }
}
