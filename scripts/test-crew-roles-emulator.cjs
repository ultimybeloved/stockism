'use strict';
// Crew head Discord role sync, against the LOCAL Firebase emulator with every
// Discord call stubbed. Never touches production and never touches Discord.
//
// Run via: npm run test:crewroles
//
// Two things here are worth pinning down. The role diff has to converge even
// when calls fail (a botched removal must not strand someone wearing a crown
// they lost), and Discord IDs must never reach market/crewStats, which is
// world-readable.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

// Must be set BEFORE discordRoles.js is required — isConfigured() reads them.
process.env.DISCORD_BOT_TOKEN = 'test-token';
process.env.DISCORD_GUILD_ID = '100000000000000001';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Stub axios before anything requires helpers.js. Both resolve to the same
// functions/node_modules/axios instance, so the require cache hands over the
// identical object. Stubbing at this layer keeps the real discordApi under
// test (header assembly, validateStatus, audit reason).
const axios = require('../functions/node_modules/axios');
let calls = [];
let scripted = [];
axios.request = async (cfg) => {
  calls.push({
    method: cfg.method,
    url: cfg.url,
    reason: cfg.headers && cfg.headers['X-Audit-Log-Reason'],
  });
  if (scripted.length > 0) {
    const next = scripted.shift();
    if (next && next.throw) throw new Error(next.throw);
    return next;
  }
  return { status: 204, data: '' };
};

const constants = require('../functions/constants');
const { CREW_HEAD_ROLE_IDS } = constants;

// Give every crew a usable role ID for the test run.
const ROLE = {};
Object.keys(constants.CREWS).forEach((crewId, i) => {
  ROLE[crewId] = String(200000000000000000 + i);
  CREW_HEAD_ROLE_IDS[crewId] = ROLE[crewId];
});

const { syncCrewHeadRoles } = require('../functions/services/discordRoles');

const STATE = db.collection('admin').doc('discordCrewRoles');
const CREWS = Object.keys(constants.CREWS);
const [C1, C2, C3] = CREWS;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const reset = async (holders = null) => {
  calls = [];
  scripted = [];
  if (holders) {
    await STATE.set({ guildId: process.env.DISCORD_GUILD_ID, holders, updatedAt: Date.now() });
  } else {
    await STATE.delete();
  }
};

const head = (uid, name) => ({ uid, displayName: name });
const puts = () => calls.filter((c) => c.method === 'put');
const dels = () => calls.filter((c) => c.method === 'delete');
const state = async () => (await STATE.get()).data() || {};

(async () => {
  console.log('\nCrew head Discord roles\n');

  // A — first ever run
  await reset();
  let r = await syncCrewHeadRoles({
    heads: { [C1]: head('u1', 'One'), [C2]: head('u2', 'Two') },
    discordIds: { [C1]: '900000000000000001', [C2]: '900000000000000002' },
    weekId: '2026-08-03',
  });
  check('A: two heads assigned', r.added === 2 && r.removed === 0, JSON.stringify(r));
  check('A: exactly two PUTs, no DELETEs', puts().length === 2 && dels().length === 0);
  check('A: holder recorded', (await state()).holders[C1].discordId === '900000000000000001');
  check('A: audit reason attached', !!calls[0].reason);

  // B — unchanged re-run re-asserts, never removes
  await reset((await state()).holders);
  r = await syncCrewHeadRoles({
    heads: { [C1]: head('u1', 'One'), [C2]: head('u2', 'Two') },
    discordIds: { [C1]: '900000000000000001', [C2]: '900000000000000002' },
  });
  check('B: idempotent re-assert', puts().length === 2 && dels().length === 0, JSON.stringify(r));

  // C — one crew changes head
  await reset({ [C1]: { discordId: '900000000000000001', uid: 'u1', roleId: ROLE[C1] } });
  r = await syncCrewHeadRoles({
    heads: { [C1]: head('u9', 'Nine') },
    discordIds: { [C1]: '900000000000000009' },
  });
  check('C: one remove and one add', dels().length === 1 && puts().length === 1, JSON.stringify(r));
  check('C: removed the OLD id', dels()[0].url.includes('900000000000000001'));
  check('C: added the NEW id', puts()[0].url.includes('900000000000000009'));

  // D — crew goes vacant
  await reset({ [C1]: { discordId: '900000000000000001', uid: 'u1', roleId: ROLE[C1] } });
  r = await syncCrewHeadRoles({ heads: {}, discordIds: {} });
  check('D: vacant crew removes role', dels().length === 1 && puts().length === 0);
  check('D: holder cleared', (await state()).holders[C1] === null);

  // E — new head has no Discord link
  await reset({ [C1]: { discordId: '900000000000000001', uid: 'u1', roleId: ROLE[C1] } });
  r = await syncCrewHeadRoles({ heads: { [C1]: head('u5', 'Five') }, discordIds: { [C1]: null } });
  check('E: old holder still removed', dels().length === 1 && puts().length === 0);
  check('E: recorded as pending', (await state()).pending[C1].reason === 'no-discord-link');

  // F — unconfigured crew is left completely alone
  const savedRole = CREW_HEAD_ROLE_IDS[C1];
  CREW_HEAD_ROLE_IDS[C1] = '';
  await reset({ [C1]: { discordId: '900000000000000001', uid: 'u1', roleId: savedRole } });
  r = await syncCrewHeadRoles({ heads: { [C1]: head('u9', 'Nine') }, discordIds: { [C1]: '900000000000000009' } });
  check('F: blank role ID makes zero calls', calls.length === 0, JSON.stringify(calls));
  check('F: existing holder preserved', (await state()).holders[C1].discordId === '900000000000000001');
  CREW_HEAD_ROLE_IDS[C1] = savedRole;

  // G — head is not in the Discord server
  await reset();
  scripted = [{ status: 404, data: { code: 10007, message: 'Unknown Member' } }];
  r = await syncCrewHeadRoles({ heads: { [C1]: head('u1', 'One') }, discordIds: { [C1]: '900000000000000001' } });
  check('G: not counted as a failure', r.failed === 0 && r.skipped >= 1, JSON.stringify(r));
  check('G: no holder recorded', (await state()).holders[C1] === null);
  check('G: recorded as pending', (await state()).pending[C1].reason === 'not-in-server');

  // H — removing a role from someone already gone counts as removed
  await reset({ [C1]: { discordId: '900000000000000001', uid: 'u1', roleId: ROLE[C1] } });
  scripted = [{ status: 404, data: { code: 10007, message: 'Unknown Member' } }];
  r = await syncCrewHeadRoles({ heads: {}, discordIds: {} });
  check('H: 404 on delete clears holder', (await state()).holders[C1] === null && r.removed === 1, JSON.stringify(r));

  // I — 403 stops the run, but earlier work is kept
  await reset();
  scripted = [{ status: 204, data: '' }, { status: 403, data: { code: 50013, message: 'Missing Permissions' } }];
  r = await syncCrewHeadRoles({
    heads: { [C1]: head('u1', 'One'), [C2]: head('u2', 'Two'), [C3]: head('u3', 'Three') },
    discordIds: { [C1]: '900000000000000001', [C2]: '900000000000000002', [C3]: '900000000000000003' },
  });
  check('I: stopped early', r.stoppedEarly === true, JSON.stringify(r));
  check('I: did not try every crew', calls.length < 3, `made ${calls.length} calls`);
  check('I: first success persisted', (await state()).holders[C1] !== null);
  check('I: problem is actionable', (r.problems || []).some((p) => /Manage Roles/i.test(p)));

  // J — 429 retries once and then succeeds
  await reset();
  scripted = [{ status: 429, data: { retry_after: 0.05 } }, { status: 204, data: '' }];
  r = await syncCrewHeadRoles({ heads: { [C1]: head('u1', 'One') }, discordIds: { [C1]: '900000000000000001' } });
  check('J: retried once and landed', r.added === 1 && calls.length === 2, JSON.stringify(r));

  // K — network error leaves stored state untouched for the next run
  await reset({ [C1]: { discordId: '900000000000000001', uid: 'u1', roleId: ROLE[C1] } });
  scripted = [{ throw: 'socket hang up' }, { throw: 'socket hang up' }];
  r = await syncCrewHeadRoles({ heads: {}, discordIds: {} });
  check('K: counted as failed', r.failed === 1, JSON.stringify(r));
  check('K: holder left intact for retry', (await state()).holders[C1].discordId === '900000000000000001');

  // L — a different guild invalidates stored holders
  calls = [];
  scripted = [];
  await STATE.set({ guildId: '999999999999999999', holders: { [C1]: { discordId: '900000000000000001', uid: 'u1', roleId: ROLE[C1] } }, updatedAt: Date.now() });
  r = await syncCrewHeadRoles({ heads: {}, discordIds: {} });
  check('L: no DELETEs fired at the old guild', dels().length === 0, JSON.stringify(calls));

  // M — no token means the whole feature no-ops
  await reset();
  const savedToken = process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_BOT_TOKEN;
  r = await syncCrewHeadRoles({ heads: { [C1]: head('u1', 'One') }, discordIds: { [C1]: '900000000000000001' } });
  check('M: reports unconfigured', r.configured === false, JSON.stringify(r));
  check('M: made no calls', calls.length === 0);
  process.env.DISCORD_BOT_TOKEN = savedToken;

  // N — dry run plans without touching anything
  await reset();
  r = await syncCrewHeadRoles({
    heads: { [C1]: head('u1', 'One') },
    discordIds: { [C1]: '900000000000000001' },
    dryRun: true,
  });
  check('N: planned but made no calls', r.dryRun === true && r.planned === 1 && calls.length === 0, JSON.stringify(r));
  check('N: wrote nothing', !(await STATE.get()).exists);

  // ── End to end through the real weekly job ────────────────────────────
  // Covers the two things most worth catching: that the crown follows the
  // biggest PORTFOLIO (not the biggest weekly percentage gain), and that a
  // Discord ID never lands in market/crewStats, which anyone can read.
  await reset();

  const { getWeekId } = require('../functions/helpers');
  // Must match how the job itself resolves "last week" (marketWeekly.js:220),
  // otherwise the seeded activity lands in the wrong bucket and nobody
  // qualifies as active.
  const prevWeekId = getWeekId(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  // The job only considers members who were active last week.
  const activeLastWeek = { weeklyMissions: { [prevWeekId]: { tradeCount: 3 } } };

  // Whale: biggest portfolio, flat week. Rocket: tiny account, huge percentage.
  await db.collection('users').doc('whale').set({
    displayName: 'Whale', crew: C1, portfolioValue: 500000,
    portfolioSnapshot7d: { value: 495000 },
    discordId: '900000000000000042', ...activeLastWeek,
  });
  await db.collection('users').doc('rocket').set({
    displayName: 'Rocket', crew: C1, portfolioValue: 4000,
    portfolioSnapshot7d: { value: 1000 },
    discordId: '900000000000000043', ...activeLastWeek,
  });

  const { runWeeklyCrewRankings } = require('../functions/services/marketWeekly');
  await runWeeklyCrewRankings({ postToDiscord: true });

  const stats = (await db.collection('market').doc('crewStats').get()).data() || {};
  const crowned = (stats.heads || {})[C1];
  check('E2E: biggest portfolio takes the crown', crowned && crowned.uid === 'whale',
    `crowned ${crowned && crowned.uid} (rocket gained 300%, whale gained 1%)`);
  check('E2E: portfolio value reported, not a percentage', crowned && crowned.portfolioValue === 500000);

  // The regression guard. A leak here exposes linked Discord IDs to every
  // visitor, since market/* is world-readable.
  const leaked = Object.values(stats.heads || {}).filter((h) => h && h.discordId !== undefined);
  check('E2E: no discordId anywhere in crewStats.heads', leaked.length === 0, JSON.stringify(leaked));
  check('E2E: whale got the Discord role', (await state()).holders[C1]?.discordId === '900000000000000042');

  const whaleDoc = (await db.collection('users').doc('whale').get()).data();
  check('E2E: crown written to the user doc', whaleDoc.isCrewHead === true && whaleDoc.crewHeadStreak === 1);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
