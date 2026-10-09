// What a split means for each document: pure helpers, no Firestore handles, so
// they test without an emulator. Split out of stockSplit.ts, which re-exports
// them. INTERNAL MODULE: exports no Cloud Functions.
import type { DocumentData } from 'firebase-admin/firestore';

export type Updates = Record<string, unknown>;

// ============================================
// PURE HELPERS
// ============================================
// No Firestore handles. Everything that decides what a split means is here so
// it can be tested without an emulator.

/** A price after the split. Four decimals: cents would shave value off big holdings. */
export const splitPrice = <T>(p: T, n: number): T | number =>
  typeof p === 'number' ? Math.round((p / n) * 1e4) / 1e4 : p;
/** A share count after the split. */
export const splitShares = <T>(s: T, n: number): T | number =>
  typeof s === 'number' ? Math.round(s * n * 1e6) / 1e6 : s;

/** A list of { price } points (chart history, review detail). */
export const splitPoints = (arr: unknown, n: number) =>
  Array.isArray(arr)
    ? arr.map((pt: DocumentData | null) =>
        pt && typeof pt.price === 'number' ? { ...pt, price: splitPrice(pt.price, n) } : pt,
      )
    : arr;

/** { buy: [{ts, shares, impact}], sell: [...], ... }: shares x N, impact unchanged. */
export const splitTradeHistory = (byAction: unknown, n: number) => {
  if (!byAction || typeof byAction !== 'object') return byAction;
  const out: Updates = {};
  for (const [action, list] of Object.entries(byAction)) {
    out[action] = Array.isArray(list)
      ? list.map((e: DocumentData | null) =>
          e && typeof e.shares === 'number' ? { ...e, shares: splitShares(e.shares, n) } : e,
        )
      : list;
  }
  return out;
};

/**
 * Everything one player document needs changed. {} if they hold nothing in the
 * stock or this split has already been applied to them.
 */
export const buildUserSplitUpdates = (
  u: DocumentData | null | undefined,
  ticker: string,
  n: number,
  splitId: string,
): Updates => {
  if (!u || u.splitsApplied?.[splitId]) return {};
  const t = ticker;
  const up: Updates = {};
  const has = (map: string) => u[map] && u[map][t] !== undefined && u[map][t] !== null;

  if (has('holdings')) up[`holdings.${t}`] = splitShares(u.holdings[t], n);
  if (has('costBasis')) up[`costBasis.${t}`] = splitPrice(u.costBasis[t], n);
  if (has('lowestWhileHolding')) up[`lowestWhileHolding.${t}`] = splitPrice(u.lowestWhileHolding[t], n);
  if (has('ipoPurchases')) up[`ipoPurchases.${t}`] = splitShares(u.ipoPurchases[t], n);
  if (has('holdingCohorts')) {
    const c = u.holdingCohorts[t];
    up[`holdingCohorts.${t}`] = {
      ...c,
      eligible: splitShares(c.eligible || 0, n),
      pending: (c.pending || []).map((lot: DocumentData) => ({ ...lot, shares: splitShares(lot.shares, n) })),
    };
  }
  if (has('shorts')) {
    const s = u.shorts[t];
    up[`shorts.${t}`] = {
      ...s,
      shares: splitShares(s.shares, n),
      ...(s.costBasis !== undefined ? { costBasis: splitPrice(s.costBasis, n) } : {}),
      ...(s.entryPrice !== undefined ? { entryPrice: splitPrice(s.entryPrice, n) } : {}),
    };
  }
  for (const lock of ['ipoLockup', 'marginLockup']) {
    if (has(lock) && typeof u[lock][t].shares === 'number') {
      up[`${lock}.${t}`] = { ...u[lock][t], shares: splitShares(u[lock][t].shares, n) };
    }
  }
  if (has('tickerTradeHistory')) up[`tickerTradeHistory.${t}`] = splitTradeHistory(u.tickerTradeHistory[t], n);

  if (!Object.keys(up).length) return {};
  up[`splitsApplied.${splitId}`] = true;
  return up;
};

/** market/current. Prices and records down; IPO share volumes up. */
export const buildMarketSplitUpdates = (m: DocumentData | null | undefined, ticker: string, n: number) => {
  const up: Updates = {};
  for (const map of ['prices', 'ath', 'atl']) {
    if (typeof m?.[map]?.[ticker] === 'number') up[`${map}.${ticker}`] = splitPrice(m![map][ticker], n);
  }
  if (typeof m?.volumes?.[ticker] === 'number') up[`volumes.${ticker}`] = splitShares(m!.volumes[ticker], n);
  return up;
};

/** One limit order, open or finished. */
export const buildOrderSplitUpdates = (o: DocumentData | null | undefined, n: number, splitId: string) => {
  if (!o || o.splitsApplied?.[splitId]) return {};
  const up: Updates = { [`splitsApplied.${splitId}`]: true };
  for (const f of ['shares', 'filledShares']) if (typeof o[f] === 'number') up[f] = splitShares(o[f], n);
  for (const f of ['limitPrice', 'executedPrice', 'stopPrice'])
    if (typeof o[f] === 'number') up[f] = splitPrice(o[f], n);
  return up;
};

/** One trade record. The dollar total is the same either way. */
export const buildTradeSplitUpdates = (t: DocumentData | null | undefined, n: number, splitId: string) => {
  if (!t || t.splitsApplied?.[splitId]) return {};
  const up: Updates = { [`splitsApplied.${splitId}`]: true };
  for (const f of ['amount', 'shares']) if (typeof t[f] === 'number') up[f] = splitShares(t[f], n);
  for (const f of ['price', 'marketPrice', 'executionPrice']) if (typeof t[f] === 'number') up[f] = splitPrice(t[f], n);
  return up;
};
