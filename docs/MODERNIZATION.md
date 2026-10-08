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

Open item: 8 frontend files exceed their limit after reformatting and are
warn-only in `.eslintrc.cjs`. They get split in Phase 4. Remove each from that
list as it is split.

## Phase 2: Frontend TypeScript (in progress)

Done: `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `allowJs` until the
last file converts), `npm run typecheck` in CI, ESLint 9 flat config
(`eslint.config.js`, one config for src + functions), `src/types/` domain
types, 19 small utils/constants, and `src/characters.ts` + `src/crews.ts`.

The roster files are TypeScript now; `npm run sync:chars` strips the types into
`functions/*.js` via `scripts/lib/sharedSource.cjs`, and Node scripts read the
roster through its `load()`. Any script that needs a converted `src/` file must
go through `load()` too (`check-data.cjs` is the example).

Conversion rule: rename `.js`→`.ts` (`.jsx`→`.tsx`) with `git mv`, type every
parameter, no `any` (lint rejects it), use `!` only where an index is proven in
range. Tests convert with their subject. Add fields to `src/types/index.ts` as
code needs them.

Done also: all of `src/constants/` and `src/utils/` (except `dividends.test.js`).
`npm run typecheck` runs both tsconfigs.

Also done: `firebase.ts`, `monitoring.ts`, `context/AppContext.tsx` (typed
`AppContextValue`), all top-level hooks, `src/hooks/ladder/`. Callables are typed in
`src/firebase.ts` via `callable<Req, Res>('name')` with shapes in
`src/api/types.ts`; type a callable when converting the code that reads it.
Action hooks take `ActionHookDeps` from `src/hooks/types.ts`.

All of `src/hooks/` is done, admin included (shared admin types in
`hooks/admin/adminShared.ts`: `AdminHookDeps`, `AdminUser`). Admin callable
results that only the admin tabs render are typed `AdminReport` for now;
tighten each one when its tab converts.

Tests typecheck under `tsconfig.test.json`, which only relaxes
`noUncheckedIndexedAccess`.

Remaining, in order:
1. The last 26 JS files (`git ls-files 'src/*.jsx' 'src/*.js'`). Admin panel is
   done. Next batch: PreMarketModal, CrewSelectionModal, ShopTab, PriceChart,
   PredictionCard.test. MarketGrid waits on CharacterCard. App.jsx (662 lines)
   must be split while converting; also split MarketIndex, AboutModal,
   LeaderboardPage, StockPage (on the eslint warn list).
   Noted for later: ProfileChart and PortfolioChart duplicate their drawing code
   (merge in Phase 4). Backend bug: getPublicProfile sends `displayCrewPin || null`,
   so a player who hid their crew pin still shows it on their public profile.
2. Turn off `allowJs`; drop the JS globs from `eslint.config.js`.

## Phase 3: Backend restructure + TypeScript

1. Move `functions/services/*` into domain folders
   `functions/src/{trading,orders,margin,market,season,admin,discord,moderation,ladder,predictions,users,crews,missions,shared}/`.
   Each domain's `index` lists its deployable functions; internal modules sit
   beside it. `servicePaths.js` becomes derived. Update `check-function-exports`,
   `serviceLoader`, emulator suite imports, and CLAUDE.md in the same change.
2. Split `helpers.js` (2,091 lines) and `constants.js` (1,199 lines) into topic
   modules under `functions/src/shared/`, keeping a temporary barrel so imports
   don't all change at once.
3. TypeScript build: `functions/src/**/*.ts` → `tsc` → `functions/lib/`,
   `main: lib/index.js`, build in the `firebase.json` predeploy hook. Emulator
   suites import the built output or run through `tsx`.
4. Replace `console.log` with `firebase-functions/logger`.
5. One shared source for game rules used by both sides (characters, crews,
   economy rules, impact math, season tiers, ladder tax) instead of mirrored
   copies with "keep in sync" comments.
6. Move emulator suites from `scripts/test-*` to `tests/emulator/` on vitest,
   one `npm run test:emulator` command.
7. Deploy every function once (all code moved). Batch to avoid the rate limit.

## Phase 4: Frontend restructure

1. Feature folders `src/features/<feature>/{components,hooks,api}` +
   `src/shared/`.
2. `src/api/` wrappers for the 109 `httpsCallable` call sites, typed, one error
   path.
3. Split AppContext into theme / auth+user / market contexts (price ticks stop
   re-rendering everything).
4. Tailwind `dark:` variant instead of `getThemeClasses(darkMode)`; removes the
   63 `darkMode={darkMode}` props. Verify with the screenshot rig.
5. Break `App.jsx` into router, shell, providers.

## Phase 5: Library upgrades (one per commit)

Vite, Firebase JS SDK 12, firebase-admin (one version), firebase-functions
(stay 1st gen via `firebase-functions/v1`), React 19, Tailwind 4 last.
Not doing: 2nd-gen Cloud Functions (changes the bill and the Discord webhook URL).

## Phase 6: Docs

README = setup, commands, architecture. Game rules → `docs/game-rules.md`.
`docs/architecture.md`, `docs/runbooks/` (deploy, rename ticker, split stock,
add characters), `CONTRIBUTING.md`. CLAUDE.md shrinks to point at them, and its
"no TypeScript" rule is replaced.
