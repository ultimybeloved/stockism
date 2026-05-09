'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 10;
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 15000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFunctionNames() {
  const servicesDir = path.join(__dirname, '..', 'functions', 'services');
  const files = fs.readdirSync(servicesDir).filter(f => f.endsWith('.js'));
  const names = new Set();

  for (const file of files) {
    const src = fs.readFileSync(path.join(servicesDir, file), 'utf8');
    const matches = src.matchAll(/exports\.(\w+)\s*=/g);
    for (const m of matches) names.add(m[1]);
  }

  // Also check functions/index.js for any top-level exports
  const indexPath = path.join(__dirname, '..', 'functions', 'index.js');
  if (fs.existsSync(indexPath)) {
    const src = fs.readFileSync(indexPath, 'utf8');
    const matches = src.matchAll(/exports\.(\w+)\s*=/g);
    for (const m of matches) names.add(m[1]);
  }

  return [...names].sort();
}

async function deployBatch(names, batchNum, total) {
  const only = names.map(n => `functions:${n}`).join(',');
  console.log(`\n[Batch ${batchNum}/${total}] Deploying ${names.length} functions: ${names.join(', ')}`);

  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      execSync(`firebase deploy --only "${only}"`, { stdio: 'inherit' });
      console.log(`[Batch ${batchNum}/${total}] OK`);
      return true;
    } catch (err) {
      if (attempt < RETRY_LIMIT) {
        console.log(`[Batch ${batchNum}/${total}] Failed (attempt ${attempt}/${RETRY_LIMIT}), retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(`[Batch ${batchNum}/${total}] FAILED after ${RETRY_LIMIT} attempts`);
        return false;
      }
    }
  }
  return false;
}

async function main() {
  const allNames = getFunctionNames();
  console.log(`Found ${allNames.length} functions total`);

  const batches = [];
  for (let i = 0; i < allNames.length; i += BATCH_SIZE) {
    batches.push(allNames.slice(i, i + BATCH_SIZE));
  }

  console.log(`Deploying in ${batches.length} batches of up to ${BATCH_SIZE}`);

  const failed = [];
  for (let i = 0; i < batches.length; i++) {
    const ok = await deployBatch(batches[i], i + 1, batches.length);
    if (!ok) failed.push(i + 1);
  }

  console.log('\n=== Deploy Summary ===');
  if (failed.length === 0) {
    console.log(`All ${batches.length} batches deployed successfully.`);
  } else {
    console.error(`${failed.length} batch(es) failed: ${failed.map(n => `#${n}`).join(', ')}`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
