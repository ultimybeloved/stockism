// /ladder: the ladder game in the Discord bot. Internal module, routed by
// discordInteractions.ts. Stockism server only, played in the open in the
// LADDER_CHANNEL_IDS channels only.
//
// Flow, all on one message:
//   /ladder bet:N   -> empty board, buttons Left / Right
//   pick a side     -> that X ringed, buttons ODD / EVEN
//   pick ODD/EVEN   -> the game is played through ladder/ladderCore.ts (the
//                      same code as the website), then the message is edited
//                      frame by frame down the ladder, ending on Play again.
//
// No state is stored between clicks: the side, bet and owner ride in each
// button's custom_id. Only the owner's clicks count. Every step answers Discord
// at once (no reads before the reply), and the animation runs after that by
// editing the original message through the interaction token.
import axios from 'axios';
import * as functions from 'firebase-functions/v1';
import type { Response } from 'express';
import { DISCORD_GUILD_ID, DISCORD_INVITE_URL, LADDER_CHANNEL_IDS, SITE_URL } from '../shared/constants';
import { touchLastActive } from '../shared/activity';
import { reportError } from '../shared/sentry';
import { runLadderGame, type LadderPlay } from '../ladder/ladderCore';
import { buttonRow, callerDiscordId, findUserByDiscordId, linkButton, money, EPHEMERAL } from './discordCommands';
import type { Interaction } from './discordCommands';
import { holdAck } from './discordAck';
import { idleBoard, playFrames, renderBoard, type Grid, type Side } from './ladderBoard';

const COLOR = 0xf97316;
const WIN_COLOR = 0x22c55e;
const LOSS_COLOR = 0x71717a;
const STEP_MS = 900;
const MAX_BET = 1_000_000_000;

/** The parts of a button click this module reads. */
interface ComponentInteraction extends Interaction {
  id: string;
  application_id: string;
  token: string;
  data: Interaction['data'] & { custom_id?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const embed = (text: string, g: Grid, color = COLOR) => ({
  embeds: [{ title: 'Ladder', color, description: `${text}\n\n${renderBoard(g)}` }],
});

const button = (label: string, custom_id: string, style = 2) => ({ type: 2, style, label, custom_id });

const pickSide = (owner: string, amount: number, note = '') => ({
  ...embed(`${note}<@${owner}> bets **${money(amount)}**. Pick a starting X.`, idleBoard()),
  components: [
    buttonRow(
      button('Left X', `ladder:side:left:${amount}:${owner}`),
      button('Right X', `ladder:side:right:${amount}:${owner}`),
    ),
  ],
});

const pickBet = (owner: string, amount: number, side: Side, note = '') => ({
  ...embed(`${note}<@${owner}> bets **${money(amount)}** from the ${side} X. ODD or EVEN?`, idleBoard(side)),
  components: [
    buttonRow(
      button('ODD', `ladder:bet:${side}:odd:${amount}:${owner}`, 1),
      button('EVEN', `ladder:bet:${side}:even:${amount}:${owner}`, 4),
    ),
  ],
});

const ephemeral = (content: string, components?: object[]) => ({
  type: 4,
  data: { content, flags: EPHEMERAL, ...(components ? { components } : {}) },
});

/** The reply to the slash command itself. Synchronous: no reads, so it always beats Discord's 3s. */
export const ladderCommand = (interaction: Interaction) => {
  if (interaction.guild_id !== DISCORD_GUILD_ID) {
    return ephemeral('The ladder is only in the official Stockism Discord.', [
      buttonRow(linkButton('Join the Stockism Discord', DISCORD_INVITE_URL, 'link')),
    ]);
  }
  if (!LADDER_CHANNEL_IDS.includes(String(interaction.channel_id))) {
    return ephemeral(`The ladder can only be played in ${LADDER_CHANNEL_IDS.map((c) => `<#${c}>`).join(' and ')}.`);
  }
  const owner = callerDiscordId(interaction);
  const amount = Math.floor(Number(interaction.data.options?.find((o) => o.name === 'bet')?.value));
  if (!owner) return ephemeral('Could not identify your Discord account.');
  if (!Number.isFinite(amount) || amount < 1 || amount > MAX_BET) return ephemeral('Bet a whole number of dollars.');
  return { type: 4, data: pickSide(owner, amount) };
};

const editMessage = (i: ComponentInteraction, payload: object) =>
  axios.patch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, payload);

const followUp = (i: ComponentInteraction, content: string, components?: object[]) =>
  axios.post(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}`, {
    content,
    flags: EPHEMERAL,
    ...(components ? { components } : {}),
  });

/** Handles every `ladder:` button. Sends the HTTP reply itself. */
export const handleLadderButton = async (i: ComponentInteraction, res: Response) => {
  const parts = String(i.data.custom_id).split(':');
  const owner = parts[parts.length - 1]!;
  const clicker = callerDiscordId(i);
  if (clicker !== owner) {
    return void res.json(ephemeral(`This is <@${owner}>'s game. Start your own with \`/ladder\`.`));
  }

  const [, step] = parts;
  if (step === 'again') return void res.json({ type: 7, data: pickSide(owner, Number(parts[2])) });
  if (step === 'side') return void res.json({ type: 7, data: pickBet(owner, Number(parts[3]), parts[2] as Side) });
  if (step !== 'bet') return void res.json({ type: 6 });

  const side = parts[2] as Side;
  const bet = parts[3] as 'odd' | 'even';
  const amount = Number(parts[4]);
  const betText = `<@${owner}> bets **${money(amount)}** on **${bet.toUpperCase()}** from the ${side} X.`;
  // Take the buttons off straight away so a double click can't play twice.
  //
  // Acknowledged through holdAck so the game runs at full speed after it.
  const release = await holdAck(i, res, {
    type: 7,
    data: { ...embed(betText, idleBoard(side)), components: [] },
  });
  try {
    await playBet(i, owner, side, bet, amount, betText);
  } finally {
    release();
  }
};

const playBet = async (
  i: ComponentInteraction,
  owner: string,
  side: Side,
  bet: 'odd' | 'even',
  amount: number,
  betText: string,
) => {
  // Put the buttons back and tell only the player why, for any refusal.
  const refuse = async (content: string, components?: object[]) => {
    await editMessage(i, pickBet(owner, amount, side));
    await followUp(i, content, components);
  };

  let finish: (() => Promise<unknown>) | undefined;
  try {
    const found = await findUserByDiscordId(owner);
    if (!found) {
      return void (await refuse('Link this Discord to your Stockism account to play.', [
        buttonRow(linkButton('Link my Discord', `${SITE_URL}/link-discord`), linkButton('Create an account', SITE_URL)),
      ]));
    }
    touchLastActive(found.uid, 'ladder');
    let play: LadderPlay;
    try {
      play = await runLadderGame(found.uid, { startSide: side, bet, amount });
    } catch (err) {
      if (!(err instanceof functions.https.HttpsError)) throw err;
      const short = err.message === 'Insufficient balance.';
      return void (await refuse(
        short ? `Not enough in your ladder balance for ${money(amount)}.` : err.message,
        short ? [buttonRow(linkButton('Add to my ladder balance', `${SITE_URL}/ladder`))] : undefined,
      ));
    }

    const done = play;
    const frames = playFrames(side, done.rungs.length);
    const streak = done.won && done.currentStreak >= 2 ? ` ${done.currentStreak} wins in a row.` : '';
    const outcome = done.won ? `Won **${money(done.payout - amount)}**!${streak}` : `Lost ${money(amount)}.`;
    finish = () =>
      editMessage(i, {
        ...embed(
          `${betText}\nLanded on **${done.result.toUpperCase()}**. ${outcome}\nLadder balance: ${money(done.newBalance)}`,
          frames[frames.length - 1]!,
          done.won ? WIN_COLOR : LOSS_COLOR,
        ),
        components: [buttonRow(button(`Play again (${money(amount)})`, `ladder:again:${amount}:${owner}`, 1))],
      });
    // One frame every STEP_MS, counting the time each edit takes.
    for (let f = 0; f < frames.length - 1; f++) {
      const t0 = Date.now();
      await editMessage(i, embed(betText, frames[f]!));
      await sleep(Math.max(0, STEP_MS - (Date.now() - t0)));
    }
    await finish();
  } catch (err) {
    reportError(err, { where: 'discordLadder', owner });
    try {
      // Once the game is played the money has moved: show the result rather
      // than offering the bet again.
      if (finish) await finish();
      else await refuse('Something went wrong. Try again in a moment.');
    } catch {
      // Nothing more to tell them; the error is reported.
    }
  }
};
