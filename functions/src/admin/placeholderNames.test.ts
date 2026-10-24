import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { needsName, toUsername, pickName, randomInvestorName, usable } =
  require('./placeholderNames') as typeof import('./placeholderNames');

describe('needsName', () => {
  it('flags missing, blank and placeholder names', () => {
    for (const n of [undefined, null, '', '  ', 'User', 'Anonymous', 'unknown', 'user 3', 'guest_12'])
      expect(needsName(n)).toBe(true);
  });
  it('leaves picked names alone', () => {
    for (const n of ['Darth', 'UserOne', 'PLAYER', 'Trader', 'anon_k']) expect(needsName(n)).toBe(false);
  });
});

describe('toUsername', () => {
  it('turns dots and spaces into underscores', () => {
    expect(toUsername('dangler.inspector')).toBe('dangler_inspector');
    expect(toUsername('noah fence')).toBe('noah_fence');
  });
  it('drops symbols, edge underscores and extra underscores', () => {
    expect(toUsername('shaew._')).toBe('shaew');
    expect(toUsername('_a_b_c_d_')).toBe('a_b_cd');
    expect(toUsername('𓄧 .𝗆α𝖻   ( ˶°ㅁ°)')).toBe('');
  });
  it('cuts to 20 characters', () => {
    expect(toUsername('aki_rin2bc1wastaken_extra')).toHaveLength(19);
  });
  it('refuses deleted Discord accounts and too-short leftovers', () => {
    expect(toUsername('deleted_user_7675cb3cad3b')).toBe('');
    expect(toUsername('a.')).toBe('');
  });
});

describe('pickName', () => {
  it('takes the first usable, free candidate', async () => {
    expect(await pickName([null, 'deleted_user_1', 'rixxy1291'], () => false)).toEqual({
      name: 'rixxy1291',
      source: 'discord',
    });
  });
  it('adds a number when the name is taken', async () => {
    expect(await pickName(['dakkman'], (l) => l === 'dakkman')).toEqual({ name: 'dakkman2', source: 'discord' });
  });
  it('skips every Discord name when one is off limits', async () => {
    expect((await pickName(['_diegay', 'Azazel'], () => false)).source).toBe('random');
  });
  it('falls back to a random investing name', async () => {
    const r = await pickName([null, ''], () => false);
    expect(r.source).toBe('random');
    expect(usable(r.name)).toBe(true);
  });
});

describe('randomInvestorName', () => {
  it('is always a valid username', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 300; i++) expect(usable(randomInvestorName(rand))).toBe(true);
  });
});
