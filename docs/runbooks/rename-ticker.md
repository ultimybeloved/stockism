# Renaming a Ticker

`renameTicker` (Admin -> Recovery -> Rename Ticker) rewrites a ticker everywhere
the game computes on it. The engine is `functions/src/market/tickerRename.ts`, an
internal module not listed in its domain's `services.js`.

**Order is enforced. Source edit and deploy come first, migration second.**
Running the migration first makes `initNewCharacterPrices` see the old ticker
still in the roster with no price and re-seed it at base price, creating a
duplicate stock at the wrong price.

1. Edit `src/characters.ts` (the `ticker`, plus **every** ETF `constituents` and
   `trailingFactors` reference) and `src/crews.ts` `members`.
2. `npm run check:data` then `npm run sync:chars`
3. `npm test` and `npm run build`
4. **HALT THE MARKET** by hand (Admin -> Market) before pushing. See "Why you
   halt first" below — this is not optional and the tool cannot do it for you.
5. Commit source and generated together, push, then deploy the character-add
   function set **plus `renameTicker`** (see [add-characters.md](add-characters.md) for
   the list — a rename changes the roster, so the same functions need it).
6. Admin -> Recovery -> Rename Ticker -> **Dry Run**. Read all nine preflight
   rows and the "left as history" list. A dry run writes nothing at all, so it
   is free to repeat.
7. **Execute.** If it pauses on the time budget, click Resume until it
   completes. If it fails, fix the cause and Resume.
   **Never un-halt the market by hand while a rename is incomplete.**
8. Verify: `npm run status:market`. The priced-ticker count must not have grown
   (a duplicate stock would show as +1); confirm the index divisor did not
   change; open the old ticker's URL and confirm it redirects; check the stock's
   chart still has its history.
9. **Un-halt the market yourself.** Because you halted it in step 4, the tool
   records that it was already halted and deliberately leaves it that way rather
   than reopening something you closed.

## Why you halt first

The tool halts the market for the migration itself, but that is not the exposed
window. Between the functions deploy (step 5) and clicking Execute (step 7), the
backend knows the NEW ticker and has no price for it, while the old price still
sits under the old name. `executeTrade` auto-creates a missing price from
`basePrice` on first trade, so a single trade in that gap mints a second stock at
the wrong price. Preflight catches it and refuses, but then you have two price
entries to unpick by hand.

## Deploy the index ahead of time

The `priceAlerts` collection-group query needs a `COLLECTION_GROUP_ASC` index on
`ticker`. It is in `firestore.indexes.json` now, but if a future phase adds
another collection-group query, the emulator will NOT warn you — it answers those
without an index. Run `firebase deploy --only firestore:indexes` a few minutes
BEFORE the rename and let it finish building. A missing or still-building index
fails the dry run with `FAILED_PRECONDITION`, which costs nothing but wastes a
halt window. The error text distinguishes the two cases: "You can create it here"
means it does not exist, "That index is not ready yet" means wait.

**What is rewritten vs aliased.** Anything the game computes on is rewritten
(prices, history, holdings, `holdingCohorts`, `drip`, open orders, alerts, index
constituents, dividend config). Anything that is only a historical record a human
reads keeps the old name and resolves through `market/current.tickerAliases`:
bell notifications, feed entries past their 7-day TTL, and backups in Cloud
Storage. `restoreBackup` remaps keys through that alias, which is what stops a
pre-rename backup resurrecting a retired ticker.

**Tests:** `npm run test:rename` (emulator, end to end) and the unit tests in
`functions/src/market/tickerRename.test.js`. Run both before and after touching the engine.
