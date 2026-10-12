import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'adminlog-test' });
const { buildAdminLogEntry } = require('./adminLog') as typeof import('./adminLog');

describe('buildAdminLogEntry', () => {
  it('keeps before and after, and never stores undefined (Firestore rejects it)', () => {
    const entry = buildAdminLogEntry('admin1', {
      action: 'set_holding',
      uid: 'u1',
      name: undefined,
      before: { ticker: 'MONO', shares: 3, costBasis: undefined },
      after: { ticker: 'MONO', shares: 0 },
    });
    expect(entry).toEqual({
      action: 'set_holding',
      by: 'admin1',
      uid: 'u1',
      name: null,
      before: { ticker: 'MONO', shares: 3 },
      after: { ticker: 'MONO', shares: 0 },
      detail: null,
    });
  });

  it('records actions with no player', () => {
    const entry = buildAdminLogEntry('admin1', { action: 'halt_market', detail: { reason: 'chapter leak' } });
    expect(entry).toMatchObject({ uid: null, before: null, after: null, detail: { reason: 'chapter leak' } });
  });
});
