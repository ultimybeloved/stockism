'use strict';

// The accounts spam-name-audit.cjs flagged, reviewed by hand and approved for
// deletion by Darth YG on 2026-08-21.
//
// Shared by spam-name-detail.cjs (read-only) and spam-name-purge.cjs (deletes).
//
// Every entry carries the display name as well as the uid. The purge asserts
// the name still matches before it deletes anything, so a stale or mistyped uid
// aborts instead of wiping an innocent account.

module.exports = [
  // --- never used: 0 trades, still sitting on exactly starting cash ---
  { uid: '1YtENtAiPza6AppGxXKDM6qlHSn1', name: 'N1CumBucketCallmebot' },
  { uid: '9gr8kLxT0Ihzp2BkeooJ5q4z3Yj2', name: 'StitchRvpesCallmebot' },
  { uid: 'BO27gJRTWIhMRXh3OHXd7pgOPVC2', name: 'CallmebotLicksStitch' },
  { uid: 'TfP1GszmmpMgFIAZm6MEjNexzNw2', name: 'CallmebotisAbottom' },
  { uid: 'dYLsXl9ooohNOO8tB7WPW1lZHbs2', name: 'StchFingersCallmebot' },
  { uid: 'rV2STOkKqgTZMNpC3T4dwbLbNQi1', name: 'CallmebotisAdog' },
  { uid: 'UcElKE11g7PuIaAvuHctmTXs5Si1', name: 'CallmebotSucksStitch' },
  { uid: 'JwtXuyM7BCaW7G5xbUF9BeDvkYf1', name: 'SubmissiveCallmebot' },

  // --- barely touched: 1-2 trades, abandoned since June ---
  { uid: 'woCd8ZWFupZULiRwEIvgXgkOPFv2', name: 'HeFingersCallmebot' },
  { uid: 'uZoaK2Bu7eT3Poxa8FCkm9td9LC2', name: 'RatsuvaPegsCallmebot' },
  { uid: 'GEZ6BVFgnOPouvXsdxKQzOZDDzR2', name: 'CallmebotRvpedSlare' },
  { uid: 'KTXXeAGoJzd2xXeNhAe8izINHCn2', name: 'StitchsDogCallmebot' },
  { uid: 'M6c1DGBLV2UdSaRluPlOf8LTEtu2', name: 'StitchPegsCallmebot' },
  { uid: 'vYUnNeqgwYNpm7t1rsiw2T09OKf2', name: 'StitchOwnsCallmebot' },

  // --- did play once, but the name is targeted harassment; all dead since May ---
  { uid: 'ZSMgtxBk24NDANeD8xRrEgyieXk2', name: 'GaySonOrThotEliJang' },
  { uid: 'zox4OHHSYwSC15lMJ0MwkfOTHR82', name: 'StitchSlaveCallmebot' },
  { uid: 'TAN5j9dUIvYqjWUfFuj0V9ewEtm1', name: 'StitchsGaySon' },

  // Deliberately NOT included. Flagged by the audit, held back by Darth YG on
  // 2026-08-21: "Shibal" is a Korean swear as well as a player name, and this
  // reads more like a character joke than an attack.
  //   5MaOXPRQuNOR0z0LReK6WUjzOVF3  BongsopShibalson
];
