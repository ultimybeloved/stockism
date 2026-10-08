// Pre-deploy sanity checks for functions/. Run: npm run check:functions
//
// Three checks, all of which have caught real problems:
//
//  0. ENVIRONMENT — functions/.env is uploaded by the deploy and REPLACES the
//     whole live environment. Deploying without it wipes the Discord tokens and
//     Sentry DSN from production while reporting success. Lives in check-env.cjs
//     so `npm run check:env` and the firebase.json predeploy hook share it.
//
//  1. EXPORT PURITY — functions/src/index.js loads every file listed in
//     servicePaths.js. Those files sometimes export a plain helper for a sibling
//     or a test; serviceLoader.js copies across only real Cloud Functions, and
//     this check proves nothing else reached the deployed surface.
//
//  2. CONSTANTS IMPORTS — a file that uses a constant without importing it
//     throws at runtime, in production, only on the code path that touches it.
//     This is the check documented in CLAUDE.md.
//
// Exits non-zero on any finding so it can gate a deploy.

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');
const SRC_DIR = path.join(FUNCTIONS_DIR, 'src');

// Every backend source file except tests, as [absolute path, label].
const sourceFiles = (dir = SRC_DIR) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith('.js') || entry.name.includes('.test.')) return [];
    return [[full, path.relative(SRC_DIR, full).split(path.sep).join('/')]];
  });

let problems = 0;

// --- 0. Environment ---------------------------------------------------------

// First, because on a fresh clone it is the check most likely to fail and the
// only one whose failure would silently break production.
problems += require('./check-env.cjs').checkEnv();

// --- 1. Export purity -------------------------------------------------------

// A real Cloud Function carries __trigger/__endpoint from the firebase-functions
// builder. Anything else on the entry point is a leaked helper or constant.
const isCloudFunction = (v) => typeof v === 'function' && v.__trigger !== undefined && v.__endpoint !== undefined;

// The package.json "main", exactly what firebase-tools loads.
const exports_ = require(FUNCTIONS_DIR);
const leaked = Object.keys(exports_).filter((k) => !isCloudFunction(exports_[k]));

if (leaked.length > 0) {
  problems += leaked.length;
  console.log('Entry point exports that are NOT Cloud Functions:');
  leaked.forEach((k) => console.log(`  ${k}  (${typeof exports_[k]})`));
  console.log('  -> move these into shared/helpers.js or an internal module no services.js lists\n');
} else {
  console.log(`Export purity: OK (${Object.keys(exports_).length} exports, all Cloud Functions)`);
}

// --- 1b. Lazy-load scan coverage -------------------------------------------

// serviceLoader.js finds a function's owning file by regex-scanning sources for
// `exports.<name> =` rather than requiring them, so a function declared some
// other way would not be found. That is fail-open (it falls back to loading
// everything, costing startup time but never breaking), but it silently loses
// the cold-start win — so flag it here instead of letting it rot.
const servicePaths = require(path.join(SRC_DIR, 'servicePaths.js'));
const scanFinds = (name) =>
  servicePaths.some((p) =>
    new RegExp(`^exports\\.${name}\\s*=`, 'm').test(fs.readFileSync(path.join(SRC_DIR, `${p}.js`), 'utf8')),
  );

const unscannable = Object.keys(exports_).filter((name) => !scanFinds(name));

if (unscannable.length > 0) {
  problems += unscannable.length;
  console.log('Functions serviceLoader cannot locate by source scan:');
  unscannable.forEach((k) => console.log(`  ${k}`));
  console.log('  -> declare them as `exports.<name> = ...` at the start of a line\n');
} else {
  console.log('Lazy-load scan: OK (every function locatable without loading it)');
}

// --- 2. Constants imports ---------------------------------------------------

const constantNames = Object.keys(require(path.join(SRC_DIR, 'shared', 'constants.js')));

// Counted separately from `problems` so a failure in an earlier check does not
// hide whether this one actually passed.
let constantsProblems = 0;

// Comments routinely mention constants by name to explain behaviour ("the slot
// frees up after DISCORD_RELINK_COOLDOWN_MS"). Scanning raw source flags those
// as missing imports, so strip comments and strings before looking for real use.
const stripNonCode = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

// Every source file. helpers.js was NOT scanned here until 2026-09-23, so a
// constant used in it but never imported would only surface as a ReferenceError
// on whichever path touched it — and in writeFeedEntry that path is inside a
// try/catch, so feed entries would have stopped appearing with nothing logged.
const CONSTANTS_SCAN = sourceFiles().filter(([, label]) => !['shared/constants.js', 'index.js'].includes(label));

CONSTANTS_SCAN.forEach(([file, label]) => {
  const raw = fs.readFileSync(file, 'utf8');
  const source = stripNonCode(raw);
  // Collect EVERY destructured require, not just the one from constants.
  // Several names constants.js re-exports actually originate elsewhere (CREWS
  // and the crew mission values come from crews.js), so a file importing one
  // from its real source is correct and must not be reported as missing.
  const imported = [...raw.matchAll(/\{([^}]+)\}\s*=\s*require\(/g)].map((m) => m[1]).join(',');
  const missing = constantNames.filter(
    (name) =>
      !imported.includes(name) &&
      new RegExp(`\\b${name}\\b`).test(source) &&
      !new RegExp(`const ${name}\\b`).test(source),
  );
  if (missing.length > 0) {
    constantsProblems += missing.length;
    console.log(`${label}: missing constants import — ${missing.join(', ')}`);
  }
});

if (constantsProblems === 0) console.log('Constants imports: OK');
problems += constantsProblems;

// --- 3. helpers.js imports resolve ------------------------------------------
//
// The mirror of the constants check, and it exists for the same reason: a name
// destructured out of helpers.js that helpers.js never exported is `undefined`,
// and nothing says so until the one code path that calls it runs in production.
// marketMakerCycle imported `monthIdOf` this way and threw
// "monthIdOf is not a function" on EVERY hourly run — the stabiliser was dead
// and the only trace was a log line nobody was reading.

const helperExports = new Set(Object.keys(require(path.join(SRC_DIR, 'shared', 'helpers.js'))));
let helperProblems = 0;

for (const [file, label] of sourceFiles()) {
  if (label === 'shared/helpers.js') continue;
  const raw = fs.readFileSync(file, 'utf8');
  for (const m of raw.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\((['"])[^'"]*helpers\2\)/g)) {
    const missing = m[1]
      .split(',')
      .map((s) => s.split(':')[0].trim())
      .filter((n) => n && !helperExports.has(n));
    if (missing.length) {
      helperProblems += missing.length;
      console.log(`${label}: imports from helpers.js that are not exported — ${missing.join(', ')}`);
    }
  }
}

if (helperProblems === 0) console.log('Helpers imports: OK');
else console.log('  -> add the name to module.exports in functions/src/shared/helpers.js\n');
problems += helperProblems;

if (problems === 0) {
  console.log('\nAll checks passed.');
} else {
  console.log(`\n${problems} problem(s) found. Fix before deploying.`);
}

process.exit(problems > 0 ? 1 : 0);
