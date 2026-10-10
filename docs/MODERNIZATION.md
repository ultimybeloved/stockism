# Modernization plan

Started 2026-10-07. Goal: a codebase any professional developer can pick up, on
2026 standards, fully converted to TypeScript. This file tracks what is left.
Delete it when the last phase ships.

**Ground rules for every step**

- No change players can see. Every step is behavior-neutral unless it says so.
- Run `npm test`, `npm run lint`, `npm run build`, and the emulator suites that
  cover the touched code before and after.
- Never rename a deployed Cloud Function (a rename deletes and recreates it).
- Commit at small working checkpoints and update this file as you go, so work can
  resume mid-phase.

## Phase 1: Guardrails (done)

Prettier, editorconfig, `.nvmrc` (Node 22), husky + lint-staged pre-commit,
backend lint and `format:check` in CI, the 5 missing emulator suites in CI,
file-size limits as `max-lines` lint rules, finished one-off moderation scripts
moved out of the repo (copies in the ignored `local/archive/`).

## Phase 2: Frontend TypeScript (done 2026-10-08)

All of `src/` is TypeScript (strict, `noUncheckedIndexedAccess`; `allowJs` is
off). Conventions for new code:

- Callables are typed in `src/api/callables.ts` via `callable<Req, Res>('name')`,
  shapes in `src/api/types.ts`.
- Firestore doc shapes live in `src/types/index.ts`; add fields as code reads them.
- Props passed straight from a hook are typed `Pick<ReturnType<typeof useX>, ...>`.
- Action hooks take `ActionHookDeps` (`src/shared/hooks/types.ts`); admin hooks take
  `AdminHookDeps` (`src/features/admin/utils/adminShared.ts`).
- Tests typecheck under `tsconfig.test.json` (relaxes `noUncheckedIndexedAccess`).
- `npm run sync:chars` strips types from `src/characters.ts` + `src/crews.ts`
  into `functions/`; Node scripts read the roster through
  `scripts/lib/sharedSource.cjs` `load()`.

Every file is within its size limit; the warn-only list in `eslint.config.js`
is gone.

Left for Phase 4: ProfileChart and PortfolioChart duplicate their drawing code.

Backend bug found during the conversion, fixed in code 2026-10-08, live once
`getPublicProfile` and `getLeaderboard` are deployed: they sent
`displayCrewPin || null`, so a player who hid their crew pin still showed it on
their public profile and the leaderboard.

## Phase 3: Backend restructure + TypeScript

1. ~~Domain folders~~ **Done 2026-10-08.** Everything is under `functions/src/`
   (`package.json` main is `src/index.js`). Each domain's `services.js` lists its
   deployable files and `servicePaths.js` joins them; the shared modules and the
   generated characters/crews are in `src/shared/`; vitest files sit beside
   their module. Same 153 functions. Also fixed: the `firebase.json` predeploy
   still ran `npm --prefix functions run lint`, a script Phase 1 removed, which
   would have failed every deploy; it runs `npm run lint:functions` now.
   Nothing is deployed yet: production runs the old layout until step 7.
2. ~~Split helpers and constants~~ **Done 2026-10-08.** `helpers.js` (2,331
   lines) is 14 topic modules in `functions/src/shared/` plus a re-exporting
   `helpers.js`; `constants.js` is 18 topic files in `shared/constants/` plus
   `index.js`. Every export kept its exact value and source. Callers still
   import through the barrels; moving them to the topic modules can happen
   file by file during the TypeScript conversion. `indexMaintenance.js` moved
   to `shared/` too, since shared code needs it.
3. TypeScript build. **Build done 2026-10-08**: `functions/tsconfig.json`
   (strict, `noUncheckedIndexedAccess`, `allowJs` so JS and TS mix),
   `npm run build:functions` → `functions/lib/`, `main: lib/index.js`, built by
   the predeploy hook, `check:functions`, `deploy:functions` and `emulators`.
   Emulator suites run through tsx; backend vitest files get tsx's require hook
   (`functions/test/setup.ts`, the `backend` vitest project).
   **Converted (done 2026-10-08):** every backend logic file: all of
   `shared/`, the roster copies (`sync:chars` copies `src/characters.ts` and
   `src/crews.ts` verbatim, types included), and every domain module. Document
   shapes live in `shared/types.ts`; add fields as code reads them. Admin
   callables use `requireAdmin(context)` from `fnConfig`. Imports go to the
   topic module (`../shared/impact`), not the `helpers` barrel. Exports are
   `export const name = ...`; tsc emits `exports.name = ...`, which
   serviceLoader's scan finds. A test that reassigns a module export must swap
   the cached module instead (see `test-drop-halt-emulator.cjs`): TS exports
   are read-only.
   **Left in JS:** the plumbing (`index.js`, `serviceLoader.js`,
   `servicePaths.js`, each domain's `services.js`) and the backend
   `*.test.js` files. Converting the plumbing means teaching
   `serviceLoader`/`check-function-exports.cjs` to read `.ts` service lists;
   after that `allowJs` and the `.js` branches in `check-function-exports.cjs`
   can go.
   Files over the 600-line limit were split along the way (seasonCheckpoint,
   seasonMoney, crewRankings, tickerRenameChecks, stockSplitMath,
   signupHelpers), each an internal module re-exported where callers expect it.
4. ~~Replace `console.log` with `firebase-functions/logger`~~ **Done 2026-10-09**
   (218 calls, 51 files), deployed 2026-10-09. New backend code logs through `logger`, never `console`.
5. One shared source for game rules used by both sides (characters, crews,
   economy rules, impact math, season tiers, ladder tax) instead of mirrored
   copies with "keep in sync" comments. **Done 2026-10-09:** the mechanism is
   `src/rules/` -> `functions/src/shared/rules/` via sync:chars, guarded by
   check:sync. Modules: ladder, lmsr, activity, impact, money, equity, seasons,
   seasonMoney (margin averaging, money in, week maths), economy (every
   constant that was marked "keep in sync"). Deployed 2026-10-09.
6. ~~Emulator suites on vitest~~ **Done 2026-10-09.** They live in
   `tests/emulator/` (own config, so `npm test` skips them) and
   `npm run test:emulator` runs all of them: the Firestore/Auth suites in one
   emulator boot (`test:emulator:core`, each file starts from an empty
   database), then the event market, which needs the functions emulator.
   `npm run test:<suite>` still runs one. A suite reports through `check()`
   from `tests/emulator/harness.js` (a soft expect, so every failing check is
   listed); a suite that needs the market seeded calls
   `beforeAll(seedEmulator)`. The suites are still JavaScript.
7. ~~Deploy every function once~~ **Done 2026-10-09**: all 153 deployed with
   `npm run deploy:functions`, the TypeScript build and the split files included.

## Phase 4: Frontend restructure

1. ~~Feature folders~~ **Done 2026-10-09.** `src/features/<feature>/{components,hooks,pages,utils}`
   (16 features), `src/shared/{components,hooks}` for code several features
   use, `src/app/` for the shell. 277 files moved, every import rewritten; utils,
   constants, context, types, api and rules stay at the top of `src/`. The
   callables moved to `src/api/` in step 2. File-size limits in
   `eslint.config.js` follow the new folders.
2. ~~`src/api/` wrappers~~ **Done 2026-10-09.** Every callable is in
   `src/api/callables.ts`, all typed (shapes in `src/api/types.ts`);
   `src/firebase.ts` is only the Firebase setup. The one error path is
   `src/utils/errors.ts`, which every caller already used. Tests that mock a
   callable mock `api/callables`, not `firebase`.
3. ~~Split AppContext~~ **Done 2026-10-09.** `useTheme()`, `useSession()`,
   `useMarket()` (one context each, `useAppContext` is gone); App builds each
   value with its own memo. Pages that read no market data (leaderboard,
   ladder, achievements, public profile) are `memo`'d so price ticks skip them.
   App itself still subscribes to prices (its trade/portfolio hooks need them),
   so everything it renders with changing props still re-renders; step 5 is
   where that tightens.
4. ~~Tailwind `dark:` variant~~ **Done 2026-10-09.** The theme is a `dark` class on
   `<html>` (`useDarkMode` sets it before paint); `tailwind.config.js` adds a
   `light:` variant so each string carries both themes exactly as the old
   ternary did (680 converted). `getThemeClasses(darkMode)` is the constant
   `themeClasses`; all 63 `darkMode={darkMode}` props are gone. `darkMode` is
   still read through `useTheme()` for chart colours, image paths and inline
   styles. The rarity trims and cosmetic name effects in `index.css` got an
   `html` prefix, since the theme classes now load after them. Checked by
   comparing every element's computed styles, old build vs new, on every route
   in both themes.
5. ~~Router and providers~~ **Done 2026-10-09.** The market subscriptions moved
   to `src/app/MarketDataProvider.tsx`, mounted above App in `main.tsx`; the
   routes to `src/app/AppRoutes.tsx`; the price-driven account upkeep to
   `src/app/BackgroundTasks.tsx`. App reads no live market values: the action
   hooks read the market when clicked through `useMarketAccess().getMarket`,
   and the header, home page, predictions page and modal stack read what they
   show from `useMarket()`. A price tick now re-renders only market readers,
   not App, the layout or the non-market pages (`App.smoke.test.tsx` checks
   this). App.tsx is 290 lines, down from 402.

## Phase 5: Library upgrades (one per commit)

Vite, Firebase JS SDK 12, firebase-admin (one version), firebase-functions
(stay 1st gen via `firebase-functions/v1`), React 19, Tailwind 4 last.
Not doing: 2nd-gen Cloud Functions (changes the bill and the Discord webhook URL).

- **Vite: Done 2026-10-09.** 5 -> 8 (+ `@vitejs/plugin-react` 6), the same Vite
  vitest already ran on. Vendor chunks moved from `manualChunks` to Rolldown's
  `codeSplitting.groups` (same split). Every route and modal identical old vs new
  in both themes. Needs Node 20.19+ (`.nvmrc` is 22).
  `build.target` keeps Vite 5's browser list; Vite 8's default (Safari 16.4+)
  would drop older iPhones.
- **Firebase JS SDK: Done 2026-10-09.** 10.14 -> **12.14.0, pinned exactly.**
  12.15+ bundles `re2js` (Firestore pipeline regex) whether used or not: +57 KB
  gzip for every player. 13.0 was two days old. Revisit when Firebase makes it
  tree-shakeable; check `vendor-firebase` gzip size before bumping.
- **firebase-functions: Done 2026-10-09 (not deployed yet).** 4.9 -> 7.4. Done
  before firebase-admin because admin 13 needs functions 6+. Every import is now
  `firebase-functions/v1` (6+ made the bare import 2nd gen). All 153 functions'
  deploy settings (`__endpoint`) identical old vs new; emulator suites pass.
  Changes the runtime of every function, so it ships as one full deploy.

## Phase 6: Docs

README = setup, commands, architecture. Game rules → `docs/game-rules.md`.
`docs/architecture.md`, `docs/runbooks/` (deploy, rename ticker, split stock,
add characters), `CONTRIBUTING.md`. CLAUDE.md shrinks to point at them, and its
"no TypeScript" rule is replaced.
