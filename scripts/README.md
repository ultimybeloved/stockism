# Admin Scripts

Scripts for managing Stockism database operations.

## Setup (One-Time)

1. **Download your Firebase service account key:**
   - Go to: https://console.firebase.google.com/project/stockism-abb28/settings/serviceaccounts/adminsdk
   - Click "Generate new private key"
   - Save as `service-account-key.json` in project root
   - ⚠️ **NEVER commit this file to git** (already in .gitignore)

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Scripts that load backend code** (anything requiring `functions/src/...`) run
   through tsx, because parts of the backend are TypeScript:
   ```bash
   npx tsx scripts/who-is.cjs <name>
   ```

## Scripts

### check-data.cjs

Validates the character / crew / ETF data. Silent success = clean, non-zero exit
with a list of what to fix otherwise. No network, no credentials.

**Usage:**
```bash
npm run check:data
```

**What it catches:**
- ETF trailing weights that don't sum to 0.8 (i.e. a member was added without
  re-weighting the rest), and members weighted unequally
- ETF constituents with no trailing factor, or trailing factors that aren't
  constituents
- Crew members missing from their crew's fund
- Trailing factors, constituents, or crew members pointing at tickers that don't
  exist
- Duplicate tickers or names, missing basePrice / dateAdded

Run it after editing `src/characters.ts` or `src/crews.ts`, before `sync:chars`.

---

### market-status.cjs

Read-only snapshot of the live market. **No service account key needed** — the
market doc is world-readable, and App Check comes from the debug token already in
`.env.local`.

**Usage:**
```bash
npm run status:market
```

**What it tells you:**
- Which IPO characters have launched and now trade as normal stocks. This only
  exists in Firestore (`launchedTickers`), so it is otherwise invisible from the
  codebase — `ipoRequired: true` stays on a character forever, even after launch.
- Whether any character is missing a live price (a "dead stock": bots skip it, it
  never shows in gainers/losers, blank chart) and needs Init New Character Prices.
- Prices left over from renamed or removed characters.
- Current halt state, weekly and manual.

Run it after adding a character, and before assuming anything about IPO state.

---

### spam-name-audit.cjs / spam-name-detail.cjs / spam-name-purge.cjs

Finds and removes harassment usernames — accounts named to insult another
player ("StitchSlaveCallmebot"). Three steps, read-only until the last one.

**Usage:**
```bash
npx tsx scripts/spam-name-audit.cjs    # find them (read-only)
node scripts/spam-name-detail.cjs    # activity + database footprint (read-only)
node scripts/spam-name-purge.cjs     # dry run
node scripts/spam-name-purge.cjs --confirm
```

**The audit** scans every account and flags two things: a name containing a slur,
and a name containing a real player's name plus a degrading word. The player-name
list is derived from the data at run time, so it stays current. It also warns when
a top-25 player is missing from `PROTECTED_PLAYER_NAMES` in `functions/src/shared/helpers.js`,
which is what the signup filter uses — that list is hand-curated and will otherwise
go stale as the leaderboard moves.

**Read the detail before deleting.** `lastActive` is unset on most old docs and
the newest *trade* record is nearly always a scheduled dividend, so an abandoned
account looks active from both. The detail script reports the last real buy/sell
separately for exactly this reason.

**Editing the target list:** `spam-name-targets.cjs` is the only thing the purge
will delete. Each entry carries the expected display name; the purge aborts the
whole run if any uid no longer matches, so a stale uid can never wipe an innocent
account.

**What the purge does** (same teardown as a player self-deleting, same order):
- ✅ Audit record into `moderationDeletions` first — deletion is irreversible
- ✅ Username tombstoned so the name can never be registered again
- ✅ Open limit / pre-market orders cancelled
- ✅ `recursiveDelete` of the user doc and all subcollections
- ✅ Signup IP slot held for ~a month, Discord tombstoned if linked
- ✅ Firebase Auth account deleted
- ✅ Cached leaderboard docs cleared so the names drop off immediately

Shares are deleted rather than sold, so no stock price moves. Trade records are
left alone on purpose: they are market history.

---

### Everything else

Read-only unless marked. Each file's header comment has the full usage.

| Script | What it does |
|---|---|
| `halt-price-audit.cjs` (`npm run audit:halt [date]`) | What moved prices during a Thursday halt. Runs automatically every Thursday as `haltPriceAudit`; use this for a specific day |
| `halt-window-audit.cjs` / `halt-window-profit.cjs` | Who traded inside the halt window, and whether it paid |
| `pre-halt-check.cjs` | Looks for trading on advance knowledge of a chapter |
| `who-is.cjs` | Find an account by name |
| `account-forensics.cjs` | Week-by-week history of one account against exploit patch dates |
| `alt-verdicts.cjs`, `alt-audit.cjs`, `connection-map.cjs`, `whose-connection.cjs` | Alt-account investigation: who works together, and which accounts are one person |
| `household-roster.cjs`, `household-report.cjs`, `link-detail.cjs`, `link-report.cjs`, `location-matrix.cjs` | Accounts sharing a connection, measured directly |
| `cluster-pump.cjs` | What a linked group did to prices, treated as one trader |
| `sim-daily-drop.cjs` | Simulates the daily drop payout against live prices |
| `download-backup.cjs` | Downloads the latest market backup from Storage |
| `emergency-restore.cjs` | **WRITES.** Restores price history from the latest backup over live data. Last resort; the admin panel's restore is the normal path |
| `collapse-review-history.cjs` | **WRITES.** Collapses one chapter review's price-history staircase by hand (the 20:54 job normally does this) |
| `post-rules.cjs` | **WRITES to Discord.** Posts or edits the server rules message |
| `register-discord-commands.cjs` (`npm run discord:commands`), `sync-crew-emojis.cjs` (`npm run discord:emojis`) | **WRITES to Discord.** Bot slash commands and crew emojis. `discord-api.cjs` is their shared plumbing |
| `seed-emulator.cjs`, `set-sandbox-state.cjs`, `loadtest-*.cjs` | Local emulator sandbox only |
| `pixel-badges.cjs` | Draws the pixel-art achievement badges into public/pins/achievements/ |
| `sync-chars.cjs`, `check-*.cjs`, `deploy-functions.cjs` | Build and deploy tooling, run through the npm scripts in the root package.json |

Banning a player is done from the admin panel (`banUser`), which also books the ledger. The old `ban-user.js` wrote cash directly and was removed.

---

## Security Notes

- Scripts use Firebase Admin SDK (full database access)
- Service account key must be kept private
- Always test on a backup project first if unsure
- Backups are saved to `backups/` folder automatically
