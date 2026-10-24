// Starting prices for characters that are in the roster but not yet in the live
// price map. Every automated mover (bots, market maker, daily summary) iterates
// the price map, so an unseeded character sits frozen until someone trades it.
// Run every hour by marketMakerCycle (halts included) and on demand by the admin Init Prices
// button (initNewCharacterPrices). INTERNAL MODULE: exports no Cloud Functions.
import * as admin from 'firebase-admin';
import { CHARACTERS } from '../shared/characters';
import { appendPriceHistory } from '../shared/marketData';
import type { Character } from '../shared/characters';
import type { PricePoint } from '../shared/types';

const db = admin.firestore();

export interface SeedPlan {
  seeds: { ticker: string; price: number }[];
  /** Priced tickers no longer in the roster: a rename not yet migrated. */
  orphans: string[];
}

/**
 * Which characters need a starting price. IPO characters get theirs at launch
 * and ETFs are left to the admin, as before.
 *
 * A priced ticker missing from the roster means a ticker rename has been
 * deployed but not migrated. Its new ticker shows as unpriced, and seeding it
 * at base price would make a second stock and block the migration. The
 * automatic run waits in that case; the admin button can still go ahead.
 */
export const planSeeds = (roster: Character[], prices: Record<string, unknown>): SeedPlan => ({
  seeds: roster
    .filter((c) => !c.ipoRequired && !c.isETF && !prices[c.ticker])
    .map((c) => ({ ticker: c.ticker, price: c.basePrice })),
  orphans: Object.keys(prices).filter((t) => !roster.some((c) => c.ticker === t)),
});

/**
 * Writes the starting prices and returns what was seeded, plus any orphans.
 * In a transaction, so a first trade landing at the same moment keeps its price
 * instead of being reset to base.
 */
export const seedMissingPrices = async ({ waitOnOrphans }: { waitOnOrphans: boolean }) => {
  const marketRef = db.collection('market').doc('current');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(marketRef);
    if (!snap.exists) return null;
    const plan = planSeeds(CHARACTERS, snap.data()!.prices || {});
    if (plan.seeds.length === 0 || (waitOnOrphans && plan.orphans.length > 0)) {
      return { initialized: [], orphans: plan.orphans, waiting: plan.seeds.length > 0 };
    }
    const now = Date.now();
    const updates: Record<string, number> = {};
    // Tagged so a seeded starting price is never mistaken for a trade.
    const points: Record<string, PricePoint> = {};
    for (const { ticker, price } of plan.seeds) {
      updates[`prices.${ticker}`] = price;
      points[ticker] = { timestamp: now, price, source: 'init' };
    }
    tx.update(marketRef, updates);
    appendPriceHistory(tx, points);
    return { initialized: plan.seeds, orphans: plan.orphans, waiting: false };
  });
};
