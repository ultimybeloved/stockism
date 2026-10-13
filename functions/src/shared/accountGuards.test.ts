import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type Mod = typeof import('./accountGuards');
let ipTrackingKey: Mod['ipTrackingKey'];

beforeAll(() => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'guards-test' });
  ({ ipTrackingKey } = require('./accountGuards') as Mod);
});

describe('ipTrackingKey', () => {
  it('keeps an IPv4 address whole, as the doc id it has always been', () => {
    expect(ipTrackingKey('203.0.113.7')).toBe('203_0_113_7');
  });

  it('gives every address on one IPv6 connection the same key', () => {
    const a = ipTrackingKey('2001:db8:85a3:12:aaaa:bbbb:cccc:1');
    const b = ipTrackingKey('2001:db8:85a3:12:1111:2222:3333:4');
    expect(a).toBe(b);
    expect(a).not.toContain(':');
  });

  it('has no key for a missing address', () => {
    expect(ipTrackingKey('unknown')).toBeNull();
    expect(ipTrackingKey(undefined)).toBeNull();
  });
});
