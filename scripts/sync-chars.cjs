// Copies src/characters.js → functions/characters.js
// Run before deploying functions: npm run sync:chars
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../src/characters.js');
const dest = path.join(__dirname, '../functions/characters.js');

fs.copyFileSync(src, dest);
console.log('Synced src/characters.js → functions/characters.js');
