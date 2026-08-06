'use strict';

// Read-only snapshot of the LIVE market doc, so the state that only exists in
// Firestore is visible from the repo.
//
//   npm run status:market
//
// The thing this exists for: `ipoRequired: true` stays on a character forever,
// but every gate also checks market/current.launchedTickers. Once a ticker is in
// that list it trades like any other stock, and nothing in the codebase says so.
// Same for prices — a character in the roster with no entry in market/current
// .prices is a dead stock (no bots, no gainers/losers, blank chart) until
// someone runs Init New Character Prices.
//
// market/current is world-readable by firestore.rules, so this needs no service
// account key. It does need App Check, which is why it reuses the debug token
// from .env.local (same one the dev server uses).

const fs = require('fs');
const path = require('path');

const { CHARACTERS } = require('../functions/characters');
const { isWeeklyTradingHalt } = require('../functions/constants');

const PROJECT_ID = 'stockism-abb28';
// The web API key is locked to browser referrers; the dev server's origin is an
// allowed one, so REST calls have to present it too.
const REFERER = 'http://localhost:5173';

function readEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('No .env.local found. See CLAUDE.md for the local dev setup.');
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const [k, ...rest] = line.split('=');
    env[k.trim()] = rest.join('=').trim();
  }
  const missing = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_APPCHECK_DEBUG_TOKEN']
    .filter((k) => !env[k]);
  if (missing.length) {
    console.error(`.env.local is missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  return env;
}

async function appCheckToken(env) {
  const url = `https://firebaseappcheck.googleapis.com/v1/projects/${env.VITE_FIREBASE_MESSAGING_SENDER_ID}`
    + `/apps/${env.VITE_FIREBASE_APP_ID}:exchangeDebugToken?key=${env.VITE_FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: REFERER },
    body: JSON.stringify({ debugToken: env.VITE_APPCHECK_DEBUG_TOKEN }),
  });
  if (!res.ok) {
    console.error(`App Check debug-token exchange failed (${res.status}).`);
    console.error('If this says the token is invalid, re-register the UUID in');
    console.error('Firebase Console -> App Check -> Apps -> web app -> Manage debug tokens.');
    process.exit(1);
  }
  return (await res.json()).token;
}

async function readMarket(env, token) {
  const fields = ['launchedTickers', 'prices', 'marketHalted']
    .map((f) => `mask.fieldPaths=${f}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}`
    + `/databases/(default)/documents/market/current?key=${env.VITE_FIREBASE_API_KEY}&${fields}`;
  const res = await fetch(url, { headers: { Referer: REFERER, 'X-Firebase-AppCheck': token } });
  if (!res.ok) {
    console.error(`Reading market/current failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  const doc = await res.json();
  const priceFields = doc.fields?.prices?.mapValue?.fields || {};
  const prices = {};
  for (const [ticker, v] of Object.entries(priceFields)) {
    prices[ticker] = Number(v.doubleValue ?? v.integerValue ?? 0);
  }
  return {
    prices,
    launched: (doc.fields?.launchedTickers?.arrayValue?.values || []).map((v) => v.stringValue),
    manualHalt: doc.fields?.marketHalted?.booleanValue === true,
  };
}

const list = (arr) => (arr.length ? arr.join(', ') : '(none)');

async function main() {
  const env = readEnvLocal();
  const { prices, launched, manualHalt } = await readMarket(env, await appCheckToken(env));

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  console.log(`\nLIVE MARKET STATUS  —  ${now} UTC\n`);
  console.log(`  Weekly halt : ${isWeeklyTradingHalt() ? 'ACTIVE (Thursday 13:00-21:00 UTC)' : 'no'}`);
  console.log(`  Manual halt : ${manualHalt ? 'ON' : 'off'}`);

  const ipoChars = CHARACTERS.filter((c) => c.ipoRequired);
  const graduated = ipoChars.filter((c) => launched.includes(c.ticker));
  const gated = ipoChars.filter((c) => !launched.includes(c.ticker));

  console.log('\nIPO CHARACTERS');
  console.log(`  Launched, trades as a normal stock : ${list(graduated.map((c) => c.ticker))}`);
  console.log(`  Still IPO-gated                    : ${list(gated.map((c) => c.ticker))}`);
  if (graduated.length) {
    console.log('  (the ipoRequired flag on the launched ones is vestigial — every');
    console.log('   gate checks launchedTickers too, so it blocks nothing)');
  }

  // A character with no price entry is invisible to every automated mover:
  // bots, the market maker, and the daily gainers/losers all iterate the price
  // map, not the roster.
  const unpriced = CHARACTERS.filter((c) => !c.isETF && !prices[c.ticker]);
  const orphans = Object.keys(prices).filter((t) => !CHARACTERS.some((c) => c.ticker === t));

  console.log('\nROSTER vs LIVE PRICES');
  console.log(`  ${CHARACTERS.length} characters in the roster, ${Object.keys(prices).length} tickers priced`);
  if (unpriced.length) {
    console.log(`  DEAD STOCKS (no live price)  : ${list(unpriced.map((c) => c.ticker))}`);
    console.log('  -> run Init New Character Prices in the admin panel');
  } else {
    console.log('  Every character has a live price.');
  }
  if (orphans.length) {
    console.log(`  Priced but not in the roster : ${list(orphans)}`);
    console.log('  -> leftovers from a rename or a removed character; harmless, just noise');
  }
  console.log('');
}

main().catch((err) => { console.error(err); process.exit(1); });
