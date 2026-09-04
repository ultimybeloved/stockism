import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// helpers.js grabs a Firestore handle at module load, so the app has to exist
// before it is required. Constructing the handle does not open a connection,
// and nothing under test touches the network.
let buildExtremeUpdates;
let buildTickerFlowUpdate;

beforeAll(() => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'tickerstats-test' });
  ({ buildExtremeUpdates, buildTickerFlowUpdate } = require('./helpers'));
});

// Real roster tickers, because the extremes sweep filters through
// isRosterTicker and a made-up ticker would be dropped for the wrong reason.
const A = 'DG';
const B = 'BUFF';

describe('all-time high/low marks', () => {
  it('sets both marks the first time a price is seen', () => {
    expect(buildExtremeUpdates({ [A]: 50 }, {}, {})).toEqual({
      [`ath.${A}`]: 50,
      [`atl.${A}`]: 50,
    });
  });

  it('moves only the high when a price breaks upward', () => {
    expect(buildExtremeUpdates({ [A]: 90 }, { [A]: 80 }, { [A]: 40 }))
      .toEqual({ [`ath.${A}`]: 90 });
  });

  it('moves only the low when a price breaks downward', () => {
    expect(buildExtremeUpdates({ [A]: 30 }, { [A]: 80 }, { [A]: 40 }))
      .toEqual({ [`atl.${A}`]: 30 });
  });

  it('writes nothing while a price stays inside its band', () => {
    expect(buildExtremeUpdates({ [A]: 60 }, { [A]: 80 }, { [A]: 40 })).toEqual({});
  });

  it('leaves an equal price alone, so a flat stock never rewrites its marks', () => {
    expect(buildExtremeUpdates({ [A]: 80 }, { [A]: 80 }, { [A]: 80 })).toEqual({});
  });

  it('ignores a ticker that is priced but no longer on the roster', () => {
    // The DOTS case: a rename left a price behind that no player can see.
    expect(buildExtremeUpdates({ DOTS: 999 }, {}, {})).toEqual({});
  });

  it('ignores zero and negative prices rather than recording them as a low', () => {
    expect(buildExtremeUpdates({ [A]: 0, [B]: -5 }, {}, {})).toEqual({});
  });

  it('treats a missing or zero stored mark as unset', () => {
    expect(buildExtremeUpdates({ [A]: 10 }, { [A]: 0 }, { [A]: 0 })).toEqual({
      [`ath.${A}`]: 10,
      [`atl.${A}`]: 10,
    });
  });

  it('handles several tickers in one sweep', () => {
    const out = buildExtremeUpdates(
      { [A]: 100, [B]: 5 },
      { [A]: 80, [B]: 90 },
      { [A]: 40, [B]: 50 }
    );
    expect(out).toEqual({ [`ath.${A}`]: 100, [`atl.${B}`]: 5 });
  });
});

describe('per-ticker money flow', () => {
  const flow = (action, totalValue) =>
    buildTickerFlowUpdate({ ticker: A, action, amount: 3, totalValue, now: 1000 })[A];

  // The increment sentinel carries its operand, which is what needs asserting.
  const operandOf = (sentinel) => JSON.parse(JSON.stringify(sentinel)).operand;

  it('counts buying as money going into the stock', () => {
    expect(operandOf(flow('buy', 250).netFlow)).toBe(250);
  });

  it('counts covering as money going in, since a cover buys shares back', () => {
    expect(operandOf(flow('cover', 250).netFlow)).toBe(250);
  });

  it('counts selling as money coming out', () => {
    expect(operandOf(flow('sell', 250).netFlow)).toBe(-250);
  });

  it('counts shorting as money coming out', () => {
    expect(operandOf(flow('short', 250).netFlow)).toBe(-250);
  });

  it('counts one trade and its shares regardless of direction', () => {
    const out = flow('sell', 250);
    expect(operandOf(out.trades)).toBe(1);
    expect(operandOf(out.shares)).toBe(3);
  });

  it('stamps the trade time so the neglect detector has something to read', () => {
    expect(flow('buy', 250).lastTradedAt).toBe(1000);
  });

  it('treats a missing value as zero rather than writing NaN', () => {
    const out = buildTickerFlowUpdate({ ticker: A, action: 'buy', now: 1 })[A];
    expect(operandOf(out.netFlow)).toBe(0);
    expect(operandOf(out.shares)).toBe(0);
  });
});
