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

Run it after editing `src/characters.js` or `src/crews.js`, before `sync:chars`.

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

### migrate-ticker.js
Migrate a character from one ticker to another.

**Usage:**
```bash
node scripts/migrate-ticker.js <oldTicker> <newTicker>
```

**Example:**
```bash
node scripts/migrate-ticker.js DOTS CROW
```

**What it does:**
- ✅ Creates backup of all data
- ✅ Migrates market prices and history
- ✅ Updates all user holdings, cost basis, shorts
- ✅ Archives old price history
- ✅ Cleans up old ticker data

**After running:**
- Update `src/characters.js` - change the ticker
- Update any `trailingFactors` that reference the old ticker
- Update `src/crews.js` if the character is in a crew
- Deploy: `npm run build && firebase deploy`

---

### ban-user.js
Ban a user and disable their account.

**Usage:**
```bash
node scripts/ban-user.js <userId>
```

**Example:**
```bash
node scripts/ban-user.js iTsQ6vLOmpUvjHHj6shx6itZARZ2
```

**What it does:**
- ✅ Disables Firebase authentication (can't sign in)
- ✅ Marks account as banned in database
- ✅ Resets cash and portfolio to $1000
- ✅ Clears holdings and shorts

---

## Security Notes

- Scripts use Firebase Admin SDK (full database access)
- Service account key must be kept private
- Always test on a backup project first if unsure
- Backups are saved to `backups/` folder automatically
