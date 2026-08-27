// Pre-deploy environment check. Run: npm run check:env
//
// WHY THIS EXISTS
//
// `firebase deploy --only functions` uploads functions/.env and REPLACES the
// entire live environment with it. It does not merge. If the file is absent,
// every deployed function comes back with no Discord token, no OAuth secret and
// no Sentry DSN — the bot goes silent (403s that are never surfaced), Discord
// login breaks, and error reporting stops. The deploy itself reports success,
// so nothing looks wrong until someone notices the bot stopped posting.
//
// This happened once already, deploying an emergency fix from a fresh clone on
// a second machine. functions/.env is gitignored (it holds live credentials and
// always will be), so a clone can never have it. The only defence is refusing
// to deploy without it.
//
// Two checks:
//
//  1. functions/.env has every required key, with a non-empty value.  FATAL.
//  2. .env.local has every VITE_ key that src/ reads.                  WARNING.
//     Vercel builds from its own dashboard env vars, so a missing .env.local
//     only breaks local `npm run dev` / `npm run build`, never production.
//
// Values are never printed. Key names only.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Injected by Google/Firebase at runtime, or by the emulator. Never in a .env.
const PLATFORM = new Set([
  'GCLOUD_PROJECT', 'GCP_PROJECT', 'K_SERVICE', 'FUNCTION_NAME', 'FUNCTION_TARGET',
  'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR',
  'FIREBASE_CONFIG', 'NODE_ENV',
]);

// Must be present and non-empty or production loses a feature silently.
// Note the ones written as `process.env.X || ''` in constants.js are still
// required: the empty fallback stops a crash, it does not make the feature work.
const REQUIRED = {
  DISCORD_BOT_TOKEN: 'every Discord message the bot sends',
  DISCORD_CHANNEL_ID: 'the main announcements channel',
  DISCORD_SIGNUP_CHANNEL_ID: 'the signup feed channel',
  DISCORD_CLIENT_ID: 'Discord account linking (OAuth)',
  DISCORD_CLIENT_SECRET: 'Discord account linking (OAuth)',
  DISCORD_PUBLIC_KEY: 'slash command signature verification',
  ADMIN_DISCORD_USER_ID: 'admin-only Discord commands',
  SENTRY_DSN: 'backend error reporting',
};

// Deliberately allowed to be absent, with the reason it is safe.
const OPTIONAL = {
  DISCORD_GUILD_ID: 'crew-head roles are dormant until the role IDs are filled in',
  ADMIN_UID: 'falls back to the hardcoded admin UID in functions/constants.js',
};

// VITE_ keys that do not belong in .env.local.
const VITE_ELSEWHERE = new Set(['VITE_USE_EMULATOR']);

/** Every .js/.jsx file under a directory, skipping node_modules. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Distinct env var names matched by `pattern` across `dir`. */
function envNamesUsedIn(dir, pattern) {
  const names = new Set();
  for (const file of sourceFiles(dir)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(pattern)) names.add(m[1]);
  }
  return names;
}

/** Keys with a non-empty value in a .env file. Values are discarded. */
function envKeysWithValues(file) {
  if (!fs.existsSync(file)) return null;
  const keys = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (value) keys.add(key);
  }
  return keys;
}

function checkEnv() {
  let problems = 0;

  // --- 1. functions/.env (FATAL) -------------------------------------------

  // Any env var the backend reads must be classified. An unclassified one means
  // a new variable was added without deciding whether prod breaks without it,
  // so it is reported rather than quietly assumed safe.
  const used = envNamesUsedIn(path.join(ROOT, 'functions'), /process\.env\.([A-Z][A-Z_0-9]*)/g);
  const unclassified = [...used].filter(
    (n) => !PLATFORM.has(n) && !(n in REQUIRED) && !(n in OPTIONAL)
  );
  if (unclassified.length > 0) {
    problems += unclassified.length;
    console.log('Backend env vars not classified in scripts/check-env.cjs:');
    unclassified.forEach((n) => console.log(`  ${n}`));
    console.log('  -> add each to REQUIRED (prod breaks without it) or OPTIONAL (with the reason)\n');
  }

  const fnKeys = envKeysWithValues(path.join(ROOT, 'functions', '.env'));

  if (fnKeys === null) {
    problems += 1;
    console.log('functions/.env is MISSING.');
    console.log('');
    console.log('  DO NOT DEPLOY. A functions deploy replaces the whole live environment');
    console.log('  with this file, so deploying without it wipes these from production:');
    Object.entries(REQUIRED).forEach(([k, why]) => console.log(`    ${k}  (${why})`));
    console.log('');
    console.log('  The file is gitignored on purpose, so a fresh clone never has it.');
    console.log('  Copy it from the main dev machine (password manager or USB, not email');
    console.log('  or Discord, since the bot token and client secret are live keys).');
    console.log('  functions/.env.example lists the key names.\n');
  } else {
    const missing = Object.keys(REQUIRED).filter((k) => !fnKeys.has(k));
    if (missing.length > 0) {
      problems += missing.length;
      console.log('functions/.env is present but incomplete. DO NOT DEPLOY.');
      console.log('  Missing or empty:');
      missing.forEach((k) => console.log(`    ${k}  (${REQUIRED[k]})`));
      console.log('  A deploy would clear these in production.\n');
    } else {
      console.log(`functions/.env: OK (${Object.keys(REQUIRED).length} required keys present)`);
    }
  }

  // --- 2. .env.local (WARNING) ---------------------------------------------

  const viteUsed = [...envNamesUsedIn(path.join(ROOT, 'src'), /import\.meta\.env\.(VITE_[A-Z_0-9]*)/g)]
    .filter((n) => !VITE_ELSEWHERE.has(n));
  const localKeys = envKeysWithValues(path.join(ROOT, '.env.local'));

  if (localKeys === null) {
    console.log('.env.local is missing (warning only).');
    console.log('  Local `npm run dev` and `npm run build` will produce a broken app.');
    console.log('  Production is unaffected: Vercel builds with its own env vars.');
  } else {
    const missingVite = viteUsed.filter((k) => !localKeys.has(k)).sort();
    if (missingVite.length > 0) {
      console.log(`.env.local is missing keys (warning only): ${missingVite.join(', ')}`);
      console.log('  Affects local dev only. Production builds on Vercel are unaffected.');
    } else {
      console.log(`.env.local: OK (${viteUsed.length} VITE_ keys present)`);
    }
  }

  return problems;
}

module.exports = { checkEnv };

if (require.main === module) {
  const problems = checkEnv();
  if (problems > 0) console.log(`\n${problems} problem(s) found. Fix before deploying.`);
  process.exit(problems > 0 ? 1 : 0);
}
