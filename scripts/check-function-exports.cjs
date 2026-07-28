// Pre-deploy sanity checks for functions/. Run: npm run check:functions
//
// Two checks, both of which have caught real problems:
//
//  1. EXPORT PURITY — functions/index.js re-exports everything a service file
//     exports (`Object.assign(exports, require('./services/x'))`). If a service
//     exports a plain helper or a constant, it lands in the deployed Cloud
//     Function list as a bogus entry. Shared helpers belong in helpers.js or in
//     an internal module that index.js does not require.
//
//  2. CONSTANTS IMPORTS — a service that uses a constant without importing it
//     throws at runtime, in production, only on the code path that touches it.
//     This is the check documented in CLAUDE.md.
//
// Exits non-zero on any finding so it can gate a deploy.

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');
const SERVICES_DIR = path.join(FUNCTIONS_DIR, 'services');

let problems = 0;

// --- 1. Export purity -------------------------------------------------------

// A real Cloud Function carries __trigger/__endpoint from the firebase-functions
// builder. Anything else in index.js is a leaked helper or constant.
const isCloudFunction = (v) =>
  typeof v === 'function' && v.__trigger !== undefined && v.__endpoint !== undefined;

const exports_ = require(path.join(FUNCTIONS_DIR, 'index.js'));
const leaked = Object.keys(exports_).filter((k) => !isCloudFunction(exports_[k]));

if (leaked.length > 0) {
  problems += leaked.length;
  console.log('index.js exports that are NOT Cloud Functions:');
  leaked.forEach((k) => console.log(`  ${k}  (${typeof exports_[k]})`));
  console.log('  -> move these into helpers.js or an internal module not required by index.js\n');
} else {
  console.log(`Export purity: OK (${Object.keys(exports_).length} exports, all Cloud Functions)`);
}

// --- 2. Constants imports ---------------------------------------------------

const constantNames = Object.keys(require(path.join(FUNCTIONS_DIR, 'constants.js')));

// Comments routinely mention constants by name to explain behaviour ("the slot
// frees up after DISCORD_RELINK_COOLDOWN_MS"). Scanning raw source flags those
// as missing imports, so strip comments and strings before looking for real use.
const stripNonCode = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/`(?:\\.|[^`\\])*`/g, '``')
  .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
  .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

fs.readdirSync(SERVICES_DIR)
  .filter((f) => f.endsWith('.js'))
  .forEach((file) => {
    const raw = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8');
    const source = stripNonCode(raw);
    const match = raw.match(/\{([^}]+)\}\s*=\s*require\('\.\.\/constants'\)/);
    const imported = match ? match[1] : '';
    const missing = constantNames.filter((name) =>
      !imported.includes(name)
      && new RegExp(`\\b${name}\\b`).test(source)
      && !new RegExp(`const ${name}\\b`).test(source)
    );
    if (missing.length > 0) {
      problems += missing.length;
      console.log(`${file}: missing constants import — ${missing.join(', ')}`);
    }
  });

if (problems === 0) {
  console.log('Constants imports: OK');
  console.log('\nAll checks passed.');
} else {
  console.log(`\n${problems} problem(s) found. Fix before deploying.`);
}

process.exit(problems > 0 ? 1 : 0);
