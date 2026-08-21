'use strict';
// End-to-end test of the chapter-review tidy-up (collapseReviewWindow +
// writeReviewChanges) against the LOCAL Firebase emulator. Never touches
// production (FIRESTORE_EMULATOR_HOST).
//
// Run via: npm run test:collapse
//
// Why this exists: collapseReviewHistory is a SCHEDULED function that rewrites
// live price history once a week. The one-off script version was proven against
// real data on 2026-08-20; this proves the Cloud Function port does the same.
//
// Scenarios covered:
//   1. A review staircase folds to ONE point, stamped 20:54 for every stock
//   2. The last price is preserved exactly - a collapse must never move a price
//   3. Points that are not the review survive: trades, daily drops, the auction
//   4. The collapsed point is tagged admin_adjust + collapsed, so price
//      protection keeps working and the split readers know the detail moved
//   5. The detail is stashed at market/reviewDetail
//   6. Idempotent - a second run finds nothing left to fold
//   7. A stock with a single review point is left alone
//   8. The set/knock-on split is written BEFORE the fold, and a rebuild AFTER
//      the fold still reconstructs it from the stash
//   9. A pre-halt point outside the window is never touched

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

// Use the SAME firebase-admin instance the functions code resolves
// (functions/node_modules), or its initializeApp won't be visible there.
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { writeReviewChanges, collapseReviewWindow } = require('../functions/services/reviewChanges');
const { WEEKLY_HALT_START_MINUTE, WEEKLY_HALT_END_MINUTE, REVIEW_COLLAPSE_MINUTE } = require('../functions/constants');

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  [PASS]' : '  [FAIL]'} ${label}${cond ? '' : ' - ' + detail}`);
  if (!cond) failures++;
};

// A Thursday in the past, so the window is fixed and the test is deterministic.
const DAY = Date.UTC(2026, 7, 20);
const haltStart = DAY + WEEKLY_HALT_START_MINUTE * 60 * 1000;
const haltEnd = DAY + WEEKLY_HALT_END_MINUTE * 60 * 1000;
const STAMP = DAY + REVIEW_COLLAPSE_MINUTE * 60 * 1000;
const at = (h, m) => Date.UTC(2026, 7, 20, h, m);

// GAP's real tape from 2026-08-20, plus a daily drop and the opening auction.
const FIXTURE = {
  GAP: [
    { timestamp: at(11, 40), price: 1615.32 },                            // pre-halt trade
    { timestamp: at(17, 32), price: 1634.71, source: 'trailing' },
    { timestamp: at(18, 12), price: 1641.25, source: 'trailing' },
    { timestamp: at(18, 19), price: 1670.79, source: 'trailing' },
    { timestamp: at(18, 20), price: 1750.15, source: 'admin_adjust' },
    { timestamp: at(20, 19), price: 1696.46, source: 'admin_adjust' },
    { timestamp: at(20, 56), price: 1667.33, source: 'pre_market_auction' },
  ],
  // Only ever knocked on, and carries a daily drop that must survive untouched.
  KWON: [
    { timestamp: at(12, 0), price: 113.06 },
    { timestamp: at(15, 7), price: 113.5, source: 'daily_drop' },
    { timestamp: at(19, 34), price: 114.02, source: 'trailing' },
    { timestamp: at(19, 35), price: 114.94, source: 'trailing' },
  ],
  // A single adjustment: nothing to fold.
  MONO: [
    { timestamp: at(12, 0), price: 124.88 },
    { timestamp: at(18, 11), price: 128.54, source: 'admin_adjust' },
  ],
};

const seed = async () => {
  await db.collection('market').doc('priceHistory').set(FIXTURE);
  await db.collection('market').doc('current').set({
    prices: { GAP: 1667.33, KWON: 114.94, MONO: 128.54 },
  }, { merge: true });
  await db.collection('market').doc('reviewDetail').delete().catch(() => {});
  await db.collection('market').doc('reviewChanges').delete().catch(() => {});
};

const history = async () => (await db.collection('market').doc('priceHistory').get()).data();

async function main() {
  await seed();

  // Order matters: the split has to be saved before the detail is folded.
  const before = await writeReviewChanges({ haltStart, haltEnd, fallbackPrices: {} });
  const gapBefore = before.changes.GAP;
  check('split recorded before the fold', gapBefore && typeof gapBefore.trailingChange === 'number',
    JSON.stringify(gapBefore));
  check('GAP total is the two halves compounded',
    Math.abs(((1 + gapBefore.directChange / 100) * (1 + gapBefore.trailingChange / 100) - 1) * 100
      - gapBefore.percentChange) < 0.001,
    JSON.stringify(gapBefore));
  check('the 20:56 auction is NOT part of the review', Math.abs(gapBefore.newPrice - 1667.33) > 0.01,
    `newPrice ${gapBefore.newPrice}`);

  // The fold itself.
  const first = await collapseReviewWindow({ haltStart, haltEnd });
  check('two stocks tidied (GAP, KWON), MONO left alone', first.tidied === 2, JSON.stringify(first));
  check('five intermediate points folded away', first.folded === 5, JSON.stringify(first));

  const after = await history();
  const gap = after.GAP.slice().sort((a, b) => a.timestamp - b.timestamp);
  const inWindow = gap.filter((p) => p.timestamp >= haltStart && p.timestamp <= haltEnd);
  const collapsed = gap.filter((p) => p.collapsed);

  check('GAP has exactly one collapsed point', collapsed.length === 1, JSON.stringify(collapsed));
  check('stamped 20:54 UTC', collapsed[0] && collapsed[0].timestamp === STAMP,
    collapsed[0] ? new Date(collapsed[0].timestamp).toISOString() : 'none');
  check('carries the last review price, not the auction price',
    collapsed[0] && collapsed[0].price === 1696.46, String(collapsed[0] && collapsed[0].price));
  check('tagged admin_adjust so price protection still applies',
    collapsed[0] && collapsed[0].source === 'admin_adjust', String(collapsed[0] && collapsed[0].source));
  check('pre-halt point untouched', gap[0].timestamp === at(11, 40) && gap[0].price === 1615.32);
  check('the 20:56 auction fill survived',
    inWindow.some((p) => p.source === 'pre_market_auction' && p.price === 1667.33));
  check('GAP last price unchanged by the fold', gap[gap.length - 1].price === 1667.33,
    String(gap[gap.length - 1].price));
  check('collapsed point sits before the auction', collapsed[0] && collapsed[0].timestamp < at(20, 56));

  const kwon = after.KWON.slice().sort((a, b) => a.timestamp - b.timestamp);
  check('the daily drop survived the fold',
    kwon.some((p) => p.source === 'daily_drop' && p.price === 113.5), JSON.stringify(kwon));
  check('KWON last price unchanged', kwon[kwon.length - 1].price === 114.94);

  check('MONO was left alone (single adjustment)',
    after.MONO.length === 2 && !after.MONO.some((p) => p.collapsed), JSON.stringify(after.MONO));

  // The stash.
  const stash = (await db.collection('market').doc('reviewDetail').get()).data();
  check('detail stashed for both folded stocks',
    Object.keys(stash.detail || {}).sort().join(',') === 'GAP,KWON',
    JSON.stringify(Object.keys(stash.detail || {})));
  check('stash holds every original GAP step', (stash.detail.GAP || []).length === 5,
    String((stash.detail.GAP || []).length));
  check('stash is tagged to this window', stash.windowEnd === haltEnd);

  // Idempotent.
  const second = await collapseReviewWindow({ haltStart, haltEnd });
  check('a second run finds nothing left to fold', second.tidied === 0, JSON.stringify(second));

  // Rebuild AFTER the fold still reconstructs the split from the stash.
  const rebuilt = await writeReviewChanges({ haltStart, haltEnd, fallbackPrices: {} });
  check('rebuild after the fold keeps every stock',
    rebuilt.tickerCount === before.tickerCount, `${rebuilt.tickerCount} vs ${before.tickerCount}`);
  const gapAfter = rebuilt.changes.GAP;
  check('rebuilt GAP split matches the original',
    gapAfter && Math.abs(gapAfter.directChange - gapBefore.directChange) < 0.001
    && Math.abs(gapAfter.trailingChange - gapBefore.trailingChange) < 0.001,
    `${JSON.stringify(gapAfter)} vs ${JSON.stringify(gapBefore)}`);
  check('rebuilt KWON is still knock-on only',
    rebuilt.changes.KWON && Math.abs(rebuilt.changes.KWON.directChange) < 0.001
    && rebuilt.changes.KWON.trailingChange > 0,
    JSON.stringify(rebuilt.changes.KWON));

  console.log(failures === 0 ? '\nALL REVIEW-COLLAPSE E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Test crashed:', err); process.exit(1); });
