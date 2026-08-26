import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Requiring the script must not kick off a deploy — it is guarded by a
// require.main check for exactly that reason.
const { failedFunctions } = require('./deploy-functions.cjs');

describe('failedFunctions', () => {
  // Verbatim from the 2026-08-25 deploy. The CLI exited ZERO on this and the
  // script reported "All 1 batches deployed successfully", while the function
  // that records the market index was left on its old code.
  const realWorld = [
    '+  functions: functions source uploaded successfully',
    '!  functions: failed to update function projects/stockism-abb28/locations/us-central1/functions/dailyMarketSummary',
    '+  functions[adminStartSeason(us-central1)] Successful update operation.',
  ].join('\n');

  it('catches the failure the exit code hides', () => {
    expect(failedFunctions(realWorld)).toEqual(['dailyMarketSummary']);
  });

  it('strips the resource path down to the function name', () => {
    const out = failedFunctions(
      'failed to update function projects/p/locations/us-central1/functions/executeTrade'
    );
    expect(out).toEqual(['executeTrade']);
  });

  it('handles a bare name with no resource path', () => {
    expect(failedFunctions('failed to update function seasonCheckpoint')).toEqual(['seasonCheckpoint']);
  });

  it('finds every casualty, not just the first', () => {
    const out = failedFunctions([
      'failed to update function alpha',
      'some other line',
      'failed to update function beta',
    ].join('\n'));
    expect(out).toEqual(['alpha', 'beta']);
  });

  it('reports each function once even if mentioned twice', () => {
    const out = failedFunctions('failed to update function alpha\nfailed to update function alpha');
    expect(out).toEqual(['alpha']);
  });

  it('stays quiet on a clean deploy', () => {
    const clean = [
      '+  functions: functions source uploaded successfully',
      '+  functions[executeTrade(us-central1)] Successful update operation.',
      '+  Deploy complete!',
    ].join('\n');
    expect(failedFunctions(clean)).toEqual([]);
  });

  it('is not fooled by the word failed appearing elsewhere', () => {
    expect(failedFunctions('Deploy failed. See logs.')).toEqual([]);
    expect(failedFunctions('i  functions: cleaning up build failed artifacts')).toEqual([]);
  });

  it('handles empty and missing output', () => {
    expect(failedFunctions('')).toEqual([]);
  });
});
