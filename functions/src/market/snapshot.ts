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
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import { CHARACTERS, CHARACTER_MAP } from '../shared/characters';
import { DISCORD_API_TIMEOUT_MS, isWeeklyTradingHalt } from '../shared/constants';
import { isRosterTicker } from '../shared/roster';

/** One row of the cached global leaderboard. */
interface BoardEntry {
  displayName?: string;
  crew?: string;
  portfolioValue?: number;
}

/** One row of the cached season board. */
interface SeasonBoardEntry {
  displayName?: string;
  tier?: string;
  returnPercent: number;
}

/** One entry of predictions/current.list. */
interface PredictionEntry {
  question?: string;
  type?: string;
  options?: string[];
  resolved?: boolean;
}

type Doc = admin.firestore.DocumentData;

const SITE = 'https://stockism.app';
// Cached at the edge so a crawl storm can't turn into a Firestore bill. Each
// render is 2-4 reads; at half an hour of caching that is a rounding error.
const CACHE_SECONDS = 1800;

// Display names and prediction questions are user- and admin-authored, so every
// interpolated value goes through this. A name containing markup would otherwise
// end up as live HTML on a public page.
const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (n: unknown) =>
  Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const page = (title: string, bodyHtml: string, takenAt: string) => `<!doctype html>
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

const marketSection = (market: Doc) => {
  const halted = market.marketHalted === true || isWeeklyTradingHalt();
  return `<h2>Market status</h2>
<p class="${halted ? 'halt' : 'open'}">${halted ? 'HALTED' : 'OPEN'}</p>
${market.marketHalted && market.haltReason ? `<p class="meta">Reason: ${esc(market.haltReason)}</p>` : ''}`;
};

const pricesSection = (market: Doc) => {
  const prices: Record<string, number> = market.prices || {};
  const rows = CHARACTERS.filter((c) => isRosterTicker(c.ticker) && prices[c.ticker] !== undefined)
    .map((c) => ({ ticker: c.ticker, name: c.name, price: prices[c.ticker]! }))
    .sort((a, b) => b.price - a.price);

  if (!rows.length) return '';
  return `<h2>Prices (${rows.length})</h2>
<table><thead><tr><th>Ticker</th><th>Name</th><th class="n">Price</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc(r.ticker)}</td><td>${esc(r.name)}</td><td class="n">$${money(r.price)}</td></tr>`).join('\n')}
</tbody></table>`;
};

// A single past day, read from the daily closes recorded by dailyMarketSummary.
// This is what makes the archive answer "what was true on this date" rather than
// only ever showing whatever is current.
const datedPricesSection = (closes: Record<string, number> | undefined, day: string) => {
  const rows = Object.entries(closes || {})
    .filter(([ticker]) => isRosterTicker(ticker))
    .map(([ticker, price]) => ({
      ticker,
      price,
      name: CHARACTER_MAP[ticker]?.name || ticker,
    }))
    .sort((a, b) => b.price - a.price);

  if (!rows.length) {
    return `<h2>${esc(day)}</h2><p class="meta">No closing prices recorded for this date.</p>`;
  }
  return `<h2>Closing prices for ${esc(day)} (${rows.length})</h2>
<table><thead><tr><th>Ticker</th><th>Name</th><th class="n">Close</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc(r.ticker)}</td><td>${esc(r.name)}</td><td class="n">$${money(r.price)}</td></tr>`).join('\n')}
</tbody></table>`;
};

// Every date the archive holds for one month, so a crawler following links
// reaches all of them without guessing dates.
const monthIndexSection = (monthId: string, days: string[]) => {
  if (!days.length) return `<h2>${esc(monthId)}</h2><p class="meta">Nothing recorded.</p>`;
  return `<h2>${esc(monthId)} — ${days.length} day${days.length === 1 ? '' : 's'}</h2>
<p>${days.map((d) => `<a href="${SITE}/snapshot/${esc(d)}">${esc(d)}</a>`).join(' · ')}</p>`;
};

const leaderboardSection = (entries: BoardEntry[]) => {
  if (!entries.length) return '';
  return `<h2>Leaderboard — top ${entries.length}</h2>
<table><thead><tr><th>#</th><th>Player</th><th>Crew</th><th class="n">Portfolio</th></tr></thead><tbody>
${entries.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.displayName || 'Anonymous')}</td><td>${esc(e.crew || '')}</td><td class="n">$${money(e.portfolioValue)}</td></tr>`).join('\n')}
</tbody></table>`;
};

const seasonSection = (season: Doc | null | undefined, standings: Doc | null | undefined) => {
  if (!season || season.status !== 'active') return '';
  const rows: SeasonBoardEntry[] = (standings?.entries || []).slice(0, 25);
  return `<h2>Season ${esc(season.number)} — ${esc(season.name)}</h2>
<p class="meta">Week ${esc(standings?.weeks ?? '')} · ranked on trading return, free stock and bonuses excluded</p>
${
  rows.length
    ? `<table><thead><tr><th>#</th><th>Player</th><th>Tier</th><th class="n">Return</th></tr></thead><tbody>
${rows.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.displayName)}</td><td>${esc(e.tier || '')}</td><td class="n">${e.returnPercent > 0 ? '+' : ''}${esc(e.returnPercent)}%</td></tr>`).join('\n')}
</tbody></table>`
    : ''
}`;
};

const predictionsSection = (list: PredictionEntry[]) => {
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
export const publicSnapshot = cf().https.onRequest(async (req, res) => {
  try {
    res.set('Cache-Control', `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`);
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Archives should keep these forever; nothing here is private.
    res.set('X-Robots-Tag', 'all');

    const takenAt = stamp();
    const wantsPredictions = /predictions/i.test(req.path || '');

    // /snapshot/YYYY-MM-DD  a single past day's closing prices
    // /snapshot/YYYY-MM     the dates available in that month
    //
    // Both read the daily closes written by dailyMarketSummary, so the archive
    // can answer for any recorded date rather than only for right now. Dates
    // before that recording started simply have nothing, which the page says.
    const dated = /(\d{4}-\d{2})(-\d{2})?\s*$/.exec(req.path || '');
    if (dated && !wantsPredictions) {
      const monthId = dated[1]!;
      const day = dated[2] ? `${monthId}${dated[2]}` : null;
      const doc = await db.collection('market').doc('current').collection('daily_closes').doc(monthId).get();
      const closes = doc.exists ? (doc.data() || {}).closes || {} : {};

      if (day) {
        const body =
          datedPricesSection(closes[day], day) +
          `<p class="meta"><a href="${SITE}/snapshot/${monthId}">All of ${monthId}</a>` +
          ` · <a href="${SITE}/snapshot">Current market</a></p>`;
        res.status(200).send(page(`Market on ${day}`, body, takenAt));
        return;
      }

      const days = Object.keys(closes).sort();
      const body =
        monthIndexSection(monthId, days) + `<p class="meta"><a href="${SITE}/snapshot">Current market</a></p>`;
      res.status(200).send(page(`Market archive ${monthId}`, body, takenAt));
      return;
    }

    if (wantsPredictions) {
      const snap = await db.collection('predictions').doc('current').get();
      const list = snap.exists ? snap.data()!.list || [] : [];
      res.status(200).send(page('Predictions snapshot', predictionsSection(list), takenAt));
      return;
    }

    const [marketSnap, boardSnap, seasonSnap, seasonBoardSnap] = await Promise.all([
      db.collection('market').doc('current').get(),
      db.collection('leaderboard').doc('global').get(),
      db.collection('market').doc('season').get(),
      db.collection('leaderboard').doc('season').get(),
    ]);

    const market = (marketSnap.exists ? marketSnap.data() : {}) as Doc;
    const entries = (boardSnap.exists ? boardSnap.data()!.entries || [] : []).slice(0, 50);
    const season = seasonSnap.exists ? seasonSnap.data() : null;
    const seasonBoard = seasonBoardSnap.exists ? seasonBoardSnap.data() : null;

    const body = [
      marketSection(market),
      pricesSection(market),
      leaderboardSection(entries),
      seasonSection(season, seasonBoard),
      `<p class="meta"><a href="${SITE}/snapshot/predictions">Predictions snapshot →</a>` +
        ` · <a href="${SITE}/snapshot/${new Date().toISOString().slice(0, 7)}">This month's daily closes →</a></p>`,
    ].join('\n');

    res.status(200).send(page('Market snapshot', body, takenAt));
    return;
  } catch (err) {
    logger.error('publicSnapshot failed:', err);
    res.status(500).send('<!doctype html><p>Snapshot unavailable.</p>');
    return;
  }
});

// ── Archive.org Save Page Now ────────────────────────────────────────────────

/**
 * Ask the Wayback Machine to store a snapshot now.
 *
 * Best-effort by design: Save Page Now is a free public service that rate-limits
 * and can be slow, and a missed week is not worth failing a scheduled run over.
 */
const savePage = async (path: string) => {
  const url = `https://web.archive.org/save/${SITE}${path}`;
  try {
    await axios.get(url, {
      timeout: DISCORD_API_TIMEOUT_MS,
      maxRedirects: 2,
      headers: { 'User-Agent': 'stockism-archiver/1.0 (+https://stockism.app)' },
      validateStatus: () => true,
    });
    logger.info(`ARCHIVE requested: ${path}`);
    return { path, requested: true };
  } catch (err) {
    logger.error(`Archive request failed for ${path}:`, (err as Error).message);
    return { path, requested: false, error: (err as Error).message };
  }
};

const runArchive = async (includePredictions: boolean) => {
  const results = [await savePage('/snapshot')];
  if (includePredictions) results.push(await savePage('/snapshot/predictions'));
  return results;
};

// Thursday 21:30 UTC — half an hour after the weekly halt lifts, so the archived
// state is the market as it stands for the new chapter. That alignment is the
// reason this is not simply "every N days": the chapter review is the biggest
// price event of the week, and a fixed-interval schedule would drift off it.
//
// Deliberately not daily. Save Page Now is a free public service and there is no
// reason to hammer it, and the per-day detail now lives in the dated routes
// (/snapshot/YYYY-MM-DD) which are backed by our own daily closes.
//
// Predictions ride along on the 1st-8th, which works out to roughly monthly.
export const archiveSnapshot = cf()
  .pubsub.schedule('30 21 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    const includePredictions = new Date().getUTCDate() <= 7;
    await runArchive(includePredictions);
    return null;
  });

export const triggerArchiveSnapshot = cf().https.onCall(async (_data: unknown, context) => {
  // The public snapshot ROUTES are deliberately App Check free so crawlers can
  // read them. This admin trigger is not one of those routes, and was the only
  // callable in the codebase missing the check.
  requireAdmin(context);
  const results = await runArchive(true);
  return { success: true, results };
});
