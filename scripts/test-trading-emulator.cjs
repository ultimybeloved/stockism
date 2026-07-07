'use strict';
// Characterization test suite for executeTrade against the LOCAL Firebase emulator.
// Never touches production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run test:trading
// (= firebase emulators:exec --config firebase.emulator-test.json --only firestore
//      "node scripts/test-trading-emulator.cjs")
//
// Purpose: pin down the CURRENT behavior of the trade engine so any future change
// to functions/services/trading.js can be verified against it. Expected numbers are
// computed independently in this file (same math, reimplemented) — if the engine's
// formulas, rounding, or orchestration change, these checks fail.
//
// Sections:
//   A. Validation & gating   B. Buy mechanics       C. Sell mechanics
//   D. Short mechanics       E. Cover mechanics     F. Margin buys
//   G. ETF & trailing        H. Throttles & anti-manipulation
//   I. Bookkeeping & achievements

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Modules loaded AFTER admin.initializeApp so their top-level admin.firestore()
// binds to the emulator.
const { executeTrade } = require('../functions/services/trading');
const {
  BASE_IMPACT, BASE_LIQUIDITY, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD,
  MAX_PRICE_CHANGE_PERCENT, MAX_DAILY_IMPACT, MAX_TRADES_PER_TICKER_24H,
  SHORT_MARGIN_RATIO, MARGIN_SELL_LOCKUP_MS, isWeeklyTradingHalt,
} = require('../functions/constants');

// ── Test tickers (chosen for isolation) ──────────────────────────────────────
// SOPH / CROC / XIAO: no trailingFactors, not a constituent of any ETF.
// MIRA: price < $20 (underdog), only parent ETF is JWON (left unseeded → inert).
// SCRT: ETF with 5 constituents at coefficient 0.16 (GOO/LOGN/SAM seeded;
//        ALEX/SHMN left unseeded so trailing skips them).
// GOO:  plain char that is a constituent of SCRT (tests stock→ETF propagation).
// REI:  ipoRequired ticker (never launched in these tests).
const T = 'SOPH';   // main test ticker, basePrice 80
const T2 = 'CROC';  // secondary clean ticker, basePrice 66
const T3 = 'XIAO';  // third clean ticker, basePrice 40
const ETF = 'SCRT';
const CON = 'GOO';  // SCRT constituent
const UND = 'MIRA'; // underdog (< $20)
const IPOT = 'REI'; // ipoRequired, unlaunched

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let failures = 0;
let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};
const near = (a, b, eps = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= eps;

let ipSeed = 0;
const freshIp = () => `203.0.113.${++ipSeed % 250}.${Math.floor(ipSeed / 250)}`.replace(/\.0$/, '');
const ctx = (uid, ip) => ({ auth: { uid }, rawRequest: { ip: ip || `198.51.100.${++ipSeed}` } });
const ok = (data, uid, ip) => executeTrade.run(data, ctx(uid, ip));
const err = async (data, uid, ip) => {
  try { await executeTrade.run(data, ctx(uid, ip)); return null; }
  catch (e) { return e.message || String(e); }
};

const setUser = (uid, data) => db.collection('users').doc(uid).set({ displayName: uid, ...data });
const getUser = async (uid) => (await db.collection('users').doc(uid).get()).data();
const getMarket = async () => (await db.collection('market').doc('current').get()).data();
const getHistoryDoc = async () => {
  const s = await db.collection('market').doc('priceHistory').get();
  return s.exists ? s.data() : {};
};

// Reset the market docs to a known state. `prices` maps ticker → price; only
// seeded tickers participate in trailing effects (unseeded ones are skipped).
const seedMarket = async (prices, extra = {}) => {
  await db.collection('market').doc('current').set({
    prices, launchedTickers: [], marketHalted: false, haltedTickers: {}, ...extra,
  });
  await db.collection('market').doc('priceHistory').set({});
};

// ── Independent reimplementation of the engine's price math ─────────────────
const round2 = (x) => Math.round(x * 100) / 100;
const impactOf = (price, amount, cum = 0, factor = 1) => {
  const raw = price * BASE_IMPACT * (
    Math.sqrt((cum + amount) / BASE_LIQUIDITY) - Math.sqrt(cum / BASE_LIQUIDITY)
  );
  return Math.min(raw, price * MAX_PRICE_CHANGE_PERCENT) * factor;
};
const buyMath = (price, amount, { cum = 0, factor = 1, spread = BID_ASK_SPREAD } = {}) => {
  const impact = impactOf(price, amount, cum, factor);
  const newPrice = round2(price + impact);
  const exec = newPrice * (1 + spread / 2);
  return { impact, newPrice, exec, cost: exec * amount };
};
const sellMath = (price, amount, { cum = 0, factor = 1, spread = BID_ASK_SPREAD, capRemaining = Infinity } = {}) => {
  let impact = impactOf(price, amount, cum, factor);
  impact = Math.min(impact, price * capRemaining);
  const newPrice = Math.max(0.01, round2(price - impact));
  const exec = Math.max(0.01, newPrice * (1 - spread / 2));
  return { impact, newPrice, exec, proceeds: exec * amount };
};

const todayDate = () => new Date().toISOString().split('T')[0];
const weekIdOf = () => {
  const nowDate = new Date();
  const weekStart = new Date(nowDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  if (weekStart > nowDate) weekStart.setDate(weekStart.getDate() - 7);
  return weekStart.toISOString().split('T')[0];
};

// ════════════════════════════════════════════════════════════════════════════
// A. VALIDATION & GATING
// ════════════════════════════════════════════════════════════════════════════
async function testValidation() {
  console.log('\nA. Validation & gating');
  await seedMarket({ [T]: 80 });
  await setUser('val_user', { cash: 10000 });

  for (const [label, data] of [
    ['amount 0', { ticker: T, action: 'buy', amount: 0 }],
    ['negative amount', { ticker: T, action: 'buy', amount: -5 }],
    ['amount over 10,000', { ticker: T, action: 'buy', amount: 10001 }],
    ['3-decimal amount', { ticker: T, action: 'buy', amount: 1.001 }],
    ['sub-cent dust amount', { ticker: T, action: 'sell', amount: 0.005 }],
    ['NaN amount', { ticker: T, action: 'buy', amount: NaN }],
  ]) {
    const e = await err(data, 'val_user');
    check(`rejects ${label}`, !!e && /Invalid trade parameters/i.test(e), e || 'no error');
  }

  const eAct = await err({ ticker: T, action: 'gift', amount: 1 }, 'val_user');
  check('rejects unknown action', !!eAct && /Invalid trade action/i.test(eAct), eAct || 'no error');

  const eTick = await err({ ticker: 'ZZZZ', action: 'buy', amount: 1 }, 'val_user');
  check('rejects invalid ticker', !!eTick && /Invalid ticker/i.test(eTick), eTick || 'no error');

  let eAuth = null;
  try { await executeTrade.run({ ticker: T, action: 'buy', amount: 1 }, { rawRequest: { ip: '1.2.3.4' } }); }
  catch (e) { eAuth = e.message; }
  check('rejects unauthenticated call', !!eAuth && /logged in/i.test(eAuth), eAuth || 'no error');

  const eNoUser = await err({ ticker: T, action: 'buy', amount: 1 }, 'val_ghost');
  check('rejects missing user doc', !!eNoUser && /User not found/i.test(eNoUser), eNoUser || 'no error');

  await setUser('val_banned', { cash: 10000, isBanned: true });
  const eBan = await err({ ticker: T, action: 'buy', amount: 1 }, 'val_banned');
  check('rejects banned user', !!eBan && /banned/i.test(eBan), eBan || 'no error');

  await setUser('val_wall', { cash: 10000, requiresDiscordLink: true });
  const eWall = await err({ ticker: T, action: 'buy', amount: 1 }, 'val_wall');
  check('rejects Discord-walled user', !!eWall && /Discord/i.test(eWall), eWall || 'no error');

  const eIpo = await err({ ticker: IPOT, action: 'buy', amount: 1 }, 'val_user');
  check('rejects unlaunched IPO ticker', !!eIpo && /IPO/i.test(eIpo), eIpo || 'no error');

  await seedMarket({ [T]: 80 }, { marketHalted: true, haltReason: 'test halt' });
  const eHalt = await err({ ticker: T, action: 'buy', amount: 1 }, 'val_user');
  check('admin halt blocks buys', !!eHalt && /test halt/i.test(eHalt), eHalt || 'no error');
  await setUser('val_holder', { cash: 0, holdings: { [T]: 5 }, costBasis: { [T]: 80 } });
  const eHaltSell = await err({ ticker: T, action: 'sell', amount: 1 }, 'val_holder');
  check('admin halt blocks sells too', !!eHaltSell && /test halt/i.test(eHaltSell), eHaltSell || 'no error');

  await seedMarket({ [T]: 80 }, { haltedTickers: { [T]: { resumeAt: Date.now() + 10 * MIN, reason: 'circuit' } } });
  const eCb = await err({ ticker: T, action: 'buy', amount: 1 }, 'val_user');
  check('circuit breaker blocks the halted ticker', !!eCb && /circuit breaker/i.test(eCb), eCb || 'no error');
  await seedMarket({ [T]: 80, [T2]: 66 }, { haltedTickers: { [T]: { resumeAt: Date.now() + 10 * MIN } } });
  const okOther = await ok({ ticker: T2, action: 'buy', amount: 1 }, 'val_user');
  check('circuit breaker does not block other tickers', okOther.success === true, JSON.stringify(okOther));

  // Bankrupt: buy/short blocked, sell/cover allowed
  await seedMarket({ [T]: 80 });
  const now = Date.now();
  await setUser('val_broke', {
    cash: 50, isBankrupt: true,
    holdings: { [T]: 2 }, costBasis: { [T]: 80 },
    shorts: { [T2]: { shares: 1, costBasis: 66, margin: 66, openedAt: now - MIN, system: 'v2' } },
  });
  const eBB = await err({ ticker: T, action: 'buy', amount: 0.5 }, 'val_broke');
  check('bankrupt user cannot buy', !!eBB && /bankrupt/i.test(eBB), eBB || 'no error');
  const eBS = await err({ ticker: T, action: 'short', amount: 0.5 }, 'val_broke');
  check('bankrupt user cannot short', !!eBS && /bankrupt/i.test(eBS), eBS || 'no error');
  const okBSell = await ok({ ticker: T, action: 'sell', amount: 1 }, 'val_broke');
  check('bankrupt user CAN sell to exit', okBSell.success === true, JSON.stringify(okBSell));

  // Missing price falls back to the character's basePrice (XIAO = 40)
  await seedMarket({ [T]: 80 });
  await setUser('val_base', { cash: 10000 });
  const okBase = await ok({ ticker: T3, action: 'buy', amount: 1 }, 'val_base');
  const bm = buyMath(40, 1);
  check('unseeded price falls back to basePrice', okBase.success && near(okBase.newPrice, bm.newPrice),
    `newPrice=${okBase.newPrice} expected=${bm.newPrice}`);
}

// ════════════════════════════════════════════════════════════════════════════
// B. BUY MECHANICS
// ════════════════════════════════════════════════════════════════════════════
async function testBuy() {
  console.log('\nB. Buy mechanics');
  await seedMarket({ [T]: 80 });
  await setUser('buy_gold', { cash: 10000 });

  const exp = buyMath(80, 10);
  const r = await ok({ ticker: T, action: 'buy', amount: 10 }, 'buy_gold');
  const u = await getUser('buy_gold');
  const m = await getMarket();

  check('buy: price impact matches sqrt formula', near(r.priceImpact, exp.impact), `${r.priceImpact} vs ${exp.impact}`);
  check('buy: new price rounded to cents', near(r.newPrice, exp.newPrice) && near(m.prices[T], exp.newPrice),
    `result=${r.newPrice} market=${m.prices[T]} expected=${exp.newPrice}`);
  check('buy: executes at ask (newPrice + half spread)', near(r.executionPrice, exp.exec), `${r.executionPrice} vs ${exp.exec}`);
  check('buy: cash debited exactly', near(u.cash, 10000 - exp.cost), `${u.cash} vs ${10000 - exp.cost}`);
  check('buy: holdings credited', u.holdings[T] === 10, JSON.stringify(u.holdings));
  check('buy: cost basis = rounded exec price', near(u.costBasis[T], round2(exp.exec)), `${u.costBasis[T]}`);
  check('buy: lowestWhileHolding = rounded exec price', near(u.lowestWhileHolding[T], round2(exp.exec)), `${u.lowestWhileHolding[T]}`);
  const cohort = u.holdingCohorts?.[T];
  check('buy: dividend cohort has 10 pending shares', cohort && cohort.eligible === 0 &&
    cohort.pending?.length === 1 && cohort.pending[0].shares === 10, JSON.stringify(cohort));
  check('buy: throttle stamps written', !!u.lastTradeTime && !!u.lastBuyTime?.[T] && !!u.lastTickerTradeTime?.[T],
    JSON.stringify({ lt: !!u.lastTradeTime, lb: !!u.lastBuyTime, ltt: !!u.lastTickerTradeTime }));
  const hist = u.tickerTradeHistory?.[T]?.buy;
  check('buy: trade history entry appended', hist?.length === 1 && hist[0].shares === 10 &&
    near(hist[0].impact, exp.impact / 80), JSON.stringify(hist));
  check('buy: remaining trades counts down', r.remainingTrades === MAX_TRADES_PER_TICKER_24H - 1, `${r.remainingTrades}`);

  const hd = await getHistoryDoc();
  const lastPoint = (hd[T] || [])[ (hd[T] || []).length - 1 ];
  check('buy: price history point appended', !!lastPoint && near(lastPoint.price, exp.newPrice), JSON.stringify(lastPoint));

  const daily = u.dailyMissions?.[todayDate()];
  check('buy: daily mission counters', daily && daily.tradesCount === 1 && daily.tradeVolume === 10 && daily.boughtAny === true,
    JSON.stringify(daily));
  const weekly = u.weeklyMissions?.[weekIdOf()];
  check('buy: weekly mission counters', weekly && weekly.tradeCount === 1 && near(weekly.tradeValue, exp.cost) &&
    weekly.tradingDays?.[todayDate()] === true, JSON.stringify(weekly));
  check('buy: totalTrades incremented', u.totalTrades === 1, `${u.totalTrades}`);
  const tx = (u.transactionLog || [])[u.transactionLog.length - 1];
  check('buy: transaction log entry', tx && tx.type === 'BUY' && near(tx.totalCost, exp.cost) && near(tx.pricePerShare, exp.exec),
    JSON.stringify(tx));
  const trades = await db.collection('trades').where('uid', '==', 'buy_gold').get();
  check('buy: trades collection record', trades.size === 1 && trades.docs[0].data().action === 'buy', `${trades.size}`);

  // Second buy on same ticker: weighted-average cost basis, marginal impact uses cumulative volume
  await db.collection('users').doc('buy_gold').update({
    lastTradeTime: admin.firestore.FieldValue.delete(),
    lastTickerTradeTime: admin.firestore.FieldValue.delete(),
  });
  const p2 = (await getMarket()).prices[T];
  const exp2 = buyMath(p2, 10, { cum: 10 });
  const r2 = await ok({ ticker: T, action: 'buy', amount: 10 }, 'buy_gold');
  const u2 = await getUser('buy_gold');
  check('buy: 2nd buy impact uses cumulative volume', near(r2.priceImpact, exp2.impact), `${r2.priceImpact} vs ${exp2.impact}`);
  const expBasis = round2(((round2(exp.exec) * 10) + (exp2.exec * 10)) / 20);
  check('buy: cost basis is weighted average', near(u2.costBasis[T], expBasis), `${u2.costBasis[T]} vs ${expBasis}`);
  check('buy: holdings accumulate', u2.holdings[T] === 20, JSON.stringify(u2.holdings));

  // Insufficient funds
  await setUser('buy_poor', { cash: 10 });
  const ePoor = await err({ ticker: T, action: 'buy', amount: 10 }, 'buy_poor');
  check('buy: insufficient funds rejected', !!ePoor && /Insufficient funds/i.test(ePoor), ePoor || 'no error');

  // Impact capped at 5% of price; MONOPOLY achievement fires on a capped buy
  await seedMarket({ [T]: 80 });
  await setUser('buy_whale', { cash: 1000000 });
  const rW = await ok({ ticker: T, action: 'buy', amount: 5000 }, 'buy_whale');
  check('buy: impact capped at 5% of price', near(rW.priceImpact, 80 * MAX_PRICE_CHANGE_PERCENT) && near(rW.newPrice, 84),
    `impact=${rW.priceImpact} newPrice=${rW.newPrice}`);
  const uW = await getUser('buy_whale');
  check('buy: MONOPOLY + SHARK achievements on capped big buy',
    (uW.achievements || []).includes('MONOPOLY') && (uW.achievements || []).includes('SHARK'),
    JSON.stringify(uW.achievements));

  // Daily 10% impact cap blocks further buys
  await seedMarket({ [T]: 80 });
  await setUser('buy_capped', {
    cash: 10000,
    tickerTradeHistory: { [T]: { buy: [{ ts: Date.now() - 1000, shares: 1, impact: 0.099 }] } },
  });
  const eCap = await err({ ticker: T, action: 'buy', amount: 10 }, 'buy_capped');
  check('buy: daily 10% impact cap blocks', !!eCap && /Daily trading limit/i.test(eCap), eCap || 'no error');

  // 10-trades-per-24h cap
  const entries = Array.from({ length: MAX_TRADES_PER_TICKER_24H }, (_, i) => ({ ts: Date.now() - (i + 1) * 1000, shares: 0.01, impact: 0 }));
  await setUser('buy_maxed', { cash: 10000, tickerTradeHistory: { [T]: { buy: entries } } });
  const eMax = await err({ ticker: T, action: 'buy', amount: 1 }, 'buy_maxed');
  check('buy: 10-trade/24h cap blocks', !!eMax && /limit of 10 buys/i.test(eMax), eMax || 'no error');

  // New-account impact damping (~10% at day 0)
  await seedMarket({ [T]: 80 });
  await setUser('buy_newbie', { cash: 10000, createdAt: admin.firestore.Timestamp.now() });
  const rN = await ok({ ticker: T, action: 'buy', amount: 10 }, 'buy_newbie');
  const fullImpact = impactOf(80, 10);
  const ratio = rN.priceImpact / fullImpact;
  check('buy: brand-new account impact damped to ~10%', ratio > 0.09 && ratio < 0.12, `ratio=${ratio}`);
}

// ════════════════════════════════════════════════════════════════════════════
// C. SELL MECHANICS
// ════════════════════════════════════════════════════════════════════════════
async function testSell() {
  console.log('\nC. Sell mechanics');
  await seedMarket({ [T]: 80 });
  await setUser('sell_gold', { cash: 1000, holdings: { [T]: 10 }, costBasis: { [T]: 80 },
    holdingCohorts: { [T]: { eligible: 10, pending: [] } } });

  const exp = sellMath(80, 4);
  const r = await ok({ ticker: T, action: 'sell', amount: 4 }, 'sell_gold');
  const u = await getUser('sell_gold');
  const m = await getMarket();
  check('sell: price drops by impact', near(r.newPrice, exp.newPrice) && near(m.prices[T], exp.newPrice),
    `${r.newPrice} vs ${exp.newPrice}`);
  check('sell: executes at bid (newPrice - half spread)', near(r.executionPrice, exp.exec), `${r.executionPrice} vs ${exp.exec}`);
  check('sell: cash credited exactly', near(u.cash, 1000 + exp.proceeds), `${u.cash} vs ${1000 + exp.proceeds}`);
  check('sell: holdings decremented', u.holdings[T] === 6, JSON.stringify(u.holdings));
  check('sell: cost basis untouched on partial sell', u.costBasis[T] === 80, `${u.costBasis[T]}`);
  check('sell: cohort decremented (eligible first)', u.holdingCohorts[T].eligible === 6, JSON.stringify(u.holdingCohorts[T]));
  const daily = u.dailyMissions?.[todayDate()];
  check('sell: daily mission soldAny set', daily?.soldAny === true, JSON.stringify(daily));

  // Sell ALL → full cleanup
  await db.collection('users').doc('sell_gold').update({ lastTradeTime: admin.firestore.FieldValue.delete() });
  const okAll = await ok({ ticker: T, action: 'sell', amount: 6 }, 'sell_gold');
  const uAll = await getUser('sell_gold');
  check('sell-all: holdings key removed', okAll.success && !(T in (uAll.holdings || {})), JSON.stringify(uAll.holdings));
  check('sell-all: cost basis zeroed', uAll.costBasis[T] === 0, `${uAll.costBasis[T]}`);
  check('sell-all: lowestWhileHolding removed', !(uAll.lowestWhileHolding && T in uAll.lowestWhileHolding),
    JSON.stringify(uAll.lowestWhileHolding));
  check('sell-all: cohort removed', !(uAll.holdingCohorts && T in uAll.holdingCohorts), JSON.stringify(uAll.holdingCohorts));

  // Insufficient shares
  await setUser('sell_none', { cash: 0, holdings: { [T]: 1 } });
  const eNone = await err({ ticker: T, action: 'sell', amount: 2 }, 'sell_none');
  check('sell: insufficient shares rejected', !!eNone && /Insufficient shares/i.test(eNone), eNone || 'no error');

  // 45s hold period after a buy
  await setUser('sell_hold', { cash: 0, holdings: { [T]: 5 }, lastBuyTime: { [T]: Date.now() - 10000 } });
  const eHold = await err({ ticker: T, action: 'sell', amount: 1 }, 'sell_hold');
  check('sell: 45s hold period enforced', !!eHold && /Hold period/i.test(eHold), eHold || 'no error');
  await db.collection('users').doc('sell_hold').update({ [`lastBuyTime.${T}`]: Date.now() - 50000 });
  const okHold = await ok({ ticker: T, action: 'sell', amount: 1 }, 'sell_hold');
  check('sell: allowed once hold expires', okHold.success === true, JSON.stringify(okHold));

  // Margin lockup blocks selling locked shares
  await setUser('sell_mlock', { cash: 0, holdings: { [T]: 10 },
    marginLockup: { [T]: { shares: 6, until: Date.now() + DAY } } });
  const eML = await err({ ticker: T, action: 'sell', amount: 5 }, 'sell_mlock');
  check('sell: margin-locked shares blocked', !!eML && /margin-locked/i.test(eML), eML || 'no error');
  const okML = await ok({ ticker: T, action: 'sell', amount: 4 }, 'sell_mlock');
  check('sell: unlocked remainder sells fine', okML.success === true, JSON.stringify(okML));

  // At daily impact cap the sell still executes, with zero price movement
  await seedMarket({ [T]: 80 });
  await setUser('sell_cap', { cash: 0, holdings: { [T]: 10 },
    tickerTradeHistory: { [T]: { sell: [{ ts: Date.now() - 1000, shares: 0.01, impact: MAX_DAILY_IMPACT }] } } });
  const rCap = await ok({ ticker: T, action: 'sell', amount: 5 }, 'sell_cap');
  check('sell: executes at daily cap with clamped (zero) impact',
    rCap.success && rCap.priceImpact === 0 && near(rCap.newPrice, 80),
    `impact=${rCap.priceImpact} newPrice=${rCap.newPrice}`);

  // Cohort FIFO: eligible consumed first, then oldest pending
  const now = Date.now();
  await setUser('sell_fifo', { cash: 0, holdings: { [T]: 10 },
    holdingCohorts: { [T]: { eligible: 5, pending: [
      { shares: 3, availableAt: now + 1 * DAY },
      { shares: 2, availableAt: now + 5 * DAY },
    ] } } });
  await ok({ ticker: T, action: 'sell', amount: 7 }, 'sell_fifo');
  const uF = await getUser('sell_fifo');
  const cF = uF.holdingCohorts[T];
  check('sell: cohort FIFO (eligible → oldest pending)',
    cF.eligible === 0 && cF.pending.length === 2 && cF.pending[0].shares === 1 && cF.pending[1].shares === 2,
    JSON.stringify(cF));
}

// ════════════════════════════════════════════════════════════════════════════
// D. SHORT MECHANICS
// ════════════════════════════════════════════════════════════════════════════
async function testShort() {
  console.log('\nD. Short mechanics');
  await seedMarket({ [T]: 80 });
  await setUser('shrt_gold', { cash: 1000 });

  const exp = sellMath(80, 5); // shorts price like sells, execute at bid
  const margin = 80 * 5 * SHORT_MARGIN_RATIO;
  const r = await ok({ ticker: T, action: 'short', amount: 5 }, 'shrt_gold');
  const u = await getUser('shrt_gold');
  check('short: price drops like a sell', near(r.newPrice, exp.newPrice), `${r.newPrice} vs ${exp.newPrice}`);
  check('short: 100% collateral deducted (no proceeds)', near(u.cash, 1000 - margin), `${u.cash} vs ${1000 - margin}`);
  const pos = u.shorts[T];
  check('short: position recorded (v2, basis = bid exec)',
    pos && pos.shares === 5 && near(pos.costBasis, exp.exec) && near(pos.margin, margin) && pos.system === 'v2',
    JSON.stringify(pos));
  check('short: shortHistory stamped', (u.shortHistory?.[T] || []).length === 1, JSON.stringify(u.shortHistory));

  // Adding to an existing short: weighted basis, accumulated margin
  await seedMarket({ [T]: 50 });
  const now = Date.now();
  await setUser('shrt_add', { cash: 2000,
    shorts: { [T]: { shares: 5, costBasis: 40, margin: 200, openedAt: now - MIN, system: 'v2' } } });
  const expA = sellMath(50, 5);
  await ok({ ticker: T, action: 'short', amount: 5 }, 'shrt_add');
  const uA = await getUser('shrt_add');
  const posA = uA.shorts[T];
  const expBasis = (40 * 5 + expA.exec * 5) / 10;
  check('short: add-on merges with weighted basis', posA.shares === 10 && near(posA.costBasis, expBasis) &&
    near(posA.margin, 200 + 50 * 5), JSON.stringify(posA));

  // Insufficient cash for collateral
  await seedMarket({ [T]: 80 });
  await setUser('shrt_poor', { cash: 100 });
  const ePoor = await err({ ticker: T, action: 'short', amount: 5 }, 'shrt_poor');
  check('short: insufficient collateral rejected', !!ePoor && /Insufficient cash for short margin/i.test(ePoor), ePoor || 'no error');

  // Total-shorts-vs-equity cap. The existing short must be underwater (price above
  // basis) so equity < cash + margin — otherwise the insufficient-cash check fires first.
  // equity = 700 + (500 + (50-90)*10) = 800; existing margin 500 + new 400 = 900 > 800.
  await seedMarket({ [T]: 80, [T2]: 90 });
  await setUser('shrt_equity', { cash: 700,
    shorts: { [T2]: { shares: 10, costBasis: 50, margin: 500, openedAt: now - MIN, system: 'v2' } } });
  const eEq = await err({ ticker: T, action: 'short', amount: 5 }, 'shrt_equity');
  check('short: total shorts capped at portfolio equity', !!eEq && /cannot exceed your portfolio value/i.test(eEq), eEq || 'no error');

  // Per-ticker concentration cap (50% of equity)
  await seedMarket({ [T]: 80 });
  await setUser('shrt_conc', { cash: 1000 });
  const eConc = await err({ ticker: T, action: 'short', amount: 7 }, 'shrt_conc'); // 560 > 500
  check('short: per-ticker concentration cap', !!eConc && /Concentration limit/i.test(eConc), eConc || 'no error');
  const okConc = await ok({ ticker: T, action: 'short', amount: 6 }, 'shrt_conc'); // 480 ≤ 500
  check('short: allowed just under concentration cap', okConc.success === true, JSON.stringify(okConc));

  // 8h cooldown after 3 shorts on one ticker
  await setUser('shrt_cool', { cash: 10000,
    shortHistory: { [T]: [now - 1 * HOUR, now - 2 * HOUR, now - 3 * HOUR] } });
  const eCool = await err({ ticker: T, action: 'short', amount: 1 }, 'shrt_cool');
  check('short: 8h cooldown after 3 shorts', !!eCool && /can short/i.test(eCool), eCool || 'no error');

  // Pending SELL limit order on the ticker blocks shorting
  await setUser('shrt_limit', { cash: 10000 });
  await db.collection('limitOrders').add({ userId: 'shrt_limit', ticker: T, status: 'PENDING', type: 'SELL', shares: 1, limitPrice: 99 });
  const eLim = await err({ ticker: T, action: 'short', amount: 1 }, 'shrt_limit');
  check('short: blocked by pending sell limit order', !!eLim && /pending sell order/i.test(eLim), eLim || 'no error');
}

// ════════════════════════════════════════════════════════════════════════════
// E. COVER MECHANICS
// ════════════════════════════════════════════════════════════════════════════
async function testCover() {
  console.log('\nE. Cover mechanics');
  const now = Date.now();

  // v2 full cover: cash += margin back + (basis - exec) * shares; price rises like a buy
  await seedMarket({ [T]: 80 });
  await setUser('cov_gold', { cash: 100,
    shorts: { [T]: { shares: 5, costBasis: 90, margin: 400, openedAt: now - MIN, system: 'v2' } } });
  const exp = buyMath(80, 5); // covers price like buys, execute at ask
  const r = await ok({ ticker: T, action: 'cover', amount: 5 }, 'cov_gold');
  const u = await getUser('cov_gold');
  const expCash = 100 + 400 + (90 - exp.exec) * 5;
  check('cover: price rises like a buy', near(r.newPrice, exp.newPrice), `${r.newPrice} vs ${exp.newPrice}`);
  check('cover: executes at ask', near(r.executionPrice, exp.exec), `${r.executionPrice} vs ${exp.exec}`);
  check('cover: v2 payout = margin + P&L', near(u.cash, expCash), `${u.cash} vs ${expCash}`);
  check('cover: full cover removes the position', !(u.shorts && T in u.shorts), JSON.stringify(u.shorts));
  check('cover: COLD_BLOODED on profitable cover', (u.achievements || []).includes('COLD_BLOODED'),
    JSON.stringify(u.achievements));
  const tx = (u.transactionLog || [])[u.transactionLog.length - 1];
  check('cover: transaction log SHORT_CLOSE with profit', tx?.type === 'SHORT_CLOSE' && near(tx.totalProfit, (90 - exp.exec) * 5),
    JSON.stringify(tx));

  // Partial cover: proportional margin return
  await seedMarket({ [T]: 80 });
  await setUser('cov_part', { cash: 0,
    shorts: { [T]: { shares: 5, costBasis: 90, margin: 400, openedAt: now - MIN, system: 'v2' } } });
  const expP = buyMath(80, 2);
  await ok({ ticker: T, action: 'cover', amount: 2 }, 'cov_part');
  const uP = await getUser('cov_part');
  check('cover: partial returns proportional margin', near(uP.cash, 160 + (90 - expP.exec) * 2) &&
    uP.shorts[T].shares === 3 && near(uP.shorts[T].margin, 240), JSON.stringify({ cash: uP.cash, pos: uP.shorts[T] }));

  // Over-cover rejected (clear the 3s cooldown left by the partial cover first)
  await db.collection('users').doc('cov_part').update({ lastTradeTime: admin.firestore.FieldValue.delete() });
  const eOver = await err({ ticker: T, action: 'cover', amount: 10 }, 'cov_part');
  check('cover: covering more than the position rejected', !!eOver && /No short position/i.test(eOver), eOver || 'no error');

  // 45s hold from open
  await setUser('cov_hold', { cash: 0,
    shorts: { [T]: { shares: 2, costBasis: 90, margin: 160, openedAt: Date.now() - 10000, system: 'v2' } } });
  const eHold = await err({ ticker: T, action: 'cover', amount: 1 }, 'cov_hold');
  check('cover: 45s hold period from open', !!eHold && /Hold period/i.test(eHold), eHold || 'no error');

  // Legacy (pre-v2) cover: pay cover cost, get margin back
  await seedMarket({ [T]: 80 });
  await setUser('cov_v1', { cash: 1000,
    shorts: { [T]: { shares: 5, costBasis: 90, margin: 225, openedAt: now - MIN, system: 'v1' } } });
  const expL = buyMath(80, 5);
  await ok({ ticker: T, action: 'cover', amount: 5 }, 'cov_v1');
  const uL = await getUser('cov_v1');
  check('cover: legacy path pays cost and returns margin', near(uL.cash, 1000 - expL.cost + 225),
    `${uL.cash} vs ${1000 - expL.cost + 225}`);
}

// ════════════════════════════════════════════════════════════════════════════
// F. MARGIN BUYS
// ════════════════════════════════════════════════════════════════════════════
async function testMarginBuy() {
  console.log('\nF. Margin buys');
  await seedMarket({ [T3]: 40 });

  // Tier 0.25 (peak < 7500): cash 100 → borrow base 100 → max borrowable 25.
  await setUser('mgn_user', { cash: 100, marginEnabled: true, peakPortfolioValue: 0 });
  const exp = buyMath(40, 3); // ~120.2 cost > 100 cash → needs ~20 margin
  const r = await ok({ ticker: T3, action: 'buy', amount: 3 }, 'mgn_user');
  const u = await getUser('mgn_user');
  const expMargin = exp.cost - 100;
  check('margin: shortfall funded from margin', near(u.marginUsed, expMargin, 1e-6), `${u.marginUsed} vs ${expMargin}`);
  check('margin: cash floors at 0', u.cash === 0, `${u.cash}`);
  const lock = u.marginLockup?.[T3];
  const expLockShares = Math.round((expMargin / exp.exec) * 100) / 100;
  check('margin: funded shares locked for 36h', lock && near(lock.shares, expLockShares) &&
    lock.until > Date.now() + MARGIN_SELL_LOCKUP_MS - 10000, JSON.stringify(lock));
  check('margin: buy succeeded with holdings credited', r.success && u.holdings[T3] === 3, JSON.stringify(u.holdings));

  // Beyond available margin → rejected
  await setUser('mgn_over', { cash: 100, marginEnabled: true, peakPortfolioValue: 0 });
  const eOver = await err({ ticker: T3, action: 'buy', amount: 4 }, 'mgn_over'); // ~160 > 100+25
  check('margin: blocked past borrowing power', !!eOver && /Insufficient funds \(including margin\)/i.test(eOver), eOver || 'no error');

  // Collateral valued at LOWER of cost basis or market (pump-proof)
  await seedMarket({ [T3]: 40, [T]: 400 });
  await setUser('mgn_pump', { cash: 0, marginEnabled: true, peakPortfolioValue: 0,
    holdings: { [T]: 10 }, costBasis: { [T]: 10 } });
  // collateral = min(10, 400) * 10 = 100 → max borrowable 25 → can't afford 40+ purchase
  const ePump = await err({ ticker: T3, action: 'buy', amount: 1 }, 'mgn_pump');
  check('margin: collateral uses lower of basis/market', !!ePump && /Insufficient funds/i.test(ePump), ePump || 'no error');

  // Without marginEnabled, no borrowing happens
  await seedMarket({ [T3]: 40 });
  await setUser('mgn_off', { cash: 100, marginEnabled: false });
  const eOff = await err({ ticker: T3, action: 'buy', amount: 3 }, 'mgn_off');
  check('margin: disabled users get plain insufficient-funds', !!eOff && /Insufficient funds\./i.test(eOff), eOff || 'no error');
}

// ════════════════════════════════════════════════════════════════════════════
// G. ETF & TRAILING EFFECTS
// ════════════════════════════════════════════════════════════════════════════
async function testEtfTrailing() {
  console.log('\nG. ETF & trailing effects');

  // Buy the ETF: constituents trail by coefficient × ETF % change
  await seedMarket({ [ETF]: 50, GOO: 85, LOGN: 30, SAM: 60 });
  await setUser('etf_user', { cash: 10000 });
  const exp = buyMath(50, 20, { spread: ETF_BID_ASK_SPREAD });
  const r = await ok({ ticker: ETF, action: 'buy', amount: 20 }, 'etf_user');
  const m = await getMarket();
  check('etf: uses the tighter ETF spread', near(r.executionPrice, exp.exec), `${r.executionPrice} vs ${exp.exec}`);
  const pct = (exp.newPrice - 50) / 50;
  const expCon = (p0) => Math.max(0.01, round2(p0 * (1 + pct * 0.16)));
  check('etf: constituents trail at their coefficient',
    near(m.prices.GOO, expCon(85)) && near(m.prices.LOGN, expCon(30)) && near(m.prices.SAM, expCon(60)),
    JSON.stringify({ GOO: m.prices.GOO, LOGN: m.prices.LOGN, SAM: m.prices.SAM,
      exp: [expCon(85), expCon(30), expCon(60)] }));
  check('etf: result includes all affected tickers', r.priceUpdates && ETF in r.priceUpdates &&
    'GOO' in r.priceUpdates && 'LOGN' in r.priceUpdates && 'SAM' in r.priceUpdates, JSON.stringify(r.priceUpdates));
  const uE = await getUser('etf_user');
  const trailGoo = uE.tickerTradeHistory?.GOO?.buy;
  check('etf: trailing impact logged as synthetic history (shares 0)',
    trailGoo?.length === 1 && trailGoo[0].shares === 0 && trailGoo[0].impact > 0, JSON.stringify(trailGoo));
  const hd = await getHistoryDoc();
  check('etf: price history written for trailing tickers too',
    (hd[ETF] || []).length === 1 && (hd.GOO || []).length === 1 && (hd.LOGN || []).length === 1,
    JSON.stringify(Object.keys(hd)));

  // Buy a constituent: the parent ETF moves via reverse propagation
  await seedMarket({ [ETF]: 50, GOO: 85 });
  await setUser('etf_rev', { cash: 10000 });
  const expG = buyMath(85, 10);
  await ok({ ticker: 'GOO', action: 'buy', amount: 10 }, 'etf_rev');
  const m2 = await getMarket();
  const gooPct = (expG.newPrice - 85) / 85;
  const expEtf = Math.max(0.01, round2(50 * (1 + gooPct * 0.16)));
  check('etf: stock buy propagates to parent ETF', near(m2.prices[ETF], expEtf),
    `${m2.prices[ETF]} vs ${expEtf}`);

  // Trailing impact counts against the constituent's own daily cap
  await seedMarket({ [ETF]: 50, GOO: 85 });
  await setUser('etf_cap', { cash: 100000,
    tickerTradeHistory: { GOO: { buy: [{ ts: Date.now() - 1000, shares: 0.01, impact: 0.0999 }] } } });
  const eTrailCap = await err({ ticker: 'GOO', action: 'buy', amount: 50 }, 'etf_cap');
  check('etf: trailing/daily impact cap still enforced per ticker',
    !!eTrailCap && /Daily trading limit/i.test(eTrailCap), eTrailCap || 'no error');
}

// ════════════════════════════════════════════════════════════════════════════
// H. THROTTLES & ANTI-MANIPULATION
// ════════════════════════════════════════════════════════════════════════════
async function testThrottles() {
  console.log('\nH. Throttles & anti-manipulation');
  await seedMarket({ [T]: 80, [T2]: 66 });
  const now = Date.now();

  // 3s global cooldown
  await setUser('thr_global', { cash: 10000, lastTradeTime: now - 1000 });
  const eG = await err({ ticker: T, action: 'buy', amount: 1 }, 'thr_global');
  check('3s global trade cooldown', !!eG && /Trade cooldown/i.test(eG), eG || 'no error');

  // 10s same-ticker cooldown (buy/short only) — sells exempt
  await setUser('thr_ticker', { cash: 10000, holdings: { [T]: 5 },
    lastTradeTime: now - 5000, lastTickerTradeTime: { [T]: now - 5000 } });
  const eT = await err({ ticker: T, action: 'buy', amount: 1 }, 'thr_ticker');
  check('10s same-ticker cooldown on buys', !!eT && /Same-stock cooldown/i.test(eT), eT || 'no error');
  const okSell = await ok({ ticker: T, action: 'sell', amount: 1 }, 'thr_ticker');
  check('same-ticker cooldown does NOT block sells', okSell.success === true, JSON.stringify(okSell));

  // Burst limit: 3 same-action trades per ticker per 5 min
  await setUser('thr_burst', { cash: 10000 });
  const batch = db.batch();
  for (let i = 0; i < 3; i++) {
    batch.set(db.collection('trades').doc(), {
      uid: 'thr_burst', ticker: T, action: 'buy',
      timestamp: admin.firestore.Timestamp.fromMillis(now - (i + 1) * 30000),
    });
  }
  await batch.commit();
  const eB = await err({ ticker: T, action: 'buy', amount: 1 }, 'thr_burst');
  check('burst limit: max 3 buys per ticker per 5 min', !!eB && /Slow down/i.test(eB), eB || 'no error');

  // Velocity limit: 15 trades per ticker per hour
  await setUser('thr_vel', { cash: 10000 });
  const batch2 = db.batch();
  for (let i = 0; i < 15; i++) {
    batch2.set(db.collection('trades').doc(), {
      uid: 'thr_vel', ticker: T2, action: 'buy',
      timestamp: admin.firestore.Timestamp.fromMillis(now - 10 * MIN - i * 1000),
    });
  }
  await batch2.commit();
  const eV = await err({ ticker: T2, action: 'buy', amount: 1 }, 'thr_vel');
  check('velocity limit: 15 trades per ticker per hour', !!eV && /velocity/i.test(eV), eV || 'no error');

  // Per-IP account cap: 3rd account buying from one IP within an hour is blocked
  const capIp = '198.18.0.1';
  const capIpDoc = capIp.replace(/[.:/]/g, '_');
  await db.collection('ipTracking').doc(capIpDoc).set({
    recentTraders: { ip_user_a: now - 5 * MIN, ip_user_b: now - 5 * MIN },
  });
  await setUser('ip_user_c', { cash: 10000, holdings: { [T]: 5 } });
  const eIp = await err({ ticker: T, action: 'buy', amount: 1 }, 'ip_user_c', capIp);
  check('per-IP cap: 3rd account cannot buy', !!eIp && /Too many accounts/i.test(eIp), eIp || 'no error');
  const okIpSell = await ok({ ticker: T, action: 'sell', amount: 1 }, 'ip_user_c', capIp);
  check('per-IP cap: sells still allowed (exit path)', okIpSell.success === true, JSON.stringify(okIpSell));

  // IP-shared daily impact: a sibling account's impact counts against yours
  const shIp = '198.18.0.2';
  await db.collection('ipTracking').doc(shIp.replace(/[.:/]/g, '_')).set({
    tickerTradeHistory: { [T2]: { buy: [{ ts: now - 1000, shares: 1, impact: 0.099 }] } },
    recentTraders: {},
  });
  await setUser('ip_shared', { cash: 10000 });
  const eShared = await err({ ticker: T2, action: 'buy', amount: 10 }, 'ip_shared', shIp);
  check('IP-shared daily impact cap', !!eShared && /Daily trading limit/i.test(eShared), eShared || 'no error');
}

// ════════════════════════════════════════════════════════════════════════════
// I. BOOKKEEPING & ACHIEVEMENTS
// ════════════════════════════════════════════════════════════════════════════
async function testAchievements() {
  console.log('\nI. Bookkeeping & achievements');
  const now = Date.now();

  // BULL_RUN (≥25% sell profit) + DIAMOND_HANDS (held through ≥30% dip, sold green)
  await seedMarket({ [T]: 80 });
  await setUser('ach_bull', { cash: 0, holdings: { [T]: 5 }, costBasis: { [T]: 10 },
    lowestWhileHolding: { [T]: 5 } });
  await ok({ ticker: T, action: 'sell', amount: 5 }, 'ach_bull');
  const uB = await getUser('ach_bull');
  check('BULL_RUN + DIAMOND_HANDS on dip-surviving profitable sell',
    (uB.achievements || []).includes('BULL_RUN') && (uB.achievements || []).includes('DIAMOND_HANDS'),
    JSON.stringify(uB.achievements));

  // DISCORD_LINKED: any trade by a linked account
  await setUser('ach_disc', { cash: 10000, discordId: '12345' });
  await ok({ ticker: T, action: 'buy', amount: 1 }, 'ach_disc');
  const uD = await getUser('ach_disc');
  check('DISCORD_LINKED awarded on first trade', (uD.achievements || []).includes('DISCORD_LINKED'),
    JSON.stringify(uD.achievements));

  // TOPPED_OFF: sold at/above the all-time high
  await seedMarket({ [T]: 80 });
  await db.collection('market').doc('priceHistory').set({
    [T]: [{ timestamp: now - DAY, price: 50 }, { timestamp: now - HOUR, price: 60 }],
  });
  await setUser('ach_top', { cash: 0, holdings: { [T]: 2 }, costBasis: { [T]: 40 } });
  await ok({ ticker: T, action: 'sell', amount: 2 }, 'ach_top');
  const uT = await getUser('ach_top');
  check('TOPPED_OFF on selling at all-time high', (uT.achievements || []).includes('TOPPED_OFF'),
    JSON.stringify(uT.achievements));

  // THATS_A_BIG_DEAL: bought a bullish stock within 3% of its 7-day low
  await seedMarket({ [T2]: 55 });
  await db.collection('market').doc('priceHistory').set({
    [T2]: [{ timestamp: now - 6 * DAY, price: 60 }, { timestamp: now - 25 * HOUR, price: 54 }],
  });
  await setUser('ach_deal', { cash: 10000 });
  await ok({ ticker: T2, action: 'buy', amount: 1 }, 'ach_deal');
  const uDeal = await getUser('ach_deal');
  check('THATS_A_BIG_DEAL on bullish weekly-low buy', (uDeal.achievements || []).includes('THATS_A_BIG_DEAL'),
    JSON.stringify(uDeal.achievements));

  // ANIMAL_INSTINCT: cumulative animal-character profit ≥ 250
  await seedMarket({ RYAN: 48 });
  await setUser('ach_zoo', { cash: 0, holdings: { RYAN: 10 }, costBasis: { RYAN: 10 } });
  await ok({ ticker: 'RYAN', action: 'sell', amount: 10 }, 'ach_zoo');
  const uZ = await getUser('ach_zoo');
  check('ANIMAL_INSTINCT + profitByTicker tracking',
    (uZ.achievements || []).includes('ANIMAL_INSTINCT') && (uZ.profitByTicker?.RYAN || 0) > 250,
    JSON.stringify({ ach: uZ.achievements, pbt: uZ.profitByTicker }));

  // UNIFIER revocation: selling below a full share strips badge AND pin
  await seedMarket({ [T]: 80 });
  await setUser('ach_uni', { cash: 0, holdings: { [T]: 1.5 }, costBasis: { [T]: 80 },
    achievements: ['UNIFIER'], displayedAchievementPins: ['UNIFIER'] });
  await ok({ ticker: T, action: 'sell', amount: 1 }, 'ach_uni');
  const uU = await getUser('ach_uni');
  check('UNIFIER revoked (badge + displayed pin) on partial-share sell',
    !(uU.achievements || []).includes('UNIFIER') && !(uU.displayedAchievementPins || []).includes('UNIFIER'),
    JSON.stringify({ ach: uU.achievements, pins: uU.displayedAchievementPins }));

  // Crew mission flags: crew-member buy vs rival buy
  await seedMarket({ GOO: 85, JAKE: 65 });
  await setUser('ach_crew', { cash: 10000, crew: 'SECRET_FRIENDS' });
  await ok({ ticker: 'GOO', action: 'buy', amount: 2 }, 'ach_crew');
  let uC = await getUser('ach_crew');
  let dC = uC.dailyMissions?.[todayDate()];
  check('crew buy sets boughtCrewMember + crewSharesBought', dC?.boughtCrewMember === true && dC?.crewSharesBought === 2,
    JSON.stringify(dC));
  await db.collection('users').doc('ach_crew').update({
    lastTradeTime: admin.firestore.FieldValue.delete(),
    lastTickerTradeTime: admin.firestore.FieldValue.delete(),
  });
  await ok({ ticker: 'JAKE', action: 'buy', amount: 1 }, 'ach_crew');
  uC = await getUser('ach_crew');
  dC = uC.dailyMissions?.[todayDate()];
  check('rival-crew buy sets boughtRival', dC?.boughtRival === true, JSON.stringify(dC));

  // Underdog buy (< $20)
  await seedMarket({ [UND]: 12 });
  await setUser('ach_und', { cash: 1000 });
  await ok({ ticker: UND, action: 'buy', amount: 1 }, 'ach_und');
  const uUnd = await getUser('ach_und');
  check('underdog buy flag (< $20)', uUnd.dailyMissions?.[todayDate()]?.boughtUnderdog === true,
    JSON.stringify(uUnd.dailyMissions?.[todayDate()]));
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  if (isWeeklyTradingHalt()) {
    console.error('Cannot run: the weekly trading halt (Thursday 13:00–21:00 UTC) is active right now.');
    console.error('executeTrade rejects everything during the halt. Re-run outside that window.');
    process.exit(2);
  }

  await testValidation();
  await testBuy();
  await testSell();
  await testShort();
  await testCover();
  await testMarginBuy();
  await testEtfTrailing();
  await testThrottles();
  await testAchievements();

  console.log(`\n${checks} checks run.`);
  console.log(failures === 0 ? 'ALL TRADING CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
