# Deploying

## Frontend

Vercel deploys `main` automatically on every push. Before pushing:

1. `npm run build` exits clean.
2. `npm test`, `npm run lint`, `npm run typecheck`.
3. `git push`.

## Backend (anything under `functions/`)

Never automatic. Needs `functions/.env` and `firebase login` on the machine (see
the README).

1. If `src/characters.ts`, `src/crews.ts` or anything in `src/rules/` changed:
   `npm run sync:chars`, and commit the generated copies with the source.
2. `git push` (CI runs the same checks).
3. `npm run check:functions`. Silent success means clean. It builds
   `functions/lib/` and checks:
   - **Environment:** `functions/.env` exists with every required key
     (`scripts/check-env.cjs` owns the list; also `npm run check:env`).
   - **Export purity:** `functions/src/index.js` exports only real Cloud
     Functions. Internal helpers that a service exports for a sibling or a test
     must not reach it.
   - **Constants imports:** every service file imports what it uses from
     `functions/src/shared/constants/`.
4. Deploy **only the functions whose code changed, by name**:

   ```bash
   node scripts/deploy-functions.cjs --only executeTrade,payDividends
   ```

   Work the list out from which files changed: every exported Cloud Function in
   those files, plus every function that imports a changed shared module and
   reads the changed value at runtime. The script checks every name against the
   real exports before deploying anything.

`npm run deploy:functions` with no arguments deploys **all** 153 functions. Use it
only when a change genuinely touches every function (for example `fnConfig.ts`,
App Check settings, or a library upgrade). Each function deploy is a Cloud Build;
full deploys exceed the free daily build minutes.

### Rules

- **Never run `firebase deploy` without `--only functions`.** A bare deploy also
  pushes Firebase Hosting, which is unused (Vercel serves the site).
- **Never deploy without `functions/.env`.** The deploy replaces the whole live
  environment with that file, so a missing one wipes the Discord tokens, OAuth
  secret and Sentry DSN, and still reports success. `check:env` is wired into
  `check:functions`, `deploy:functions` and the `firebase.json` predeploy hook
  to stop this.
- **Never rename a deployed function.** A rename deletes and recreates it.
- New backend env var: classify it in `scripts/check-env.cjs` as REQUIRED or
  OPTIONAL. The check fails on any unclassified one.

### When it goes wrong

- **"Rate exceeded" / "failed to update function X".** Google rate limiting. The
  script batches in tens, retries, and names any function that did not deploy
  with the exact command to re-run. The firebase CLI exits 0 on a partial failure,
  so always read the summary. A function that failed keeps serving its old code.
- **"Cannot determine backend specification. Timeout after 10000."** The CLI
  gives the code 10 seconds to load. Check it loads at all with
  `cd functions && GCLOUD_PROJECT=stockism-abb28 FIREBASE_CONFIG='{"projectId":"stockism-abb28"}' node -e "require('./lib/index.js')"`,
  then re-run the deploy with `FUNCTIONS_DISCOVERY_TIMEOUT=90`.

## Firestore rules and indexes

```bash
npm run test:rules
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

An index takes minutes to build after deploy. The emulator never warns about a
missing collection-group index, so deploy new ones ahead of the code that needs
them.
