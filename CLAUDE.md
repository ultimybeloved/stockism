# Claude Code Instructions

> **Modernization in progress (since 2026-10-07).** Read `docs/MODERNIZATION.md` first: it has the current phase and next step.

## Local Dev Setup

Run the app locally before pushing changes:

1. `npm install` (once)
2. `npm run dev` → opens http://localhost:5173
3. **App Check setup (only if onboarding a new dev):** generate any UUID, put it in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN`, then register the same UUID at Firebase Console → App Check → Apps → web app → Manage debug tokens. Existing token in `.env.local` already works for the current dev.

`.env.local` already has all the keys. Do NOT commit it (it's gitignored).

Local dev runs against the **production** Firebase backend, so any trades or writes hit live data — test with the user's own account, not a fresh one.

### Sandbox mode (local emulators — safe to test anything)

A `npm run dev` always hits production. To test risky changes against a fake, resettable backend instead, use the Firebase emulator sandbox. Nothing in the sandbox can touch live players.

**Requires Java 21+** (the Firebase CLI emulators need it; check with `java -version`).

Three terminals (or run the first in the background):

1. `npm run emulators` — starts the auth/firestore/functions emulators + UI at http://localhost:4000
2. `npm run seed:emulator` — writes a starting market doc into the emulator (prices show immediately). The market doc is admin-only by Firestore rules, so the client can't self-init it; this seeds it via the Admin SDK.
3. `npm run dev:emulator` — runs the app in sandbox mode (Vite `--mode emulator` loads `.env.emulator`, which sets `VITE_USE_EMULATOR=true`). The app connects to the local emulators and skips App Check. A "🧪 SANDBOX MODE" warning prints in the browser console.

Sign up a fresh account in the sandbox — it's a clean database, so the production anti-alt / live-data warning above does not apply here. Restarting the emulators wipes everything back to zero.

The flag is off by default: plain `npm run dev` and all Vercel/production builds are unaffected and keep using the real backend.

## Project Context

You are the **sole developer** of this codebase. The user (Darth YG) is a non-technical manager who:

* Does not know how code works
* Provides ideas, feature requests, and bug reports in plain English
* Relies on you entirely for technical decisions and implementation

**Your responsibilities:**

* Translate vague requests into concrete technical tasks
* Make architectural decisions autonomously - don't ask the user to choose between technical options they won't understand
* Explain changes in simple terms when asked, but don't over-explain unprompted
* Push back on requests that are technically infeasible or would create problems
* Own the quality of this codebase - if something is broken, fix it; if something is messy, clean it up

**Communication style:**

* Skip jargon - say "I fixed it" not "I refactored the state management to use memoization"
* When something goes wrong, explain what happened and what you did about it, not the technical details
* If you need clarification, ask about the *goal*, not the implementation ("What should happen when someone clicks that?" not "Should this be a PUT or POST request?")

## Code Philosophy

* Understand the codebase before changing it
* Consider 2+ approaches before implementing
* Simplify ruthlessly - remove complexity wherever possible
* Plan non-trivial changes before coding
* Leave code better than you found it

## Git Commits

* Do NOT add "Co-Authored-By: Claude" or any co-author attribution to commit messages
* Keep commit messages short and vague (e.g., "Update portfolio", "Fix bug", "Add feature")

## Before Deploying Backend Functions

The backend is compiled: `npm run build:functions` turns `functions/src/` (TypeScript, plus JavaScript not converted yet) into `functions/lib/`, which is what Firebase deploys and the emulator loads. Never edit `lib/`; it is gitignored and rebuilt by `check:functions`, `deploy:functions`, `emulators` and the `firebase.json` predeploy hook. The emulator suites and backend vitest files load `functions/src/` directly through tsx, and so must any script that requires backend code (`npx tsx scripts/<name>.cjs`).

Run `npm run check:functions` before any `firebase deploy`. It exits non-zero and prints what to fix if any check fails:

1. **Environment** — `functions/.env` must exist with every required key filled in (`scripts/check-env.cjs` owns the list). Also runs standalone as `npm run check:env`.
2. **Export purity** — `functions/src/index.js` must export only real Cloud Functions. Service files sometimes export an internal helper so a sibling service or an emulator test can drive it; those must not reach index.js. Shared helpers go in a `functions/src/shared/` module or an internal module no `services.js` lists.
3. **Constants imports** — every service file must import everything it uses from `functions/src/shared/constants/`. A missing import throws in production on whichever code path touches it.

Silent success = clean.

### Files that must be on any machine that deploys

These are gitignored, so a fresh clone never has them. Carry them by password manager or USB, never email or Discord.

| File | Needed for | If missing |
|---|---|---|
| `functions/.env` | `firebase deploy --only functions` | **Wipes the live backend environment.** A deploy uploads this file and *replaces* the whole environment rather than merging, so deploying without it clears the Discord tokens, OAuth secret and Sentry DSN from production. The bot goes silent on unsurfaced 403s, Discord login breaks, error reporting stops, and the deploy still reports success. This shipped once from a fresh clone on a second machine |
| `.env.local` | `npm run dev`, local `npm run build` | Local dev only. Vercel builds with its own dashboard env vars, so production is unaffected |
| `service-account-key.json` | the admin scripts in `scripts/` | Those scripts refuse to run. Not needed for dev or deploys |

`npm run check:env` enforces the first one. It's wired into `check:functions`, into `npm run deploy:functions`, and into the `predeploy` hook in `firebase.json`, so a bare `firebase deploy --only functions` is blocked too. When adding a new backend env var, classify it in `scripts/check-env.cjs` as REQUIRED or OPTIONAL — the check fails on any unclassified one rather than assuming it's safe.

Also needed on a second machine: `firebase login`, Node 22, `npm install` in both the root and `functions/`, and Java 21+ for the emulator sandbox.

\## Cost \& Token Efficiency Rules

\- \*\*Model Choice:\*\* Use Sonnet 4.5 by default for all implementation and terminal tasks. Only switch to or suggest Opus 4.5 for high-complexity architectural changes or "impossible" debugging scenarios.

\- \*\*Permission Gate:\*\* ALWAYS ask for user confirmation before:

&nbsp;   - Reading files larger than 100KB.

&nbsp;   - Initiating a `subagent` loop (multi-agent tasks).

&nbsp;   - Scanning directories that are not explicitly part of the source code (e.g., ignore build/, dist/, coverage/).

\- \*\*Context Management:\*\* After completing a major task, suggest the `/compact` command to the user to keep the session history lean.

\- \*\*Conciseness:\*\* Provide direct, code-heavy responses. Skip the conversational "fluff" to save output tokens.

## Proactive Guidance

You are the technical expert. The user provides ideas; you provide implementation expertise. Always:

* **Suggest improvements** - If you see a better way to implement something, say so
* **Challenge bad ideas** - If an approach has flaws, explain why and offer alternatives
* **Think ahead** - Warn about potential issues, edge cases, or maintenance problems
* **Offer options** - When multiple valid approaches exist, present them with trade-offs
* **Be honest** - Don't just agree to be agreeable. Respectful pushback is valuable.
* **Ask before assuming** - When a request is unclear, ambiguous, or could go multiple ways technically, ask the user to clarify the goal rather than picking an interpretation and running with it. The user can always overrule technical concerns — but only if they know about them. Surface tradeoffs, flag constraints, and confirm direction before building.

## Pre-Completion Checks

Before completing any task, run these checks:

* **Security Scan:** Check for hardcoded secrets, API keys, or passwords
* **Injection Prevention:** Verify no SQL injection, shell injection, or path traversal vulnerabilities
* **Input Validation:** Ensure all user inputs are validated and sanitized
* **Test Suite:** Run the test suite if one exists (`npm test`)
* **Type Errors:** Check for type errors or lint issues
* **Build Check:** Run `npm run build` and confirm it exits clean with no errors

---

## Architecture Rules — Non-Negotiable

These rules exist because we spent significant effort cleaning up a codebase that had grown into god files and duplicated logic. Do not undo that work.

### File Size Hard Limits

| Location | Limit | Action if exceeded |
|---|---|---|
| Any frontend component (`src/components/`) | 400 lines | Split into sub-components |
| Any page component (`src/pages/`) | 300 lines | Extract logic into a hook |
| Any hook (`src/hooks/`) | 200 lines | Split by concern |
| `src/App.tsx` | 500 lines | Stop and refactor before adding more |
| Any backend file (`functions/src/<domain>/`, not `shared/`) | 600 lines | Split by sub-domain |
| `functions/src/index.js` | 15 lines | Entry point only. Deployable files are listed per domain in `functions/src/<domain>/services.js` — never add logic here |

If a new feature would push a file past its limit, **split the file first, then add the feature.** Never ask permission to do this — it is part of the job.

### Frontend: Where Code Lives

**Components** (`src/components/`)
- One component per file, named to match the file
- Sub-components used only by one parent live in a subfolder: `src/components/portfolio/HoldingRow.tsx`
- Never put business logic in a component — extract to a hook

**Hooks** (`src/hooks/`)
- All stateful logic that doesn't belong in a component goes here
- One concern per hook: `useTradeLogic.js`, `useModalManager.js`, not `useEverything.js`

**Utilities** (`src/utils/`)
- Pure functions only — no side effects, no Firebase, no React
- Calculation logic → `src/utils/calculations.ts` (already canonical — do not duplicate)
- Theme/dark mode class strings → `src/utils/theme.ts` (already canonical — do not duplicate)
- Formatting → `src/utils/formatters.ts`

**Constants** (`src/constants/`)
- Named constants only — no magic numbers in components or hooks
- Economy rules → `src/constants/economy.ts`

**Context** (`src/context/AppContext.tsx`)
- Global state that 3+ components need: `darkMode`, `user`, `userData`, `prices`, `priceHistory`, `holdings`, `shorts`, `costBasis`, `marketData`, `showNotification`, `activeIPOs`
- **Never pass these as props.** Components call `useAppContext()`.
- If you find yourself writing `darkMode={darkMode}` as a prop, stop — use context instead

### Backend: Where Code Lives

**Domain folders** (`functions/src/<domain>/`)
- Backend code is grouped by domain: `trading`, `orders`, `margin`, `market`, `season`, `admin`, `discord`, `moderation`, `ladder`, `predictions`, `users`, `crews`, `missions`. Code every domain uses lives in `functions/src/shared/` (constants, helpers, fnConfig, sentry, the generated characters/crews)
- Each domain's `services.js` lists its files that declare Cloud Functions; `functions/src/servicePaths.js` joins them. The Codebase Map below covers the service files and the internal modules
- Adding a new Cloud Function: find the right service file and append to it. A new file goes in its domain folder and that folder's `services.js`. A new domain folder also goes in `DOMAINS` in `servicePaths.js`
- Internal modules (tradeGuards, limitOrderMatching, missionChecks, crewMissionProgress, ...) are required directly by their owning service and must NOT be listed in a `services.js`
- Backend vitest files sit beside the module they test (`functions/src/season/seasonTiers.test.js`)
- Never add Cloud Function logic directly to `functions/src/index.js`

**Shared constants** (`functions/src/shared/constants/`)
- All numeric economy values live here, one file per topic (`market`, `margin`, `economy`, `seasons`, `discord`, ...). `require('../shared/constants')` loads the folder's `index.js`, which gathers them all
- If you are writing a number like `0.005`, `10000`, `86400000`, or `7 * 24 * 60 * 60 * 1000` inline in a service file, stop — add a named constant to the right topic file in `functions/src/shared/constants/` first

**Shared helpers** (`functions/src/shared/`)
- Utility functions used by multiple service files live in topic modules: `impact.js` (price impact, wash rule, circuit breaker), `cohorts.js` (dividend lot ledger), `tradeRecords.js`, `marketData.js`, `equity.js`, `usernames.js`, `accountGuards.js`, `discordApi.js`, `notifications.js`, `activity.js`, ...
- `helpers.js` re-exports all of them so existing `require('../shared/helpers')` calls keep working; new code can require the topic module directly
- Never copy-paste a helper from one service file to another — move it to the right shared module

**Every lane that fills an order** (executeTrade, `limitOrderFill`, the pre-market
auction in `marketOrders`, `marketOpenStopLoss`, the liquidations in
`marginScanners`)

A fill is not just cash and `holdings`. Each of these has to be maintained by
every lane, and each one was missed by at least one lane until 2026-09-22:

| What | How |
|---|---|
| Dividend / exit-loyalty lot ledger | `cohortAddUpdate` / `cohortRemoveUpdate` (helpers.js) — spread into the user update. Never touch `holdingCohorts` by hand |
| 45-second hold gate | stamp `lastBuyTime.<ticker>` on anything that adds shares |
| Circuit-breaker pause | `isTickerPaused(marketData.haltedTickers, ticker)` — this binds automated price movers (bots, market maker, forced covers) too, not just player trades |
| Wash rule | `washRuleRemainingMs(userData, ticker)` — blocks buys only, never exits. 48h since 2026-09-23 |
| Short after dump | `shortAfterDumpRemainingMs(userData, ticker)` — blocks shorts for 48h after a heavy SELL. Shorts only open through executeTrade, so that is the one lane that checks it |
| Network (IP) rules | Accounts-per-connection cap and the connection's shared daily allowance. Queued orders capture the connection at placement (`claimNetworkForOrder`, `orderOrigins/{orderId}`) and fills apply it via `orderNetwork.js`. The pre-market auction relies on the placement check alone (its window is inside the cap's one hour) |
| Mission / stat credit | `buildTradeCreditUpdates` + `updateCrewMissionProgress` |
| Trade record | `recordTrade` with a `source` tag (no tag = placed by hand) |

A closed position leaves nothing behind: delete `holdings`, `costBasis`,
`lowestWhileHolding`, `holdingCohorts` and any lockups together. `drip` is a
preference and survives on purpose.

**Shared game rules** (`src/rules/*.ts` and their `functions/src/shared/rules/` copies)
- Any rule the website previews and the server enforces (taxes, caps, ramps, price maths) lives ONCE in `src/rules/`. `npm run sync:chars` copies every file there to `functions/src/shared/rules/`; `npm run check:sync` (CI) fails if a copy is stale or orphaned. Never edit the copies.
- A rule module stays pure: no Firebase, no React, and imports only from inside `src/rules/` (or `../characters` / `../crews`, which sit at the same relative path on both sides). Constants files on both sides re-export from it so existing imports keep working.
- Done so far: `rules/ladder` (caps, ramp, house chips, withdrawal tax), `rules/lmsr` (event-market pricing), `rules/activity` (last-active time), `rules/impact` (price impact, liquidity, spreads, order size, new-account ramp). The rest of the mirrored rules are moving here one module at a time (see docs/MODERNIZATION.md Phase 3 step 5).

**Characters & crews** (`src/characters.ts` + `src/crews.ts` and their `functions/` copies)
- `src/characters.ts` and `src/crews.ts` are the **only files you ever edit**. Never touch `functions/src/shared/characters.ts` or `functions/src/shared/crews.ts` directly — both are generated copies.
- After editing either source file, run `npm run check:data` (validates ETF weights, crew rosters, and ticker references — silent success = clean) then `npm run sync:chars`, which overwrites both `functions/` copies automatically.
- Commit source and generated files together, then deploy functions. If you forget the sync, users get "Invalid ticker" errors for new characters, and new crew members are invisible to missions and crew bots (this exact bug shipped in June 2026 when the backend crew list was still hand-copied).
- Crew rosters, mission definitions/rewards, and crew mission contribution minimums all live in `src/crews.ts`; `functions/src/shared/constants/` derives `CREW_MEMBERS` and re-exports the mission values from the synced copy.

### The Anti-Patterns That Created the Original Mess

These specific patterns are banned. If you catch yourself writing any of them, stop and do it the right way.

1. **Inline duplicate functions** — `calculatePriceImpact`, `getBidAskPrices`, `getCurrentPrice` were each defined in 3–4 files simultaneously. Never define a function that already exists elsewhere. Check `src/utils/calculations.ts` before writing any price/portfolio math.

2. **Inline theme strings** — `const cardClass = darkMode ? 'bg-zinc-900 ...' : 'bg-white ...'` was copy-pasted 50+ times. Use `getThemeClasses(darkMode)` from `src/utils/theme.ts`.

3. **God files** — `App.jsx` at 3,900 lines, `AdminPanel.jsx` at 7,400 lines, `functions/index.js` at 11,000 lines. These took days to untangle. Never let a file grow past its limit without splitting it.

4. **Prop drilling** — passing `darkMode`, `user`, `userData`, `prices` through 3–5 component layers. These are in context. Use `useAppContext()`.

5. **Magic numbers** — `0.005`, `0.15`, `500`, `10000` scattered across backend files with no explanation. Every economy value needs a named constant.

6. **Copy-paste across frontend/backend** — `src/characters.ts` and `functions/src/shared/characters.ts` were allowed to diverge and caused trade bugs. Any logic that needs to exist in both places needs a sync mechanism or a single source of truth.

### When Adding a New Feature

Before writing any code, answer these questions:

- Does similar logic already exist somewhere? (Check `calculations.js`, `helpers.js`, `constants.js` first)
- Which existing file owns this domain? Add to it — don't create a new file unless the domain is genuinely new
- Will this push any file past its line limit? Split first
- Does this component need `darkMode`, `user`, or `prices`? Get them from `useAppContext()`, not props
- Is there a magic number? Name it in the appropriate constants file first

### Reviewing Your Own Work

Before committing any feature or fix, scan for:
- [ ] No function defined more than once across the codebase
- [ ] No `darkMode={darkMode}` props passed to components that use `useAppContext()`
- [ ] No inline numeric economy values — all named constants
- [ ] No file past its line limit
- [ ] `functions/src/index.js` is still a pure re-exporter (≤15 lines; deployable files listed in each domain's `services.js`)
- [ ] If characters changed: ran `npm run sync:chars` and committed both files

---

## Codebase Map

Quick reference so you know where to look and where to add things.

### Frontend (`src/`)

| Path | What lives here |
|---|---|
| `src/App.tsx` | Router, top-level subscriptions, state/handler assembly — the modal stack itself is in `src/components/AppModals.tsx` |
| `src/components/AppModals.tsx` | Every modal's render condition. App.tsx still owns the state and handlers; values already in context are read from context, not drilled |
| `src/context/AppContext.tsx` | Global state: darkMode, user, userData, prices, priceHistory, holdings, shorts, costBasis, marketData, activeIPOs, showNotification |
| `src/hooks/useModalManager.ts` | Single openModal/closeModal pattern — use this, don't add more useState modal flags |
| `src/hooks/useTradeManagement.ts` | handleTrade — trade execution, retry logic (achievement side-effects in `tradeAchievements.js`) |
| `src/hooks/useMissionManagement.ts` | handleClaimMissionReward, handleRerollMissions, handleClaimWeeklyMissionReward |
| `src/hooks/useMarginManagement.ts` | handleEnableMargin, handleDisableMargin, handleRepayMargin |
| `src/hooks/useCrewManagement.ts` | handleCrewSelect, handleCrewLeave |
| `src/hooks/usePredictionManagement.ts` | handleBet |
| `src/hooks/useIPOManagement.ts` | handleBuyIPO |
| `src/hooks/useDailyOperations.ts` | handleDailyCheckin, handleBailout |
| `src/hooks/usePinShop.ts` | handlePinAction, handlePurchaseCosmetic, handleEquipCosmetic |
| `src/utils/calculations.ts` | All price/portfolio math — canonical, do not duplicate. Includes `getShortRisk`/`getShortMargin` (mirror the backend force-cover check) and `getAccountAgeImpactFactor` |
| `src/utils/theme.ts` | Dark mode class strings via `getThemeClasses(darkMode)` — canonical, do not duplicate |
| `src/utils/formatters.ts` | Currency, number, percentage formatting |
| `src/utils/marketHours.ts` | Halt detection, countdown logic |
| `src/constants/economy.ts` | Frontend economy constants (dividend rates, hold times) |
| `src/constants/achievements.ts` | Achievement definitions |
| `src/constants/cosmetics.ts` | Cosmetic item definitions |
| `src/characters.ts` | **Source of truth** for all character/ETF data — edit here only |
| `src/components/admin/` | Admin panel split into focused components |
| `src/components/ladder/` | Ladder game UI: board, side panel, modals, shared style constants |
| `src/hooks/ladder/` | Ladder game logic: data listeners, game flow, banners, DOM animation |
| `src/hooks/admin/` | Admin panel state + handlers, one hook per domain — spread into tab components as props |
| `src/components/modals/` | All modal components |
| `src/components/layout/` | Header, Footer, MobileBottomNav, Layout wrapper |

### Backend (`functions/`)

| Path | What lives here |
|---|---|
| `functions/src/index.js` | Re-exports only — ≤15 lines, never add logic here |
| `functions/lib/` | Build output of `npm run build:functions`. Never edit, never commit |
| `functions/src/servicePaths.js` | Builds the full service list from every domain's `services.js`. A new domain folder is added to `DOMAINS` here |
| `functions/src/<domain>/services.js` | The files in that domain that declare Cloud Functions. Never list internal modules |
| `functions/src/serviceLoader.js` | Loads services onto index.js. Copies only real Cloud Functions (so leaked helpers/constants can't masquerade as deployable), and at runtime loads ONLY the service owning the invoked function — cold start is ~350ms instead of ~1.4s. Always fails open to loading everything |
| `functions/src/shared/sentry.ts` | Error monitoring. `@sentry/node` is loaded lazily on first error, not at startup — it was ~700ms of every cold start and does nothing unless something fails |
| `functions/src/shared/constants/` | All backend economy constants, one file per topic — add new ones to the right topic |
| `functions/src/shared/helpers.ts` | Re-exports the shared topic modules beside it (impact, cohorts, equity, usernames, ...) |
| `functions/src/shared/characters.ts` | **Generated file** — never edit directly, always via `npm run sync:chars` |
| `functions/src/market/botTrader.ts` | Bot trading scheduler |
| `functions/src/trading/trading.ts` | executeTrade orchestrator — the most critical flow, treat with care. Logic in `tradeGuards.js` / `tradeActions.js` / `tradePricing.js` / `tradeState.js` / `tradeEffects.js` (internal modules, not in index.js) |
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
| `functions/src/orders/limitOrders.ts` | createLimitOrder + the sweep schedule; engine is in `limitOrderMatching.js` (internal) |
| `functions/src/missions/missions.ts` | Daily/weekly mission logic + dailyCheckin |
| `functions/src/predictions/predictions.ts` | Prediction markets, IPO price jumps |
| `functions/src/ladder/ladderGame.ts` | Ladder game mechanics and leaderboard |
| `functions/src/moderation/watchlist.ts` | IP watchlist, fraud detection |
| `functions/src/admin/archiving.ts` | Data archiving and cleanup |
| `functions/src/orders/marketOrders.ts` | processMarketOpenOrders (pre-market auction + stop-loss sweep, Thursday 20:56 UTC) + triggerMarketOpenOrders (admin re-run for recovery) |
| `functions/src/orders/preMarket.ts` | createPreMarketOrder / cancelPreMarketOrder (queue window Thursday 20:30–20:55 UTC) |
| `functions/src/orders/orderNetwork.ts` | **Internal module, not in services.js.** The per-connection (IP) rules for queued orders: placement takes a slot, limit/stop-loss fills share the connection's daily allowance. The connection lives in the private `orderOrigins` collection, never on an order doc (pre-market orders are world-readable). `npm run test:limitorders` section 18 |
| `functions/src/market/marketWeekly.ts` | Weekly market summary, leaderboard, crew rankings (scheduled) |
| `functions/src/market/crewRankings.ts` | **Internal module.** runWeeklyCrewRankings: active counts, underdog multipliers, crew head rotation + role sync, the Discord post |
| `functions/src/market/tickerRename.ts` | **Internal module, not in services.js.** The ticker rename engine: preflight, journalled phases, alias map, verification. Driven by `renameTicker` in adminMigrate.js |
| `functions/src/market/tickerRenameChecks.ts` | **Internal module.** The rename's preflight, dry-run counts and verification scan; re-exported by tickerRename.ts |
| `functions/src/market/tickerRemap.ts` | **Internal module, not in services.js.** The rename engine's pure helpers: which user/market maps a rename moves (`USER_TICKER_MAPS`, `MARKET_TICKER_MAPS`). Any new ticker-keyed field on a player or market/current must be added here |
| `functions/src/market/tickerStats.ts` | recordPriceExtremes — hourly all-time high/low sweep |
| `functions/src/season/season.ts` | Seasons: start/end, the Thursday checkpoint, the standings board. Scores live net equity at frozen prices, never the stored portfolioValue |
| `functions/src/season/seasonCheckpoint.ts` | **Internal module.** runSeasonCheckpoint (the Thursday week record) plus the season doc ref and ladder-cash read season.ts shares |
| `functions/src/season/seasonRecords.ts` | **Internal module, not in services.js.** The weekly record, board membership, and one player's board entry (incl. size division) |
| `functions/src/season/seasonExclusions.ts` | Admin: players flagged for coordination this season, and keeping one out of Platinum/Diamond (`seasonTopTierExclusion` on the user doc, private) |
| `functions/src/moderation/coordDetection.ts` | Hourly coordination scan (`35 * * * *`). Alerts + admin DM, then `coordEnforcement.js` (internal): 48h buy-back + short block for everyone in a TIGHT downward cluster, and the "all in on borrowed money" flag on upward ones. `npm run test:coord` |
| `functions/src/moderation/coordReview.ts` | Admin: what a flagged push made a player (math in `coordProfitMath.js`, internal, unit-tested against the real 9/17 raid) and removing it — cash first, rest as margin debt, refused below the forced-sale line |
| `functions/src/season/seasonTiers.ts` | **Internal module, not in services.js.** The tier rules: Bronze/Silver/Gold banked at checkpoints, Platinum/Diamond ranked within each size division (SEASON_DIVISIONS) at season end. Mirrored in `src/constants/seasons.ts` + `src/utils/seasonWeeks.ts`; `functions/src/season/seasonTiers.test.js` fails if the rules drift |
| `functions/src/season/seasonMoney.ts` | **Internal module.** Season margin averaging and money-in maths; re-exported by seasonTiers.ts |

---

## Renaming a Ticker

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
   function set **plus `renameTicker`** (see the "adding characters" playbook for
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

### Why you halt first

The tool halts the market for the migration itself, but that is not the exposed
window. Between the functions deploy (step 5) and clicking Execute (step 7), the
backend knows the NEW ticker and has no price for it, while the old price still
sits under the old name. `executeTrade` auto-creates a missing price from
`basePrice` on first trade, so a single trade in that gap mints a second stock at
the wrong price. Preflight catches it and refuses, but then you have two price
entries to unpick by hand.

### Deploy the index ahead of time

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
`functions/tickerRename.test.js`. Run both before and after touching the engine.

## Splitting a Stock

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
twice) and `functions/stockSplit.test.js`.

## Deploy Checklist

Frontend deploys automatically via Vercel on every push to `main`. Backend requires a manual step.

**When deploying frontend only (most changes):**
1. `npm run build` — confirm clean
2. `git push` — Vercel auto-deploys

**When deploying backend (any change to `functions/`):**
1. If characters changed: `npm run sync:chars`
2. `git push` — for frontend
3. `npm run check:functions`, then `firebase deploy --only functions:<name>,functions:<name>` — only the functions whose code changed, by name (budget). A shared module change means every function that requires it

**Never run `firebase deploy` without `--only functions`** — this would also deploy Firebase Hosting, which we don't use (Vercel owns hosting).

---

## Things That Are Intentionally Not Done

These are known gaps that were evaluated and deliberately left alone. Don't reopen them without a good reason.

- ~~**`executeTrade` refactor**~~ **DONE 2026-07-19**: `functions/src/trading/trading.ts` is now a ~315-line orchestrator; the logic lives in sibling modules `tradeGuards.js` (validation + anti-abuse gates), `tradeActions.js` (buy/sell/short/cover math), `tradePricing.js` (trailing/ETF propagation), `tradeState.js` (IP tracking + user-doc update assembly), `tradeEffects.js` (post-commit achievements/notifications/feed). Still ONE atomic transaction — all reads before writes, write order market → price history → trade record → ipTracking → user doc. `npm run test:trading` (155 checks) is the characterization suite — run before and after ANY change to these files. The internal modules are NOT exported through `functions/src/index.js`.
- ~~**`AdminPanel.jsx` split**~~ **DONE 2026-07-07**: `src/AdminPanel.tsx` is now a ~300-line orchestrator. All state/handlers live in `src/hooks/admin/` (one hook per domain, each ≤200 lines); tab components receive hook returns as spread props. `src/AdminPanel.test.tsx` is the characterization test — run `npm test` before and after touching anything in the admin panel.
- ~~**`LadderGame.jsx` split**~~ **DONE 2026-07-07**: `src/components/LadderGame.tsx` is now a ~135-line orchestrator. Logic lives in `src/hooks/ladder/` (data listeners, game flow, banners, DOM animation, modals); UI lives in `src/components/ladder/` (board, side panel, three modals, shared style constants). The DOM path animation was moved verbatim into `src/hooks/ladder/animatePath.ts` — its timing values are load-bearing, don't tweak them casually. `src/components/LadderGame.test.tsx` is the characterization test — run `npm test` before and after touching anything in the ladder game.
- ~~**End-to-end trade tests**~~ **DONE**: the emulator suites (`npm run test:trading`, `test:limitorders`, `test:premarket`, `test:season`, and ~15 more; see package.json) run the real function code against a local Firestore, and CI runs the money-path ones on every push to main (`.github/workflows/ci.yml`).
- **TypeScript migration**: APPROVED 2026-10-07 as a full conversion. The frontend (`src/`) is all TypeScript since 2026-10-08; the backend is converting file by file (new backend files are `.ts`). Follow the order in `docs/MODERNIZATION.md`; don't convert files outside the current phase.

---

## Weekly Halt Schedule

The market halts every **Thursday 13:00–21:00 UTC** for chapter review. This is enforced in:
- Frontend: `src/utils/marketHours.ts` (`isWeeklyHalt()`)
- Backend: `functions/src/shared/constants/` (`WEEKLY_HALT_DAY`, `WEEKLY_HALT_START_HOUR`, `WEEKLY_HALT_END_HOUR`)

Manual halts can also be triggered by an admin via the admin panel, which sets `marketData.marketHalted` in Firestore. Both halt types block all trades.

Pre-market timeline inside the Thursday halt: orders queue 20:30–20:55 UTC (`preMarket.js`), the lock hits at 20:55 (no new orders or cancellations), the opening auction + stop-loss sweep runs at 20:56 (`marketOrders.js`, applies any deferred IPO jumps first), and the market reopens clean at 21:00. If the auction run fails, the admin-only `triggerMarketOpenOrders` callable re-runs it idempotently.

---

## Common Gotchas

- **`activeUserData` vs `userData`** in App.tsx: `userData` is the logged-in user's Firestore doc. `activeUserData` is derived from it with fallbacks. Always use `activeUserData` when reading holdings/shorts/cohorts, not `userData` directly.
- **`colorBlindMode`**: Not stored directly in context — derive it everywhere as `const colorBlindMode = userData?.colorBlindMode || false`. It affects green/red color choices throughout the UI.
- **Guest mode**: `isGuest` flag is true when a user is browsing without an account. Most write operations and modals should be gated behind `!isGuest`.
- **Price impact**: Every trade moves the price. The preview calculation uses `calculatePriceImpactDollars` in `src/utils/calculations.ts`. The backend uses `calculateMarginalImpact` in `functions/src/shared/impact.ts`. Both use the same marginal sqrt formula. If you change the formula, change it in both places and re-run `npm test`.
- **ETFs**: ETF prices trail their constituent characters. This is handled in `executeTrade` via trailing effects. ETF entries are identified by `isETF: true` in `src/characters.ts` (there is no `type` field).
