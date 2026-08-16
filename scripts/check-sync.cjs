'use strict';

// Verifies the generated backend copies match their sources.
//
//   npm run check:sync
//
// Silent success = clean. Exits non-zero and says what to run otherwise.
//
// functions/characters.js and functions/crews.js are generated from src/ by
// `npm run sync:chars`. When someone edits a source file and forgets to sync,
// nothing complains locally: the frontend has the new data and the backend does
// not. Players then get "Invalid ticker" errors on any new character, and new
// crew members are invisible to missions and crew bots. That exact bug shipped
// in June 2026, which is why this is a check and not a convention.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAIRS = [
  ['src/characters.js', 'functions/characters.js'],
  ['src/crews.js', 'functions/crews.js'],
];

const problems = [];

for (const [from, to] of PAIRS) {
  const toPath = path.join(ROOT, to);
  if (!fs.existsSync(toPath)) {
    problems.push(`${to} does not exist`);
    continue;
  }
  const source = fs.readFileSync(path.join(ROOT, from), 'utf8');
  const generated = fs.readFileSync(toPath, 'utf8');
  if (source !== generated) {
    problems.push(`${to} is out of date with ${from}`);
  }
}

if (problems.length > 0) {
  console.error('Sync check FAILED:');
  problems.forEach((p) => console.error(`  - ${p}`));
  console.error('\nFix: npm run sync:chars   (then commit both files together)');
  process.exit(1);
}
