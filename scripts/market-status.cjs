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

/**
 * The market index doc. Season tiers are scored against this line, and the
 * divisor is what stops a roster addition moving it on its own, so "did the
 * divisor actually get written" is now a thing worth being able to check.
 */
async function readIndex(env, token) {
  const fields = ['divisor', 'lastDivisorAdjustment', 'constituents']
    .map((f) => `mask.fieldPaths=${f}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}`
    + `/databases/(default)/documents/market/indexHistory?key=${env.VITE_FIREBASE_API_KEY}&${fields}`;
  const res = await fetch(url, { headers: { Referer: REFERER, 'X-Firebase-AppCheck': token } });
  if (!res.ok) return { error: `${res.status} ${await res.text()}` };
  const f = (await res.json()).fields || {};
  const adj = f.lastDivisorAdjustment?.mapValue?.fields || {};
  return {
    divisor: Number(f.divisor?.doubleValue ?? f.divisor?.integerValue ?? 0),
    constituents: (f.constituents?.arrayValue?.values || []).length,
    lastAdjustment: Object.keys(adj).length ? {
      reason: adj.reason?.stringValue,
      at: Number(adj.at?.doubleValue ?? adj.at?.integerValue ?? 0),
      count: Number(adj.count?.doubleValue ?? adj.count?.integerValue ?? 0),
    } : null,
  };
}

const list = (arr) => (arr.length ? arr.join(', ') : '(none)');

async function main() {
  const env = readEnvLocal();
  const token = await appCheckToken(env);
  const { prices, launched, manualHalt } = await readMarket(env, token);
  const index = await readIndex(env, token);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  console.log(`\nLIVE MARKET STATUS  —  ${now} UTC\n`);
  console.log(`  Weekly halt : ${isWeeklyTradingHalt() ? 'ACTIVE (Thursday 13:00-21:00 UTC)' : 'no'}`);
  console.log(`  Manual halt : ${manualHalt ? 'ON' : 'off'}`);

  // launchedTickers is the authority: every gate reads
  // `ipoRequired && !launchedTickers.includes(ticker)`, so a launched ticker
  // trades normally whether or not it still carries the flag.
  const ipoChars = CHARACTERS.filter((c) => c.ipoRequired);
  const gated = ipoChars.filter((c) => !launched.includes(c.ticker));
  const staleFlag = ipoChars.filter((c) => launched.includes(c.ticker));

  console.log('\nIPO CHARACTERS');
  console.log(`  Launched, trades as a normal stock : ${list(launched)}`);
  console.log(`  Still IPO-gated                    : ${list(gated.map((c) => c.ticker))}`);
  if (staleFlag.length) {
    console.log(`  Flagged ipoRequired but launched   : ${list(staleFlag.map((c) => c.ticker))}`);
    console.log('  -> the flag no longer gates them. Drop it in src/characters.js:');
    console.log('     left on, it reads as gated and the admin IPO panel keeps');
    console.log('     offering them as candidates for another launch.');
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
    console.log('  -> leftovers from a rename or a removed character. Inert since the');
    console.log('     isRosterTicker guard (bots and the daily/weekly summaries skip');
    console.log('     them), but do NOT just delete the price: confirm nobody still');
    console.log('     holds the ticker first, or you strand their position.');
  }
  console.log('\nMARKET INDEX');
  if (index.error) {
    console.log(`  Could not read market/indexHistory: ${index.error}`);
  } else if (!(index.divisor > 0)) {
    console.log('  NO DIVISOR YET. The index is still on the plain average, so a');
    console.log('  roster addition drags it down and every player looks like they');
    console.log('  beat the market. It is written by dailyMarketSummary at 21:00');
    console.log('  UTC — if a scheduled run has passed since the deploy and this is');
    console.log('  still empty, that job is not running.');
  } else {
    console.log(`  Divisor      : ${index.divisor} over ${index.constituents} constituents`);
    if (index.constituents !== CHARACTERS.filter((c) => !c.isETF && c.basePrice > 0).length) {
      console.log('  -> roster has changed since the last daily run; the next one');
      console.log('     rescales the divisor so the index does not step.');
    }
    if (index.lastAdjustment) {
      const when = new Date(index.lastAdjustment.at).toISOString().replace('T', ' ').slice(0, 16);
      console.log(`  Last change  : ${index.lastAdjustment.reason} at ${when} UTC (${index.lastAdjustment.count} constituents)`);
    }
  }

  console.log('');
}

main().catch((err) => { console.error(err); process.exit(1); });
