# Architecture

Where code lives and the rules that keep it that way. These rules exist because
this codebase was untangled from god files (a 3,900-line `App.jsx`, a
7,400-line `AdminPanel.jsx`, an 11,000-line `functions/index.js`) and duplicated
logic. Do not undo that work.

Everything is TypeScript (strict, `noUncheckedIndexedAccess`). The backend
plumbing (`functions/src/index.ts`, `serviceLoader.ts`, `servicePaths.ts`, each
domain's `services.ts`) and the backend `*.test.js` files are still JavaScript.

## Layout

```
src/
├── App.tsx                    Session, action hooks, theme/session contexts, page shell
├── characters.ts              Source of truth: characters, ETFs, rarity, dividends
├── crews.ts                   Source of truth: crews, missions, pins, penalties
├── firebase.ts                Firebase setup (auth, Firestore, emulator switch)
├── api/                       callables.ts (every backend call, typed) + types.ts
├── features/<feature>/        components/, hooks/, pages/, utils/ per feature:
│                              admin, ladder, trading, margin, market, portfolio,
│                              predictions, ipo, leaderboard, missions, crews,
│                              season, profile, account, notifications, about
├── shared/                    components/ (layout, charts, common) and hooks/
│                              used by several features
├── app/                       App shell: routes, modals, market data provider,
│                              background tasks, status screens, install prompt
├── context/AppContext.tsx     useTheme / useSession / useMarket contexts
├── rules/                     Game rules shared with the backend (source; sync:chars
│                              copies them to functions/src/shared/rules/)
├── utils/                     calculations, theme, formatters, errors, rarity,
│                              marketHours, cosmetics, username, profanity
└── constants/                 economy, achievements, cosmetics, seasons

functions/src/
├── index.ts                   Entry point only
├── servicePaths.ts            Joins every domain's services.ts into one list
├── serviceLoader.ts           Loads only the service owning the invoked function
├── shared/                    constants, helpers, fnConfig (instance cap, App Check),
│                              sentry, rules/, characters.ts + crews.ts (generated,
│                              never edit)
├── trading/                   executeTrade and its trade* internals
├── orders/                    Limit orders, pre-market queue, opening auction
├── margin/                    Margin actions and liquidation scanners
├── market/                    Prices, halts, weekly summary, dividends, alerts,
│                              market maker, bots, rename and split engines
├── season/                    Seasons, tiers, standings
├── users/                     Accounts, profiles, portfolio, leaderboard, signup checks
├── crews/                     Crew switching and crew missions
├── missions/                  Daily and weekly missions
├── predictions/               Weekly bets, event shares
├── ladder/                    Ladder game
├── discord/                   Login, slash commands, roles, daily drop
├── moderation/                Watchlist, alt detection, coordination scan and review
└── admin/                     Backups, ops, repair, migrations, health, billing

Each domain folder's services.ts lists the files there that declare Cloud
Functions; the rest are internal modules.
```

## Frontend conventions

- Callables are typed in `src/api/callables.ts` via `callable<Req, Res>('name')`,
  shapes in `src/api/types.ts`. Tests that mock a callable mock `api/callables`.
- Firestore doc shapes live in `src/types/index.ts`; add fields as code reads them.
- Props passed straight from a hook are typed `Pick<ReturnType<typeof useX>, ...>`.
- Action hooks take `ActionHookDeps` (`src/shared/hooks/types.ts`); admin hooks
  take `AdminHookDeps` (`src/features/admin/utils/adminShared.ts`).
- Tests typecheck under `tsconfig.test.json` (relaxes `noUncheckedIndexedAccess`).
- Errors from the backend go through `src/utils/errors.ts`.

## Backend conventions

- `npm run build:functions` compiles `functions/src/` to `functions/lib/`, which
  is what Firebase deploys and the emulator loads. Never edit `lib/` (gitignored).
- Emulator suites and backend vitest files load `functions/src/` directly through
  tsx, and so must any script that requires backend code
  (`npx tsx scripts/<name>.cjs`).
- Exports are `export const name = ...`; tsc emits `exports.name = ...`, which
  serviceLoader's scan finds. A test that reassigns a module export must swap the
  cached module instead (see `tests/emulator/dropHalt.test.js`): TS exports are
  read-only.
- Admin callables use `requireAdmin(context)` from `fnConfig`.
- Imports go to the topic module (`../shared/impact`), not the `helpers` barrel.
- Every import is `firebase-functions/v1` (functions stay 1st gen). Firestore
  statics come from `firebase-admin/firestore`
  (`import { FieldValue, Timestamp } from 'firebase-admin/firestore'`), never
  `admin.firestore.FieldValue`: the emulator drops those statics.
- Log through `firebase-functions/logger`, never `console`.
- Document shapes live in `functions/src/shared/types.ts`.
- Never rename a deployed Cloud Function: a rename deletes and recreates it.

## Rules

These rules exist because we spent significant effort cleaning up a codebase that had grown into god files and duplicated logic. Do not undo that work.

### File Size Hard Limits

| Location | Limit | Action if exceeded |
|---|---|---|
| Any frontend component (`src/features/*/components/`, `src/shared/components/`, `src/app/`) | 400 lines | Split into sub-components |
| Any page component (`src/features/*/pages/`) | 300 lines | Extract logic into a hook |
| Any hook (`src/features/*/hooks/`, `src/shared/hooks/`) | 200 lines | Split by concern |
| `src/App.tsx` | 500 lines | Stop and refactor before adding more |
| Any backend file (`functions/src/<domain>/`, not `shared/`) | 600 lines | Split by sub-domain |
| `functions/src/index.ts` | 15 lines | Entry point only. Deployable files are listed per domain in `functions/src/<domain>/services.ts` — never add logic here |

If a new feature would push a file past its limit, **split the file first, then add the feature.** ESLint enforces these limits (`max-lines` in `eslint.config.js`).

### Frontend: Where Code Lives

**Feature folders** (`src/features/<feature>/{components,hooks,pages,utils}`): admin, ladder, trading, margin, market (home + stock pages), portfolio, predictions, ipo, leaderboard, missions, crews, season, profile, account, notifications, about. Code used by several features lives in `src/shared/{components,hooks}`; the app shell (modal stack, status screens, install prompt) in `src/app/`. `src/utils`, `src/constants`, `src/context`, `src/types`, `src/api`, `src/rules` stay at the top level. A new file goes in the feature that owns it; it moves to `src/shared/` only once a second feature needs it.

**Components** (`src/features/<feature>/components/`)
- One component per file, named to match the file
- Sub-components used only by one parent live in a subfolder: `src/features/portfolio/components/HoldingRow.tsx`
- Never put business logic in a component — extract to a hook

**Hooks** (`src/features/<feature>/hooks/`)
- All stateful logic that doesn't belong in a component goes here
- One concern per hook: `useTradeLogic.ts`, `useModalManager.ts`, not `useEverything.ts`

**Utilities** (`src/utils/`)
- Pure functions only — no side effects, no Firebase, no React
- Calculation logic → `src/utils/calculations.ts` (already canonical — do not duplicate)
- Theme/dark mode class strings → `src/utils/theme.ts` (already canonical — do not duplicate)
- Dark mode is a `dark` class on `<html>`. Write both themes in one string: `light:bg-white dark:bg-zinc-900`, never `darkMode ? ... : ...` for classes. Use `light:` for the light value rather than a bare class, so it can't leak into dark mode. Only read `darkMode` from `useTheme()` for non-class values (chart colours, image paths, inline styles)
- Formatting → `src/utils/formatters.ts`

**Constants** (`src/constants/`)
- Named constants only — no magic numbers in components or hooks
- Economy rules → `src/constants/economy.ts`

**Context** (`src/context/AppContext.tsx`)
- Global state that 3+ components need: `darkMode`, `user`, `userData`, `prices`, `priceHistory`, `holdings`, `shorts`, `costBasis`, `marketData`, `showNotification`, `activeIPOs`
- Three contexts, so a price tick only re-renders what reads prices: `useTheme()` (`darkMode`), `useSession()` (`user`, `userData`, `holdings`, `shorts`, `costBasis`, `showNotification`, `getColorBlindColors`), `useMarket()` (`prices`, `priceHistory`, `marketData`, `activeIPOs`, `predictions`, and the other live market docs). Call only the ones a component reads.
- The market contexts come from `src/app/MarketDataProvider.tsx`, mounted above App in `main.tsx`. App reads no live market values, so a price tick does not re-render it or the page shell: its handlers read the market at click time through `useMarketAccess().getMarket`. Never call `useMarket()` in App.tsx; put the read in the component that shows it.
- **Never pass these as props.** Components call the hooks above.
- If you find yourself writing `darkMode={darkMode}` as a prop, stop — use context instead

### Backend: Where Code Lives

**Domain folders** (`functions/src/<domain>/`)
- Backend code is grouped by domain: `trading`, `orders`, `margin`, `market`, `season`, `admin`, `discord`, `moderation`, `ladder`, `predictions`, `users`, `crews`, `missions`. Code every domain uses lives in `functions/src/shared/` (constants, helpers, fnConfig, sentry, the generated characters/crews)
- Each domain's `services.ts` lists its files that declare Cloud Functions; `functions/src/servicePaths.ts` joins them. The Codebase Map below covers the service files and the internal modules
- Adding a new Cloud Function: find the right service file and append to it. A new file goes in its domain folder and that folder's `services.ts`. A new domain folder also goes in `DOMAINS` in `servicePaths.ts`
- Internal modules (tradeGuards, limitOrderMatching, missionChecks, crewMissionProgress, ...) are required directly by their owning service and must NOT be listed in a `services.ts`
- Backend vitest files sit beside the module they test (`functions/src/season/seasonTiers.test.ts`)
- They load backend code with `require('./x') as typeof import('./x')` (through `createRequire`), not `import`, so they share the module instance the code under test uses, and still get its types. They typecheck under `functions/tsconfig.test.json`
- Never add Cloud Function logic directly to `functions/src/index.ts`

**Shared constants** (`functions/src/shared/constants/`)
- All numeric economy values live here, one file per topic (`market`, `margin`, `economy`, `seasons`, `discord`, ...). `require('../shared/constants')` loads the folder's `index.js`, which gathers them all
- If you are writing a number like `0.005`, `10000`, `86400000`, or `7 * 24 * 60 * 60 * 1000` inline in a service file, stop — add a named constant to the right topic file in `functions/src/shared/constants/` first

**Shared helpers** (`functions/src/shared/`)
- Utility functions used by multiple service files live in topic modules: `impact.ts` (price impact, wash rule, circuit breaker), `cohorts.ts` (dividend lot ledger), `tradeRecords.ts`, `marketData.ts`, `equity.ts`, `usernames.ts`, `accountGuards.ts`, `discordApi.ts`, `notifications.ts`, `activity.ts`, ...
- `helpers.ts` re-exports all of them; new code imports the topic module directly (`../shared/impact`)
- Never copy-paste a helper from one service file to another — move it to the right shared module

**Every lane that fills an order** (executeTrade, `limitOrderFill`, the pre-market
auction in `marketOrders`, `marketOpenStopLoss`, the liquidations in
`marginScanners`)

A fill is not just cash and `holdings`. Each of these has to be maintained by
every lane, and each one was missed by at least one lane until 2026-09-22:

| What | How |
|---|---|
| Dividend / exit-loyalty lot ledger | `cohortAddUpdate` / `cohortRemoveUpdate` (`shared/cohorts.ts`) — spread into the user update. Never touch `holdingCohorts` by hand |
| 45-second hold gate | stamp `lastBuyTime.<ticker>` on anything that adds shares |
| Circuit-breaker pause | `isTickerPaused(marketData.haltedTickers, ticker)` — this binds automated price movers (bots, market maker, forced covers) too, not just player trades |
| Wash rule | `washRuleRemainingMs(userData, ticker)` — blocks buys only, never exits. 48h since 2026-09-23 |
| Short after dump | `shortAfterDumpRemainingMs(userData, ticker)` — blocks shorts for 48h after a heavy SELL. Shorts only open through executeTrade, so that is the one lane that checks it |
| Network (IP) rules | Accounts-per-connection cap and the connection's shared daily allowance. Queued orders capture the connection at placement (`claimNetworkForOrder`, `orderOrigins/{orderId}`) and fills apply it via `orderNetwork.ts`. The pre-market auction relies on the placement check alone (its window is inside the cap's one hour) |
| Mission / stat credit | `buildTradeCreditUpdates` + `updateCrewMissionProgress` |
| Trade record | `recordTrade` with a `source` tag (no tag = placed by hand) |

A closed position leaves nothing behind: delete `holdings`, `costBasis`,
`lowestWhileHolding`, `holdingCohorts` and any lockups together. `drip` is a
preference and survives on purpose.

**Shared game rules** (`src/rules/*.ts` and their `functions/src/shared/rules/` copies)
- Any rule the website previews and the server enforces (taxes, caps, ramps, price maths) lives ONCE in `src/rules/`. `npm run sync:chars` copies every file there to `functions/src/shared/rules/`; `npm run check:sync` (CI) fails if a copy is stale or orphaned. Never edit the copies.
- A rule module stays pure: no Firebase, no React, and imports only from inside `src/rules/` (or `../characters` / `../crews`, which sit at the same relative path on both sides). Constants files on both sides re-export from it so existing imports keep working.
- Modules: `rules/ladder` (caps, ramp, house chips, withdrawal tax), `rules/lmsr` (event-market pricing), `rules/activity` (last-active time), `rules/impact` (price impact, liquidity, spreads, order size, new-account ramp), `rules/money` (round2), `rules/equity` (exit equity, total invested), `rules/seasons` (tier thresholds, divisions, default rules), `rules/seasonMoney` (season margin averaging, money in, week maths), `rules/economy` (starting cash, check-in rewards, order sizes, margin gates, daily limits).

**Characters & crews** (`src/characters.ts` + `src/crews.ts` and their `functions/` copies)
- `src/characters.ts` and `src/crews.ts` are the **only files you ever edit**. Never touch `functions/src/shared/characters.ts` or `functions/src/shared/crews.ts` directly — both are generated copies.
- After editing either source file, run `npm run check:data` (validates ETF weights, crew rosters, and ticker references — silent success = clean) then `npm run sync:chars`, which overwrites both `functions/` copies automatically.
- Commit source and generated files together, then deploy functions. If you forget the sync, users get "Invalid ticker" errors for new characters, and new crew members are invisible to missions and crew bots (this exact bug shipped in June 2026 when the backend crew list was still hand-copied).
- Crew rosters, mission definitions/rewards, and crew mission contribution minimums all live in `src/crews.ts`; `functions/src/shared/constants/` derives `CREW_MEMBERS` and re-exports the mission values from the synced copy.

### The Anti-Patterns That Created the Original Mess

These specific patterns are banned. If you catch yourself writing any of them, stop and do it the right way.

1. **Inline duplicate functions** — `calculatePriceImpact`, `getBidAskPrices`, `getCurrentPrice` were each defined in 3–4 files simultaneously. Never define a function that already exists elsewhere. Check `src/utils/calculations.ts` before writing any price/portfolio math.

2. **Inline theme strings** — `const cardClass = darkMode ? 'bg-zinc-900 ...' : 'bg-white ...'` was copy-pasted 50+ times. Use `themeClasses` from `src/utils/theme.ts`, or write `light:`/`dark:` classes.

3. **God files** — `App.jsx` at 3,900 lines, `AdminPanel.jsx` at 7,400 lines, `functions/index.js` at 11,000 lines. These took days to untangle. Never let a file grow past its limit without splitting it.

4. **Prop drilling** — passing `darkMode`, `user`, `userData`, `prices` through 3–5 component layers. These are in context. Use `useTheme()` / `useSession()` / `useMarket()`.

5. **Magic numbers** — `0.005`, `0.15`, `500`, `10000` scattered across backend files with no explanation. Every economy value needs a named constant.

6. **Copy-paste across frontend/backend** — `src/characters.ts` and `functions/src/shared/characters.ts` were allowed to diverge and caused trade bugs. Any logic that needs to exist in both places needs a sync mechanism or a single source of truth.

### When Adding a New Feature

Before writing any code, answer these questions:

- Does similar logic already exist somewhere? (Check `src/utils/calculations.ts`, `src/rules/`, `functions/src/shared/` and its `constants/` first)
- Which existing file owns this domain? Add to it — don't create a new file unless the domain is genuinely new
- Will this push any file past its line limit? Split first
- Does this component need `darkMode`, `user`, or `prices`? Get them from `useTheme()` / `useSession()` / `useMarket()`, not props
- Is there a magic number? Name it in the appropriate constants file first

### Reviewing Your Own Work

Before committing any feature or fix, scan for:
- [ ] No function defined more than once across the codebase
- [ ] No `darkMode={darkMode}` props passed to components that can read context
- [ ] No inline numeric economy values — all named constants
- [ ] No file past its line limit
- [ ] `functions/src/index.ts` is still a pure re-exporter (≤15 lines; deployable files listed in each domain's `services.ts`)
- [ ] If characters changed: ran `npm run sync:chars` and committed both files

---

## Codebase map

Quick reference so you know where to look and where to add things.

### Frontend (`src/`)

| Path | What lives here |
|---|---|
| `src/App.tsx` | The player's session (auth, toasts, theme), the action hooks, the theme/session contexts and the page shell. Pages are in `src/app/AppRoutes.tsx`, modals in `src/app/AppModals.tsx` |
| `src/app/MarketDataProvider.tsx` | The live market subscriptions and the market contexts, mounted above App in `main.tsx` |
| `src/app/AppRoutes.tsx` | URL -> page. App builds each page's props |
| `src/app/BackgroundTasks.tsx` | Account upkeep that follows prices (payout claims, portfolio sync, interest, debt reminders). Draws nothing |
| `src/app/AppModals.tsx` | Every modal's render condition. App.tsx still owns the state and handlers; values already in context are read from context, not drilled |
| `src/context/AppContext.tsx` | Global state in three contexts: `useTheme` (darkMode), `useSession` (user, userData, holdings, shorts, costBasis, showNotification), `useMarket` (prices, priceHistory, marketData, activeIPOs, ...); plus `useMarketAccess` (load status + `getMarket`, which does not change on a tick) |
| `src/shared/hooks/useModalManager.ts` | Single openModal/closeModal pattern — use this, don't add more useState modal flags |
| `src/features/trading/hooks/useTradeManagement.ts` | handleTrade — trade execution, retry logic (achievement side-effects in `tradeAchievements.ts`) |
| `src/features/missions/hooks/useMissionManagement.ts` | handleClaimMissionReward, handleRerollMissions, handleClaimWeeklyMissionReward |
| `src/features/margin/hooks/useMarginManagement.ts` | handleEnableMargin, handleDisableMargin, handleRepayMargin |
| `src/features/crews/hooks/useCrewManagement.ts` | handleCrewSelect, handleCrewLeave |
| `src/features/predictions/hooks/usePredictionManagement.ts` | handleBet |
| `src/features/ipo/hooks/useIPOManagement.ts` | handleBuyIPO |
| `src/features/missions/hooks/useDailyOperations.ts` | handleDailyCheckin, handleBailout |
| `src/features/profile/hooks/usePinShop.ts` | handlePinAction, handlePurchaseCosmetic, handleEquipCosmetic |
| `src/utils/calculations.ts` | All price/portfolio math — canonical, do not duplicate. Includes `getShortRisk`/`getShortMargin` (mirror the backend force-cover check) and `getAccountAgeImpactFactor` |
| `src/utils/theme.ts` | Shared theme class strings (`themeClasses`), each carrying its `light:` and `dark:` styles — canonical, do not duplicate |
| `src/utils/formatters.ts` | Currency, number, percentage formatting |
| `src/utils/marketHours.ts` | Halt detection, countdown logic |
| `src/constants/economy.ts` | Frontend economy constants (dividend rates, hold times) |
| `src/constants/achievements.ts` | Achievement definitions |
| `src/constants/cosmetics.ts` | Cosmetic item definitions |
| `src/characters.ts` | **Source of truth** for all character/ETF data — edit here only |
| `src/features/admin/` | Admin panel: `components/` (AdminPanel.tsx orchestrator + tabs), `hooks/` (state + handlers, one hook per domain, spread into tabs as props), `utils/` (pure helpers) |
| `src/features/ladder/` | Ladder game: `components/` (board, side panel, modals, shared style constants), `hooks/` (data listeners, game flow, banners, DOM animation) |
| `src/shared/components/layout/` | Header, Footer, MobileBottomNav, Layout wrapper |

### Backend (`functions/`)

| Path | What lives here |
|---|---|
| `functions/src/index.ts` | Re-exports only — ≤15 lines, never add logic here |
| `functions/lib/` | Build output of `npm run build:functions`. Never edit, never commit |
| `functions/src/servicePaths.ts` | Builds the full service list from every domain's `services.ts`. A new domain folder is added to `DOMAINS` here |
| `functions/src/<domain>/services.ts` | The files in that domain that declare Cloud Functions. Never list internal modules |
| `functions/src/serviceLoader.ts` | Loads services onto index.js. Copies only real Cloud Functions (so leaked helpers/constants can't masquerade as deployable), and at runtime loads ONLY the service owning the invoked function — cold start is ~350ms instead of ~1.4s. Always fails open to loading everything |
| `functions/src/shared/sentry.ts` | Error monitoring. `@sentry/node` is loaded lazily on first error, not at startup — it was ~700ms of every cold start and does nothing unless something fails |
| `functions/src/shared/constants/` | All backend economy constants, one file per topic — add new ones to the right topic |
| `functions/src/shared/helpers.ts` | Re-exports the shared topic modules beside it (impact, cohorts, equity, usernames, ...) |
| `functions/src/shared/characters.ts` | **Generated file** — never edit directly, always via `npm run sync:chars` |
| `functions/src/market/botTrader.ts` | Bot trading scheduler |
| `functions/src/trading/trading.ts` | executeTrade orchestrator — the most critical flow, treat with care. Logic in `tradeGuards.ts` / `tradeActions.ts` / `tradePricing.ts` / `tradeState.ts` / `tradeEffects.ts` (internal modules, not in index.js) |
| `functions/src/users/users.ts` | Account lifecycle: createUser, deleteAccount (anti-abuse gates live here) |
| `functions/src/users/signupHelpers.ts` | **Internal module.** createUser's blocked-signup auth cleanup and the parked Discord-link apply |
| `functions/src/users/userProfile.ts` | checkUsername, changeDisplayName, migrateUsernames, purchaseCosmetic |
| `functions/src/market/market.ts` | Daily Discord summary, pre-halt price snapshot, chapter recap + review rebuild, market open/close alerts, manual halt (setMarketHalt). 595 lines, near the 600 limit |
| `functions/src/users/leaderboard.ts` | Rankings, leaderboard computation |
| `functions/src/market/dividends.ts` | Dividend payouts |
| `functions/src/market/alerts.ts` | Price alerts |
| `functions/src/discord/discord.ts` | Discord OAuth and account linking (≤352 lines) |
| `functions/src/discord/discordInteractions.ts` | Discord slash command webhook handler |
| `functions/src/discord/discordAdmin.ts` | Discord-triggered admin diagnostics and recovery tools |
| `functions/src/admin/admin.ts` | banUser, fixBasePriceCliffs, createBots |
| `functions/src/admin/adminBackups.ts` | Market backup/restore/retention (restoreBackup overwrites live data) |
| `functions/src/admin/adminOps.ts` | Small direct admin ops: grant/revoke, set cash, broadcast, toggles, Discord unlink/move-link |
| `functions/src/admin/adminUserEdit.ts` | Direct edits to one player's game state: crew, achievements, margin, a single holding. Skips player-facing penalties/cooldowns on purpose |
| `functions/src/admin/adminRepair.ts` | Heavy bulk player-data repair (repairSpikeVictims, reconstructPortfolioHistory) |
| `functions/src/admin/adminMigrate.ts` | Ticker/roster migrations: renameTicker, initNewCharacterPrices |
| `functions/src/margin/margin.ts` | User-facing margin actions: repay, bailout, toggle, interest |
| `functions/src/margin/marginScanners.ts` | The two scheduled liquidation scanners (checkShortMarginCalls, checkMarginLending). Covered by test:trading sections J and K |
| `functions/src/users/portfolio.ts` | syncPortfolio, sweepDustPositions |
| `functions/src/crews/crew.ts` | switchCrew, leaveCrew |
| `functions/src/orders/limitOrders.ts` | createLimitOrder + the sweep schedule; engine is in `limitOrderMatching.ts` (internal) |
| `functions/src/missions/missions.ts` | Daily/weekly mission logic + dailyCheckin |
| `functions/src/predictions/predictions.ts` | Prediction markets, IPO price jumps |
| `functions/src/ladder/ladderGame.ts` | Ladder game mechanics and leaderboard |
| `functions/src/moderation/watchlist.ts` | IP watchlist, fraud detection |
| `functions/src/admin/archiving.ts` | Data archiving and cleanup |
| `functions/src/orders/marketOrders.ts` | processMarketOpenOrders (pre-market auction + stop-loss sweep, Thursday 20:56 UTC) + triggerMarketOpenOrders (admin re-run for recovery) |
| `functions/src/orders/preMarket.ts` | createPreMarketOrder / cancelPreMarketOrder (queue window Thursday 20:30–20:55 UTC) |
| `functions/src/orders/orderNetwork.ts` | **Internal module, not in services.ts.** The per-connection (IP) rules for queued orders: placement takes a slot, limit/stop-loss fills share the connection's daily allowance. The connection lives in the private `orderOrigins` collection, never on an order doc (pre-market orders are world-readable). `npm run test:limitorders` section 18 |
| `functions/src/market/marketWeekly.ts` | Weekly market summary, leaderboard, crew rankings (scheduled) |
| `functions/src/market/crewRankings.ts` | **Internal module.** runWeeklyCrewRankings: active counts, underdog multipliers, crew head rotation + role sync, the Discord post |
| `functions/src/market/tickerRename.ts` | **Internal module, not in services.ts.** The ticker rename engine: preflight, journalled phases, alias map, verification. Driven by `renameTicker` in adminMigrate.ts |
| `functions/src/market/tickerRenameChecks.ts` | **Internal module.** The rename's preflight, dry-run counts and verification scan; re-exported by tickerRename.ts |
| `functions/src/market/tickerRemap.ts` | **Internal module, not in services.ts.** The rename engine's pure helpers: which user/market maps a rename moves (`USER_TICKER_MAPS`, `MARKET_TICKER_MAPS`). Any new ticker-keyed field on a player or market/current must be added here |
| `functions/src/market/tickerStats.ts` | recordPriceExtremes — hourly all-time high/low sweep |
| `functions/src/season/season.ts` | Seasons: start/end, the Thursday checkpoint, the standings board. Scores live net equity at frozen prices, never the stored portfolioValue |
| `functions/src/season/seasonCheckpoint.ts` | **Internal module.** runSeasonCheckpoint (the Thursday week record) plus the season doc ref and ladder-cash read season.ts shares |
| `functions/src/season/seasonRecords.ts` | **Internal module, not in services.ts.** The weekly record, board membership, and one player's board entry (incl. size division) |
| `functions/src/season/seasonExclusions.ts` | Admin: players flagged for coordination this season, and keeping one out of Platinum/Diamond (`seasonTopTierExclusion` on the user doc, private) |
| `functions/src/moderation/coordDetection.ts` | Hourly coordination scan (`35 * * * *`). Alerts + admin DM, then `coordEnforcement.ts` (internal): 48h buy-back + short block for everyone in a TIGHT downward cluster, and the "all in on borrowed money" flag on upward ones. `npm run test:coord` |
| `functions/src/moderation/coordReview.ts` | Admin: what a flagged push made a player (math in `coordProfitMath.ts`, internal, unit-tested against the real 9/17 raid) and removing it — cash first, rest as margin debt, refused below the forced-sale line |
| `functions/src/season/seasonTiers.ts` | **Internal module, not in services.ts.** The tier rules: Bronze/Silver/Gold banked at checkpoints, Platinum/Diamond ranked within each size division (SEASON_DIVISIONS) at season end. Thresholds and money maths come from the shared `rules/seasons` + `rules/seasonMoney`; `functions/src/season/seasonTiers.test.ts` checks the site's week derivation matches |
| `functions/src/season/seasonMoney.ts` | **Internal module.** Writes the season margin tally and reads server-only counters; re-exports the shared `rules/seasonMoney` maths. Re-exported by seasonTiers.ts |

---

## Characterization tests

The biggest files were split behind tests that pin their behaviour. Run the
matching test before and after touching any of these areas.

| Area | Test |
|---|---|
| `executeTrade` (`functions/src/trading/`) and the margin scanners | `npm run test:trading`. Still ONE atomic transaction: all reads before writes, write order market -> price history -> trade record -> ipTracking -> user doc |
| Limit orders (`functions/src/orders/limitOrders.ts`, `limitOrderMatching.ts`) | `npm run test:limitorders` |
| Admin panel (`src/features/admin/`) | `src/features/admin/components/AdminPanel.test.tsx` (`npm test`) |
| Ladder game (`src/features/ladder/`) | `src/features/ladder/components/LadderGame.test.tsx` (`npm test`). The timing values in `hooks/animatePath.ts` are load-bearing |
| Ticker rename engine | `npm run test:rename` and `functions/src/market/tickerRename.test.ts` |
| Stock split engine | `npm run test:split` and `functions/src/market/stockSplit.test.ts` |
| Firestore rules | `npm run test:rules` |

## Where the weekly halt is enforced

The market halts every **Thursday 13:00–21:00 UTC** (see [game-rules.md](game-rules.md)). It is enforced in:
- Frontend: `src/utils/marketHours.ts` (`isWeeklyHalt()`)
- Backend: `functions/src/shared/constants/` (`WEEKLY_HALT_DAY`, `WEEKLY_HALT_START_HOUR`, `WEEKLY_HALT_END_HOUR`)

Manual halts can also be triggered by an admin via the admin panel, which sets `marketData.marketHalted` in Firestore. Both halt types block all trades.

Pre-market timeline inside the Thursday halt: orders queue 20:30–20:55 UTC (`preMarket.ts`), the lock hits at 20:55 (no new orders or cancellations), the opening auction + stop-loss sweep runs at 20:56 (`marketOrders.ts`, applies any deferred IPO jumps first), and the market reopens clean at 21:00. If the auction run fails, the admin-only `triggerMarketOpenOrders` callable re-runs it idempotently.

---

## Gotchas

- **`activeUserData` vs `userData`** in App.tsx: `userData` is the logged-in user's Firestore doc. `activeUserData` is derived from it with fallbacks. Always use `activeUserData` when reading holdings/shorts/cohorts, not `userData` directly.
- **`colorBlindMode`**: Not stored directly in context — derive it everywhere as `const colorBlindMode = userData?.colorBlindMode || false`. It affects green/red color choices throughout the UI.
- **Guest mode**: `isGuest` flag is true when a user is browsing without an account. Most write operations and modals should be gated behind `!isGuest`.
- **Price impact**: Every trade moves the price. The preview calculation uses `calculatePriceImpactDollars` in `src/utils/calculations.ts`. The backend uses `calculateMarginalImpact` in `functions/src/shared/impact.ts`. Both use the same marginal sqrt formula. If you change the formula, change it in both places and re-run `npm test`.
- **ETFs**: ETF prices trail their constituent characters. This is handled in `executeTrade` via trailing effects. ETF entries are identified by `isETF: true` in `src/characters.ts` (there is no `type` field).
