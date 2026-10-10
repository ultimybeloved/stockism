// Username rules: profanity, banned and protected names, targeted harassment.

import * as functions from 'firebase-functions/v1';

// Banned usernames (impersonation prevention)
export const BANNED_NAMES = [
  'admin',
  'administrator',
  'mod',
  'moderator',
  'support',
  'staff',
  'official',
  'system',
  'root',
  'owner',
  'founder',
  'manager',
  // 'yg' blocks any name containing those letters adjacently (admin
  // impersonation); underscores are stripped before matching, so y_g
  // is caught too. Subsumes the old 'darthyg' / 'darth_yg' entries.
  'stockism',
  'yg',
  'darth',
  'null',
  'undefined',
  'ricky',
];

// Profanity filter
export const PROFANITY_LIST = [
  // Profanity
  'fuck',
  'shit',
  'ass',
  'bitch',
  'damn',
  'cunt',
  'dick',
  'cock',
  'pussy',
  'bastard',
  'whore',
  'slut',
  'piss',
  'crap',
  'fag',
  'retard',
  'nigger',
  'nigga',
  'chink',
  // Variations/leetspeak
  'f4ck',
  'fuk',
  'fck',
  'sh1t',
  'b1tch',
  'azz',
  'a55',
  'd1ck',
  'c0ck',
  'cnt',
  'fag0t',
  'r3tard',
  'n1gger',
  'n1gga',
  // Slurs
  'kike',
  'spic',
  'beaner',
  'wetback',
  'gook',
  'towelhead',
  'sandnigger',
  // Sexual/inappropriate
  'sex',
  'porn',
  'xxx',
  'rape',
  'molest',
  'pedo',
  'anal',
  'vagina',
  'penis',
  'testicle',
  'semen',
  'cumshot',
  'jizz',
  'blowjob',
  'handjob',
  // 'rvpe' spellings beat 'rape' because normalizeProfanity has no v->a rule,
  // and it must not get one: v->a would turn "Vase" into "aase" and read it as
  // a slur. These literals cost nothing and collide with no English word.
  'rvpe',
  'rvped',
  'rvpes',
  'rvpist',
  // Bare 'cum' is deliberately NOT here — it is a substring of "document" and
  // "cucumber". It lives in HARASSMENT_WORDS instead, where it only bites when
  // a real player's name is attached. These compounds are unambiguous.
  'cumbucket',
  'cumdump',
  'cumslut',
  'cumrag',
  // Hate/offensive
  'nazi',
  'hitler',
  'kill',
  'murder',
  'terrorist',
  'jihad',
  'isis',
  // Common substitutions
  'fvck',
  'phuck',
  'biatch',
  'bytch',
  'azhole',
  'assh0le',
];

// Players prominent enough that people build throwaway accounts out of their
// names. This list NEVER blocks a name on its own — it is only ever consulted
// together with HARASSMENT_WORDS below. "Stitch" is an ordinary English word and
// stays freely available: CrossStitch and StitchInTime are fine, StitchSlave is
// not. Blocking every name containing a player's name would break half the
// dictionary, which is exactly why this is a short curated list and not the
// whole user collection.
//
// Store entries already normalized: lowercase, letters and digits only.
// Keep it current when the top of the board changes — scripts/spam-name-audit.cjs
// prints a reminder listing any top-25 player missing from here.
export const PROTECTED_PLAYER_NAMES = [
  // Repeatedly targeted (the 2026-08-21 purge was 17 accounts aimed at these).
  'stitch',
  'callmebot',
  'slare',
  'shibal',
  'elijang',
  // Top of the leaderboard and crew heads.
  'amado901',
  'toartauki',
  'ayin',
  'yapryong',
  'definethereal',
  'gunglazer',
  'royalshrub',
  'madness',
  'yakhob',
  'zalfer',
  'whitecyxres',
  'gapnegshing',
  'danielpark',
  'versus',
  'sadakosasaki',
  'jinsakai',
  'sifilo',
  'sandygnow',
  'shadows3511p',
  '2orain',
  'unkb',
  'sniv',
];

// Words that are an attack when welded to somebody's name, but perfectly
// ordinary otherwise. None of these block a name by themselves.
const HARASSMENT_WORDS = [
  'slave',
  'slaves',
  'peg',
  'pegs',
  'pegged',
  'pegging',
  'submissive',
  'bottom',
  'dog',
  'dogs',
  'bitch',
  'simp',
  'servant',
  'worship',
  'owns',
  'owned',
  'suck',
  'sucks',
  'lick',
  'licks',
  'finger',
  'fingers',
  'smells',
  'stinks',
  'ugly',
  'trash',
  'loser',
  'eater',
  'toy',
  'pet',
  'kisser',
  'cuck',
  'whore',
  'slut',
  'gay',
  'fag',
  'thot',
  'hoe',
  'rape',
  'rapes',
  'raped',
  'rvpe',
  'rvpes',
  'rvped',
  'cum',
  'kys',
];

// Shortest protected name we will look for inside a longer one. Below this the
// odds of an innocent collision outrun the odds of an actual attack.
const MIN_PROTECTED_NAME_LENGTH = 4;

/**
 * Both readings of a name: plain, and with leetspeak folded back to letters.
 * Checking both means StchFingers and St1tchF1ngers are the same to us.
 * @returns Normalized forms, deduped
 */
function nameForms(name: unknown): string[] {
  const plain = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const deleet = plain
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b');
  return plain === deleet ? [plain] : [plain, deleet];
}

/**
 * True when a name is another player's name plus an insult.
 *
 * Requires BOTH halves. A protected name alone is fine (it is usually just a
 * word), an insult alone is fine (the profanity filter already judges those on
 * their own merits). Only the combination is targeted harassment.
 *
 * @param username - Raw display name as typed
 */
export function isTargetedHarassment(username: unknown): boolean {
  const forms = nameForms(username);
  if (!forms[0]) return false;

  // Must contain someone else's name, and be longer than it — otherwise this is
  // just the player themselves, whom uniqueness already handles.
  const targetsPlayer = PROTECTED_PLAYER_NAMES.some((protectedName) => {
    if (protectedName.length < MIN_PROTECTED_NAME_LENGTH) return false;
    return forms.some((form) => form.length > protectedName.length && form.includes(protectedName));
  });
  if (!targetsPlayer) return false;

  return HARASSMENT_WORDS.some((word) => forms.some((form) => form.includes(word)));
}

/**
 * Normalize text for profanity detection (remove special chars, numbers that look like letters)
 * @param text - Text to normalize
 * @returns Normalized text
 */
export function normalizeProfanity(text: string): string {
  return text
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
    .replace(/!/g, 'i')
    .replace(/\+/g, 't')
    .replace(/[^a-z]/g, '');
}

/**
 * Checks if text contains profanity
 * @param text - Text to check
 * @returns True if profanity detected
 */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;

  const normalized = normalizeProfanity(text);
  const lower = text.toLowerCase();

  for (const word of PROFANITY_LIST) {
    // Exact match (whole word)
    const wordBoundaryRegex = new RegExp(`\\b${word}\\b`, 'i');
    if (wordBoundaryRegex.test(lower) || wordBoundaryRegex.test(normalized)) {
      return true;
    }

    // Substring match for shorter words (3+ chars)
    if (word.length >= 3 && (lower.includes(word) || normalized.includes(word))) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a username is banned (handles leetspeak variations).
 * @param username - Lowercase username to check
 * @returns True if banned
 */
export function isBannedUsername(username: string): boolean {
  // Normalize leetspeak and variations
  const normalized = username
    .replace(/[0]/g, 'o')
    .replace(/[1]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/_/g, '');

  // Check exact matches
  if (BANNED_NAMES.includes(username) || BANNED_NAMES.includes(normalized)) {
    return true;
  }

  // Check if it contains banned terms
  for (const banned of BANNED_NAMES) {
    if (username.includes(banned) || normalized.includes(banned)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates username format (shared by createUser and changeDisplayName).
 * Throws an HttpsError with a user-facing message on the first failed rule.
 * Caller passes the already-trimmed name. Does NOT check uniqueness, bans, or
 * profanity — those stay at the call sites.
 * Mirror of validateUsername in src/utils/username.ts — keep both in sync.
 * @param name - Trimmed display name
 */
export function validateUsernameFormat(name: string) {
  if (name.length < 3) {
    throw new functions.https.HttpsError('invalid-argument', 'Username must be at least 3 characters.');
  }
  if (name.length > 20) {
    throw new functions.https.HttpsError('invalid-argument', 'Username must be 20 characters or less.');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username can only contain letters, numbers, and underscores.',
    );
  }
  if (!/[a-zA-Z]/.test(name)) {
    throw new functions.https.HttpsError('invalid-argument', 'Username must include at least one letter.');
  }
  if ((name.match(/[a-zA-Z0-9]/g) || []).length < 3) {
    throw new functions.https.HttpsError('invalid-argument', 'Username must include at least 3 letters or numbers.');
  }
  if ((name.match(/_/g) || []).length > 2 || name.includes('__') || name.startsWith('_') || name.endsWith('_')) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username can have at most 2 underscores, not repeated or at the start or end.',
    );
  }
}
