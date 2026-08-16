'use strict';
// Archivable plain-HTML views of the public market state.
//
// The site is a React SPA: the HTML it ships is an empty shell and every price
// and rank arrives afterwards from Firestore, behind App Check. Archive crawlers
// can't authenticate, so an archived stockism.app is a blank page and the
// market's history is lost. These routes render the same public data server-side
// with no JavaScript, no login and no App Check, so what a crawler stores is
// what was actually true at that moment.
//
// Reads only documents that are already world-readable, and never emits user IDs
// or Discord data — display names and portfolio values are already public on the
// live leaderboard, nothing more is exposed here.
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const axios = require('axios');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { ADMIN_UID, DISCORD_API_TIMEOUT_MS, isWeeklyTradingHalt } = require('../constants');
const { isRosterTicker } = require('../helpers');

const SITE = 'https://stockism.app';
// Cached at the edge so a crawl storm can't turn into a Firestore bill. Each
// render is 2-4 reads; at half an hour of caching that is a rounding error.
const CACHE_SECONDS = 1800;

// Display names and prediction questions are user- and admin-authored, so every
// interpolated value goes through this. A name containing markup would otherwise
// end up as live HTML on a public page.
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const money = (n) => Number(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const page = (title, bodyHtml, takenAt) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Stockism</title>
<meta name="description" content="Archived snapshot of the Stockism market, ${esc(takenAt)}.">
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#18181b;color:#e4e4e7}
 main{max-width:900px;margin:0 auto}
 h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;color:#fbbf24}
 .meta{color:#a1a1aa;font-size:12px;margin-bottom:8px}
 table{border-collapse:collapse;width:100%;margin-bottom:8px}
 th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #27272a}
 th{color:#a1a1aa;font-weight:600;font-size:12px}
 td.n{text-align:right;font-variant-numeric:tabular-nums}
 a{color:#fb923c}
 .halt{color:#f87171;font-weight:600}.open{color:#4ade80;font-weight:600}
</style>
</head><body><main>
<h1>${esc(title)}</h1>
<p class="meta">Snapshot taken ${esc(takenAt)} · <a href="${SITE}">stockism.app</a></p>
${bodyHtml}
<p class="meta">This is a static archival view. The live site is at <a href="${SITE}">stockism.app</a>.</p>
</main></body></html>`;

const stamp = () => `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const marketSection = (market) => {
  const halted = market.marketHalted === true || isWeeklyTradingHalt();
  return `<h2>Market status</h2>
<p class="${halted ? 'halt' : 'open'}">${halted ? 'HALTED' : 'OPEN'}</p>
${market.marketHalted && market.haltReason ? `<p class="meta">Reason: ${esc(market.haltReason)}</p>` : ''}`;
};

const pricesSection = (market) => {
  const prices = market.prices || {};
  const rows = CHARACTERS
    .filter((c) => isRosterTicker(c.ticker) && prices[c.ticker] !== undefined)
    .map((c) => ({ ticker: c.ticker, name: c.name, price: prices[c.ticker] }))
    .sort((a, b) => b.price - a.price);

  if (!rows.length) return '';
  return `<h2>Prices (${rows.length})</h2>
<table><thead><tr><th>Ticker</th><th>Name</th><th class="n">Price</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc(r.ticker)}</td><td>${esc(r.name)}</td><td class="n">$${money(r.price)}</td></tr>`).join('\n')}
</tbody></table>`;
};

const leaderboardSection = (entries) => {
  if (!entries.length) return '';
  return `<h2>Leaderboard — top ${entries.length}</h2>
<table><thead><tr><th>#</th><th>Player</th><th>Crew</th><th class="n">Portfolio</th></tr></thead><tbody>
${entries.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.displayName || 'Anonymous')}</td><td>${esc(e.crew || '')}</td><td class="n">$${money(e.portfolioValue)}</td></tr>`).join('\n')}
</tbody></table>`;
};

const seasonSection = (season, standings) => {
  if (!season || season.status !== 'active') return '';
  const rows = (standings?.entries || []).slice(0, 25);
  return `<h2>Season ${esc(season.number)} — ${esc(season.name)}</h2>
<p class="meta">Week ${esc(standings?.weeks ?? '')} · ranked on trading return, free stock and bonuses excluded</p>
${rows.length ? `<table><thead><tr><th>#</th><th>Player</th><th>Tier</th><th class="n">Return</th></tr></thead><tbody>
${rows.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.displayName)}</td><td>${esc(e.tier || '')}</td><td class="n">${e.returnPercent > 0 ? '+' : ''}${esc(e.returnPercent)}%</td></tr>`).join('\n')}
</tbody></table>` : ''}`;
};

const predictionsSection = (list) => {
  const live = list.filter((p) => !p.resolved);
  if (!live.length) return '<h2>Predictions</h2><p class="meta">None open.</p>';
  return `<h2>Open predictions (${live.length})</h2>
<table><thead><tr><th>Question</th><th>Type</th><th>Options</th></tr></thead><tbody>
${live.map((p) => `<tr><td>${esc(p.question)}</td><td>${esc(p.type === 'event' ? 'event market' : 'weekly')}</td><td>${esc((p.options || []).join(' · '))}</td></tr>`).join('\n')}
</tbody></table>`;
};

/**
 * GET /snapshot            — status, prices, leaderboard, season
 * GET /snapshot/predictions — open predictions and event markets
 *
 * Public and unauthenticated on purpose: an archive crawler is the intended
 * caller. Everything served is already world-readable.
 */
exports.publicSnapshot = cf().https.onRequest(async (req, res) => {
  try {
    res.set('Cache-Control', `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`);
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Archives should keep these forever; nothing here is private.
    res.set('X-Robots-Tag', 'all');

    const takenAt = stamp();
    const wantsPredictions = /predictions/i.test(req.path || '');

    if (wantsPredictions) {
      const snap = await db.collection('predictions').doc('current').get();
      const list = snap.exists ? (snap.data().list || []) : [];
      return res.status(200).send(page('Predictions snapshot', predictionsSection(list), takenAt));
    }

    const [marketSnap, boardSnap, seasonSnap, seasonBoardSnap] = await Promise.all([
      db.collection('market').doc('current').get(),
      db.collection('leaderboard').doc('global').get(),
      db.collection('market').doc('season').get(),
      db.collection('leaderboard').doc('season').get(),
    ]);

    const market = marketSnap.exists ? marketSnap.data() : {};
    const entries = (boardSnap.exists ? (boardSnap.data().entries || []) : []).slice(0, 50);
    const season = seasonSnap.exists ? seasonSnap.data() : null;
    const seasonBoard = seasonBoardSnap.exists ? seasonBoardSnap.data() : null;

    const body = [
      marketSection(market),
      pricesSection(market),
      leaderboardSection(entries),
      seasonSection(season, seasonBoard),
      `<p class="meta"><a href="${SITE}/snapshot/predictions">Predictions snapshot →</a></p>`,
    ].join('\n');

    return res.status(200).send(page('Market snapshot', body, takenAt));
  } catch (err) {
    console.error('publicSnapshot failed:', err);
    return res.status(500).send('<!doctype html><p>Snapshot unavailable.</p>');
  }
});

// ── Archive.org Save Page Now ────────────────────────────────────────────────

/**
 * Ask the Wayback Machine to store a snapshot now.
 *
 * Best-effort by design: Save Page Now is a free public service that rate-limits
 * and can be slow, and a missed week is not worth failing a scheduled run over.
 */
const savePage = async (path) => {
  const url = `https://web.archive.org/save/${SITE}${path}`;
  try {
    await axios.get(url, {
      timeout: DISCORD_API_TIMEOUT_MS,
      maxRedirects: 2,
      headers: { 'User-Agent': 'stockism-archiver/1.0 (+https://stockism.app)' },
      validateStatus: () => true,
    });
    console.log(`ARCHIVE requested: ${path}`);
    return { path, requested: true };
  } catch (err) {
    console.error(`Archive request failed for ${path}:`, err.message);
    return { path, requested: false, error: err.message };
  }
};

const runArchive = async (includePredictions) => {
  const results = [await savePage('/snapshot')];
  if (includePredictions) results.push(await savePage('/snapshot/predictions'));
  return results;
};

// Thursday 21:30 UTC — half an hour after the weekly halt lifts, so the archived
// state is the market as it stands for the new chapter. Predictions ride along
// on the 1st-8th of the month, which works out to roughly monthly.
exports.archiveSnapshot = cf().pubsub
  .schedule('30 21 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    const includePredictions = new Date().getUTCDate() <= 7;
    await runArchive(includePredictions);
    return null;
  });

exports.triggerArchiveSnapshot = cf().https.onCall(async (data, context) => {
  // The public snapshot ROUTES are deliberately App Check free so crawlers can
  // read them. This admin trigger is not one of those routes, and was the only
  // callable in the codebase missing the check.
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new (require('firebase-functions').https.HttpsError)('permission-denied', 'Admin only');
  }
  const results = await runArchive(true);
  return { success: true, results };
});
