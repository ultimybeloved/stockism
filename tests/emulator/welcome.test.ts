// The /welcome week against the Firestore emulator. Never touches production.
//
// Run: npm run test:welcome
//
// It pays real cash, so the things worth proving: it pays the table exactly
// once per day, pauses rather than resets, books the ledger and grantedValue,
// can't be run twice by relinking, and refuses outside the official server, to
// unlinked or banned players, and to brand-new Discord accounts.

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { cmdWelcome } =
  require('../../functions/src/discord/discordWelcome') as typeof import('../../functions/src/discord/discordWelcome');
const { handleSlashCommand } =
  require('../../functions/src/discord/discordCommands') as typeof import('../../functions/src/discord/discordCommands');
const { DISCORD_GUILD_ID } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');
const { WELCOME_STREAK_REWARDS, WELCOME_STREAK_TOTAL } =
  require('../../functions/src/shared/rules/welcome') as typeof import('../../functions/src/shared/rules/welcome');

// Discord IDs encode their creation time. These are from 2015-2016, so old enough.
const OLD_A = '80351110224678912';
const OLD_B = '80351110224678913';
const OLD_C = '80351110224678914';
const OLD_D = '80351110224678915';
// A Discord account made a minute ago.
const FRESH = String((BigInt(Date.now() - 60_000 - 1420070400000) << 22n) + 1n);

const run = (discordId: string, guild: string | null = DISCORD_GUILD_ID) =>
  cmdWelcome({
    type: 2,
    data: { name: 'welcome' },
    guild_id: guild ?? undefined,
    member: { user: { id: discordId } },
  } as Loose);
const title = (r: Loose) => r?.embeds?.[0]?.title || '';
const user = async (uid: string) => (await db.collection('users').doc(uid).get()).data();
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
/** Pretend the last claim was a day earlier, so the next run counts as a new day. */
const rewind = async (uid: string, discordId: string) => {
  await db.collection('users').doc(uid).update({ 'welcomeStreak.lastClaimDay': yesterday() });
  await db.collection('welcomeStreaks').doc(discordId).update({ lastClaimDay: yesterday() });
};

async function main() {
  await db.collection('users').doc('w1').set({ displayName: 'w1', cash: 3000, discordId: OLD_A });
  await db.collection('users').doc('w_banned').set({ displayName: 'wb', cash: 3000, discordId: OLD_B, isBanned: true });
  await db.collection('users').doc('w_fresh').set({ displayName: 'wf', cash: 3000, discordId: FRESH });

  // ── Refusals ──
  check('refused outside the official server', /Stockism server/.test(title(await run(OLD_A, 'some-partner'))));
  check('refused in DMs', /Stockism server/.test(title(await run(OLD_A, null))));
  check('unlinked Discord gets the link pitch', /Link your Stockism account/.test(title(await run(OLD_C))));
  check('brand-new Discord account refused', /Not yet/.test(title(await run(FRESH))));
  check('banned account refused', /Not available/.test(title(await run(OLD_B))));
  check('nothing paid to the banned account', (await user('w_banned')).cash === 3000);

  // ── The week ──
  let expected = 3000;
  for (let day = 1; day <= 7; day++) {
    if (day > 1) await rewind('w1', OLD_A);
    const r = await run(OLD_A);
    expected += WELCOME_STREAK_REWARDS[day - 1]!;
    const u = await user('w1');
    check(`day ${day} pays ${WELCOME_STREAK_REWARDS[day - 1]}`, u.cash === expected, { cash: u.cash, expected, r });
    if (day === 1) {
      const again = await run(OLD_A);
      check(
        'a second run the same day pays nothing',
        /done/.test(title(again)) && (await user('w1')).cash === expected,
      );
    }
  }
  const done = await user('w1');
  check('the week totals the advertised amount', done.cash === 3000 + WELCOME_STREAK_TOTAL, done.cash);
  check('booked as granted value', done.grantedValue === WELCOME_STREAK_TOTAL, done.grantedValue);
  await rewind('w1', OLD_A);
  check(
    'an eighth day pays nothing',
    /complete/.test(title(await run(OLD_A))) && (await user('w1')).cash === done.cash,
  );
  const ledger = await db.collection('ledger').where('uid', '==', 'w1').get();
  const paid = ledger.docs.reduce(
    (s: number, d: Loose) => s + (d.data().type === 'welcome_streak' ? d.data().amount : 0),
    0,
  );
  check('every day is in the ledger', ledger.size === 7 && paid === WELCOME_STREAK_TOTAL, { n: ledger.size, paid });

  // ── Pause, not reset ──
  await db.collection('users').doc('w2').set({ displayName: 'w2', cash: 0, discordId: OLD_C });
  await run(OLD_C);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  await db.collection('users').doc('w2').update({ 'welcomeStreak.lastClaimDay': weekAgo });
  await db.collection('welcomeStreaks').doc(OLD_C).update({ lastClaimDay: weekAgo });
  await run(OLD_C);
  check('after missing days it picks up at day 2', (await user('w2')).welcomeStreak.day === 2);

  // ── No second week by relinking ──
  // The finished Discord linked to a different account: still done.
  await db.collection('users').doc('w1').update({ discordId: null });
  await db.collection('users').doc('w3').set({ displayName: 'w3', cash: 0, discordId: OLD_A });
  check('a used Discord cannot start over on another account', /Already used/.test(title(await run(OLD_A))));
  check('nothing paid to the second account', (await user('w3')).cash === 0);
  // The account that used OLD_C relinks to a new Discord: still bound to OLD_C.
  await db.collection('users').doc('w2').update({ discordId: OLD_D });
  check('an account cannot start over with a new Discord', /Already used/.test(title(await run(OLD_D))));

  // ── Routed through the bot ──
  await db.collection('users').doc('w4').set({ displayName: 'w4', cash: 0, discordId: '80351110224678920' });
  const routed = await handleSlashCommand({
    data: { name: 'welcome' },
    guild_id: DISCORD_GUILD_ID,
    member: { user: { id: '80351110224678920' } },
  });
  check('/welcome is wired into the bot', /Day 1 of 7/.test(title(routed)) && (await user('w4')).cash === 1000);
}

it('Discord welcome week', main);
