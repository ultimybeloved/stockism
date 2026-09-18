'use strict';

// The Kizaru alt ring, found 2026-09-18 (scripts/who-is.cjs). Five of these were
// created within four minutes on 2026-02-05, and all of them trade from a shared
// set of connections nobody else uses. Darth YG: keep Kizaru, delete the rest,
// and the person gets one account ever from now on.
//
// Used by: node scripts/spam-name-purge.cjs --targets=scripts/alt-ring-kizaru-targets.cjs
// Every entry carries its display name; the purge aborts on any mismatch.

module.exports = {
  reason: 'Alt account in the Kizaru alt ring. The owner keeps Kizaru only.',
  usernameReason: 'alt account, removed by moderation',
  permanentDiscord: true,
  targets: [
    { uid: 'sPiBzx6u2KP1fBGEJ6cI7zgLJED3', name: 'Vasco' },
    { uid: 'NbD3EN5oEhTMJ8VTXMKn0tWhGGI2', name: 'aallah' },
    { uid: 'rvJ3eBOCnaUIlmiXRrm1vRM9X013', name: 'vascoforce' },
    { uid: '6sYCkAvllFYQjfqjPBGUVuRul2h1', name: 'thecherishedone' },
    { uid: 'ppDxSFANJugylF4XcjszDglhxkl2', name: 'horren' },
    { uid: 'v3U6DQuOanMpmj2jKDn2Grv6el93', name: 'Godbull' },
    { uid: '89lDBj39ujNjAAYGWTBLvhFD0FK2', name: 'chimichonga' },
    { uid: 'RubX4VPx5UXbio4ichtjFwM47Im1', name: 'Shibal' },
    { uid: 'DHT5vg1LoZZ9YPH7DhJm3INBEc13', name: 'GitaesMom' },
    { uid: 'KDF33uGhPgecin4yYzExEJvIFYG3', name: 'Allahsstrongest' },
    { uid: 'RLCE8ovmRgVuiU22hJj90LoxdvJ3', name: 'JamaAbdi' },
  ],
};
