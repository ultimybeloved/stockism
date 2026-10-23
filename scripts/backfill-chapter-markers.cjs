'use strict';

// One-off: fills market/chapterMarkers with the chapter reviews that happened
// before the 20:55 job started recording them (2026-10-22).
//
//   npx tsx scripts/backfill-chapter-markers.cjs          (dry run, prints)
//   npx tsx scripts/backfill-chapter-markers.cjs --apply  (writes the doc)
//
// For every past Thursday it takes each stock's last price at or before the
// halt (13:00 UTC) and its last price at or before the 20:55 lock, from the live
// price history plus the archive. A week with no history either side is left
// out. Markers already in the doc (and any admin labels and notes) are kept;
// only missing weeks are added.

const fs = require('fs');
const path = require('path');
const admin = require('../functions/node_modules/firebase-admin');
const { buildChapterMarker, upsertChapterMarker } = require('../src/rules/chapterMarkers');
const { missionWeekId } = require('../src/rules/missions');
const { indexFromStored } = require('../functions/src/shared/indexMaintenance');
const { isRosterTicker } = require('../functions/src/shared/roster');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('No service-account-key.json in the repo root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const DAY = 864e5;
const HALT_START_MIN = 13 * 60;
const LOCK_MIN = 20 * 60 + 55;

const lastAtOrBefore = (points, t) => {
  let best = null;
  for (const p of points) if (p.timestamp <= t && (!best || p.timestamp > best.timestamp)) best = p;
  return best;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const [live, archive, idx, existing] = await Promise.all([
    db.doc('market/priceHistory').get(),
    db.collection('market').doc('current').collection('price_history').get(),
    db.doc('market/indexHistory').get(),
    db.doc('market/chapterMarkers').get(),
  ]);
  const history = {};
  for (const [t, pts] of Object.entries(live.data() || {})) if (Array.isArray(pts)) history[t] = [...pts];
  archive.forEach((d) => {
    const h = d.data().history;
    if (Array.isArray(h)) history[d.id] = [...h, ...(history[d.id] || [])];
  });
  const tickers = Object.keys(history).filter(isRosterTicker);
  const earliest = Math.min(...tickers.flatMap((t) => history[t].map((p) => p.timestamp)));
  console.log(`${tickers.length} tickers, history from ${new Date(earliest).toISOString().slice(0, 10)}`);

  let markers = existing.data()?.markers || [];
  const have = new Set(markers.map((m) => m.weekId));
  const stored = idx.exists ? idx.data() : null;
  const now = Date.now();
  // Every Thursday from the first one with history to the last one already over.
  let day = Date.UTC(
    new Date(earliest).getUTCFullYear(),
    new Date(earliest).getUTCMonth(),
    new Date(earliest).getUTCDate(),
  );
  while (new Date(day).getUTCDay() !== 4) day += DAY;
  let added = 0;
  for (; day + LOCK_MIN * 60000 < now; day += 7 * DAY) {
    const haltStart = day + HALT_START_MIN * 60000;
    const lock = day + LOCK_MIN * 60000;
    const weekId = missionWeekId(haltStart);
    if (have.has(weekId)) continue;
    const before = {};
    const after = {};
    for (const t of tickers) {
      const b = lastAtOrBefore(history[t], haltStart);
      if (!b) continue;
      before[t] = b.price;
      after[t] = (lastAtOrBefore(history[t], lock) || b).price;
    }
    if (Object.keys(before).length === 0) continue;
    const marker = buildChapterMarker({
      weekId,
      at: haltStart,
      before,
      after,
      indexBefore: indexFromStored(before, stored),
      indexAfter: indexFromStored(after, stored),
    });
    const top = Object.entries(marker.moves)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 5)
      .map(([t, m]) => `${t} ${m > 0 ? '+' : ''}${m}%`)
      .join(', ');
    console.log(
      `${new Date(day).toISOString().slice(0, 10)}  ${String(Object.keys(marker.moves).length).padStart(3)} moved  index ${marker.index}%  ${top}`,
    );
    markers = upsertChapterMarker(markers, marker);
    added++;
  }
  console.log(`\n${added} weeks to add, ${markers.length} markers total.`);
  if (!apply) return console.log('Dry run. Add --apply to write market/chapterMarkers.');
  await db.doc('market/chapterMarkers').set({ markers, updatedAt: now });
  console.log('Written.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
