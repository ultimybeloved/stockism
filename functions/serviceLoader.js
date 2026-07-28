'use strict';
// Loads service files onto index.js's exports, and copies across only the
// exports Firebase would actually deploy.
//
// WHY THIS ISN'T JUST Object.assign:
//
// 1. EXPORT PURITY. Service files sometimes export an internal helper so a
//    sibling service or an emulator test can drive it (runLimitOrderCheck,
//    trackWatchedIpTrade, ...). Object.assign copied those onto index.js where
//    they looked like deployable Cloud Functions. Firebase ignored them, but it
//    made index.js a misleading picture of the deployed surface — and a plain
//    constant once sat in the function list unnoticed. Only things carrying a
//    trigger get copied now.
//
// 2. COLD START. Firebase loads index.js for EVERY function invocation, so a
//    Discord slash command used to load the trading engine, the ladder game and
//    the admin tools before doing anything. When the runtime tells us which
//    function is being invoked, we find its owning file by READING the sources
//    (cheap) rather than requiring them (expensive), and load just that one.
//
// FAIL-OPEN IS THE WHOLE SAFETY STORY: if we cannot identify the target, cannot
// find its owner, or load the owner and still don't have the function, we fall
// back to loading everything — i.e. exactly the old behaviour. A wrong guess
// costs a little startup time, never a missing function.

const fs = require('fs');
const path = require('path');

// The runtime sets one of these to the function being invoked. All are unset
// when firebase-tools loads this file locally to discover what to deploy, which
// is exactly when we want to load everything.
const invokedFunction = () =>
  process.env.K_SERVICE
  || process.env.FUNCTION_TARGET
  || process.env.FUNCTION_NAME
  || null;

// Does this file export `name`, without executing it? Every Cloud Function in
// this codebase is declared as `exports.<name> = ...` at the start of a line;
// `npm run check:functions` verifies this scan still finds all of them.
const fileExports = (absPathNoExt, name) => {
  try {
    const source = fs.readFileSync(`${absPathNoExt}.js`, 'utf8');
    return new RegExp(`^exports\\.${name}\\s*=`, 'm').test(source);
  } catch (_) {
    return false;
  }
};

const isDeployable = (value) =>
  typeof value === 'function'
  && (value.__endpoint !== undefined || value.__trigger !== undefined);

const copyFunctions = (serviceModule, target) => {
  for (const [name, value] of Object.entries(serviceModule)) {
    if (isDeployable(value)) target[name] = value;
  }
};

module.exports = (target, baseDir, servicePaths) => {
  const resolve = (p) => path.join(baseDir, p);
  const wanted = invokedFunction();

  if (wanted) {
    const owner = servicePaths.find((p) => fileExports(resolve(p), wanted));
    if (owner) {
      copyFunctions(require(resolve(owner)), target);
      if (typeof target[wanted] === 'function') return;
    }
  }

  servicePaths.forEach((p) => copyFunctions(require(resolve(p)), target));
};
