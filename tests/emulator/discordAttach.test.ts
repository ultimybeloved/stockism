// Putting a Discord on an account, against the LOCAL Firebase emulator. Never
// touches production.
//
// The one-time starting-cash top-up is paid once however many links finish at
// the same moment, an account that already has a different Discord is left
// alone, and accounts older than the gate get nothing.

import { beforeAll, it } from 'vitest';
import { createRequire } from 'module';
import { check, resetEmulator } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { attachDiscordToAccount } =
  require('../../functions/src/discord/discordAttach') as typeof import('../../functions/src/discord/discordAttach');
const { STARTING_CASH, UNVERIFIED_STARTING_CASH } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

const TOP_UP = STARTING_CASH - UNVERIFIED_STARTING_CASH;
const user = async (uid: string) => (await db.collection('users').doc(uid).get()).data();
const unlocks = async (uid: string) =>
  (await db.collection('ledger').where('uid', '==', uid).where('type', '==', 'starting_cash_unlock').get()).size;

beforeAll(resetEmulator);

it('pays the starting-cash top-up once when several links land together', async () => {
  await db.collection('users').doc('da_new').set({ cash: UNVERIFIED_STARTING_CASH, startingCashUnlocked: false });

  const results = await Promise.all(
    Array.from({ length: 5 }, () => attachDiscordToAccount('da_new', 'discord_1', 'newbie')),
  );
  const after = (await user('da_new'))!;
  check(
    'every link reports success',
    results.every((r) => r === 'linked'),
    results,
  );
  check('cash went up by one top-up', after.cash === UNVERIFIED_STARTING_CASH + TOP_UP, after.cash);
  check('the unlock is marked', after.startingCashUnlocked === true);
  check('one ledger entry', (await unlocks('da_new')) === 1, await unlocks('da_new'));
  check('the Discord and the achievement are on the account', after.discordId === 'discord_1');
  check('achievement given once', after.achievements.join() === 'DISCORD_LINKED', after.achievements);
});

it('leaves a different Discord alone and pays old accounts nothing', async () => {
  await db
    .collection('users')
    .doc('da_other')
    .set({ cash: 100, discordId: 'discord_old', startingCashUnlocked: false });
  check('a second Discord is refused', (await attachDiscordToAccount('da_other', 'discord_2', 'x')) === 'other');
  const other = (await user('da_other'))!;
  check('nothing changed', other.discordId === 'discord_old' && other.cash === 100, other);

  await db.collection('users').doc('da_old').set({ cash: 500 });
  check('an account with no flag links', (await attachDiscordToAccount('da_old', 'discord_3', 'vet')) === 'linked');
  check('and is paid nothing', (await user('da_old'))!.cash === 500 && (await unlocks('da_old')) === 0);

  check(
    'an account with no profile is reported',
    (await attachDiscordToAccount('da_none', 'discord_4', 'x')) === 'missing',
  );
});
