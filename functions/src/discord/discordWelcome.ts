// /welcome: the Discord welcome week. Internal module, routed by
// discordCommands.handleSlashCommand. The rules (amounts, pause-not-reset,
// Discord age) live in shared/rules/welcome.
//
// Unlike every other bot command this one moves money, so it follows the
// website's rules for that: one transaction, a ledger entry, and grantedValue
// booked so the bonus never counts as a trading return.
//
// The week is recorded twice, on purpose: welcomeStreaks/{discordId} so a
// Discord account can only ever run it once whichever Stockism account it is
// linked to, and users/{uid}.welcomeStreak (with the Discord ID) so a Stockism
// account can't run it again by linking a different Discord. Both are
// server-only.

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
const db = admin.firestore();

import { DISCORD_GUILD_ID, DISCORD_INVITE_URL, SITE_URL } from '../shared/constants';
import {
  WELCOME_STREAK_REWARDS,
  WELCOME_STREAK_DAYS,
  WELCOME_STREAK_TOTAL,
  WELCOME_MIN_DISCORD_AGE_DAYS,
  welcomeClaim,
  discordCreatedAtMs,
  welcomeTrack,
  type WelcomeStreakState,
} from '../shared/rules/welcome';
import { grantedValueUpdate } from '../shared/equity';
import { recordLedger } from '../shared/ledger';
import { round2 } from '../shared/money';
import { sendDiscordMessage } from '../shared/discordApi';
import { reportError } from '../shared/sentry';
import {
  findUserByDiscordId,
  callerDiscordId,
  linkButton,
  buttonRow,
  money,
  type Interaction,
} from './discordCommands';

const WELCOME_COLOR = 0xea580c;
const DAY_MS = 24 * 60 * 60 * 1000;

const reply = (title: string, description: string, components?: object[]) => ({
  embeds: [{ color: WELCOME_COLOR, title, description }],
  ...(components ? { components } : {}),
});

/** Discord timestamp for the next UTC midnight, rendered in the reader's time zone. */
const nextUtcMidnight = (now: number) => `<t:${Math.floor((Math.floor(now / DAY_MS) + 1) * (DAY_MS / 1000))}:R>`;

const schedule = (claimed: number) =>
  WELCOME_STREAK_REWARDS.map(
    (r, i) => `${i < claimed ? '~~' : ''}Day ${i + 1}: ${money(r)}${i < claimed ? '~~' : ''}`,
  ).join('\n');

class WelcomeRefusal extends Error {
  constructor(public payload: Record<string, unknown>) {
    super('welcome refused');
  }
}

export const cmdWelcome = async (interaction: Interaction) => {
  const discordId = callerDiscordId(interaction);

  if (interaction.guild_id !== DISCORD_GUILD_ID) {
    return reply(
      'Only in the Stockism server',
      `Your welcome week is in the official Stockism Discord. Join, then run \`/welcome\` there for up to ${money(WELCOME_STREAK_TOTAL)}.`,
      [buttonRow(linkButton('Join the Stockism Discord', DISCORD_INVITE_URL))],
    );
  }
  if (!discordId) return reply('Something went wrong', 'Try again in a moment.');

  const found = await findUserByDiscordId(discordId);
  if (!found) {
    return reply(
      'Link your Stockism account first',
      `Link this Discord to your Stockism account, then come back and run \`/welcome\`. ` +
        `Linking unlocks your full starting cash, and the welcome week adds up to ${money(WELCOME_STREAK_TOTAL)} more.`,
      [buttonRow(linkButton('Link my Discord', `${SITE_URL}/link-discord`), linkButton('Create an account', SITE_URL))],
    );
  }

  const ageDays = (Date.now() - discordCreatedAtMs(discordId)) / DAY_MS;
  if (ageDays < WELCOME_MIN_DISCORD_AGE_DAYS) {
    return reply(
      'Not yet',
      `The welcome week needs a Discord account at least ${WELCOME_MIN_DISCORD_AGE_DAYS} days old. ` +
        `Yours will qualify ${`<t:${Math.floor((discordCreatedAtMs(discordId) + WELCOME_MIN_DISCORD_AGE_DAYS * DAY_MS) / 1000)}:R>`}.`,
    );
  }

  const userRef = db.collection('users').doc(found.uid);
  const streakRef = db.collection('welcomeStreaks').doc(discordId);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  let result: { day: number; reward: number; done: boolean; cashAfter: number; displayName: string };
  try {
    result = await db.runTransaction(async (tx) => {
      const [userSnap, streakSnap] = await Promise.all([tx.get(userRef), tx.get(streakRef)]);
      const user = userSnap.data();
      // Re-checked inside the transaction: the link could have changed since the lookup.
      if (!user || user.discordId !== discordId) {
        throw new WelcomeRefusal(
          reply('Link your Stockism account first', 'This Discord is not linked to an account.'),
        );
      }
      if (user.isBanned) throw new WelcomeRefusal(reply('Not available', 'This account is banned.'));

      const onAccount = user.welcomeStreak as WelcomeStreakState | undefined;
      const onDiscord = streakSnap.exists ? (streakSnap.data() as WelcomeStreakState & { uid?: string }) : undefined;
      if ((onDiscord && onDiscord.uid !== found.uid) || (onAccount?.discordId && onAccount.discordId !== discordId)) {
        throw new WelcomeRefusal(
          reply(
            'Already used',
            'The welcome week can only be done once per Discord account and once per Stockism account.',
          ),
        );
      }

      const state = onDiscord || onAccount || null;
      const claim = welcomeClaim(state, today);
      if (!claim.ok) {
        throw new WelcomeRefusal(
          claim.reason === 'done'
            ? reply(
                'Welcome week complete',
                `You've already collected all ${money(WELCOME_STREAK_TOTAL)}. Welcome aboard!`,
              )
            : reply(
                `Day ${state!.day} done`,
                `${welcomeTrack(state!.day)}\n\nYou've already claimed today. Day ${state!.day + 1} unlocks ${nextUtcMidnight(now)} ` +
                  `and pays **${money(WELCOME_STREAK_REWARDS[state!.day])}**.`,
              ),
        );
      }

      const cashAfter = round2((user.cash || 0) + claim.reward);
      const next: WelcomeStreakState = { day: claim.day, lastClaimDay: today, discordId };
      tx.update(userRef, {
        cash: cashAfter,
        // Free money: booked so percent-return boards net it out.
        ...grantedValueUpdate(claim.reward),
        welcomeStreak: next,
      });
      tx.set(streakRef, {
        ...next,
        uid: found.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(claim.done ? { completedAt: now } : {}),
      });
      recordLedger(tx, {
        uid: found.uid,
        type: 'welcome_streak',
        amount: claim.reward,
        cashAfter,
        ref: String(claim.day),
      });
      return { ...claim, cashAfter, displayName: user.displayName || 'A new trader' };
    });
  } catch (err) {
    if (err instanceof WelcomeRefusal) return err.payload;
    reportError(err, { where: 'cmdWelcome', discordId });
    return reply('Something went wrong', 'Nothing was paid. Try again in a moment.');
  }

  if (result.done) {
    // The finish is announced in the channel it happened in: the best advert
    // the command has is someone else collecting the full week.
    if (interaction.channel_id) {
      await sendDiscordMessage(
        null,
        [
          {
            color: WELCOME_COLOR,
            title: 'Welcome week complete',
            description: `<@${discordId}> just finished their welcome week and collected ${money(WELCOME_STREAK_TOTAL)}. New here? Run \`/welcome\`.`,
          },
        ],
        interaction.channel_id,
      ).catch((e) => reportError(e, { where: 'cmdWelcome.announce' }));
    }
    return reply(
      `Day 7 of 7: ${money(result.reward)}!`,
      `${welcomeTrack(WELCOME_STREAK_DAYS)}\n\nThat's the full week: **${money(WELCOME_STREAK_TOTAL)}** on top of your starting cash. ` +
        `Cash now: ${money(result.cashAfter)}.`,
      [buttonRow(linkButton('Start trading', SITE_URL))],
    );
  }

  return reply(
    `Day ${result.day} of ${WELCOME_STREAK_DAYS}: +${money(result.reward)}`,
    `${welcomeTrack(result.day)}\n\n` +
      `${result.day === 1 ? 'Welcome to Stockism! ' : ''}Come back ${nextUtcMidnight(now)} for day ${result.day + 1} ` +
      `(**${money(WELCOME_STREAK_REWARDS[result.day])}**). Missing a day only pauses your week, it never resets it.\n\n` +
      `${schedule(result.day)}\n\nCash now: ${money(result.cashAfter)}.`,
    [buttonRow(linkButton('Open Stockism', SITE_URL))],
  );
};
