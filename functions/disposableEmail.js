'use strict';
// Disposable / temp-mail domains blocked at signup. Aggressive by design — a few
// legit users on these providers get blocked, which is the accepted trade for
// shutting down throwaway-email alt rings.
//
// Three layers, checked in order:
//   1. HAND_BLOCKED_DOMAINS — our own additions, for domains we've seen in the
//      recent-signup report before any public list catches them.
//   2. The `disposable-email-domains` npm package (bundled, ~120k domains,
//      refreshed whenever we deploy).
//   3. A live copy of the community aggregate list (~70k domains, updated daily
//      upstream), fetched at runtime and cached in instance memory for 24h. This
//      catches fresh rotating domains without needing a deploy. If the fetch
//      fails, signup still works against layers 1-2 (fail-soft).
//
// Matching covers subdomains (anything.mailinator.com matches mailinator.com).

const PACKAGE_DOMAINS = require('disposable-email-domains');

// Domains observed in our own signup reports that public lists missed at the time.
const HAND_BLOCKED_DOMAINS = [
  '0815.ru', '0clickemail.com', '10minutemail.com', '10minutemail.net', '20minutemail.com',
  '33mail.com', 'anonbox.net', 'anonymbox.com', 'binkmail.com', 'bobmail.info',
  'bugmenot.com', 'burnermail.io', 'byom.de', 'crazymailing.com', 'deadaddress.com',
  'despam.it', 'discard.email', 'discardmail.com', 'dispostable.com', 'drdrb.net',
  'dropmail.me', 'einrot.com', 'emailondeck.com', 'emailsensei.com', 'emltmp.com',
  'fakeinbox.com', 'fakemail.net', 'fakemailgenerator.com', 'fastmazda.com', 'filzmail.com',
  'fleckens.hu', 'gawab.com', 'getairmail.com', 'getnada.com', 'gmx.us',
  'grr.la', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'harakirimail.com', 'hidemail.de',
  'incognitomail.com', 'inboxalias.com', 'inboxbear.com', 'jetable.org', 'kasmail.com',
  'mail-temp.com', 'mail7.io', 'mailcatch.com', 'maildrop.cc', 'maildrop.com',
  'maileater.com', 'mailexpire.com', 'mailforspam.com', 'mailinator.com', 'mailinator.net',
  'mailmetrash.com', 'mailnesia.com', 'mailnull.com', 'mailsac.com', 'mailtemp.info',
  'mailtothis.com', 'meltmail.com', 'mintemail.com', 'mohmal.com', 'moakt.com',
  'mt2015.com', 'mvrht.com', 'mytemp.email', 'mytrashmail.com', 'nada.email',
  'nada.ltd', 'no-spam.ws', 'nobulk.com', 'noclickemail.com', 'nomail.xl.cx',
  'notmailinator.com', 'nowmymail.com', 'objectmail.com', 'onewaymail.com', 'opayq.com',
  'owlymail.com', 'pokemail.net', 'proxymail.eu', 'rcpt.at', 'reallymymail.com',
  'rhyta.com', 'rmqkr.net', 'safetymail.info', 'sharklasers.com', 'shieldemail.com',
  'sneakemail.com', 'spam4.me', 'spamavert.com', 'spambog.com', 'spambox.us',
  'spamfree24.org', 'spamgourmet.com', 'spamhole.com', 'spaml.de', 'tempail.com',
  'temp-mail.io', 'temp-mail.org', 'tempemail.com', 'tempinbox.com', 'tempmail.com',
  'tempmail.dev', 'tempmail.email', 'tempmail.ninja', 'tempmail.plus', 'tempmailo.com',
  'tempmail2.com', 'tempomail.fr', 'temporarymail.com', 'thankyou2010.com', 'throwawaymail.com',
  'tmail.ws', 'tmailinator.com', 'trash-mail.com', 'trashmail.com', 'trashmail.de',
  'trashmail.me', 'trashmail.net', 'trbvm.com', 'tyldd.com', 'wegwerfmail.de',
  'wh4f.org', 'yopmail.com', 'yopmail.fr', 'yopmail.net', 'zetmail.com',
  // June 2026 alt-ring wave (seen in recent-signup report before public lists had them)
  'hotkev.com', 'web-library.net', 'poolemethodists.org.uk', 'hidingmail.net',
  'minitts.net', 'wshu.net', 'necub.com', 'dosbee.com',
];

const BUNDLED_DOMAINS = new Set([...HAND_BLOCKED_DOMAINS, ...PACKAGE_DOMAINS]);

// Daily-updated community aggregate of disposable domains.
const REMOTE_LIST_URL = 'https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt';
const REMOTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh the live list once a day per instance
const REMOTE_RETRY_DELAY_MS = 10 * 60 * 1000;    // after a failed fetch, don't retry for 10 minutes
const REMOTE_FETCH_TIMEOUT_MS = 5000;

let remoteDomains = null;   // Set of domains from the live list (null until first successful fetch)
let remoteFetchedAt = 0;    // last successful fetch
let remoteLastAttempt = 0;  // last attempt, successful or not

/**
 * Extracts the lowercased domain from an email, or null for garbage input.
 */
function emailDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * True if the domain or any of its parent domains is in the set
 * (sub.mailinator.com matches mailinator.com). Walks the labels instead of
 * scanning the set, so it stays O(labels) against 100k+ entries.
 */
function domainInSet(domain, set) {
  if (!set) return false;
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (set.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}

/**
 * Refreshes the in-memory copy of the live list if it's stale. Never throws:
 * on failure the previous copy (or nothing) stays in place and we back off.
 */
async function refreshRemoteDomains() {
  const now = Date.now();
  if (remoteDomains && now - remoteFetchedAt < REMOTE_CACHE_TTL_MS) return;
  if (now - remoteLastAttempt < REMOTE_RETRY_DELAY_MS) return;
  remoteLastAttempt = now;
  try {
    const res = await fetch(REMOTE_LIST_URL, { signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const domains = text.split('\n').map(d => d.trim().toLowerCase()).filter(Boolean);
    if (domains.length < 1000) throw new Error(`suspiciously short list (${domains.length})`);
    remoteDomains = new Set(domains);
    remoteFetchedAt = now;
  } catch (err) {
    console.error('Disposable email live list fetch failed (using bundled lists):', err.message);
  }
}

/**
 * True if an email belongs to a known disposable / temp-mail provider, checked
 * against the bundled lists only (synchronous; used by tests and as the
 * fallback layer).
 * @param {string} email
 * @returns {boolean}
 */
function isDisposableEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  return domainInSet(domain, BUNDLED_DOMAINS);
}

/**
 * True if an email belongs to a known disposable / temp-mail provider, checked
 * against the bundled lists plus the daily-updated live list. Never throws and
 * never blocks signup on a network failure — worst case it degrades to the
 * bundled coverage.
 * @param {string} email
 * @returns {Promise<boolean>}
 */
async function isDisposableEmailLive(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  if (domainInSet(domain, BUNDLED_DOMAINS)) return true;
  await refreshRemoteDomains();
  return domainInSet(domain, remoteDomains);
}

module.exports = { isDisposableEmail, isDisposableEmailLive, HAND_BLOCKED_DOMAINS };
