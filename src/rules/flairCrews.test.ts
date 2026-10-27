import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { CHARACTERS } from '../characters';
import { CREW_MAP, CREW_SWITCH_EVENT } from '../crews';
import { FLAIR_CREWS, flairCrestSrc, flairCrewsOf, flairOf } from './flairCrews';

describe('flair crews', () => {
  const flairs = Object.values(FLAIR_CREWS);
  const tickers = new Set(CHARACTERS.map((c) => c.ticker));

  it('each sits inside a real crew, lists real characters, and has a crest', () => {
    for (const f of flairs) {
      expect(CREW_MAP[f.crew], f.id).toBeDefined();
      for (const t of f.members) expect(tickers.has(t), `${f.id} ${t}`).toBe(true);
      expect(existsSync(join(__dirname, '../../public', flairCrestSrc(f))), f.id).toBe(true);
    }
  });

  it('only counts while the flair belongs to the current crew', () => {
    expect(flairOf({ crew: 'ALLIED', flairCrew: 'BURN_KNUCKLES' })?.name).toBe('Burn Knuckles');
    expect(flairOf({ crew: 'HOSTEL', flairCrew: 'BURN_KNUCKLES' })).toBeNull();
    expect(flairOf({ crew: 'ALLIED', flairCrew: 'NOPE' })).toBeNull();
    expect(flairOf({ crew: 'ALLIED', flairCrew: 42 })).toBeNull();
    expect(flairOf({ crew: 'ALLIED' })).toBeNull();
    expect(flairOf(null)).toBeNull();
  });

  it('lists a crew’s flair crews and none for a crew without', () => {
    expect(flairCrewsOf('SECRET_FRIENDS').map((f) => f.id)).toEqual(['GANGSEO_UNION', 'CHEONLIANG_SF']);
    expect(flairCrewsOf('GOD_DOG')).toEqual([]);
    expect(flairCrewsOf(null)).toEqual([]);
  });

  it('the free-switch event covers exactly the crews with flair crews', () => {
    if (CREW_SWITCH_EVENT?.id !== 'flair_2026_10') return;
    const withFlair = [...new Set(flairs.map((f) => f.crew))].sort();
    expect([...CREW_SWITCH_EVENT.crewIds].sort()).toEqual(withFlair);
  });
});
