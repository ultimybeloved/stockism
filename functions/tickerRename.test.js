import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// The engine grabs a Firestore handle at load. Constructing one opens no
// connection, and everything tested here is pure.
let R;

beforeAll(() => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'rename-test' });
  R = require('./services/tickerRename');
});

const OLD = 'GUN';
const NEW = 'GUNX';
// Present in every fixture so each test also proves the rename left its
// neighbours alone. A migration that quietly eats a sibling key is worse than
// one that fails.
const OTHER = 'JIN';

const isDelete = (v) => v && typeof v === 'object'
  && String(v.constructor?.name || '').includes('DeleteTransform');

describe('mapMoveUpdates', () => {
  it('writes nothing when the old key is absent', () => {
    expect(R.mapMoveUpdates('holdings', { [OTHER]: 5 }, OLD, NEW)).toEqual({});
  });

  it('writes nothing for a missing map, so a sparse player doc is skipped', () => {
    expect(R.mapMoveUpdates('holdings', undefined, OLD, NEW)).toEqual({});
  });

  it('moves the value to the new key and deletes the old one', () => {
    const out = R.mapMoveUpdates('holdings', { [OLD]: 7, [OTHER]: 5 }, OLD, NEW);
    expect(out[`holdings.${NEW}`]).toBe(7);
    expect(isDelete(out[`holdings.${OLD}`])).toBe(true);
    expect(out).not.toHaveProperty(`holdings.${OTHER}`);
  });

  it('moves a falsy value rather than treating it as absent', () => {
    // A zero holding still has a cost basis and a cohort behind it.
    const out = R.mapMoveUpdates('holdings', { [OLD]: 0 }, OLD, NEW);
    expect(out[`holdings.${NEW}`]).toBe(0);
  });

  it('carries nested structures across whole', () => {
    const cohorts = { [OLD]: [{ shares: 3, at: 1 }, { shares: 2, at: 2 }] };
    const out = R.mapMoveUpdates('holdingCohorts', cohorts, OLD, NEW);
    expect(out[`holdingCohorts.${NEW}`]).toEqual(cohorts[OLD]);
  });
});

describe('remapArrayOfStrings', () => {
  it('returns null when the ticker is not in the array, so nothing is written', () => {
    expect(R.remapArrayOfStrings([OTHER], OLD, NEW)).toBeNull();
  });

  it('returns null for a missing array', () => {
    expect(R.remapArrayOfStrings(undefined, OLD, NEW)).toBeNull();
  });

  it('swaps the entry and keeps order', () => {
    expect(R.remapArrayOfStrings([OTHER, OLD, 'ZZZ'], OLD, NEW)).toEqual([OTHER, NEW, 'ZZZ']);
  });

  it('collapses a duplicate if both names somehow ended up present', () => {
    expect(R.remapArrayOfStrings([OLD, NEW, OTHER], OLD, NEW)).toEqual([NEW, OTHER]);
  });
});

describe('remapObjectArray', () => {
  it('returns null when no entry matches', () => {
    expect(R.remapObjectArray([{ ticker: OTHER }], 'ticker', OLD, NEW)).toBeNull();
  });

  it('rewrites only matching entries and leaves the rest identical', () => {
    const input = [{ ticker: OTHER, n: 1 }, { ticker: OLD, n: 2 }];
    const out = R.remapObjectArray(input, 'ticker', OLD, NEW);
    expect(out).toEqual([{ ticker: OTHER, n: 1 }, { ticker: NEW, n: 2 }]);
    expect(out[0]).toBe(input[0]); // untouched entries are not cloned
  });

  it('works on the index constituent shape, which keys on t not ticker', () => {
    const out = R.remapObjectArray([{ t: OLD, b: 85 }], 't', OLD, NEW);
    expect(out).toEqual([{ t: NEW, b: 85 }]);
  });

  it('survives a null entry in the array', () => {
    expect(R.remapObjectArray([null, { ticker: OLD }], 'ticker', OLD, NEW))
      .toEqual([null, { ticker: NEW }]);
  });
});

describe('remapMessage', () => {
  it('rewrites the ticker inside feed text', () => {
    expect(R.remapMessage(`bought 5 $${OLD}`, OLD, NEW)).toBe(`bought 5 $${NEW}`);
  });

  it('does NOT touch a longer ticker that starts with the same letters', () => {
    // The whole reason for the lookahead. $GUNNER must survive renaming GUN.
    expect(R.remapMessage('bought 5 $GUNNER', OLD, NEW)).toBeNull();
  });

  it('rewrites every occurrence in one string', () => {
    expect(R.remapMessage(`$${OLD} up, $${OLD} down`, OLD, NEW))
      .toBe(`$${NEW} up, $${NEW} down`);
  });

  it('leaves a mention of another ticker alone', () => {
    expect(R.remapMessage(`sold 2 $${OTHER}`, OLD, NEW)).toBeNull();
  });

  it('returns null for a missing message rather than throwing', () => {
    expect(R.remapMessage(undefined, OLD, NEW)).toBeNull();
  });

  it('handles the ticker at the end of a sentence', () => {
    expect(R.remapMessage(`bought $${OLD}.`, OLD, NEW)).toBe(`bought $${NEW}.`);
  });
});

describe('collapseAliasChain', () => {
  it('records a first rename', () => {
    expect(R.collapseAliasChain({}, OLD, NEW)).toEqual({ [OLD]: NEW });
  });

  it('keeps every lookup one hop when a renamed ticker is renamed again', () => {
    // A -> B, then B -> C must leave A pointing at C, not at a dead name.
    const first = R.collapseAliasChain({}, 'A', 'B');
    const second = R.collapseAliasChain(first, 'B', 'C');
    expect(second).toEqual({ A: 'C', B: 'C' });
  });

  it('leaves unrelated aliases alone', () => {
    expect(R.collapseAliasChain({ DOTS: 'CROW' }, OLD, NEW))
      .toEqual({ DOTS: 'CROW', [OLD]: NEW });
  });
});

describe('buildUserUpdates', () => {
  it('writes nothing for a player who never touched the stock', () => {
    expect(R.buildUserUpdates({ holdings: { [OTHER]: 4 } }, OLD, NEW)).toEqual({});
  });

  it('writes nothing on a second pass, so a resumed run is safe', () => {
    expect(R.buildUserUpdates({ holdings: { [NEW]: 4 } }, OLD, NEW)).toEqual({});
  });

  it('covers every ticker-keyed map on the user document', () => {
    const userData = {};
    for (const map of R.USER_TICKER_MAPS) userData[map] = { [OLD]: 1, [OTHER]: 2 };
    const out = R.buildUserUpdates(userData, OLD, NEW);
    for (const map of R.USER_TICKER_MAPS) {
      expect(out[`${map}.${NEW}`]).toBe(1);
      expect(isDelete(out[`${map}.${OLD}`])).toBe(true);
    }
  });

  it('includes the three maps the old tool silently dropped', () => {
    // holdingCohorts is the dividend and exit-loyalty ledger, drip is the
    // reinvestment toggle, loyaltyTierNotified suppresses duplicate alerts.
    for (const map of ['holdingCohorts', 'drip', 'loyaltyTierNotified']) {
      expect(R.USER_TICKER_MAPS).toContain(map);
    }
  });

  it('rewrites the watchlist array', () => {
    expect(R.buildUserUpdates({ watchlist: [OTHER, OLD] }, OLD, NEW).watchlist)
      .toEqual([OTHER, NEW]);
  });

  it('rewrites the ticker inside the transaction log', () => {
    const out = R.buildUserUpdates({ transactionLog: [{ ticker: OLD, type: 'buy' }] }, OLD, NEW);
    expect(out.transactionLog).toEqual([{ ticker: NEW, type: 'buy' }]);
  });
});

describe('buildMarketUpdates', () => {
  const market = () => ({
    prices: { [OLD]: 90, [OTHER]: 40 },
    volumes: { [OLD]: 12 },
    botImpact: { [OLD]: 0.03 },
    haltedTickers: { [OLD]: true },
    ath: { [OLD]: 120 },
    atl: { [OLD]: 30 },
    launchedTickers: [OTHER, OLD],
    alertedThresholds: { [`${OLD}_10_up`]: 1, [`${OTHER}_10_up`]: 2 },
  });

  it('moves every ticker-keyed map', () => {
    const out = R.buildMarketUpdates(market(), OLD, NEW);
    expect(out[`prices.${NEW}`]).toBe(90);
    expect(out[`volumes.${NEW}`]).toBe(12);
    expect(out[`botImpact.${NEW}`]).toBe(0.03);
    expect(out[`ath.${NEW}`]).toBe(120);
    expect(out[`atl.${NEW}`]).toBe(30);
  });

  it('carries a per-ticker halt across, rather than silently lifting it', () => {
    expect(R.buildMarketUpdates(market(), OLD, NEW)[`haltedTickers.${NEW}`]).toBe(true);
  });

  it('swaps the launched list so an IPO stock stays launched', () => {
    expect(R.buildMarketUpdates(market(), OLD, NEW).launchedTickers).toEqual([OTHER, NEW]);
  });

  it('drops the old alert throttle keys and keeps everyone else', () => {
    const out = R.buildMarketUpdates(market(), OLD, NEW);
    expect(isDelete(out[`alertedThresholds.${OLD}_10_up`])).toBe(true);
    expect(out).not.toHaveProperty(`alertedThresholds.${OTHER}_10_up`);
  });

  it('always records the alias, even when nothing else moved', () => {
    expect(R.buildMarketUpdates({}, OLD, NEW).tickerAliases).toEqual({ [OLD]: NEW });
  });
});

describe('phase coverage', () => {
  it('runs the market document before anything that refers to it', () => {
    const names = R.PHASES.map((p) => p.name);
    expect(names[0]).toBe('marketCurrent');
    expect(names.indexOf('users')).toBeGreaterThan(names.indexOf('marketCurrent'));
  });

  it('includes every location the old tool missed', () => {
    const names = R.PHASES.map((p) => p.name);
    for (const n of ['priceArchive', 'marketDocs', 'priceAlerts', 'preMarketOrders', 'feed']) {
      expect(names).toContain(n);
    }
  });

  it('gives every phase a name and a human label for the progress view', () => {
    for (const p of R.PHASES) {
      expect(typeof p.name).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(typeof p.run).toBe('function');
    }
  });
});
