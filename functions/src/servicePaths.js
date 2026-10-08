'use strict';
// Every file that declares Cloud Functions, as paths relative to this folder.
// serviceLoader.js walks this to find the owner of an invoked function; order
// does not matter.
//
// Each domain folder lists its own deployable files in <domain>/services.js.
// Adding a Cloud Function: append it to the right file in its domain. A new file
// goes in that domain's services.js; a new domain goes in DOMAINS below.
// INTERNAL modules (tradeGuards, limitOrderMatching, missionChecks, ...) must
// NOT be listed: they are required directly by the file that owns them, and
// listing one would put its helpers on the deployed function surface.

const DOMAINS = [
  'admin',
  'crews',
  'discord',
  'ladder',
  'margin',
  'market',
  'missions',
  'moderation',
  'orders',
  'predictions',
  'season',
  'trading',
  'users',
];

module.exports = DOMAINS.flatMap((domain) => require(`./${domain}/services`).map((file) => `./${domain}/${file}`));
