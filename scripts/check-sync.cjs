'use strict';

// Verifies the generated backend copies match their sources.
//
//   npm run check:sync
//
// Silent success = clean. Exits non-zero and says what to run otherwise.
//
// functions/src/shared/characters.ts and functions/src/shared/crews.ts are generated from src/ by
// `npm run sync:chars`. When someone edits a source file and forgets to sync,
// nothing complains locally: the frontend has the new data and the backend does
// not. Players then get "Invalid ticker" errors on any new character, and new
// crew members are invisible to missions and crew bots. That exact bug shipped
// in June 2026, which is why this is a check and not a convention.

const fs = require('fs');

const { SHARED, generatedPath, generate } = require('./lib/sharedSource.cjs');

const problems = [];

for (const name of SHARED) {
  const from = `src/${name}.ts`;
  const to = `functions/src/shared/${name}.ts`;
  const toPath = generatedPath(name);
  if (!fs.existsSync(toPath)) {
    problems.push(`${to} does not exist`);
    continue;
  }
  const unixLines = (s) => s.split('\r\n').join('\n');
  if (unixLines(generate(name)) !== unixLines(fs.readFileSync(toPath, 'utf8'))) {
    problems.push(`${to} is out of date with ${from}`);
  }
}

if (problems.length > 0) {
  console.error('Sync check FAILED:');
  problems.forEach((p) => console.error(`  - ${p}`));
  console.error('\nFix: npm run sync:chars   (then commit both files together)');
  process.exit(1);
}
