# Splitting a Stock

`splitStock` (Admin -> Recovery -> Split Stock) splits one stock N-for-1: price
/ N, every holder's shares x N, nobody's money changes. The engine is
`functions/src/market/stockSplit.ts`, an internal module (not in
`services.js`; the per-document maths is in `stockSplitMath.ts`). It rescales prices, chart history, daily closes, ATH/ATL,
the pre-halt snapshot, review data, the index constituent's base, holdings,
dividend lots, shorts, lockups, open limit orders, price alerts, trade records,
and player and IP trade-history share counts. Feed entries stay as history.

**Order is enforced, and the market is halted FIRST.**

1. **HALT THE MARKET** by hand (Admin -> Market). From the deploy in step 3
   until the split runs, the code already carries the new factor while the data
   still has the old price: the index would read the stock 10x too high and a
   trade would get 10x the liquidity. Preflight refuses unless halted.
2. Add `splitFactor: N` to the character in `src/characters.ts`. It is the
   TOTAL factor: a second 2-for-1 on a stock already at 10 means `20`. Leave
   `basePrice` alone — characters.ts divides it by the factor on load, and
   `liquidityFor` multiplies liquidity by it, so a dollar trade moves the stock
   the same percent as before.
3. `npm run sync:chars`, `npm test`, `npm run build`, push, then deploy
   functions. Preflight checks the DEPLOYED factor equals the recorded one
   (`market/splitHistory`) x N.
4. **Dry run**, then **Execute**. If it pauses, click Resume. Never press
   Execute over an unfinished run — the engine refuses, because a second run
   would split already-split records again (each record is marked with the
   split id so a resume never double-applies).
5. Check the stock and a holder or two, then **reopen the market yourself**.
   The tool never reopens it.

**Tests:** `npm run test:split` (emulator, end to end: value and index
unchanged, same percent move for the same dollar trade, pause/resume, never
twice) and `functions/src/market/stockSplit.test.js`.
