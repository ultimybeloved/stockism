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

// Deploying every function is the exception, not the default: each one is a
// separate Cloud Build, and a full redeploy for a localized change wastes the
// daily free build tier and spikes the cost forecast. Pass the functions you
// actually changed:
//   node scripts/deploy-functions.cjs --only executeTrade,claimMissionReward
// Batching still applies, so a long list won't trip the deploy rate limit.
function requestedNames(allNames) {
  const flag = process.argv.indexOf('--only');
  if (flag === -1) return allNames;

  const asked = (process.argv[flag + 1] || '')
    .split(',').map(s => s.trim().replace(/^functions:/, '')).filter(Boolean);
  if (asked.length === 0) {
    console.error('--only needs a comma-separated list of function names');
    process.exit(1);
  }

  const unknown = asked.filter(n => !allNames.includes(n));
  if (unknown.length > 0) {
    console.error(`Unknown function name(s): ${unknown.join(', ')}`);
    console.error('Check spelling against functions/services/*.js exports.');
    process.exit(1);
  }
  return asked.sort();
}

async function main() {
  const allNames = requestedNames(getFunctionNames());
  console.log(`Deploying ${allNames.length} function(s)`);

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
