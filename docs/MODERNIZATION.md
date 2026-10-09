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

- Callables are typed in `src/firebase.ts` via `callable<Req, Res>('name')`,
  shapes in `src/api/types.ts`.
- Firestore doc shapes live in `src/types/index.ts`; add fields as code reads them.
- Props passed straight from a hook are typed `Pick<ReturnType<typeof useX>, ...>`.
- Action hooks take `ActionHookDeps` (`src/hooks/types.ts`); admin hooks take
  `AdminHookDeps` (`hooks/admin/adminShared.ts`).
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
   (218 calls, 51 files). Not deployed yet: it rides along with the next
   backend deploy. New backend code logs through `logger`, never `console`.
5. One shared source for game rules used by both sides (characters, crews,
   economy rules, impact math, season tiers, ladder tax) instead of mirrored
   copies with "keep in sync" comments. **In progress:** the mechanism is
   `src/rules/` -> `functions/src/shared/rules/` via sync:chars, guarded by
   check:sync. Done: `rules/ladder`, `rules/lmsr`, `rules/activity`, `rules/impact`.
   Next: equity (exitEquityAt, getTotalInvested), season tiers/divisions,
   then the remaining mirrored constants.
6. Move emulator suites from `scripts/test-*` to `tests/emulator/` on vitest,
   one `npm run test:emulator` command.
7. ~~Deploy every function once~~ **Done 2026-10-09**: all 153 deployed with
   `npm run deploy:functions`, the TypeScript build and the split files included.

## Phase 4: Frontend restructure

1. Feature folders `src/features/<feature>/{components,hooks,api}` +
   `src/shared/`.
2. `src/api/` wrappers for the 109 `httpsCallable` call sites, typed, one error
   path.
3. Split AppContext into theme / auth+user / market contexts (price ticks stop
   re-rendering everything).
4. Tailwind `dark:` variant instead of `getThemeClasses(darkMode)`; removes the
   63 `darkMode={darkMode}` props. Verify with the screenshot rig.
5. Break `App.tsx` further into router and providers (the shell, status screens and
   small state hooks already moved out on 2026-10-08).

## Phase 5: Library upgrades (one per commit)

Vite, Firebase JS SDK 12, firebase-admin (one version), firebase-functions
(stay 1st gen via `firebase-functions/v1`), React 19, Tailwind 4 last.
Not doing: 2nd-gen Cloud Functions (changes the bill and the Discord webhook URL).

## Phase 6: Docs

README = setup, commands, architecture. Game rules → `docs/game-rules.md`.
`docs/architecture.md`, `docs/runbooks/` (deploy, rename ticker, split stock,
add characters), `CONTRIBUTING.md`. CLAUDE.md shrinks to point at them, and its
"no TypeScript" rule is replaced.
