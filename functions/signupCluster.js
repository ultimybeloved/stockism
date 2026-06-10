'use strict';
// Pure helpers for the recent-signup alt-ring report (functions/services/watchlist.js
// getRecentSignupReport). No Firebase imports, so they can be unit-tested in isolation.

// Gmail/googlemail ignore dots in the local part and drop anything after a '+',
// so all of these aliases hit one inbox. Collapsing them reveals the single
// underlying Google account behind a batch of "different" gmail signups.
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

// Normalize an email to the identity that actually receives it. Gmail aliases
// collapse to one address; other providers are just lowercased/trimmed. Returns
// null for anything that is not a parseable address.
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at <= 0 || at === lower.length - 1) return null;

  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);

  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    if (!local) return null;
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

// Group accounts by keyFn(account). Skips empty/"unknown" keys, keeps only
// groups of at least minSize, and sorts biggest cluster first (ties broken by
// key) so the worst offenders surface at the top. Returns [{ key, count, members }].
function clusterBy(accounts, keyFn, minSize = 2) {
  const groups = new Map();
  for (const acc of accounts) {
    const key = keyFn(acc);
    if (key === null || key === undefined || key === '' || key === 'unknown') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(acc);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= minSize)
    .map(([key, members]) => ({ key, count: members.length, members }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

module.exports = { normalizeEmail, clusterBy, GMAIL_DOMAINS };
