'use strict';

// Four dormant accounts that signed up on Kizaru alt ring connections, deleted
// on Darth YG's go-ahead 2026-10-11 (see the 2026-09-18 ring cleanup).
//
// Used by: node scripts/spam-name-purge.cjs --targets=scripts/alt-ring-kizaru-dormant.cjs
// Every entry carries its display name; the purge aborts on any mismatch.

module.exports = {
  reason: 'Dormant alt on Kizaru alt ring connections. The owner keeps Kizaru only.',
  usernameReason: 'alt account, removed by moderation',
  permanentDiscord: true,
  targets: [
    { uid: '5MaOXPRQuNOR0z0LReK6WUjzOVF3', name: 'BongsopShibalson' },
    { uid: '7bBdp2wcVdUzbsOGeKTJQxdL7Ff1', name: 'Gitaelarpkim' },
    { uid: 'NCP4VB1529ZTKhdsIjgADjIaJWx2', name: 'Shingenbingen' },
    { uid: 'wvGowqAImvUyn4pvQyFW5u4zKU13', name: 'whatsthedifferencebe' },
  ],
};
