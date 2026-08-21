import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// helpers.js grabs a Firestore handle at import time. These two functions are
// pure string work and never touch it, but the module still needs an app to
// exist. No credentials and no network: nothing here reads or writes.
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'offline-test' });

const { isTargetedHarassment, containsProfanity } = require('./helpers');

// The 17 accounts removed on 2026-08-21. Every one of them was accepted by the
// signup filter at the time. None of them may ever be accepted again.
const PURGED = [
  'N1CumBucketCallmebot', 'StitchRvpesCallmebot', 'CallmebotLicksStitch',
  'CallmebotisAbottom', 'StchFingersCallmebot', 'CallmebotisAdog',
  'CallmebotSucksStitch', 'SubmissiveCallmebot', 'HeFingersCallmebot',
  'RatsuvaPegsCallmebot', 'CallmebotRvpedSlare', 'StitchsDogCallmebot',
  'StitchPegsCallmebot', 'StitchOwnsCallmebot', 'GaySonOrThotEliJang',
  'StitchSlaveCallmebot', 'StitchsGaySon',
];

const blocked = (name) => isTargetedHarassment(name) || containsProfanity(name);

describe('username harassment filter', () => {
  it.each(PURGED)('blocks the purged name %s', (name) => {
    expect(blocked(name)).toBe(true);
  });

  // The whole reason this is a two-part rule. "Stitch" is the #1 player AND an
  // ordinary English word; blocking every name containing it would be absurd.
  const innocent = [
    'CrossStitch', 'StitchInTime', 'Stitch2', 'StitchFan', 'stitcher',
    'StitchAndSew', 'LiloAndStitch', 'MadnessCombat', 'VersusMode',
    'AyinLover', 'GunGlazerFan', 'Documentary', 'Cucumber', 'Vase',
    'Sniveler', 'PetShop', 'DogWalker', 'TopDog', 'SlaveToTheRhythm',
  ];
  it.each(innocent)('allows the ordinary name %s', (name) => {
    expect(isTargetedHarassment(name)).toBe(false);
  });

  it('needs both halves, never one alone', () => {
    expect(isTargetedHarassment('Callmebot2')).toBe(false);   // name, no insult
    expect(isTargetedHarassment('SlaveDriver')).toBe(false);  // insult, no name
    expect(isTargetedHarassment('CallmebotSlave')).toBe(true); // both
  });

  it('does not block the player themselves', () => {
    expect(isTargetedHarassment('Stitch')).toBe(false);
    expect(isTargetedHarassment('Callmebot')).toBe(false);
  });

  it('sees through leetspeak and padding', () => {
    expect(isTargetedHarassment('St1tchSl4ve')).toBe(true);
    expect(isTargetedHarassment('C4llmeb0t_Dog')).toBe(true);
    expect(isTargetedHarassment('Stitch_Is_A_Dog')).toBe(true);
  });

  it('catches the rvpe spelling that beat the old filter', () => {
    expect(containsProfanity('RvpeVictim')).toBe(true);
    expect(containsProfanity('SomeoneRvped')).toBe(true);
    // ...without turning innocent v-words into slurs.
    expect(containsProfanity('Vase')).toBe(false);
    expect(containsProfanity('Silver')).toBe(false);
    expect(containsProfanity('Versus')).toBe(false);
  });

  it('leaves bare cum out of the global profanity list', () => {
    // It is a substring of these. It only bites via HARASSMENT_WORDS.
    expect(containsProfanity('Documentary')).toBe(false);
    expect(containsProfanity('Cucumber')).toBe(false);
    expect(isTargetedHarassment('CumBucketStitch')).toBe(true);
  });

  it('handles junk input without throwing', () => {
    for (const v of [null, undefined, '', '___', 123, {}]) {
      expect(() => isTargetedHarassment(v)).not.toThrow();
    }
  });
});
