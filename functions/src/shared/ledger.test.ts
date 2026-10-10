import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'offline-test' });
const { buildLedgerEntry, recordLedger } = require('./ledger') as typeof import('./ledger');

const SRC = join(__dirname, '..');

// Files that mention cash but never change a real player's balance. Anything
// else that writes cash must book a ledger entry (directly, or through
// recordTrade / recordEventTrade, which book one themselves).
const NO_LEDGER_NEEDED: Record<string, string> = {
  'market/botTrader.ts': 'bots, not players',
  'admin/adminBackups.ts': 'copies balances into a backup file',
  'discord/dropAudit.ts': 'read-only report',
  'users/leaderboard.ts': 'read-only',
  'season/season.ts': 'field list for a read, not a write',
  'season/seasonCheckpoint.ts': 'field list for a read',
  'season/seasonDryRun.ts': 'field list for a read',
  'trading/tradeState.ts': 'builds the update; trading.ts books it through recordTrade',
  'shared/ledger.ts': 'the ledger itself',
  'shared/eventTradeRecords.ts': 'books its own ledger entry',
  'shared/accountArchive.ts': 'copies a deleted account; no balance changes',
};

const CASH_WRITE =
  /\bcash\??\s*:(?!\s*(number|string|boolean|unknown)\b)\s*[^,\s]|\.cash\s*=[^=]|\bcash\s*=\s*FieldValue/;
const BOOKS_LEDGER = /\brecordLedger\(|\baddLedgerEntry\(|\brecordTrade\(|\brecordEventTrade\(/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });

describe('money ledger coverage', () => {
  it('every backend file that writes cash books a ledger entry', () => {
    const missing = walk(SRC)
      .map((p) => ({ file: relative(SRC, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }))
      .filter(({ file, src }) => !NO_LEDGER_NEEDED[file] && CASH_WRITE.test(src) && !BOOKS_LEDGER.test(src))
      .map(({ file }) => file);
    expect(missing, 'These files change cash without a ledger entry').toEqual([]);
  });

  it('the exemption list has no stale entries', () => {
    const files = new Set(walk(SRC).map((p) => relative(SRC, p).replace(/\\/g, '/')));
    expect(Object.keys(NO_LEDGER_NEEDED).filter((f) => !files.has(f))).toEqual([]);
  });
});

describe('ledger entries', () => {
  it('rounds the amount and defaults the account to cash', () => {
    const e = buildLedgerEntry({ uid: 'u', type: 'mission_reward', amount: 10.005, cashAfter: 110.004 });
    expect(e).toMatchObject({ uid: 'u', type: 'mission_reward', account: 'cash', amount: 10.01, cashAfter: 110 });
  });

  it('skips a change of zero', () => {
    const writes: unknown[] = [];
    const writer = { set: (_ref: unknown, data: unknown) => writes.push(data) };
    recordLedger(writer as never, { uid: 'u', type: 'x', amount: 0 });
    recordLedger(writer as never, { uid: 'u', type: 'x', amount: 0.001 });
    recordLedger(writer as never, { uid: 'u', type: 'x', amount: -5 });
    expect(writes).toHaveLength(1);
  });
});
