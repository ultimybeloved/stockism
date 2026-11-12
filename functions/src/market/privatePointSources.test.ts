import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PRIVATE_POINT_SOURCES } = require('../shared/constants/market') as typeof import('../shared/constants/market');

// market/priceHistory and its archive are world-readable. A chart point tagged
// with an automated mover's source lets players total each stock's bot drift
// and trade ahead of a storyline, so no backend code may write one.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });

describe('private chart point sources', () => {
  it('no backend file tags a chart point with a bot or market maker source', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of files(root)) {
      const text = readFileSync(file, 'utf8');
      for (const src of PRIVATE_POINT_SOURCES) {
        if (new RegExp(`source:\\s*['"\`]${src}['"\`]`).test(text)) offenders.push(`${file}: ${src}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
