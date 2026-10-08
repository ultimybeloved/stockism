'use strict';
// Copies src/characters.ts and src/crews.ts into functions/src/shared/ (the
// backend deploys only what is inside functions/). Run after editing either:
//   npm run sync:chars
const fs = require('fs');
const { SHARED, generatedPath, generate } = require('./lib/sharedSource.cjs');

for (const name of SHARED) {
  fs.writeFileSync(generatedPath(name), generate(name));
  console.log(`Synced src/${name}.ts → functions/src/shared/${name}.ts`);
}
