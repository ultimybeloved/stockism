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
