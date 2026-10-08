'use strict';
// Generates functions/src/shared/characters.js and functions/src/shared/crews.js from the TypeScript
// sources in src/ (types stripped, code unchanged). Run after editing either:
//   npm run sync:chars
const fs = require('fs');
const { SHARED, generatedPath, generate } = require('./lib/sharedSource.cjs');

for (const name of SHARED) {
  fs.writeFileSync(generatedPath(name), generate(name));
  console.log(`Synced src/${name}.ts → functions/src/shared/${name}.js`);
}
