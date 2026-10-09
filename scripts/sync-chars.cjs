'use strict';
// Copies src/characters.ts, src/crews.ts and every src/rules/*.ts into
// functions/src/shared/ (the backend deploys only what is inside functions/),
// and removes rule copies whose source is gone. Run after editing any of them:
//   npm run sync:chars
const fs = require('fs');
const { SHARED, generatedPath, generate, staleCopies, RULES_COPY_DIR } = require('./lib/sharedSource.cjs');

fs.mkdirSync(RULES_COPY_DIR, { recursive: true });
for (const name of SHARED) {
  fs.writeFileSync(generatedPath(name), generate(name));
  console.log(`Synced src/${name}.ts → functions/src/shared/${name}.ts`);
}
for (const name of staleCopies()) {
  fs.unlinkSync(generatedPath(name));
  console.log(`Removed functions/src/shared/${name}.ts (its source is gone)`);
}
