import { CHARACTERS, CHARACTER_MAP } from '../../../characters';
import { MIN_PRICE, TRAILING_MAX_DEPTH } from '../../../constants';

// Work out how an admin price adjustment ripples through the linked stocks.
//
// Pure: it reads the current prices and reports the moves it would make. The
// caller writes them.
//
// Level by level, NOT depth-first. Depth-first let the order of the list decide
// the result: adjusting $JIN reached $GAP first, $GAP's own 0.4 link to $SHNG
// fired (0.4 x 0.4 = 0.16), $SHNG got marked as done, and $JIN's own 0.4 link to
// $SHNG was then skipped. On 2026-08-20 that moved $SHNG 0.48% where it should
// have moved 1.20%, purely because $GAP is typed before $SHNG in
// src/characters.ts. Going level by level makes every direct link fire at full
// strength before an indirect one can claim the stock.
//
// A stock is only moved once per adjustment, at the shortest distance from the
// stock that was adjusted. That is what stops the mutual links (GAP, JIN and
// SHNG all point at each other) from looping forever.
//
// Then every crew ETF follows its members, the same as after a trade
// (applyEtfPropagation in functions/src/trading/tradePricing.ts). Keep the two
// in step.
export interface PriceMove {
  ticker: string;
  from: number;
  to: number;
}

// stockTicker -> the ETFs holding it, with its weight in each.
const PARENT_ETFS: Record<string, { etf: string; coefficient: number }[]> = {};
for (const fund of CHARACTERS.filter((c) => c.isETF && c.trailingFactors)) {
  for (const { ticker, coefficient } of fund.trailingFactors!) {
    (PARENT_ETFS[ticker] ||= []).push({ etf: fund.ticker, coefficient });
  }
}

export const buildTrailingCascade = ({
  ticker,
  oldPrice,
  newPrice,
  prices,
}: {
  ticker: string;
  oldPrice: number;
  newPrice: number;
  prices: Record<string, number>;
}): PriceMove[] => {
  const moves: PriceMove[] = [];
  const settled = new Set([ticker]);
  const current = { ...prices };
  let frontier = [{ ticker, oldPrice, newPrice }];

  for (let depth = 0; depth < TRAILING_MAX_DEPTH && frontier.length > 0; depth++) {
    // Total up the whole level's pushes before applying any of them, so two
    // stocks the same distance away both count instead of the first one winning
    // and shutting the other out.
    const pushes = new Map<string, number>();
    for (const node of frontier) {
      const character = CHARACTER_MAP[node.ticker];
      if (!character?.trailingFactors) continue;
      const changePercent = (node.newPrice - node.oldPrice) / (node.oldPrice || 1);
      for (const { ticker: linked, coefficient } of character.trailingFactors) {
        if (settled.has(linked)) continue;
        pushes.set(linked, (pushes.get(linked) || 0) + changePercent * coefficient);
      }
    }

    const nextFrontier: typeof frontier = [];
    for (const [linked, change] of pushes) {
      const from = current[linked];
      if (from == null) continue;
      const to = Math.max(MIN_PRICE, Math.round(from * (1 + change) * 100) / 100);
      if (to === from) {
        settled.add(linked);
        continue;
      }
      current[linked] = to;
      moves.push({ ticker: linked, from, to });
      settled.add(linked);
      nextFrontier.push({ ticker: linked, oldPrice: from, newPrice: to });
    }
    frontier = nextFrontier;
  }

  // Total every member's move before writing a fund, so roster order can't leak
  // in. A moved fund is not fed back into the walk (no fund -> member -> fund
  // loop), and an adjusted fund isn't moved again by its own members.
  const memberMoves = [{ ticker, from: oldPrice, to: newPrice }, ...moves];
  const fundPushes = new Map<string, number>();
  for (const move of memberMoves) {
    if (CHARACTER_MAP[move.ticker]?.isETF || !(move.from > 0) || move.from === move.to) continue;
    const change = (move.to - move.from) / move.from;
    for (const { etf, coefficient } of PARENT_ETFS[move.ticker] || []) {
      if (etf === ticker) continue;
      fundPushes.set(etf, (fundPushes.get(etf) || 0) + change * coefficient);
    }
  }
  for (const [etf, change] of fundPushes) {
    const from = current[etf];
    if (from == null || from <= 0) continue;
    const to = Math.max(MIN_PRICE, Math.round(from * (1 + change) * 100) / 100);
    if (to === from) continue;
    const earlier = moves.find((m) => m.ticker === etf);
    if (earlier) earlier.to = to;
    else moves.push({ ticker: etf, from, to });
  }

  return moves;
};
