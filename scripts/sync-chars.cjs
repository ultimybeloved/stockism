'use strict';
// Generates functions/characters.js and functions/crews.js from the TypeScript
// sources in src/ (types stripped, code unchanged). Run after editing either:
//   npm run sync:chars
const fs = require('fs');
const { SHARED, generatedPath, generate } = require('./lib/sharedSource.cjs');

for (const name of SHARED) {
  fs.writeFileSync(generatedPath(name), generate(name));
  console.log(`Synced src/${name}.ts → functions/${name}.js`);
}
