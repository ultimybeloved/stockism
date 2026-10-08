'use strict';
require('./shared/sentry');

require('firebase-admin').initializeApp();

// Loads only the service owning the invoked function - see serviceLoader.js.
require('./serviceLoader')(exports, __dirname, require('./servicePaths'));
