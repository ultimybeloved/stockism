# App Check Debug Token Setup for Localhost

## Steps:

1. **Refresh your browser** at http://localhost:5174/

2. **Open Browser Console** (F12 or right-click > Inspect > Console tab)

3. **Look for the debug token** - You'll see a message like:
   ```
   Firebase App Check debug token: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
   ```
   Copy this token (the XXXXXXXX part)

4. **Add debug token to Firebase Console:**
   - Go to: https://console.firebase.google.com/project/stockism-abb28/appcheck/apps
   - Find your web app
   - Click "Manage debug tokens"
   - Click "Add debug token"
   - Paste the token from step 3
   - Give it a name like "localhost-dev"
   - Click "Save"

5. **Refresh your browser again**

6. **Try signing in** - App Check errors should be gone!

## Alternative: Completely Disable App Check (Quick & Dirty)

If the above is too complex, I can completely disable App Check for now by commenting it out entirely. Just let me know!

