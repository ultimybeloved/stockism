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

## Phase 1: Guardrails (done; formatting commit pending push)

Prettier, editorconfig, `.nvmrc` (Node 22), husky + lint-staged pre-commit,
backend lint and `format:check` in CI, the 5 missing emulator suites in CI,
file-size limits as `max-lines` lint rules, finished one-off moderation scripts
moved out of the repo (copies in the ignored `local/archive/`).

Open item: 8 frontend files exceed their limit after reformatting and are
warn-only in `.eslintrc.cjs`. They get split in Phase 4. Remove each from that
list as it is split.

## Phase 2: TypeScript foundation (next)

1. Frontend: `typescript`, `@types/react`, `@types/react-dom`; `tsconfig.json`
   with `strict`, `allowJs` (temporary), `noEmit`, `moduleResolution: bundler`;
   `npm run typecheck` in CI. Convert leaf-first: `src/utils` →
   `src/constants` → characters/crews → hooks → components → pages → App.
2. Upgrade ESLint 8 → 9 (flat config) with `typescript-eslint`, one config for
   frontend and backend.
3. Domain types in `src/types/` (User doc, Market doc, Holding, Order, Season).
   These become the shared contract with the backend.

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
