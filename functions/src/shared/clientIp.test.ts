import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { clientIp } = require('./clientIp');

const request = (forwarded?: string, ip = 'first') => ({
  rawRequest: { ip, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } },
});

describe('clientIp', () => {
  it('reads a normal request', () => {
    expect(clientIp(request('97.1.1.1'))).toBe('97.1.1.1');
  });

  it('ignores addresses the caller wrote', () => {
    expect(clientIp(request('1.2.3.4,97.1.1.1'))).toBe('97.1.1.1');
    expect(clientIp(request('1.2.3.4, 5.6.7.8,97.1.1.1'))).toBe('97.1.1.1');
  });

  it('falls back when there is no header', () => {
    expect(clientIp(request(undefined, '10.0.0.1'))).toBe('10.0.0.1');
    expect(clientIp({ rawRequest: { ip: '10.0.0.1' } })).toBe('10.0.0.1');
    expect(clientIp(null)).toBeUndefined();
  });
});
