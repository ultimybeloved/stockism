'use strict';
// End-to-end test of limit-order processing (runLimitOrderCheck) against the
// LOCAL Firebase emulator. Never touches production (FIRESTORE_EMULATOR_HOST).
//
// Run via: npm run test:limitorders
// (or manually: npm run emulators + npm run seed:emulator + node scripts/test-limitorders-emulator.cjs)
//
// Scenarios covered:
//   1. Admin emergency halt skips the whole run
//   2. BUY fills at ask (price impact + spread), holdings/cash/market price updated
//   3. BUY whose ask-after-impact exceeds the limit is DEFERRED (stays PENDING)
//   4. SELL fills at bid, position cleared, cash credited
//   5. STOP_LOSS fills below its trigger (exempt from the bid>=limit rule)
//   6. Walled user's order (requiresDiscordLink, no discordId) is CANCELED
//   7. Bankrupt user's order is CANCELED
//   8. Order past expiresAt is EXPIRED
//   9. SHORT order type is CANCELED (unsupported)
//  10. Order on unlaunched IPO ticker is CANCELED
//  11. User at the 24h per-ticker trade cap is CANCELED with 'Trade limit reached'
//  12. Locked shares (IPO/margin hold placed AFTER order creation):
//      - no partial fills -> DEFERRED (stays PENDING, lock expires before order does)
//      - partial fills allowed -> clamped to the unlocked remainder
//  13. Per-ticker throttle: max 3 executions per ticker per cycle
//  14. No unexpected PENDING orders remain

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

// Use the SAME firebase-admin instance the functions code resolves
// (functions/node_modules), or its initializeApp won't be visible there.
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { runLimitOrderCheck } = require('../functions/services/limitOrders');
const { calculateMarginalImpact } = require('../functions/helpers');
const { BID_ASK_SPREAD, MAX_TRADES_PER_TICKER_24H } = require('../functions/constants');
const { CHARACTER_MAP } = require('../functions/characters');

const IPO_TICKER = 'EUNH'; // ipoRequired: true in characters.js, not launched in seed

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};
const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  const marketRef = db.collection('market').doc('current');
  const marketSnap = await marketRef.get();
  if (!marketSnap.exists) throw new Error('Market doc missing — run npm run seed:emulator first');
  const prices = marketSnap.data().prices || {};

  // Pick 6 distinct non-ETF, non-IPO tickers so each scenario's price math is isolated
  const usable = Object.keys(prices).filter(t => {
    const c = CHARACTER_MAP[t];
    return c && !c.isETF && !c.ipoRequired && prices[t] > 1;
  });
  if (usable.length < 6) throw new Error(`Only ${usable.length} usable tickers — re-seed the emulator`);
  const [T_BUY, T_SELL, T_STOP, T_DEFER, T_LIMITCAP, T_THROTTLE] = usable;
  const P = (t) => prices[t];
  console.log(`Tickers: buy=${T_BUY}($${P(T_BUY)}) sell=${T_SELL}($${P(T_SELL)}) stop=${T_STOP} defer=${T_DEFER} cap=${T_LIMITCAP} throttle=${T_THROTTLE}`);

  // ── Seed users ─────────────────────────────────────────────────────────
  const now = Date.now();
  const tenRecentBuys = Array.from({ length: MAX_TRADES_PER_TICKER_24H }, () => ({ ts: now - 60000, shares: 1, impact: 0.001 }));
  const users = {
    lo_buyer:      { cash: 100000, holdings: {} },
    lo_seller:     { cash: 0, holdings: { [T_SELL]: 30 } },
    lo_stopper:    { cash: 0, holdings: { [T_STOP]: 20 } },
    lo_deferrer:   { cash: 100000, holdings: {} },
    lo_walled:     { cash: 100000, holdings: {}, requiresDiscordLink: true },
    lo_bankrupt:   { cash: 5000, holdings: {}, isBankrupt: true },
    lo_expired:    { cash: 5000, holdings: {} },
    lo_shorter:    { cash: 5000, holdings: {} },
    lo_ipoBuyer:   { cash: 5000, holdings: {} },
    lo_capped:     { cash: 100000, holdings: {}, tickerTradeHistory: { [T_LIMITCAP]: { buy: tenRecentBuys } } },
    // 10 held, 6 locked by an "IPO lockup" that started after the order was placed
    lo_lockedHard: { cash: 0, holdings: { [T_SELL]: 10 }, ipoLockup: { [T_SELL]: { shares: 6, until: now + 3600000 } } },
    lo_lockedSoft: { cash: 0, holdings: { [T_STOP]: 10 }, marginLockup: { [T_STOP]: { shares: 6, until: now + 3600000 } } },
    lo_th1: { cash: 100000, holdings: {} },
    lo_th2: { cash: 100000, holdings: {} },
    lo_th3: { cash: 100000, holdings: {} },
    lo_th4: { cash: 100000, holdings: {} },
  };
  for (const [uid, data] of Object.entries(users)) {
    await db.collection('users').doc(uid).set({ displayName: uid, ...data });
  }

  // ── Seed limit orders ──────────────────────────────────────────────────
  // Generous limits so triggers/fills are deterministic; tight ones where the
  // scenario needs the fill to be rejected.
  const orders = [
    { id: 'lo_a_buy',    userId: 'lo_buyer',      ticker: T_BUY,      type: 'BUY',       shares: 10, limitPrice: round2(P(T_BUY) * 1.2) },
    { id: 'lo_b_sell',   userId: 'lo_seller',     ticker: T_SELL,     type: 'SELL',      shares: 30, limitPrice: round2(P(T_SELL) * 0.5) },
    { id: 'lo_c_stop',   userId: 'lo_stopper',    ticker: T_STOP,     type: 'STOP_LOSS', shares: 20, limitPrice: round2(P(T_STOP) * 1.1) }, // above current -> triggers now
    { id: 'lo_d_defer',  userId: 'lo_deferrer',   ticker: T_DEFER,    type: 'BUY',       shares: 50, limitPrice: P(T_DEFER) }, // triggers, but ask after impact+spread > limit
    { id: 'lo_e_wall',   userId: 'lo_walled',     ticker: T_BUY,      type: 'BUY',       shares: 1,  limitPrice: round2(P(T_BUY) * 1.2) },
    { id: 'lo_f_bank',   userId: 'lo_bankrupt',   ticker: T_BUY,      type: 'BUY',       shares: 1,  limitPrice: round2(P(T_BUY) * 1.2) },
    { id: 'lo_g_exp',    userId: 'lo_expired',    ticker: T_BUY,      type: 'BUY',       shares: 1,  limitPrice: round2(P(T_BUY) * 1.2), expiresAt: now - 1000 },
    { id: 'lo_h_short',  userId: 'lo_shorter',    ticker: T_BUY,      type: 'SHORT',     shares: 1,  limitPrice: round2(P(T_BUY) * 1.2) },
    { id: 'lo_i_ipo',    userId: 'lo_ipoBuyer',   ticker: IPO_TICKER, type: 'BUY',       shares: 1,  limitPrice: 10000 },
    { id: 'lo_j_cap',    userId: 'lo_capped',     ticker: T_LIMITCAP, type: 'BUY',       shares: 1,  limitPrice: round2(P(T_LIMITCAP) * 1.2) },
    { id: 'lo_k_lockH',  userId: 'lo_lockedHard', ticker: T_SELL,     type: 'SELL',      shares: 10, limitPrice: round2(P(T_SELL) * 0.5) },
    { id: 'lo_l_lockS',  userId: 'lo_lockedSoft', ticker: T_STOP,     type: 'SELL',      shares: 10, limitPrice: round2(P(T_STOP) * 0.5), allowPartialFills: true },
    { id: 'lo_m_th1',    userId: 'lo_th1',        ticker: T_THROTTLE, type: 'BUY',       shares: 2,  limitPrice: round2(P(T_THROTTLE) * 1.5) },
    { id: 'lo_n_th2',    userId: 'lo_th2',        ticker: T_THROTTLE, type: 'BUY',       shares: 2,  limitPrice: round2(P(T_THROTTLE) * 1.5) },
    { id: 'lo_o_th3',    userId: 'lo_th3',        ticker: T_THROTTLE, type: 'BUY',       shares: 2,  limitPrice: round2(P(T_THROTTLE) * 1.5) },
    { id: 'lo_p_th4',    userId: 'lo_th4',        ticker: T_THROTTLE, type: 'BUY',       shares: 2,  limitPrice: round2(P(T_THROTTLE) * 1.5) },
  ];
  for (const o of orders) {
    const { id, ...rest } = o;
    await db.collection('limitOrders').doc(id).set({
      allowPartialFills: false, ...rest,
      status: 'PENDING', filledShares: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  // ── 1. Emergency halt skips everything ─────────────────────────────────
  await marketRef.update({ marketHalted: true });
  const haltRun = await runLimitOrderCheck();
  check('emergency halt skips the run', haltRun.skipped === true && haltRun.reason === 'emergency_halt', JSON.stringify(haltRun));
  const stillPending = await db.collection('limitOrders').where('status', '==', 'PENDING').get();
  check('no orders touched during halt', stillPending.size === orders.length, `${stillPending.size}/${orders.length} pending`);
  await marketRef.update({ marketHalted: false });

  // ── Run the real pass ──────────────────────────────────────────────────
  console.log('\nRunning runLimitOrderCheck...\n');
  const summary = await runLimitOrderCheck();
  console.log('Summary:', JSON.stringify(summary), '\n');

  const get = async (id) => (await db.collection('limitOrders').doc(id).get()).data();
  const getUser = async (id) => (await db.collection('users').doc(id).get()).data();

  // ── 2. BUY fill math ───────────────────────────────────────────────────
  const impactBuy = calculateMarginalImpact(P(T_BUY), 10, 0);
  const newBuyPrice = round2(P(T_BUY) + impactBuy);
  const expectedAsk = round2(newBuyPrice * (1 + BID_ASK_SPREAD / 2));
  const a = await get('lo_a_buy');
  check(`BUY filled at ask ($${expectedAsk})`, a.status === 'FILLED' && Math.abs(a.executedPrice - expectedAsk) < 0.011, JSON.stringify(a));
  const buyer = await getUser('lo_buyer');
  check('BUY holdings=10 and cash deducted', buyer.holdings[T_BUY] === 10 && Math.abs(buyer.cash - (100000 - expectedAsk * 10)) < 0.25, `cash=${buyer.cash} holdings=${JSON.stringify(buyer.holdings)}`);
  const postMarket = (await marketRef.get()).data().prices;
  check(`market price moved up by impact ($${P(T_BUY)} -> $${newBuyPrice})`, Math.abs(postMarket[T_BUY] - newBuyPrice) < 0.011, `got ${postMarket[T_BUY]}`);

  // ── 3. Deferred BUY (ask exceeds limit) stays PENDING ──────────────────
  const d = await get('lo_d_defer');
  check('BUY deferred when ask exceeds limit (stays PENDING)', d.status === 'PENDING', JSON.stringify(d));

  // ── 4. SELL fill math ──────────────────────────────────────────────────
  const impactSell = calculateMarginalImpact(P(T_SELL), 30, 0);
  const newSellPrice = round2(Math.max(0.01, P(T_SELL) - impactSell));
  const expectedBid = round2(newSellPrice * (1 - BID_ASK_SPREAD / 2));
  const b = await get('lo_b_sell');
  check(`SELL filled at bid ($${expectedBid})`, b.status === 'FILLED' && Math.abs(b.executedPrice - expectedBid) < 0.011, JSON.stringify(b));
  const seller = await getUser('lo_seller');
  check('SELL position cleared and cash credited', !seller.holdings?.[T_SELL] && seller.cash > 0, `cash=${seller.cash}`);

  // ── 5. STOP_LOSS fills even below its limit ────────────────────────────
  const c = await get('lo_c_stop');
  check('STOP_LOSS filled (exempt from bid>=limit rule)', c.status === 'FILLED' && c.filledShares === 20, JSON.stringify(c));

  // ── 6-11. Cancellations ────────────────────────────────────────────────
  const e = await get('lo_e_wall');
  check('walled user order CANCELED', e.status === 'CANCELED' && /Discord/.test(e.cancelReason || ''), JSON.stringify(e));
  const f = await get('lo_f_bank');
  check('bankrupt user order CANCELED', f.status === 'CANCELED' && /bankrupt/i.test(f.cancelReason || ''), JSON.stringify(f));
  const g = await get('lo_g_exp');
  check('past-expiry order EXPIRED', g.status === 'EXPIRED', JSON.stringify(g));
  const h = await get('lo_h_short');
  check('SHORT order CANCELED (unsupported)', h.status === 'CANCELED' && /not supported/.test(h.cancelReason || ''), JSON.stringify(h));
  const i = await get('lo_i_ipo');
  check('unlaunched IPO ticker order CANCELED', i.status === 'CANCELED' && /IPO/.test(i.cancelReason || ''), JSON.stringify(i));
  const j = await get('lo_j_cap');
  check('24h trade-cap order CANCELED with Trade limit reached', j.status === 'CANCELED' && /Trade limit reached/.test(j.cancelReason || ''), JSON.stringify(j));

  // ── 12. Fill-time lock enforcement ─────────────────────────────────────
  const k = await get('lo_k_lockH');
  check('locked shares, no partials -> DEFERRED (stays PENDING)', k.status === 'PENDING', JSON.stringify(k));
  const lockedHardUser = await getUser('lo_lockedHard');
  check('locked-hard user still holds all 10 shares', lockedHardUser.holdings[T_SELL] === 10, JSON.stringify(lockedHardUser.holdings));
  const l = await get('lo_l_lockS');
  check('locked shares, partials allowed -> clamped to 4 unlocked', l.status === 'PARTIALLY_FILLED' && l.filledShares === 4, JSON.stringify(l));
  const lockedSoftUser = await getUser('lo_lockedSoft');
  check('locked-soft user keeps the 6 locked shares', lockedSoftUser.holdings[T_STOP] === 6, JSON.stringify(lockedSoftUser.holdings));

  // ── 13. Per-ticker throttle ────────────────────────────────────────────
  const th = await Promise.all(['lo_m_th1', 'lo_n_th2', 'lo_o_th3', 'lo_p_th4'].map(get));
  const thFilled = th.filter(o => o.status === 'FILLED').length;
  const thPending = th.filter(o => o.status === 'PENDING').length;
  check('per-ticker throttle: exactly 3 filled, 1 deferred', thFilled === 3 && thPending === 1, th.map(o => o.status).join(','));

  // ── 14. Only the intentional deferrals remain PENDING ──────────────────
  const leftover = await db.collection('limitOrders').where('status', 'in', ['PENDING', 'PARTIALLY_FILLED']).get();
  const leftoverIds = leftover.docs.map(x => x.id).sort();
  // Expected: lo_d_defer, lo_k_lockH, one throttled order. lo_l_lockS stays
  // PARTIALLY_FILLED (6 locked shares outstanding) by design.
  check('exactly the intentional deferrals remain live', leftover.size === 4, leftoverIds.join(','));

  console.log(failures === 0 ? '\nALL LIMIT-ORDER E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Test crashed:', err); process.exit(1); });
