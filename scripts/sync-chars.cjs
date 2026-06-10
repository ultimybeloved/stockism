// Copies src/characters.js → functions/characters.js
// and     src/crews.js      → functions/crews.js
// Run before deploying functions: npm run sync:chars
const fs = require('fs');
const path = require('path');

const files = [
  ['../src/characters.js', '../functions/characters.js'],
  ['../src/crews.js', '../functions/crews.js'],
];

files.forEach(([from, to]) => {
  fs.copyFileSync(path.join(__dirname, from), path.join(__dirname, to));
  console.log(`Synced ${from.replace('../', '')} → ${to.replace('../', '')}`);
});
