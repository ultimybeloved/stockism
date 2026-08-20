import { CHARACTER_MAP } from '../../characters';
import { MIN_PRICE, TRAILING_MAX_DEPTH } from '../../constants';

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
// src/characters.js. Going level by level makes every direct link fire at full
// strength before an indirect one can claim the stock.
//
// A stock is only moved once per adjustment, at the shortest distance from the
// stock that was adjusted. That is what stops the mutual links (GAP, JIN and
// SHNG all point at each other) from looping forever.
export const buildTrailingCascade = ({ ticker, oldPrice, newPrice, prices }) => {
  const moves = [];
  const settled = new Set([ticker]);
  const current = { ...prices };
  let frontier = [{ ticker, oldPrice, newPrice }];

  for (let depth = 0; depth < TRAILING_MAX_DEPTH && frontier.length > 0; depth++) {
    // Total up the whole level's pushes before applying any of them, so two
    // stocks the same distance away both count instead of the first one winning
    // and shutting the other out.
    const pushes = new Map();
    for (const node of frontier) {
      const character = CHARACTER_MAP[node.ticker];
      if (!character?.trailingFactors) continue;
      const changePercent = (node.newPrice - node.oldPrice) / (node.oldPrice || 1);
      for (const { ticker: linked, coefficient } of character.trailingFactors) {
        if (settled.has(linked)) continue;
        pushes.set(linked, (pushes.get(linked) || 0) + changePercent * coefficient);
      }
    }

    const nextFrontier = [];
    for (const [linked, change] of pushes) {
      const from = current[linked];
      if (from == null) continue;
      const to = Math.max(MIN_PRICE, Math.round(from * (1 + change) * 100) / 100);
      if (to === from) { settled.add(linked); continue; }
      current[linked] = to;
      moves.push({ ticker: linked, from, to });
      settled.add(linked);
      nextFrontier.push({ ticker: linked, oldPrice: from, newPrice: to });
    }
    frontier = nextFrontier;
  }

  return moves;
};
