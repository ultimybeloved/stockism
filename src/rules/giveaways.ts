// Discord giveaways run by the Stockism bot. Shared rule module (see
// src/rules/ladder.ts): the admin panel builds and previews giveaways with
// these, and the server checks and draws them with the same code.
//
// A giveaway has prize tiers, drawn in order (the biggest first). Each tier
// pays every one of its winners the same prize, and nobody wins twice: a
// winner leaves the pool before the next tier is drawn. Entry needs a Discord
// linked to a Stockism account in good standing; one Discord links one
// account forever, so one person gets one entry.

export type GiveawayPrize =
  { kind: 'credit'; amount: number } | { kind: 'cash'; amount: number } | { kind: 'cosmetic'; cosmeticId: string };

export interface GiveawayTier {
  prize: GiveawayPrize;
  winners: number;
}

export const GIVEAWAY_MAX_TIERS = 10;
export const GIVEAWAY_MAX_WINNERS = 100;
export const GIVEAWAY_MAX_AMOUNT = 10_000_000;
export const GIVEAWAY_TITLE_MAX = 100;
export const GIVEAWAY_TEXT_MAX = 1500;
// Shortest and longest a giveaway may run.
export const GIVEAWAY_MIN_MS = 10 * 60 * 1000;
export const GIVEAWAY_MAX_MS = 30 * 24 * 60 * 60 * 1000;

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** A prize in words, e.g. "$50,000 shop credit". `nameOf` names a cosmetic. */
export const prizeLabel = (prize: GiveawayPrize, nameOf: (id: string) => string | undefined = () => undefined) =>
  prize.kind === 'credit'
    ? `${money(prize.amount)} shop credit`
    : prize.kind === 'cash'
      ? `${money(prize.amount)} cash`
      : nameOf(prize.cosmeticId) || prize.cosmeticId;

/** Total winners across every tier. */
export const totalWinners = (tiers: readonly GiveawayTier[]) => tiers.reduce((s, t) => s + t.winners, 0);

/**
 * Checks a list of tiers. Returns the problem in words, or null when fine.
 * `isCosmetic` says whether an id is a real shop cosmetic.
 */
export function tierProblem(tiers: unknown, isCosmetic: (id: string) => boolean): string | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return 'Add at least one prize.';
  if (tiers.length > GIVEAWAY_MAX_TIERS) return `At most ${GIVEAWAY_MAX_TIERS} prizes.`;
  for (const [i, t] of (tiers as GiveawayTier[]).entries()) {
    const n = `Prize ${i + 1}`;
    if (!t || !Number.isInteger(t.winners) || t.winners < 1) return `${n}: winners must be a whole number, 1 or more.`;
    const p = t.prize;
    if (!p || !['credit', 'cash', 'cosmetic'].includes(p.kind)) return `${n}: pick shop credit, cash, or a cosmetic.`;
    if (p.kind === 'cosmetic') {
      if (!isCosmetic(p.cosmeticId)) return `${n}: that cosmetic doesn't exist.`;
    } else if (!Number.isInteger(p.amount) || p.amount < 1 || p.amount > GIVEAWAY_MAX_AMOUNT) {
      return `${n}: the amount must be a whole number from $1 to ${money(GIVEAWAY_MAX_AMOUNT)}.`;
    }
  }
  if (totalWinners(tiers as GiveawayTier[]) > GIVEAWAY_MAX_WINNERS) return `At most ${GIVEAWAY_MAX_WINNERS} winners.`;
  return null;
}

/**
 * Draws the winners: tier by tier in order, each from whoever has not won yet.
 * A tier with more winners than people left just gets everyone left. `random`
 * returns [0, 1); the server passes a crypto source. Pure.
 */
export function drawWinners<T>(
  pool: readonly T[],
  tiers: readonly GiveawayTier[],
  random: () => number,
): { tier: number; entrant: T }[] {
  const left = [...pool];
  const out: { tier: number; entrant: T }[] = [];
  tiers.forEach((t, tier) => {
    for (let k = 0; k < t.winners && left.length; k++) {
      const i = Math.floor(random() * left.length);
      out.push({ tier, entrant: left.splice(i, 1)[0]! });
    }
  });
  return out;
}
