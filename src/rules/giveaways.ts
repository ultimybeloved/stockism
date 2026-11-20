// Discord giveaways run by the Stockism bot. Shared rule module (see
// src/rules/ladder.ts): the admin panel builds and previews giveaways with
// these, and the server checks and draws them with the same code.
//
// A giveaway has prize tiers, drawn in order (the biggest first). Each tier
// pays every one of its winners the same prize. Tiers belong to a draw
// (1 by default): nobody wins twice in the same draw, since a winner leaves
// that draw's pool before its next tier, but separate draws pick
// independently, so one person can win a prize in each (e.g. credit in draw
// 1 and cash in draw 2). A tier can be closed to the leaderboard's top N, and
// an "everyone" tier pays every eligible entrant with no draw at all. Entry
// needs a Discord linked to a Stockism account in good standing; one Discord
// links one account forever, so one person gets one entry.

export type GiveawayPrize =
  | { kind: 'credit'; amount: number }
  | { kind: 'cash'; amount: number }
  | { kind: 'cosmetic'; cosmeticId: string }
  // One pin picked at random from a shop pin collection (src/crews.ts),
  // preferring one the winner doesn't own yet.
  | { kind: 'pin'; collection: string };

export interface GiveawayTier {
  prize: GiveawayPrize;
  /** How many win it. Ignored on an everyone tier. */
  winners: number;
  /** Every eligible entrant gets this prize; nothing is drawn. */
  everyone?: boolean;
  /** Which draw it belongs to (1 when absent). Nobody wins twice within one draw. */
  draw?: number;
  /** Players ranked this high or better on the leaderboard can't win it (10 = the top 10 are out). */
  skipTop?: number;
}

export const GIVEAWAY_MAX_TIERS = 10;
export const GIVEAWAY_MAX_DRAWS = 3;
export const GIVEAWAY_MAX_WINNERS = 100;
export const GIVEAWAY_MAX_AMOUNT = 10_000_000;
export const GIVEAWAY_TITLE_MAX = 100;
export const GIVEAWAY_TEXT_MAX = 1500;
// Shortest and longest a giveaway may run.
export const GIVEAWAY_MIN_MS = 10 * 60 * 1000;
export const GIVEAWAY_MAX_MS = 30 * 24 * 60 * 60 * 1000;

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * A prize in words, e.g. "$50,000 shop credit" or "a random Thanksgiving 2026
 * pin". `nameOf` names a cosmetic or a pin collection by id.
 */
export const prizeLabel = (prize: GiveawayPrize, nameOf: (id: string) => string | undefined = () => undefined) =>
  prize.kind === 'credit'
    ? `${money(prize.amount)} shop credit`
    : prize.kind === 'cash'
      ? `${money(prize.amount)} cash`
      : prize.kind === 'pin'
        ? `a random ${nameOf(prize.collection) || prize.collection} pin`
        : nameOf(prize.cosmeticId) || prize.cosmeticId;

/** Total drawn winners across every tier (everyone tiers aren't drawn, so they don't count). */
export const totalWinners = (tiers: readonly GiveawayTier[]) =>
  tiers.reduce((s, t) => s + (t.everyone ? 0 : t.winners), 0);

/** The draw a tier belongs to. */
export const drawOf = (t: GiveawayTier) => t.draw || 1;

/** Whether one person can win more than one prize: an everyone tier or more than one draw. */
export const winsCanStack = (tiers: readonly GiveawayTier[]) =>
  tiers.some((t) => t.everyone) || new Set(tiers.map(drawOf)).size > 1;

/**
 * Checks a list of tiers. Returns the problem in words, or null when fine.
 * `isCosmetic` says whether an id is a real shop cosmetic, `isPinCollection`
 * whether one is a real pin collection.
 */
export function tierProblem(
  tiers: unknown,
  isCosmetic: (id: string) => boolean,
  isPinCollection: (id: string) => boolean = () => false,
): string | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return 'Add at least one prize.';
  if (tiers.length > GIVEAWAY_MAX_TIERS) return `At most ${GIVEAWAY_MAX_TIERS} prizes.`;
  for (const [i, t] of (tiers as GiveawayTier[]).entries()) {
    const n = `Prize ${i + 1}`;
    if (!t) return `${n}: missing.`;
    if (t.everyone !== undefined && typeof t.everyone !== 'boolean') return `${n}: everyone must be on or off.`;
    if (!t.everyone && (!Number.isInteger(t.winners) || t.winners < 1))
      return `${n}: winners must be a whole number, 1 or more.`;
    if (t.draw !== undefined && (!Number.isInteger(t.draw) || t.draw < 1 || t.draw > GIVEAWAY_MAX_DRAWS))
      return `${n}: the draw must be 1 to ${GIVEAWAY_MAX_DRAWS}.`;
    if (t.skipTop !== undefined && (!Number.isInteger(t.skipTop) || t.skipTop < 0 || t.skipTop > 100))
      return `${n}: leaving out the top players takes a whole number from 0 to 100.`;
    const p = t.prize;
    if (!p || !['credit', 'cash', 'cosmetic', 'pin'].includes(p.kind))
      return `${n}: pick shop credit, cash, a cosmetic, or a random pin.`;
    if (p.kind === 'cosmetic') {
      if (!isCosmetic(p.cosmeticId)) return `${n}: that cosmetic doesn't exist.`;
    } else if (p.kind === 'pin') {
      if (!isPinCollection(p.collection)) return `${n}: that pin collection doesn't exist.`;
    } else if (!Number.isInteger(p.amount) || p.amount < 1 || p.amount > GIVEAWAY_MAX_AMOUNT) {
      return `${n}: the amount must be a whole number from $1 to ${money(GIVEAWAY_MAX_AMOUNT)}.`;
    }
  }
  if (totalWinners(tiers as GiveawayTier[]) > GIVEAWAY_MAX_WINNERS) return `At most ${GIVEAWAY_MAX_WINNERS} winners.`;
  return null;
}

/**
 * Draws the winners: tier by tier in order, each from whoever in that tier's
 * draw has not won yet (and is not in the leaderboard's top `skipTop`). A
 * tier with more winners than people left just gets everyone left. An
 * everyone tier pays the whole pool. `rankOf` gives an entrant's leaderboard
 * rank (null when unranked). `random` returns [0, 1); the server passes a
 * crypto source. Pure.
 */
export function drawWinners<T>(
  pool: readonly T[],
  tiers: readonly GiveawayTier[],
  random: () => number,
  rankOf: (entrant: T) => number | null = () => null,
): { tier: number; entrant: T }[] {
  const left = new Map<number, T[]>();
  const out: { tier: number; entrant: T }[] = [];
  tiers.forEach((t, tier) => {
    if (t.everyone) {
      for (const entrant of pool) out.push({ tier, entrant });
      return;
    }
    const draw = drawOf(t);
    if (!left.has(draw)) left.set(draw, [...pool]);
    const remaining = left.get(draw)!;
    const allowed = (e: T) => {
      const rank = rankOf(e);
      return !t.skipTop || rank == null || rank > t.skipTop;
    };
    for (let k = 0; k < t.winners; k++) {
      const candidates = remaining.filter(allowed);
      if (!candidates.length) break;
      const pick = candidates[Math.floor(random() * candidates.length)]!;
      remaining.splice(remaining.indexOf(pick), 1);
      out.push({ tier, entrant: pick });
    }
  });
  return out;
}
