'use strict';
// Every backend economy and config value, one module per topic in this folder.
// Source of truth for economy rules: keep in sync with src/constants/economy.ts.
// `require('../shared/constants')` gets all of them; add new values to the
// topic file they belong to.

module.exports = {
  ...require('./market'),
  ...require('./admin'),
  ...require('./leaderboard'),
  ...require('./accounts'),
  ...require('./migrations'),
  ...require('./time'),
  ...require('./halt'),
  ...require('./economy'),
  ...require('./margin'),
  ...require('./predictions'),
  ...require('./crews'),
  ...require('./ladder'),
  ...require('./discord'),
  ...require('./moderation'),
  ...require('./dailyDrop'),
  ...require('./cosmetics'),
  ...require('./seasons'),
  ...require('./runtime'),
};
