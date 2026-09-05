'use strict';

// Consistency check for the character / crew / ETF data.
//
//   npm run check:data
//
// Silent success = clean. Exits non-zero and prints what to fix otherwise.
//
// This exists because the roster data is hand-maintained across two files and
// nothing validated it. The J High School ETF sat at a 0.846 trailing weight
// for months (an 18th member was added without re-weighting the other 17), and
// Minsik Choi was on the Fist Gang crew roster but missing from the Fist Gang
// fund. Both are invisible by inspection and both change how a live stock moves.
//
// Run it after touching src/characters.js or src/crews.js, before sync:chars.

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { CHARACTERS, CHARACTER_MAP } = require(path.join(ROOT, 'src/characters.js'));
const { CREWS } = require(path.join(ROOT, 'src/crews.js'));
const { GENERATION_IDS } = require(path.join(ROOT, 'src/constants/generations.js'));
const { STORED_STATUS_IDS } = require(path.join(ROOT, 'src/constants/statuses.js'));

// Every ETF trails its members at this combined weight. Individual coefficients
// are ~TARGET/N, rounded to 3 decimals, so the sum lands slightly off.
const WEIGHT_TARGET = 0.8;
const WEIGHT_TOLERANCE = 0.02;

// Which fund holds which crew. There is no link in the data itself, so it lives
// here; a crew missing from this map is reported, not silently skipped.
const CREW_ETF = {
  ALLIED: 'ALLY', BIG_DEAL: 'DEAL', FIST_GANG: 'FIST', SECRET_FRIENDS: 'SCRT',
  HOSTEL: 'HSTL', WTJC: 'WTJC', WORKERS: 'VVIP', YAMAZAKI: 'YAMA',
  KITAE_UNION: 'SHDW',
  GOD_DOG: null, // 3 members, deliberately has no fund
};

const errors = [];
const warnings = [];
const tickers = new Set(CHARACTERS.map((c) => c.ticker));

// --- uniqueness ---
const seenT = new Set();
const seenN = new Set();
for (const c of CHARACTERS) {
  if (seenT.has(c.ticker)) errors.push(`duplicate ticker: ${c.ticker}`);
  if (seenN.has(c.name)) errors.push(`duplicate name: ${c.name}`);
  seenT.add(c.ticker);
  seenN.add(c.name);
  if (!(c.basePrice > 0)) errors.push(`${c.ticker}: basePrice must be a positive number`);
  if (!c.dateAdded) errors.push(`${c.ticker}: missing dateAdded`);

  // Generation is optional (the roster is being classified in batches), but a
  // value that is not a known id is a typo inventing a fifth generation.
  if (c.generation !== undefined) {
    if (c.isETF) errors.push(`${c.ticker}: ETFs do not have a generation`);
    else if (!GENERATION_IDS.includes(c.generation)) {
      errors.push(`${c.ticker}: unknown generation "${c.generation}" — expected one of ${GENERATION_IDS.join(', ')}`);
    }
  }

  // Story status. Absent means alive, which is the common case, so 'alive' is
  // never written out — spelling it explicitly is a sign someone misread the
  // convention and may have set it on characters who are not alive.
  if (c.status !== undefined) {
    if (c.isETF) errors.push(`${c.ticker}: ETFs do not have a status`);
    else if (!STORED_STATUS_IDS.includes(c.status)) {
      errors.push(`${c.ticker}: unknown status "${c.status}" — expected one of ${STORED_STATUS_IDS.join(', ')} (omit the field for alive)`);
    }
  }
}

// --- trailing factors point at real tickers ---
for (const c of CHARACTERS) {
  for (const tf of c.trailingFactors || []) {
    if (!tickers.has(tf.ticker)) errors.push(`${c.ticker}: trailingFactor -> unknown ticker ${tf.ticker}`);
    if (!(tf.coefficient > 0)) errors.push(`${c.ticker}: trailingFactor ${tf.ticker} has no positive coefficient`);
  }
}

// --- ETFs: constituents and weights agree ---
for (const etf of CHARACTERS.filter((c) => c.isETF)) {
  const tf = etf.trailingFactors || [];
  const cons = etf.constituents || [];
  const tfSet = new Set(tf.map((t) => t.ticker));
  const consSet = new Set(cons);

  for (const t of cons) {
    if (!tickers.has(t)) errors.push(`${etf.ticker}: constituent ${t} is not in the roster`);
    if (!tfSet.has(t)) errors.push(`${etf.ticker}: constituent ${t} has no trailingFactor`);
  }
  for (const t of tfSet) {
    if (!consSet.has(t)) errors.push(`${etf.ticker}: trailingFactor ${t} is not a constituent`);
  }

  const sum = tf.reduce((s, t) => s + t.coefficient, 0);
  if (Math.abs(sum - WEIGHT_TARGET) > WEIGHT_TOLERANCE) {
    const ideal = (WEIGHT_TARGET / tf.length).toFixed(3);
    errors.push(`${etf.ticker}: trailing weights sum to ${sum.toFixed(3)}, target ${WEIGHT_TARGET}`
      + ` — re-weight all ${tf.length} members to ${ideal}`);
  }
  // Members are equally weighted by convention; an odd one out is usually a
  // half-finished re-weight rather than a deliberate tilt.
  if (new Set(tf.map((t) => t.coefficient)).size > 1) {
    warnings.push(`${etf.ticker}: members are not equally weighted`);
  }
}

// --- crews ---
for (const crew of Object.values(CREWS)) {
  for (const m of crew.members) {
    if (!tickers.has(m)) errors.push(`crew ${crew.id}: member ${m} is not in the roster`);
  }
  if (new Set(crew.members).size !== crew.members.length) {
    errors.push(`crew ${crew.id}: has a duplicate member`);
  }

  if (!(crew.id in CREW_ETF)) {
    warnings.push(`crew ${crew.id}: not listed in CREW_ETF in this script — add it so its fund gets checked`);
    continue;
  }
  const etfTicker = CREW_ETF[crew.id];
  if (!etfTicker) continue;

  const etf = CHARACTER_MAP[etfTicker];
  if (!etf) { errors.push(`crew ${crew.id}: fund ${etfTicker} does not exist`); continue; }

  const cons = new Set(etf.constituents || []);
  const missing = crew.members.filter((m) => !cons.has(m));
  if (missing.length) {
    warnings.push(`crew ${crew.id}: on the roster but not in ${etfTicker}: ${missing.join(', ')}`);
  }
}

const report = (label, list) => {
  if (!list.length) return;
  console.log(`\n${label}:`);
  list.forEach((m) => console.log(`  - ${m}`));
};

report('WARNINGS', warnings);
report('ERRORS', errors);

if (errors.length) {
  console.log(`\nData check FAILED: ${errors.length} error(s).\n`);
  process.exit(1);
}
if (warnings.length) console.log('\nNo errors.\n');
