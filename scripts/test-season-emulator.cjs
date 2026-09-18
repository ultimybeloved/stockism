'use strict';
// End-to-end season test against the LOCAL Firebase emulator. Never touches
// production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run test:season
//
// Plays one whole season: start, two Thursday checkpoints, the standings board,
// and the end. The tier rules themselves are unit-tested in
// functions/seasonTiers.test.js; this covers the part those can't: what
// season.js actually reads from and writes to player documents.
//
// Checks the holes closed on 2026-09-13 as well as the rules:
//   - a stale stored portfolioValue can't set a baseline or bank a tier
//   - a margin loan doesn't count as value
//   - a late joiner is measured against the market from when they joined
//   - ending on the same week as a checkpoint doesn't count an active week twice
//   - a preseason keeps the season numbering and gives its own title
//   - a player under the $1,000 floor joins once they grow past it

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Loaded AFTER initializeApp so their top-level admin.firestore() binds to the emulator.
const { adminStartSeason, runSeasonCheckpoint, getSeasonStandings, adminEndSeason } = require('../functions/services/season');
const { ADMIN_UID } = require('../functions/constants');

const DAY = 24 * 60 * 60 * 1000;
const adminCtx = { auth: { uid: ADMIN_UID } };

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`); }
};
const close = (a, b, eps = 0.01) => typeof a === 'number' && Math.abs(a - b) <= eps;

const user = async (uid) => (await db.collection('users').doc(uid).get()).data();

// The index is SOPH alone with a divisor of 1/1000, so it reads SOPH x 12.5:
// 80 -> 1000, 84 -> 1050, 88 -> 1100.
const setPrices = (prices) => db.collection('market').doc('current').set({ prices }, { merge: true });

const seed = async () => {
  const now = Date.now();
  await db.collection('market').doc('indexHistory').set({
    history: [], constituents: [{ t: 'SOPH', b: 80 }], divisor: 0.001,
  });
  await setPrices({ SOPH: 80, CROC: 50, XIAO: 50, GOO: 50, MIRA: 10 });

  const players = {
    // Two characters at 50/50: the Diamond candidate.
    diverse: { cash: 0, holdings: { CROC: 100, XIAO: 100 } },
    // Everything in one character.
    sitter: { cash: 0, holdings: { GOO: 200 } },
    // $15,000 of stuff, $5,000 of it borrowed.
    margin: { cash: 10000, holdings: { CROC: 100 }, marginUsed: 5000 },
    // Logged in at a spike: the stored value says $50,000, the account holds $10,000.
    stale: { cash: 10000, holdings: {}, portfolioValue: 50000 },
    // Will be handed free money and nothing else.
    granted: { cash: 10000, holdings: {} },
    loser: { cash: 0, holdings: { MIRA: 1000 } },
    dormant: { cash: 10000, holdings: {}, lastActive: now - 60 * DAY },
    bot: { cash: 10000, holdings: {}, isBot: true },
  };
  // Cash-only players who turn up and do nothing. They fill the board so it has
  // two Platinum places and one Diamond place (14 players).
  for (let i = 0; i < 7; i++) players[`filler${i}`] = { cash: 10000, holdings: {} };

  const batch = db.batch();
  for (const [uid, p] of Object.entries(players)) {
    batch.set(db.collection('users').doc(uid), {
      displayName: uid,
      portfolioValue: p.portfolioValue ?? p.cash,
      grantedValue: 0,
      lastActive: now,
      ...p,
    });
  }
  await batch.commit();
};

const run = async () => {
  await seed();

  console.log('\nA. Start');
  await adminStartSeason.run({ name: 'Test Arc' }, adminCtx);
  const season = (await db.collection('market').doc('season').get()).data();
  check('season is active with the rules pinned', season.status === 'active' && season.rules?.platinumTopShare === 0.15, season.rules);
  check('opening index read from the stored divisor', close(season.indexAtStart, 1000), season.indexAtStart);
  check('checkpoint week list starts empty', Array.isArray(season.checkpointWeeks) && season.checkpointWeeks.length === 0);
  check('thresholds are gone', season.thresholds === undefined);
  check('baseline valued from holdings, pinned with the index', close((await user('diverse')).seasonBaseline.value, 10000)
    && close((await user('diverse')).seasonBaseline.index, 1000));
  check('margin loan is not baseline value', close((await user('margin')).seasonBaseline.value, 10000), (await user('margin')).seasonBaseline);
  check('stale stored portfolioValue is ignored', close((await user('stale')).seasonBaseline.value, 10000), (await user('stale')).seasonBaseline);
  check('bots get no baseline', !(await user('bot')).seasonBaseline);

  // A player who signs up after the start with no baseline yet.
  await db.collection('users').doc('late').set({ displayName: 'late', cash: 3000, holdings: {}, portfolioValue: 3000, grantedValue: 0, lastActive: Date.now() });

  console.log('\nB. Checkpoint 1 (market +5%)');
  await setPrices({ SOPH: 84, CROC: 60, XIAO: 50, GOO: 75, MIRA: 9 });
  await db.collection('users').doc('granted').update({ cash: 12000, grantedValue: 2000 });
  const cp1 = await runSeasonCheckpoint();
  check('checkpoint ran as week 1', cp1.ran && cp1.weeks === 1, cp1);
  check('diverse banks Gold (+10% vs +5%)', (await user('diverse')).seasonTier?.tier === 'gold', (await user('diverse')).seasonTier);
  check('sitter banks Gold', (await user('sitter')).seasonTier?.tier === 'gold');
  const marginRec = (await user('margin')).seasonWeeks?.[0];
  check('week record stores net equity, not gross', close(marginRec?.v, 11000), marginRec);
  check('stale spike banks nothing', !(await user('stale')).seasonTier, (await user('stale')).seasonTier);
  check('free money banks nothing', !(await user('granted')).seasonTier, (await user('granted')).seasonTier);
  check('loser banks nothing yet (one active week)', !(await user('loser')).seasonTier);
  const late = await user('late');
  check('late joiner pinned at the checkpoint with that day\'s index', late.seasonBaseline && close(late.seasonBaseline.index, 1050) && close(late.seasonBaseline.value, 3000), late.seasonBaseline);
  check('late joiner not scored on the week they were pinned', !late.seasonWeeks);

  await runSeasonCheckpoint();
  const rerun = await user('diverse');
  check('re-running the same week does not count activity twice', rerun.seasonActiveWeeks.weeks === 1, rerun.seasonActiveWeeks);
  check('re-running the same week replaces the record', rerun.seasonWeeks.length === 1);

  console.log('\nC. Checkpoint 2 (market +10% since start)');
  await db.collection('market').doc('season').update({ startedAt: Date.now() - 8 * DAY });
  await setPrices({ SOPH: 88, CROC: 66, XIAO: 55, GOO: 90, MIRA: 8 });
  const cp2 = await runSeasonCheckpoint();
  check('checkpoint ran as week 2', cp2.weeks === 2, cp2);
  const s2 = (await db.collection('market').doc('season').get()).data();
  check('season records both checkpoint weeks', JSON.stringify([...s2.checkpointWeeks].sort()) === '[1,2]', s2.checkpointWeeks);
  check('stale earns Bronze for turning up twice', (await user('stale')).seasonTier?.tier === 'bronze');
  check('fillers earn Bronze', (await user('filler0')).seasonTier?.tier === 'bronze');
  check('checkpoints never bank Platinum or Diamond', !['platinum', 'diamond'].includes((await user('sitter')).seasonTier?.tier));

  console.log('\nD. Standings board');
  const board = await getSeasonStandings.run({}, {});
  const row = (uid) => board.entries.find((e) => e.userId === uid);
  check('board has every active player and no one else', board.totalScored === 14 && !row('dormant') && !row('bot'), board.entries.map((e) => e.userId));
  check('ranked by lead over the market', board.entries[0].userId === 'sitter', board.entries.slice(0, 3));
  check('sitter: +80% return, +70% over the market', close(row('sitter').returnPercent, 80, 0.1) && close(row('sitter').excess, 70, 0.1), row('sitter'));
  check('market figure for the season', close(board.marketPercent, 10, 0.1), board.marketPercent);
  check('two Platinum places, one Diamond', board.slots.platinum === 2 && board.slots.diamond === 1, board.slots);
  check('sitter projected Platinum, not Diamond', row('sitter').projectedTier === 'platinum', row('sitter'));
  check('diverse projected Diamond', row('diverse').projectedTier === 'diamond', row('diverse'));
  check('late joiner measured from their own start (market +4.8%, not +10%)', close(row('late').excess, -4.76, 0.1), row('late'));

  console.log('\nE. End');
  const end = await adminEndSeason.run({}, adminCtx);
  // Bronze: stale, granted, loser, late and the seven fillers.
  check('end hands out Diamond, Platinum, Gold and Bronze', end.tierCounts.diamond === 1 && end.tierCounts.platinum === 1
    && end.tierCounts.gold === 1 && end.tierCounts.bronze === 11, end.tierCounts);
  const diverse = await user('diverse');
  check('diverse ends Diamond with both titles', diverse.seasonTier?.tier === 'diamond'
    && diverse.ownedTitles?.includes('season_1_diamond') && diverse.ownedTitles?.includes('arc_s1_diamond')
    && diverse.titleMeta?.season_1_diamond === 'Season 1 Diamond', { tier: diverse.seasonTier, titles: diverse.ownedTitles });
  check('sitter ends Platinum', (await user('sitter')).seasonTier?.tier === 'platinum');
  check('margin keeps banked Gold', (await user('margin')).seasonTier?.tier === 'gold');
  // The late joiner was pinned at checkpoint 1 and scored when that week re-ran,
  // so they were active in weeks 1 and 2. Ending re-runs week 2 and must not
  // make it three.
  const lateEnd = await user('late');
  check('ending on a checkpoint week does not count activity twice', lateEnd.seasonActiveWeeks?.weeks === 2
    && lateEnd.seasonTier?.tier === 'bronze', { active: lateEnd.seasonActiveWeeks, tier: lateEnd.seasonTier });
  const results = (await db.collection('seasonResults').doc('S1').get()).data();
  check('results filed with the board size and tier counts', results?.boardSize === 14 && results?.tierCounts?.diamond === 1, { boardSize: results?.boardSize });
  check('standings filed best first', results?.standings?.[0]?.uid === 'sitter');
  check('season marked ended', (await db.collection('market').doc('season').get()).data().status === 'ended');

  console.log('\nF. Preseason');
  // Under the $1,000 floor when it starts. Used to be out for the whole season.
  await db.collection('users').doc('small').set({ displayName: 'small', cash: 500, holdings: {}, portfolioValue: 500, grantedValue: 0, lastActive: Date.now() });
  const pre = await adminStartSeason.run({ name: 'Trial Arc', preseason: true }, adminCtx);
  const preDoc = (await db.collection('market').doc('season').get()).data();
  check('preseason does not use up a season number', pre.id === 'P1' && preDoc.number === 1 && preDoc.preseason === true && preDoc.preseasons === 1, preDoc);
  check('small player pinned under the floor', close((await user('small')).seasonBaseline.value, 500));

  await db.collection('users').doc('small').update({ cash: 2000 });
  await setPrices({ CROC: 80 });
  await runSeasonCheckpoint();
  const small = await user('small');
  check('grown past the floor: re-pinned at the checkpoint', small.seasonBaseline.seasonId === 'P1' && close(small.seasonBaseline.value, 2000), small.seasonBaseline);
  check('re-pinned player is not scored on the week they were pinned', !small.seasonWeeks);
  check('a player already over the floor is not re-pinned', close((await user('diverse')).seasonBaseline.value, 12100), (await user('diverse')).seasonBaseline);

  await adminEndSeason.run({}, adminCtx);
  const preDiverse = await user('diverse');
  check('preseason hands out one Preseason title', preDiverse.ownedTitles.includes('preseason_1_gold')
    && preDiverse.titleMeta.preseason_1_gold === 'Preseason Gold' && !preDiverse.ownedTitles.includes('arc_p1_gold'), preDiverse.ownedTitles);
  check('preseason results filed under P1', (await db.collection('seasonResults').doc('P1').get()).exists);

  console.log('\nG. Counting the start week');
  await db.collection('users').doc('diverse').update({ lastActive: Date.now() });
  const s2start = await adminStartSeason.run({ name: 'Next Arc', countThisWeek: true }, adminCtx);
  const s2doc = (await db.collection('market').doc('season').get()).data();
  check('the next real season is Season 2 and keeps the preseason count', s2start.id === 'S2' && s2doc.number === 2 && s2doc.preseasons === 1 && s2doc.preseason === false, s2doc);
  const sinceStart = Date.now() - s2doc.startedAt;
  check('dated from the last Thursday halt, within the past week', sinceStart >= 0 && sinceStart < 7 * DAY && new Date(s2doc.startedAt).getUTCDay() === 4, new Date(s2doc.startedAt).toISOString());
  check('start week credited to recently active players', (await user('diverse')).seasonActiveWeeks?.weeks === 1);
  check('start week not credited to dormant players', !(await user('dormant')).seasonActiveWeeks);
  check('start week is not a checkpoint week', s2doc.checkpointWeeks.length === 0);
  // Next Thursday's checkpoint is week 2 and brings the active count to 2.
  await db.collection('market').doc('season').update({ startedAt: s2doc.startedAt - 7 * DAY + 60 * 1000 });
  await db.collection('users').doc('diverse').update({ lastActive: Date.now() });
  const g2 = await runSeasonCheckpoint();
  check('next checkpoint is week 2', g2.weeks === 2, g2);
  const dv = await user('diverse');
  check('active in both weeks: Bronze at the first real checkpoint', dv.seasonActiveWeeks.weeks === 2 && dv.seasonTier?.tier === 'bronze', { a: dv.seasonActiveWeeks, t: dv.seasonTier });

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll season checks passed.');
  process.exit(failures ? 1 : 0);
};

run().catch((err) => { console.error(err); process.exit(1); });
