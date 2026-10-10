# Adding characters

## 1. Edit the source

`src/characters.ts` and `src/crews.ts` are the only files you edit. Their copies
in `functions/src/shared/` are generated.

- Add the character to `src/characters.ts`, and to its crew's `members` in
  `src/crews.ts`.
- **ETF weights:** an ETF's `trailingFactors` add up to about 0.8, so each
  member gets about `0.8 / N`. When a roster changes, re-weight **every**
  constituent, not only the new one. Leave the ETF's `basePrice` alone: it is a
  historical anchor.
- **IPO characters** get `ipoRequired: true`. They are blocked from every order
  path until launched from the admin IPO panel, but they still go in their crew
  and ETF before launch. Once launched, remove the flag, or the admin panel keeps
  offering them for another IPO.

## 2. Check and sync

```bash
npm run check:data   # ETF weights, crew rosters, ticker references
npm run sync:chars   # regenerate the functions/ copies
npm test
npm run build
```

Commit the source and generated files together. Skipping the sync is how players
got "Invalid ticker" errors and invisible crew members in June 2026.

## 3. Deploy

Push, then deploy the functions that validate tickers, iterate the roster or read
crew membership (see [deploy.md](deploy.md)):

```bash
node scripts/deploy-functions.cjs --only executeTrade,createPreMarketOrder,cancelPreMarketOrder,createLimitOrder,checkLimitOrders,processMarketOpenOrders,triggerMarketOpenOrders,buyIPOShares,processIPOPriceJumps,marketMakerCycle,initNewCharacterPrices,dailyMarketSummary,claimMissionReward,claimCrewMission,botTrader
```

Functions that only multiply prices by holdings (leaderboard, dividends, margin,
portfolio value) pick up new characters through the data and need no deploy.

## 4. Seed prices

Admin panel -> IPO tab -> **Init Prices** (`initNewCharacterPrices`). It
writes `basePrice` into the live price map for every non-IPO, non-ETF character
missing one, and skips the rest, so it is safe to click twice.

This is not optional. A character with no entry in the price map still shows and
trades (the first trade creates the entry), but every automated system iterates
the price map: no bot trades it, the market maker skips it, the daily summary
leaves it out, its chart is blank, and its holders get $0 dividends.

## Adding during the Thursday halt

Non-IPO characters added during the halt can take pre-market orders as soon as
the functions are deployed: every price read falls back to `basePrice`. The
deploy is still required, because ticker validation rejects unknown tickers.

## Check

`npm run status:market` shows the live price and launch state of each ticker.
