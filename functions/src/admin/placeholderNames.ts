// Names for accounts that never got a real one: early Discord signups that saved
// no displayName, and placeholder names like "User" or "Anonymous". INTERNAL
// MODULE, pure (placeholderNames.test.ts); adminNameUnnamed uses it.

import { containsProfanity, isBannedUsername, isTargetedHarassment, validateUsernameFormat } from '../shared/usernames';

// "PLAYER" is left out on purpose: the one live account with it picked it.
const PLACEHOLDERS = /^(anonymous|unknown|user|guest)[\s_-]?\d*$/i;
// Discord names the filter lets through but the site shouldn't show. A player
// with one gets a random name, not their other Discord names.
const OFF_LIMITS = /die_?gay/i;

/** True when this account has no name a player picked. */
export const needsName = (displayName: unknown) =>
  typeof displayName !== 'string' || !displayName.trim() || PLACEHOLDERS.test(displayName.trim());

/**
 * A Discord name squeezed into the username rules (letters, numbers, up to two
 * single underscores inside, 3 to 20 long), or '' if nothing usable is left.
 */
export function toUsername(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw
    .normalize('NFKD')
    .replace(/[\s.-]+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  // Keep the first two underscores, drop the rest.
  let seen = 0;
  s = s.replace(/_/g, () => (++seen <= 2 ? '_' : ''));
  s = s.slice(0, 20).replace(/_+$/, '');
  return usable(s) ? s : '';
}

/** Passes every rule a player's own pick has to pass. */
export function usable(name: string): boolean {
  if (!name || PLACEHOLDERS.test(name) || /^deleted_user/i.test(name)) return false;
  try {
    validateUsernameFormat(name);
  } catch {
    return false;
  }
  return !isBannedUsername(name.toLowerCase()) && !containsProfanity(name) && !isTargetedHarassment(name);
}

const ADJECTIVES = [
  'Bullish',
  'Steady',
  'Patient',
  'Golden',
  'Diamond',
  'Lucky',
  'Quiet',
  'Bold',
  'Savvy',
  'Prime',
  'BlueChip',
  'Compound',
  'Value',
  'Growth',
  'Long',
  'Swift',
  'Sharp',
  'Rising',
  'Sterling',
  'Liquid',
];
const NOUNS = [
  'Investor',
  'Trader',
  'Broker',
  'Banker',
  'Holder',
  'Bull',
  'Hedger',
  'Whale',
  'Dividend',
  'Ledger',
  'Ticker',
  'Portfolio',
  'Fund',
  'Market',
  'Capital',
  'Margin',
  'Rally',
  'Equity',
  'Bond',
  'Vault',
];

/** An investing-flavored name like BullishBroker42, from a 0..1 random source. */
export function randomInvestorName(rand: () => number = Math.random): string {
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${10 + Math.floor(rand() * 90)}`.slice(0, 20);
}

/** A repeatable 0..1 random source from a string. */
export function seededRandom(key: string): () => number {
  let s = 0;
  for (const c of key) s = (s * 31 + c.charCodeAt(0)) % 2147483647;
  s = s || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * The first candidate that is usable and free, trying number suffixes on a
 * taken one, else a random investing name. `taken` holds lowercase names.
 */
export async function pickName(
  candidates: (string | null | undefined)[],
  taken: (lower: string) => boolean | Promise<boolean>,
  rand: () => number = Math.random,
): Promise<{ name: string; source: 'discord' | 'random' }> {
  const offLimits = candidates.some((c) => c && OFF_LIMITS.test(toUsername(c) || c));
  for (const raw of offLimits ? [] : candidates) {
    const base = toUsername(raw);
    if (!base) continue;
    if (!(await taken(base.toLowerCase()))) return { name: base, source: 'discord' };
    for (let n = 2; n < 10; n++) {
      const name = `${base.slice(0, 20 - String(n).length)}${n}`;
      if (usable(name) && !(await taken(name.toLowerCase()))) return { name, source: 'discord' };
    }
  }
  for (let i = 0; i < 50; i++) {
    const name = randomInvestorName(rand);
    if (usable(name) && !(await taken(name.toLowerCase()))) return { name, source: 'random' };
  }
  throw new Error('No free name found');
}
