'use strict';
// Disposable / temp-mail domains blocked at signup. Pure (no Firebase imports)
// so it can be unit-tested in isolation. Aggressive by design — a few legit
// users on these providers get blocked, which is the accepted trade for shutting
// down throwaway-email alt rings. Add new domains here as they show up in the
// recent-signup report; matching also covers subdomains (anything.mailinator.com).
const DISPOSABLE_EMAIL_DOMAINS = new Set([
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
]);

/**
 * True if an email belongs to a known disposable / temp-mail provider. Matches
 * the exact domain or any subdomain of a blocked domain. Returns false for
 * missing/garbage input (we only block on a positive match).
 * @param {string} email
 * @returns {boolean}
 */
function isDisposableEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  return [...DISPOSABLE_EMAIL_DOMAINS].some(d => domain.endsWith('.' + d));
}

module.exports = { DISPOSABLE_EMAIL_DOMAINS, isDisposableEmail };
