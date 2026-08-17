'use strict';

// READ-ONLY audit of two accounts suspected of being the same person.
//
//   node scripts/alt-audit.cjs <uidA> <uidB>
//
// Answers three questions, with numbers instead of guesses:
//   1. Are they actually linked? (shared signup IP, shared trade IPs, timing)
//   2. Did one account's trading inflate a stock the other one is sitting on?
//   3. If so, exactly how many dollars of the holder's position is pump, so a
//      clawback can be set to a defensible number instead of a round one.
//
// The math leans on a field every trade record already stores: `priceImpact`,
// the fraction the price moved because of that single trade (always a positive
// magnitude — `action` carries the direction). Chaining those together across
// one account's trades in a ticker gives the exact multiplier that account's
// own trading applied to the price. Divide the live price by that multiplier
// and you get the counterfactual: where the stock would sit if the suspected
// pumper had never touched it. The gap, times the other account's share count,
// is the inflated portion.
//
// This script WRITES NOTHING. Every Firestore call below is a .get(). It is
// safe to run against production as many times as you like.
//
// Needs service-account-key.json in the repo root (gitignored, never commit it).

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');

if (!fs.existsSync(KEY_PATH)) {
  console.error('No service-account-key.json in the repo root.');
  console.error('Firebase Console -> Project Settings -> Service Accounts -> Generate new private key,');
  console.error('save it as service-account-key.json in the project root. It is already gitignored.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const pct = (n) => ((Number(n) || 0) * 100).toFixed(2) + '%';
const rule = (label) => console.log('\n' + '='.repeat(72) + (label ? '\n' + label : ''));

// Firestore timestamps come back in a couple of shapes depending on how they
// were written. Normalise to plain millis.
const toMs = (ts) => {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts._seconds) return ts._seconds * 1000;
  if (ts.seconds) return ts.seconds * 1000;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  return 0;
};
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'unknown');

// buy and cover lift the price, sell and short push it down. Mirrors
// computeBuy/computeSell/computeShort/computeCover in tradeActions.js.
const PUSHES_UP = { buy: true, cover: true, sell: false, short: false };

function pumpMultiplier(trades) {
  let multiplier = 1;
  for (const t of trades) {
    const impact = Number(t.priceImpact) || 0;
    if (!impact) continue;
    const up = PUSHES_UP[(t.action || '').toLowerCase()];
    if (up === undefined) continue;
    multiplier *= up ? 1 + impact : 1 - impact;
  }
  return multiplier;
}

async function fetchTrades(uid) {
  const snap = await db.collection('trades').where('uid', '==', uid).get();
  const trades = snap.docs.map((d) => ({ id: d.id, ...d.data(), _ts: toMs(d.data().timestamp) }));
  trades.sort((a, b) => a._ts - b._ts);
  return trades;
}

async function main() {
  const [uidA, uidB] = process.argv.slice(2);
  if (!uidA || !uidB) {
    console.error('Usage: node scripts/alt-audit.cjs <uidA> <uidB>');
    process.exit(1);
  }

  const [snapA, snapB, marketSnap] = await Promise.all([
    db.collection('users').doc(uidA).get(),
    db.collection('users').doc(uidB).get(),
    db.collection('market').doc('current').get(),
  ]);

  for (const [uid, snap] of [[uidA, snapA], [uidB, snapB]]) {
    if (!snap.exists) {
      console.error(`User ${uid} not found.`);
      process.exit(1);
    }
  }

  const A = { uid: uidA, ...snapA.data() };
  const B = { uid: uidB, ...snapB.data() };
  const prices = (marketSnap.data() || {}).prices || {};

  const [tradesA, tradesB] = await Promise.all([fetchTrades(uidA), fetchTrades(uidB)]);
  A.trades = tradesA;
  B.trades = tradesB;

  // ---------------------------------------------------------------- accounts
  rule('ACCOUNTS');
  for (const U of [A, B]) {
    const holdings = U.holdings || {};
    const costBasis = U.costBasis || {};
    let held = 0;
    let spent = 0;
    for (const [ticker, shares] of Object.entries(holdings)) {
      if (!(shares > 0)) continue;
      held += (prices[ticker] || 0) * shares;
      spent += (costBasis[ticker] || 0) * shares;
    }
    const positions = Object.entries(holdings)
      .filter(([, s]) => s > 0)
      .sort((a, b) => (prices[b[0]] || 0) * b[1] - (prices[a[0]] || 0) * a[1]);

    console.log(`\n${U.displayName || '(no name)'}  [${U.uid}]`);
    console.log(`  crew           ${U.crew || 'none'}`);
    console.log(`  joined         ${day(toMs(U.createdAt))}`);
    console.log(`  cash           ${money(U.cash)}`);
    console.log(`  holdings       ${money(held)} across ${positions.length} tickers`);
    console.log(`  cost basis     ${money(spent)}  (paper gain ${money(held - spent)})`);
    console.log(`  net worth      ${money((U.cash || 0) + held - (U.marginUsed || 0))}`);
    console.log(`  margin used    ${money(U.marginUsed)}`);
    console.log(`  granted value  ${money(U.grantedValue)}   <- free money, not earned`);
    console.log(`  signup IP      ${U.signupIp || 'not recorded'}`);
    console.log(`  discord        ${U.discordId || 'not linked'}`);
    console.log(`  trades on file ${U.trades.length}`);
    console.log('  positions:');
    for (const [ticker, shares] of positions.slice(0, 12)) {
      const value = (prices[ticker] || 0) * shares;
      const share = held > 0 ? value / held : 0;
      console.log(`    ${ticker.padEnd(8)} ${shares.toFixed(4).padStart(12)} sh  ${money(value).padStart(14)}  ${pct(share).padStart(8)} of book`);
    }
    if (positions.length > 12) console.log(`    ... and ${positions.length - 12} more`);
  }

  // ------------------------------------------------------------------- link
  rule('LINK EVIDENCE');
  const ipsA = new Set(A.trades.map((t) => t.ip).filter(Boolean));
  const ipsB = new Set(B.trades.map((t) => t.ip).filter(Boolean));
  const sharedIps = [...ipsA].filter((ip) => ipsB.has(ip));

  console.log(`  same signup IP        ${A.signupIp && A.signupIp === B.signupIp ? 'YES  ' + A.signupIp : 'no'}`);
  console.log(`  shared trading IPs    ${sharedIps.length ? sharedIps.join(', ') : 'none'}`);
  console.log(`  distinct IPs seen     ${A.displayName}: ${ipsA.size}   ${B.displayName}: ${ipsB.size}`);
  console.log(`  same crew             ${A.crew && A.crew === B.crew ? 'YES  ' + A.crew : 'no'}`);
  console.log(`  accounts created      ${day(toMs(A.createdAt))} vs ${day(toMs(B.createdAt))}`);

  // ------------------------------------------------------------- pump per ticker
  // For each ticker one account is holding, look at what the OTHER account did
  // to that ticker's price. That is the direction that matters: the holder
  // profits from the trader's impact.
  rule('PUMP ANALYSIS');
  console.log('For every ticker one account holds, how much of the live price was');
  console.log('created by the OTHER account\'s own trading.\n');

  const findings = [];

  for (const [holder, trader] of [[A, B], [B, A]]) {
    const holdings = holder.holdings || {};
    const byTicker = {};
    for (const t of trader.trades) {
      if (!t.ticker) continue;
      (byTicker[t.ticker] = byTicker[t.ticker] || []).push(t);
    }

    for (const [ticker, shares] of Object.entries(holdings)) {
      if (!(shares > 0)) continue;
      const traderTrades = byTicker[ticker];
      if (!traderTrades || !traderTrades.length) continue;

      const livePrice = prices[ticker] || 0;
      const multiplier = pumpMultiplier(traderTrades);
      if (multiplier <= 0) continue;

      const counterfactual = livePrice / multiplier;
      const inflatedPerShare = livePrice - counterfactual;
      const inflatedDollars = inflatedPerShare * shares;

      const buys = traderTrades.filter((t) => (t.action || '') === 'buy');
      const sells = traderTrades.filter((t) => (t.action || '') === 'sell');
      const sharesBought = buys.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const spent = buys.reduce((s, t) => s + (Number(t.totalValue) || 0), 0);

      findings.push({
        holder: holder.displayName, holderUid: holder.uid,
        trader: trader.displayName,
        ticker, shares, livePrice, counterfactual, multiplier,
        inflatedPerShare, inflatedDollars,
        tradeCount: traderTrades.length, buys: buys.length, sells: sells.length,
        sharesBought, spent,
        firstTrade: day(traderTrades[0]._ts),
        lastTrade: day(traderTrades[traderTrades.length - 1]._ts),
      });
    }
  }

  findings.sort((a, b) => b.inflatedDollars - a.inflatedDollars);

  if (!findings.length) {
    console.log('  No overlap. Neither account traded a ticker the other one is holding.');
    console.log('  Whatever else is going on, there is no pump-and-hold between these two.');
  }

  for (const f of findings) {
    console.log(`  ${f.ticker}  —  ${f.holder} holds ${f.shares.toFixed(4)} sh, ${f.trader} traded it ${f.tradeCount}x`);
    console.log(`     ${f.trader}: ${f.buys} buys / ${f.sells} sells, ${f.sharesBought.toFixed(4)} sh bought for ${money(f.spent)}`);
    console.log(`     active ${f.firstTrade} -> ${f.lastTrade}`);
    console.log(`     price now              ${money(f.livePrice)}`);
    console.log(`     price without ${(f.trader + ':').padEnd(12)} ${money(f.counterfactual)}`);
    console.log(`     ${f.trader} moved it     ${pct(f.multiplier - 1)}`);
    console.log(`     INFLATED IN ${f.holder}'S BOOK   ${money(f.inflatedDollars)}`);
    console.log('');
  }

  // ------------------------------------------------------- collateral damage
  // Anyone else holding a pumped ticker is carrying the same inflated price.
  // Wiping the alt does not move the price, so these players keep the paper
  // gain — worth seeing before deciding whether to roll the price back.
  const pumpedTickers = [...new Set(findings.filter((f) => f.inflatedDollars > 0).map((f) => f.ticker))];
  if (pumpedTickers.length) {
    rule('WHO ELSE IS HOLDING THE PUMPED STOCKS');
    const usersSnap = await db.collection('users').get();
    for (const ticker of pumpedTickers) {
      const f = findings.find((x) => x.ticker === ticker);
      const others = [];
      usersSnap.forEach((doc) => {
        if (doc.id === uidA || doc.id === uidB) return;
        const u = doc.data();
        if (u.isBot || u.isBanned) return;
        const shares = (u.holdings || {})[ticker] || 0;
        if (shares > 0) others.push({ name: u.displayName || doc.id, shares });
      });
      others.sort((a, b) => b.shares - a.shares);
      const totalShares = others.reduce((s, o) => s + o.shares, 0);
      console.log(`\n  ${ticker}: ${others.length} other real players, ${totalShares.toFixed(2)} shares between them`);
      console.log(`  their combined exposure to the inflated part: ${money(totalShares * f.inflatedPerShare)}`);
      for (const o of others.slice(0, 10)) {
        console.log(`    ${o.name.padEnd(20)} ${o.shares.toFixed(4).padStart(12)} sh   inflated by ${money(o.shares * f.inflatedPerShare)}`);
      }
      if (others.length > 10) console.log(`    ... and ${others.length - 10} more`);
    }
  }

  // ------------------------------------------------------------- the number
  rule('SUGGESTED CLAWBACK');
  const byHolder = {};
  for (const f of findings) {
    byHolder[f.holderUid] = byHolder[f.holderUid] || { name: f.holder, total: 0, tickers: [] };
    byHolder[f.holderUid].total += f.inflatedDollars;
    byHolder[f.holderUid].tickers.push(f.ticker);
  }

  if (!Object.keys(byHolder).length) {
    console.log('  Nothing to claw back from cross-account pumping.');
  }
  for (const [uid, h] of Object.entries(byHolder)) {
    const U = uid === uidA ? A : B;
    const holdings = U.holdings || {};
    let held = 0;
    for (const [t, s] of Object.entries(holdings)) if (s > 0) held += (prices[t] || 0) * s;
    const netWorth = (U.cash || 0) + held - (U.marginUsed || 0);
    console.log(`\n  ${h.name}`);
    console.log(`    net worth now                 ${money(netWorth)}`);
    console.log(`    inflated by the other account ${money(h.total)}   (${h.tickers.join(', ')})`);
    console.log(`    net worth after clawback      ${money(netWorth - h.total)}`);
    console.log(`    also sitting on free grants   ${money(U.grantedValue)}`);
  }

  console.log('\nNote: this counts only the price movement the OTHER account caused.');
  console.log('Gains the holder made by pumping the stock themselves are not in this');
  console.log('number. Run with the same uid twice if you want that figure too.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
