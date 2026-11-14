import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type Mod = typeof import('./signupAnnounce');
let buildSignupEmbed: Mod['buildSignupEmbed'];

beforeAll(() => {
  ({ buildSignupEmbed } = require('./signupAnnounce') as Mod);
});

describe('buildSignupEmbed', () => {
  it('names the player and how they signed up', () => {
    const embed = buildSignupEmbed('Gun', 'google.com', 0);
    expect(embed.description).toContain('**Gun** just joined Stockism with Google.');
    expect(embed.timestamp).toBe('1970-01-01T00:00:00.000Z');
  });

  it('labels a Discord signup', () => {
    expect(buildSignupEmbed('Gun', 'custom', 0).description).toContain('with Discord.');
  });

  it('leaves the method out when it is unknown', () => {
    expect(buildSignupEmbed('Gun', undefined, 0).description).toContain('**Gun** just joined Stockism.');
  });

  it('escapes underscores so a name cannot change the formatting', () => {
    expect(buildSignupEmbed('big_deal_fan', 'password', 0).description).toContain('**big\\_deal\\_fan**');
  });
});
