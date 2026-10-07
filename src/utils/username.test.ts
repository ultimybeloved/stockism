import { describe, it, expect } from 'vitest';
import { validateUsername } from './username';

describe('validateUsername', () => {
  const accepts = ['ABC', 'A_BC', 'ab_cd', 'cool_dude_1', 'abc123', 'a_b_c', '123abc', 'a12'];
  const rejects = [
    ['ab', 'too short'],
    ['12345', 'no letters'],
    ['1_2_3', 'no letters, underscores only'],
    ['A_B', 'only 2 alphanumeric'],
    ['A__', 'only 1 alphanumeric + doubled underscore'],
    ['a__b', 'doubled underscore'],
    ['_abc', 'leading underscore'],
    ['abc_', 'trailing underscore'],
    ['a_b_c_d', '3 underscores'],
    ['ab cd', 'space not allowed'],
    ['a'.repeat(21), 'too long'],
  ];

  it.each(accepts)('accepts %s', (name) => {
    expect(validateUsername(name)).toBeNull();
  });

  it.each(rejects)('rejects %s (%s)', (name) => {
    expect(validateUsername(name)).not.toBeNull();
  });
});
