// GENERATED from src/rules/auctions.ts by `npm run sync:chars`. Do not edit.
// One-of-a-kind auctions: one cosmetic, one winner, the money destroyed.
// Shared rule module (see src/rules/ladder.ts): the server takes bids by these
// rules and the auction page shows the same minimum and countdown.
//
// The top bid is held from the bidder's cash and handed back the moment
// someone outbids them. A bid in the last minutes pushes the end back, so the
// highest real offer wins rather than the last-second one. Bidders show as a
// number, new for every auction; the winner is named when it ends.

/** Each bid must beat the top bid by this much. */
export const AUCTION_MIN_RAISE = 0.05;
/** A bid this close to the end... */
export const AUCTION_EXTEND_WINDOW_MS = 5 * 60 * 1000;
/** ...moves the end to this long after the bid. */
export const AUCTION_EXTEND_MS = 5 * 60 * 1000;
/** Bidder numbers are drawn from 1 to this. */
export const AUCTION_MAX_BIDDER_NUMBER = 999;
/** How many recent bids the public auction doc keeps. */
export const AUCTION_BIDS_SHOWN = 50;

export interface AuctionBid {
  /** The bidder's number in this auction. */
  n: number;
  amount: number;
  at: number;
}

/** auctions/{id}: public. Who holds which number lives in a private doc. */
export interface Auction {
  id: string;
  /** The cosmetic being sold (an `earned`, one-of-one catalog item). */
  itemId: string;
  startsAt: number;
  endsAt: number;
  startingBid: number;
  topBid: number | null;
  topBidder: number | null;
  bidCount: number;
  bids: AuctionBid[];
  status: 'live' | 'ended' | 'cancelled';
  /** Set when it ends with a winner. */
  winnerName?: string | null;
}

/** Whole dollars, rounded up: the smallest bid the auction will take now. */
export const minimumBid = (a: Pick<Auction, 'topBid' | 'startingBid'>) =>
  a.topBid ? Math.ceil(a.topBid * (1 + AUCTION_MIN_RAISE)) : Math.ceil(a.startingBid);

export const isOpen = (a: Pick<Auction, 'status' | 'startsAt' | 'endsAt'>, now: number) =>
  a.status === 'live' && now >= a.startsAt && now < a.endsAt;

/** The end after a bid at `now`: pushed back if the bid came in the last minutes. */
export const endAfterBid = (endsAt: number, now: number) =>
  endsAt - now < AUCTION_EXTEND_WINDOW_MS ? Math.max(endsAt, now + AUCTION_EXTEND_MS) : endsAt;

/** Why a bid can't be taken, or null if it can. `held` is what this bidder already has on the top bid. */
export function bidProblem(
  a: Pick<Auction, 'status' | 'startsAt' | 'endsAt' | 'topBid' | 'startingBid'>,
  amount: number,
  cash: number,
  held: number,
  now: number,
): string | null {
  if (!isOpen(a, now)) return now < a.startsAt ? "This auction hasn't started yet." : 'This auction has ended.';
  if (!Number.isFinite(amount) || amount !== Math.floor(amount) || amount <= 0) return 'Bid in whole dollars.';
  if (amount < minimumBid(a)) return `The lowest bid now is $${minimumBid(a).toLocaleString('en-US')}.`;
  if (amount - held > cash) return "You don't have that much cash.";
  return null;
}

/** A random number for a new bidder, avoiding the ones taken. */
export function pickBidderNumber(taken: number[], random: () => number = Math.random): number {
  const used = new Set(taken);
  if (used.size >= AUCTION_MAX_BIDDER_NUMBER) return AUCTION_MAX_BIDDER_NUMBER + used.size + 1;
  for (;;) {
    const n = 1 + Math.floor(random() * AUCTION_MAX_BIDDER_NUMBER);
    if (!used.has(n)) return n;
  }
}
