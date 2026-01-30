# Disable App Check Enforcement (Backend)

The error is coming from Cloud Functions enforcing App Check.

## Quick Fix:

1. Go to Firebase App Check settings:
   https://console.firebase.google.com/project/stockism-abb28/appcheck

2. Click on "APIs" tab (or "Cloud Functions" if visible)

3. Find your Cloud Functions and set enforcement to "Not enforced" or "Metrics only"

4. Save changes

## Alternative: Use Firebase Emulators (Better for local dev)

This lets you test everything locally without hitting the real Firebase backend:

```bash
# Install emulators
firebase init emulators

# Select: Authentication, Firestore, Functions

# Start emulators
firebase emulators:start
```

Then update your app to use emulators in development.

