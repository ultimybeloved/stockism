'use strict';
// Seeds the LOCAL Firebase emulator with a starting market doc so the sandbox
// has live prices the moment you open it. Talks only to the emulator (via
// FIRESTORE_EMULATOR_HOST) — it can never touch production. Run with the
// emulators already started: `npm run seed:emulator`.
//
// The market doc is admin-only by Firestore rules, and the emulator enforces
// those rules, so the app cannot self-initialize it from the client. This
// script uses the Admin SDK, which bypasses rules, to create it.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('firebase-admin');
const { CHARACTERS } = require('../functions/characters');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

async function main() {
  const now = Date.now();
  const prices = {};
  const priceHistory = {};
  for (const c of CHARACTERS) {
    if (c.ipoRequired) continue; // IPO-gated characters launch later, like prod
    prices[c.ticker] = c.basePrice;
    priceHistory[c.ticker] = [{ timestamp: now, price: c.basePrice }];
  }

  await db.collection('market').doc('current').set({
    prices,
    launchedTickers: [],
    marketHalted: false,
    totalTrades: 0,
    lastUpdate: now,
  }, { merge: true });

  // Chart history lives in its own doc (mirrors prod after the split)
  await db.collection('market').doc('priceHistory').set(priceHistory, { merge: true });

  console.log(`✅ Seeded emulator market doc with ${Object.keys(prices).length} tickers at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
