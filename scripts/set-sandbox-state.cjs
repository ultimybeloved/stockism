'use strict';
// Sandbox-ONLY helper: flips a test account between bankruptcy states so you can
// see the new bailout flow without actually losing money. Talks only to the local
// emulator (via *_EMULATOR_HOST) — it can never touch production.
//
// Usage (emulators must be running):
//   node scripts/set-sandbox-state.cjs <email> nudge     # cash negative but solvent (shows the "sell a position" nudge, no bailout)
//   node scripts/set-sandbox-state.cjs <email> bankrupt  # truly wiped out (shows the red "Wiped Out - Request Bailout" button + modal)
//   node scripts/set-sandbox-state.cjs <email> reset     # back to a normal $3000 account

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('firebase-admin');
const { CHARACTERS } = require('../functions/characters');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const [, , email, state] = process.argv;

async function main() {
  if (!email || !['nudge', 'bankrupt', 'reset'].includes(state)) {
    console.error('Usage: node scripts/set-sandbox-state.cjs <email> <nudge|bankrupt|reset>');
    process.exit(1);
  }

  const user = await admin.auth().getUserByEmail(email);
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`No Firestore user doc for ${email} (${user.uid}). Sign up / finish onboarding in the app first.`);
    process.exit(1);
  }

  let update;
  if (state === 'nudge') {
    // Negative cash but a position worth far more, so net worth stays positive and
    // isBankrupt stays false. Should show the amber "sell a position" line, NO bailout.
    const c = CHARACTERS.find((x) => !x.ipoRequired && x.basePrice > 0);
    const shares = Math.ceil(3000 / c.basePrice);
    update = {
      cash: -500,
      isBankrupt: false,
      bankruptAt: admin.firestore.FieldValue.delete(),
      holdings: { [c.ticker]: shares },
      costBasis: { [c.ticker]: c.basePrice },
      shorts: {},
    };
    console.log(`Set ${email} to NUDGE: cash -$500 + ${shares} ${c.ticker} (~$${(shares * c.basePrice).toFixed(0)}).`);
  } else if (state === 'bankrupt') {
    // Truly wiped out: negative cash, no positions. Should show the red
    // "Wiped Out - Request Bailout" button and the destructive modal.
    update = {
      cash: -2000,
      isBankrupt: true,
      bankruptAt: Date.now(),
      holdings: {},
      costBasis: {},
      shorts: {},
    };
    console.log(`Set ${email} to BANKRUPT: cash -$2000, no positions, isBankrupt=true.`);
  } else {
    update = {
      cash: 3000,
      isBankrupt: false,
      bankruptAt: admin.firestore.FieldValue.delete(),
      holdings: {},
      costBasis: {},
      shorts: {},
    };
    console.log(`Reset ${email} to a normal $3000 account.`);
  }

  await ref.set(update, { merge: true });
  console.log('Done. The app updates live — no refresh needed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
