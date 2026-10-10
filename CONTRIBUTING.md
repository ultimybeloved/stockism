# Contributing

Setup and commands are in the [README](README.md). Read
[docs/architecture.md](docs/architecture.md) before changing code: it says where
each kind of code lives and which rules are enforced.

## Workflow

1. Work on `main` in small commits, or a branch for anything risky. Vercel
   deploys `main` on every push.
2. Run the checks that cover what you touched **before and after** the change:
   - always: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`
   - backend: `npm run lint:functions`, `npm run check:functions`, and the
     emulator suite for the area (`npm run test:trading`, `test:limitorders`,
     ..., or `npm run test:emulator` for all of them)
   - the characterization tests listed in the architecture doc, for the areas
     they cover
3. Try risky changes in the sandbox (`npm run emulators`, `npm run seed:emulator`,
   `npm run dev:emulator`). Plain `npm run dev` writes to the live game.
4. Deploy the backend by hand, following [docs/runbooks/deploy.md](docs/runbooks/deploy.md).

The pre-commit hook (husky + lint-staged) runs ESLint and Prettier on staged
files. CI runs everything above on every push to `main`.

## Conventions

- TypeScript everywhere, strict. New backend files are `.ts`.
- Prettier formats; don't hand-format. `.editorconfig` covers editors.
- File-size limits are lint errors. Split the file before adding to it.
- No magic numbers: economy values are named constants (`src/constants/`,
  `functions/src/shared/constants/`).
- A rule both sides use goes in `src/rules/` once, then `npm run sync:chars`.
  Never edit the generated copies in `functions/src/shared/`.
- Dark mode: write both themes in one class string (`light:bg-white
  dark:bg-zinc-900`), never a `darkMode ? ... : ...` ternary for classes.
- Global state comes from `useTheme()` / `useSession()` / `useMarket()`, never
  from props.
- Player-facing text: plain short sentences, no em dashes. Times in UTC, 24-hour.
- Any change to the game's rules or numbers updates
  [docs/game-rules.md](docs/game-rules.md) in the same commit.

## Commits

Short, plain messages ("Fix bug", "Update portfolio"). No co-author lines.

Never commit `.env.local`, `functions/.env` or `service-account-key.json`.

## Before you commit

- [ ] No function defined twice across the codebase
- [ ] No inline economy numbers
- [ ] No file past its line limit
- [ ] `functions/src/index.js` still only re-exports (15 lines max)
- [ ] Characters or crews changed: `npm run check:data` and `npm run sync:chars`,
      source and generated copies committed together
- [ ] Every order-filling path keeps the invariants in the architecture doc's
      "Every lane that fills an order" table
- [ ] No secrets in code; user input validated server-side
