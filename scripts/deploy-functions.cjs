'use strict';

const { spawn } = require('child_process');
const path = require('path');

const BATCH_SIZE = 10;
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFunctionNames() {
  // Load the real entry point, the same way firebase-tools does, so the list is
  // exactly what a deploy would upload (service files also export some helpers).
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';
  const entry = require(path.join(__dirname, '..', 'functions'));
  return Object.keys(entry)
    .filter((name) => typeof entry[name] === 'function' && entry[name].__endpoint !== undefined)
    .sort();
}

/**
 * Run one firebase deploy, streaming its output live AND keeping a copy.
 *
 * It has to do both. Handing the output straight through to the terminal means
 * this script never sees it and can only check the exit code — and the CLI exits
 * ZERO while printing "failed to update function X" for a function that did not
 * deploy. That has silently shipped a half-deploy twice: processMarketOpenOrders
 * on 2026-08-23, and dailyMarketSummary on 2026-08-25, which was the function
 * that records the market index. Both looked like clean deploys.
 *
 * Capturing without streaming would leave you watching a blank terminal for
 * minutes, so this pipes, echoes every chunk as it arrives, and scans the copy
 * once the process exits.
 */
function runDeploy(only) {
  return new Promise((resolve) => {
    const child = spawn(`firebase deploy --only "${only}"`, { shell: true });
    let output = '';
    const tap = (stream, target) =>
      stream.on('data', (chunk) => {
        target.write(chunk);
        output += chunk.toString();
      });
    tap(child.stdout, process.stdout);
    tap(child.stderr, process.stderr);
    child.on('close', (code) => resolve({ code: code === null ? 1 : code, output }));
    child.on('error', (err) => resolve({ code: 1, output: `${output}\n${err.message}` }));
  });
}

/**
 * Functions the CLI admitted it could not update, even on a zero exit code.
 * The message carries the full resource path, so the bare name is pulled out.
 */
function failedFunctions(output) {
  const names = new Set();
  const pattern = /failed to update function (?:projects\/[^\s/]+\/locations\/[^\s/]+\/functions\/)?([A-Za-z0-9_-]+)/g;
  let match;
  while ((match = pattern.exec(output)) !== null) names.add(match[1]);
  return [...names];
}

/** Deploy a batch. Returns the names that never landed — empty when all did. */
async function deployBatch(names, batchNum, total) {
  console.log(`\n[Batch ${batchNum}/${total}] Deploying ${names.length} functions: ${names.join(', ')}`);

  let pending = [...names];
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    const only = pending.map((n) => `functions:${n}`).join(',');
    const { code, output } = await runDeploy(only);
    const refused = failedFunctions(output);

    if (code === 0 && refused.length === 0) {
      console.log(`[Batch ${batchNum}/${total}] OK`);
      return [];
    }

    if (code === 0) {
      // The dangerous case: exit 0, some functions quietly left on old code.
      console.log(`[Batch ${batchNum}/${total}] CLI exited clean but did NOT update: ${refused.join(', ')}`);
      pending = refused;
    } else {
      console.log(`[Batch ${batchNum}/${total}] Deploy failed (exit ${code})`);
      // A hard failure says nothing about which ones landed, so retry them all
      // unless the output named specific casualties.
      if (refused.length) pending = refused;
    }

    if (attempt < RETRY_LIMIT) {
      console.log(
        `[Batch ${batchNum}/${total}] Retrying ${pending.length} in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${RETRY_LIMIT})...`,
      );
      await sleep(RETRY_DELAY_MS);
    } else {
      console.error(`[Batch ${batchNum}/${total}] FAILED after ${RETRY_LIMIT} attempts: ${pending.join(', ')}`);
      return pending;
    }
  }
  return pending;
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
    .split(',')
    .map((s) => s.trim().replace(/^functions:/, ''))
    .filter(Boolean);
  if (asked.length === 0) {
    console.error('--only needs a comma-separated list of function names');
    process.exit(1);
  }

  const unknown = asked.filter((n) => !allNames.includes(n));
  if (unknown.length > 0) {
    console.error(`Unknown function name(s): ${unknown.join(', ')}`);
    console.error('Check spelling against the function list printed by npm run check:functions.');
    process.exit(1);
  }
  return asked.sort();
}

async function main() {
  // The firebase.json predeploy hook runs this too, but it runs per batch and
  // only after the CLI has spun up. Checking here fails in a second, before any
  // batch starts, with the same message.
  if (require('./check-env.cjs').checkEnv() > 0) {
    console.error('\nEnvironment check failed. Nothing deployed.');
    process.exit(1);
  }

  const allNames = requestedNames(getFunctionNames());
  console.log(`Deploying ${allNames.length} function(s)`);

  const batches = [];
  for (let i = 0; i < allNames.length; i += BATCH_SIZE) {
    batches.push(allNames.slice(i, i + BATCH_SIZE));
  }

  console.log(`Deploying in ${batches.length} batches of up to ${BATCH_SIZE}`);

  const failed = [];
  for (let i = 0; i < batches.length; i++) {
    failed.push(...(await deployBatch(batches[i], i + 1, batches.length)));
  }

  console.log('\n=== Deploy Summary ===');
  if (failed.length === 0) {
    console.log(`All ${allNames.length} function(s) deployed and confirmed.`);
  } else {
    // Named, not counted. These are still running their old code, and being able
    // to act on that is the entire point of the check.
    console.error(`${failed.length} function(s) did NOT deploy: ${failed.join(', ')}`);
    console.error('They are still on their previous version. Re-run with:');
    console.error(`  node scripts/deploy-functions.cjs --only ${failed.join(',')}`);
    process.exit(1);
  }
}

// Exported so the failure detection can be tested without running a deploy, and
// guarded so requiring this file can never kick off a 145-function deploy.
module.exports = { failedFunctions };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
