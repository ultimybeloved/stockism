# Stockism

A stock market game built on Lookism characters. Every player trades in the same
live market, so your buys and sells move the price for everyone else.

**Live at:** https://stockism.app

How the game plays (prices, trading, crews, seasons, the weekly halt, the
economy numbers, anti-abuse): [docs/game-rules.md](docs/game-rules.md).

---

## Docs

| File | What it covers |
|---|---|
| [docs/game-rules.md](docs/game-rules.md) | The game: every rule, number and scheduled job |
| [docs/architecture.md](docs/architecture.md) | Where code lives, the rules that keep it tidy, how frontend and backend share logic |
| [docs/runbooks/deploy.md](docs/runbooks/deploy.md) | Shipping the frontend and the backend |
| [docs/runbooks/add-characters.md](docs/runbooks/add-characters.md) | Adding characters, IPOs, ETF weights |
| [docs/runbooks/rename-ticker.md](docs/runbooks/rename-ticker.md) | Renaming a ticker |
| [docs/runbooks/split-stock.md](docs/runbooks/split-stock.md) | Splitting a stock |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Conventions, tests, commits, code review checklist |

---

## Tech stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind 3, React Router 7. Hosted
  on Vercel.
- **Backend:** Firebase Cloud Functions (1st gen, Node 22), TypeScript, 153
  functions grouped by domain.
- **Database:** Firestore, with an allowlist-based security rule on user documents.
- **Auth:** Firebase Auth. Google, Twitter, email/password with verification, and
  Discord via custom token.
- **Monitoring:** Sentry on both sides, loaded lazily on the backend so it costs
  nothing on a cold start.
- **Discord:** two apps, one bot for messages and slash commands, one for OAuth
  login.

---

## Setup

Needs Node 22 (`.nvmrc`), and Java 21+ for the emulator sandbox and the
emulator test suites.

```bash
npm install
npm install --prefix functions
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:5173
```

**`npm run dev` runs against the production Firebase backend.** Any trade or
write hits live data. Use your own account, or the sandbox below.

New developers also need an App Check debug token: generate any UUID, put it in
`.env.local` as `VITE_APPCHECK_DEBUG_TOKEN`, and register the same UUID in the
Firebase Console (App Check -> Apps -> web app -> Manage debug tokens).

### Files that are never in git

Carry these between machines by password manager or USB, never email or Discord.

| File | Needed for | If missing |
|---|---|---|
| `functions/.env` | Deploying functions | **A deploy without it wipes the live backend environment** (Discord tokens, OAuth secret, Sentry DSN) and still reports success. `npm run check:env` blocks that |
| `.env.local` | `npm run dev`, local `npm run build` | Local dev only. Vercel has its own env vars |
| `service-account-key.json` | The admin scripts in `scripts/` | Those scripts refuse to run |

A machine that deploys also needs `firebase login`.

### Sandbox

A fake, resettable backend on your machine. Nothing in it can touch live players.

```bash
npm run emulators       # auth, firestore, functions + UI on :4000
npm run seed:emulator   # write a starting market doc
npm run dev:emulator    # run the app against the emulators
```

Sign up a fresh account in the sandbox. Restarting the emulators wipes it.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | App on :5173, production backend |
| `npm run build` | Production build into `dist/` |
| `npm test` | Unit and component tests (vitest) |
| `npm run test:emulator` | Every emulator suite (needs Java) |
| `npm run test:<suite>` | One emulator suite: `trading`, `limitorders`, `premarket`, `rules`, `season`, `rename`, `split`, ... (see `package.json`) |
| `npm run typecheck` | TypeScript, frontend and backend |
| `npm run lint` / `lint:functions` | ESLint, frontend / backend |
| `npm run format` / `format:check` | Prettier |
| `npm run build:functions` | Compile `functions/src/` to `functions/lib/` |
| `npm run check:functions` | Build plus the pre-deploy checks |
| `npm run check:data` | Character, crew and ETF data consistency |
| `npm run sync:chars` | Copy the shared files into `functions/` (see architecture) |
| `npm run check:sync` | Fail if those copies are stale |
| `npm run deploy:functions` | Batched backend deploy (see the deploy runbook) |
| `npm run status:market` | Read-only summary of the live market |

CI (`.github/workflows/ci.yml`) runs the data, sync, export, format, lint, type,
unit test, build and emulator checks on every push to `main`.

---

## Legal

Unofficial fan project, made for entertainment, not affiliated with or endorsed
by the creators of Lookism.

**Lookism** is created by **Taejun Park (PTJ)** and published by **Naver
Corporation** through **Naver Webtoon**. All character names, likenesses, and
related intellectual property belong to their respective copyright holders.

No copyright infringement intended. Non-commercial, made by fans for fans.

Copyright concerns: **support@stockism.app**
