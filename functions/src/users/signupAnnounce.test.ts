import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type Mod = typeof import('./signupAnnounce');
let buildSignupEmbed: Mod['buildSignupEmbed'];

beforeAll(() => {
  ({ buildSignupEmbed } = require('./signupAnnounce') as Mod);
});

describe('buildSignupEmbed', () => {
  it('names the player and nothing else', () => {
    const embed = buildSignupEmbed('Gun', 0);
    expect(embed.description).toBe('**Gun** just joined Stockism.');
    expect(embed).not.toHaveProperty('url');
    expect(embed.timestamp).toBe('1970-01-01T00:00:00.000Z');
  });

  it('credits the recruiter when there is one', () => {
    expect(buildSignupEmbed('Gun', 0, 'big_deal_fan').description).toContain('Recruited by **big\\_deal\\_fan**.');
    expect(buildSignupEmbed('Gun', 0, null).description).not.toContain('Recruited');
  });

  it('escapes underscores so a name cannot change the formatting', () => {
    expect(buildSignupEmbed('big_deal_fan', 0).description).toContain('**big\\_deal\\_fan**');
  });
});
