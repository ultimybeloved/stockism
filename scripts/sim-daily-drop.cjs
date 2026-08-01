#!/usr/bin/env node
'use strict';

/**
 * Daily-drop payout simulator.
 *
 * Runs the REAL roll (functions/services/dailyDropRoll.js) against live
 * production prices, so it can never drift from what players actually get.
 * Use it after adding characters or changing any DAILY_DROP_* weight in
 * functions/constants.js.
 *
 *   node scripts/sim-daily-drop.cjs [rolls]
 *
 * Prices are read straight from market/current via the App Check debug-token
 * flow, using the keys already in .env.local. Read-only.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROLLS = Number(process.argv[2]) || 400000;

function loadEnv() {
  const env = {};
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) throw new Error('.env.local not found');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function fetchLiveMarket() {
  const env = loadEnv();
  const proj = env.VITE_FIREBASE_PROJECT_ID;

  const res = await fetch(
    `https://firebaseappcheck.googleapis.com/v1/projects/${proj}/apps/${env.VITE_FIREBASE_APP_ID}:exchangeDebugToken?key=${env.VITE_FIREBASE_API_KEY}`,
    {
      method: 'POST',
      // The web API key is referrer-restricted; without this header the
      // exchange fails with API_KEY_HTTP_REFERRER_BLOCKED.
      headers: { 'Content-Type': 'application/json', Referer: 'http://localhost:5173/' },
      body: JSON.stringify({ debugToken: env.VITE_APPCHECK_DEBUG_TOKEN }),
    }
  );
  const { token } = await res.json();
  if (!token) throw new Error('App Check debug-token exchange failed (is the token registered in the Firebase console?)');

  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/market/current`
    + '?mask.fieldPaths=prices&mask.fieldPaths=launchedTickers';
  const doc = await (await fetch(url, { headers: { 'X-Firebase-AppCheck': token } })).json();
  if (!doc.fields) throw new Error('Could not read market/current');

  const prices = {};
  for (const [ticker, v] of Object.entries(doc.fields.prices?.mapValue?.fields || {})) {
    prices[ticker] = Number(v.doubleValue ?? v.integerValue);
  }
  const launched = (doc.fields.launchedTickers?.arrayValue?.values || []).map((v) => v.stringValue);
  return { prices, launched };
}

const money = (n) => '$' + n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

(async () => {
  const { prices, launched } = await fetchLiveMarket();
  const { rollDailyStock } = require(path.join(ROOT, 'functions/services/dailyDropRoll.js'));

  const values = [];
  let jackpotTotal = 0, jackpots = 0, normalTotal = 0, normals = 0;
  let shares = 0, legendaryHits = 0;
  const byGroup = { main: 0, bonus: 0, legendary: 0 };
  const legendaryTickers = new Map();

  for (let i = 0; i < ROLLS; i++) {
    const { picks, isJackpot } = rollDailyStock(prices, launched);
    let value = 0;
    for (const p of picks) {
      const v = p.shares * prices[p.ticker];
      value += v;
      shares += p.shares;
      byGroup[p.group] = (byGroup[p.group] || 0) + v;
      if (p.group === 'legendary') {
        legendaryHits++;
        legendaryTickers.set(p.ticker, (legendaryTickers.get(p.ticker) || 0) + 1);
      }
    }
    values.push(value);
    if (isJackpot) { jackpotTotal += value; jackpots++; } else { normalTotal += value; normals++; }
  }

  values.sort((a, b) => a - b);
  const q = (f) => values[Math.floor(ROLLS * f)];
  const pct = (n) => (n / ROLLS * 100).toFixed(1) + '%';

  console.log(`\nDaily drop simulation — ${ROLLS.toLocaleString()} rolls against live prices\n`);
  console.log(`  average per claim   ${money(values.reduce((a, b) => a + b, 0) / ROLLS)}`);
  console.log(`  average (no jackpot)${money(normalTotal / normals).padStart(8)}`);
  console.log(`  jackpot average     ${money(jackpotTotal / jackpots)}   (${pct(jackpots)} of claims)\n`);
  console.log(`  worst 10%           ${money(q(0.10))}`);
  console.log(`  typical (median)    ${money(q(0.50))}`);
  console.log(`  good day (p75)      ${money(q(0.75))}`);
  console.log(`  great day (p90)     ${money(q(0.90))}`);
  console.log(`  1-in-100 day        ${money(q(0.99))}\n`);
  console.log(`  under $100          ${pct(values.filter((v) => v < 100).length)}`);
  console.log(`  over $500           ${pct(values.filter((v) => v > 500).length)}`);
  console.log(`  shares per claim    ${(shares / ROLLS).toFixed(1)}`);

  const grandTotal = byGroup.main + byGroup.bonus + byGroup.legendary;
  const split = (n) => (n / grandTotal * 100).toFixed(0) + '%';
  console.log(`  value by table      main ${split(byGroup.main)} / bonus ${split(byGroup.bonus)} / legendary ${split(byGroup.legendary)}`);
  console.log(`  legendary bonus     ${pct(legendaryHits)} of claims (${pct(legendaryHits / normals * ROLLS)} of normal rolls)`);
  const spread = [...legendaryTickers.entries()]
    .sort((a, b) => prices[a[0]] - prices[b[0]])
    .map(([t, n]) => `${t} $${prices[t].toFixed(0)} ${(n / legendaryHits * 100).toFixed(0)}%`);
  console.log(`  drawn from          ${spread.join(', ')}\n`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
