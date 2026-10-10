// Every file that declares Cloud Functions, as paths relative to this folder.
// serviceLoader.ts walks this to find the owner of an invoked function; order
// does not matter.
//
// Each domain folder lists its own deployable files in <domain>/services.ts.
// Adding a Cloud Function: append it to the right file in its domain. A new file
// goes in that domain's services.ts; a new domain gets an import and an entry
// in DOMAINS below.
// INTERNAL modules (tradeGuards, limitOrderMatching, missionChecks, ...) must
// NOT be listed: they are required directly by the file that owns them, and
// listing one would put its helpers on the deployed function surface.

import admin from './admin/services';
import crews from './crews/services';
import discord from './discord/services';
import ladder from './ladder/services';
import margin from './margin/services';
import market from './market/services';
import missions from './missions/services';
import moderation from './moderation/services';
import orders from './orders/services';
import predictions from './predictions/services';
import season from './season/services';
import trading from './trading/services';
import users from './users/services';

const DOMAINS: Record<string, string[]> = {
  admin,
  crews,
  discord,
  ladder,
  margin,
  market,
  missions,
  moderation,
  orders,
  predictions,
  season,
  trading,
  users,
};

const servicePaths = Object.entries(DOMAINS).flatMap(([domain, files]) => files.map((file) => `./${domain}/${file}`));

export = servicePaths;
