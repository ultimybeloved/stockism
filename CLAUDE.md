# Claude Code Instructions

## Local Dev Setup

Run the app locally before pushing changes:

1. `npm install` (once)
2. `npm run dev` → opens http://localhost:5173
3. **App Check setup (only if onboarding a new dev):** generate any UUID, put it in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN`, then register the same UUID at Firebase Console → App Check → Apps → web app → Manage debug tokens. Existing token in `.env.local` already works for the current dev.

`.env.local` already has all the keys. Do NOT commit it (it's gitignored).

Local dev runs against the **production** Firebase backend, so any trades or writes hit live data — test with the user's own account, not a fresh one.

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

Always verify every service file imports everything it uses from `functions/constants.js`. Run this check before any `firebase deploy`:

```bash
node -e "
const fs=require('fs');
const c=Object.keys(require('./functions/constants'));
fs.readdirSync('functions/services').filter(f=>f.endsWith('.js')).forEach(f=>{
  const s=fs.readFileSync('functions/services/'+f,'utf8');
  const m=s.match(/\{([^}]+)\}\s*=\s*require\('\.\.\/constants'\)/);
  const imp=m?m[1]:'';
  const miss=c.filter(k=>!imp.includes(k)&&new RegExp('\\b'+k+'\\b').test(s)&&!new RegExp('const '+k+'\\b').test(s));
  if(miss.length)console.log(f+': MISSING '+miss.join(', '));
});
"
```

If it prints anything, add the missing imports before deploying. Silent output = clean.

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
| `src/App.jsx` | 500 lines | Stop and refactor before adding more |
| Any backend service (`functions/services/`) | 600 lines | Split by sub-domain |
| `functions/index.js` | 30 lines | It is a re-exporter only — never add logic here |

If a new feature would push a file past its limit, **split the file first, then add the feature.** Never ask permission to do this — it is part of the job.

### Frontend: Where Code Lives

**Components** (`src/components/`)
- One component per file, named to match the file
- Sub-components used only by one parent live in a subfolder: `src/components/portfolio/HoldingRow.jsx`
- Never put business logic in a component — extract to a hook

**Hooks** (`src/hooks/`)
- All stateful logic that doesn't belong in a component goes here
- One concern per hook: `useTradeLogic.js`, `useModalManager.js`, not `useEverything.js`

**Utilities** (`src/utils/`)
- Pure functions only — no side effects, no Firebase, no React
- Calculation logic → `src/utils/calculations.js` (already canonical — do not duplicate)
- Theme/dark mode class strings → `src/utils/theme.js` (already canonical — do not duplicate)
- Formatting → `src/utils/formatters.js`

**Constants** (`src/constants/`)
- Named constants only — no magic numbers in components or hooks
- Economy rules → `src/constants/economy.js`

**Context** (`src/context/AppContext.jsx`)
- Global state that 3+ components need: `darkMode`, `user`, `userData`, `prices`, `priceHistory`, `holdings`, `shorts`, `costBasis`, `marketData`, `showNotification`, `activeIPOs`
- **Never pass these as props.** Components call `useAppContext()`.
- If you find yourself writing `darkMode={darkMode}` as a prop, stop — use context instead

### Backend: Where Code Lives

**Service files** (`functions/services/`)
- Each file owns one domain: trading, users, market, leaderboard, dividends, alerts, discord, admin, adminOps, watchlist, ladderGame, limitOrders, missions, predictions, archiving, margin, crew
- Adding a new Cloud Function: find the right service file and append to it. If none fits, create `functions/services/<newdomain>.js` and add `Object.assign(exports, require('./services/<newdomain>'))` to `functions/index.js`
- Never add Cloud Function logic directly to `functions/index.js`

**Shared constants** (`functions/constants.js`)
- All numeric economy values live here: spread percentages, interest rates, time windows, cash amounts
- If you are writing a number like `0.005`, `10000`, `86400000`, or `7 * 24 * 60 * 60 * 1000` inline in a service file, stop — add a named constant to `functions/constants.js` first

**Shared helpers** (`functions/helpers.js`)
- Utility functions used by multiple service files go here
- Never copy-paste a helper from one service file to another — move it to helpers.js

**Characters** (`src/characters.js` and `functions/characters.js`)
- `src/characters.js` is the **only file you ever edit**. Never touch `functions/characters.js` directly.
- After editing `src/characters.js`, run `npm run sync:chars` — this overwrites `functions/characters.js` automatically.
- Commit both files together, then deploy functions. If you forget the sync, all users get "Invalid ticker" errors for the new character.

### The Anti-Patterns That Created the Original Mess

These specific patterns are banned. If you catch yourself writing any of them, stop and do it the right way.

1. **Inline duplicate functions** — `calculatePriceImpact`, `getBidAskPrices`, `getCurrentPrice` were each defined in 3–4 files simultaneously. Never define a function that already exists elsewhere. Check `src/utils/calculations.js` before writing any price/portfolio math.

2. **Inline theme strings** — `const cardClass = darkMode ? 'bg-zinc-900 ...' : 'bg-white ...'` was copy-pasted 50+ times. Use `getThemeClasses(darkMode)` from `src/utils/theme.js`.

3. **God files** — `App.jsx` at 3,900 lines, `AdminPanel.jsx` at 7,400 lines, `functions/index.js` at 11,000 lines. These took days to untangle. Never let a file grow past its limit without splitting it.

4. **Prop drilling** — passing `darkMode`, `user`, `userData`, `prices` through 3–5 component layers. These are in context. Use `useAppContext()`.

5. **Magic numbers** — `0.005`, `0.15`, `500`, `10000` scattered across backend files with no explanation. Every economy value needs a named constant.

6. **Copy-paste across frontend/backend** — `src/characters.js` and `functions/characters.js` were allowed to diverge and caused trade bugs. Any logic that needs to exist in both places needs a sync mechanism or a single source of truth.

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
- [ ] `functions/index.js` is still a pure re-exporter (≤30 lines)
- [ ] If characters changed: ran `npm run sync:chars` and committed both files

---

## Codebase Map

Quick reference so you know where to look and where to add things.

### Frontend (`src/`)

| Path | What lives here |
|---|---|
| `src/App.jsx` | Router, top-level subscriptions, modal rendering — nothing else |
| `src/context/AppContext.jsx` | Global state: darkMode, user, userData, prices, priceHistory, holdings, shorts, costBasis, marketData, activeIPOs, showNotification |
| `src/hooks/useAuth.js` | Firebase auth state |
| `src/hooks/useMarket.js` | Market/price subscriptions |
| `src/hooks/useModalManager.js` | Single openModal/closeModal pattern — use this, don't add more useState modal flags |
| `src/hooks/useNotifications.js` | Notification bell state |
| `src/utils/calculations.js` | All price/portfolio math — canonical, do not duplicate |
| `src/utils/theme.js` | Dark mode class strings via `getThemeClasses(darkMode)` — canonical, do not duplicate |
| `src/utils/formatters.js` | Currency, number, percentage formatting |
| `src/utils/marketHours.js` | Halt detection, countdown logic |
| `src/constants/economy.js` | Frontend economy constants (dividend rates, hold times) |
| `src/constants/achievements.js` | Achievement definitions |
| `src/constants/cosmetics.js` | Cosmetic item definitions |
| `src/characters.js` | **Source of truth** for all character/ETF data — edit here only |
| `src/components/admin/` | Admin panel split into focused components |
| `src/components/modals/` | All modal components |
| `src/components/layout/` | Header, Footer, MobileBottomNav, Layout wrapper |

### Backend (`functions/`)

| Path | What lives here |
|---|---|
| `functions/index.js` | Re-exports only — 25 lines, never add logic here |
| `functions/constants.js` | All backend economy constants — add new ones here |
| `functions/helpers.js` | Shared utility functions used by multiple services |
| `functions/characters.js` | **Generated file** — never edit directly, always via `npm run sync:chars` |
| `functions/botTrader.js` | Bot trading scheduler |
| `functions/services/trading.js` | executeTrade, validateTrade — the most critical file, treat with care |
| `functions/services/users.js` | createUser, changeDisplayName, deleteAccount, dailyCheckin |
| `functions/services/market.js` | Price updates, market summaries, halt management |
| `functions/services/leaderboard.js` | Rankings, leaderboard computation |
| `functions/services/dividends.js` | Dividend payouts |
| `functions/services/alerts.js` | Price alerts |
| `functions/services/discord.js` | Discord OAuth, linking, interactions |
| `functions/services/admin.js` | Ban/reinstate/cash operations |
| `functions/services/adminOps.js` | Repair/recovery/diagnostic tools |
| `functions/services/margin.js` | Margin lending, short margin calls, bailout |
| `functions/services/crew.js` | Crew switching |
| `functions/services/limitOrders.js` | Limit order creation and processing |
| `functions/services/missions.js` | Daily/weekly mission logic |
| `functions/services/predictions.js` | Prediction markets, IPO price jumps |
| `functions/services/ladderGame.js` | Ladder game mechanics and leaderboard |
| `functions/services/watchlist.js` | IP watchlist, fraud detection |
| `functions/services/archiving.js` | Data archiving and cleanup |

---

## Deploy Checklist

Frontend deploys automatically via Vercel on every push to `main`. Backend requires a manual step.

**When deploying frontend only (most changes):**
1. `npm run build` — confirm clean
2. `git push` — Vercel auto-deploys

**When deploying backend (any change to `functions/`):**
1. If characters changed: `npm run sync:chars`
2. `git push` — for frontend
3. `firebase deploy --only functions` — separate manual step

**Never run `firebase deploy` without `--only functions`** — this would also deploy Firebase Hosting, which we don't use (Vercel owns hosting).

---

## Things That Are Intentionally Not Done

These are known gaps that were evaluated and deliberately left alone. Don't reopen them without a good reason.

- **`executeTrade` refactor** (`functions/services/trading.js`, ~1,600 lines): The function is a single Firestore transaction. Splitting it risks breaking atomicity with no integration tests to catch it. Leave it unless a specific bug requires touching it.
- **End-to-end trade tests**: Would require Firebase Emulator setup. ROI is low unless trade logic is being actively changed.
- **TypeScript migration**: The codebase is plain JS. Don't start adding `.ts` files — a half-migrated codebase is worse than none.

---

## Weekly Halt Schedule

The market halts every **Thursday 13:00–21:00 UTC** for chapter review. This is enforced in:
- Frontend: `src/utils/marketHours.js` (`isWeeklyHalt()`)
- Backend: `functions/constants.js` (`WEEKLY_HALT_DAY`, `WEEKLY_HALT_START_HOUR`, `WEEKLY_HALT_END_HOUR`)

Manual halts can also be triggered by an admin via the admin panel, which sets `marketData.marketHalted` in Firestore. Both halt types block all trades.

---

## Common Gotchas

- **`activeUserData` vs `userData`** in App.jsx: `userData` is the logged-in user's Firestore doc. `activeUserData` is derived from it with fallbacks. Always use `activeUserData` when reading holdings/shorts/cohorts, not `userData` directly.
- **`colorBlindMode`**: Not stored directly in context — derive it everywhere as `const colorBlindMode = userData?.colorBlindMode || false`. It affects green/red color choices throughout the UI.
- **Guest mode**: `isGuest` flag is true when a user is browsing without an account. Most write operations and modals should be gated behind `!isGuest`.
- **Price impact**: Every trade moves the price. The calculation lives in `calculatePriceImpact` in `src/utils/calculations.js` and is mirrored backend-side. If you change the formula, change it in both places and re-run `npm test`.
- **ETFs**: ETF prices trail their constituent characters. This is handled in `executeTrade` via trailing effects. ETF tickers are identified by the `type: 'etf'` field in `src/characters.js`.
