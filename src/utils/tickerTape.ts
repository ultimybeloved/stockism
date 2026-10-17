import type { CSSProperties } from 'react';
import { CHARACTERS } from '../characters';
import { seedHash } from '../rules/cosmetics';

// The Ticker Tape frame's quotes. Every wearer gets their own tape: eight real
// tickers with made-up moves, picked from a generator seeded by the player's
// name, so no two tapes match and a player's tape is the same everywhere.
//
// Each quote sits in a fixed-width slot so the tile is exactly TAPE_WIDTH
// wide; the crawl animation in index.css moves one slot per step and one whole
// tile per cycle, which is what keeps the loop seamless. Change the slot size
// or count and the cosTickerCrawl keyframes have to change with it.
export const TAPE_SLOT = 56;
export const TAPE_SLOTS = 8;
const TAPE_WIDTH = TAPE_SLOT * TAPE_SLOTS;

export const TICKERS = CHARACTERS.filter((c) => !c.isETF && c.ticker.length <= 4).map((c) => c.ticker);

// mulberry32: tiny seeded generator, plenty for picking quotes.
export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const tile = (next: () => number) => {
  const quotes = Array.from({ length: TAPE_SLOTS }, (_, i) => {
    const ticker = TICKERS[Math.floor(next() * TICKERS.length)] || 'STK';
    const up = next() < 0.55;
    const move = (0.1 + next() * 9.8).toFixed(1);
    return (
      `<text x='${i * TAPE_SLOT + 3}' y='8'>` +
      `<tspan fill='#fbbf24'>${ticker}</tspan>` +
      `<tspan fill='${up ? '#22c55e' : '#ef4444'}'>${up ? '▲' : '▼'}${move}</tspan></text>`
    );
  }).join('');
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${TAPE_WIDTH}' height='10'>` +
    `<rect width='${TAPE_WIDTH}' height='10' fill='#18181b'/>` +
    `<g font-family='monospace' font-size='8' font-weight='700'>${quotes}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

const cache = new Map<string, CSSProperties>();

/** CSS variables carrying this player's top and bottom tapes. */
export const tickerTapeStyle = (key: string | null | undefined): CSSProperties => {
  const k = (key || '').toLowerCase();
  let style = cache.get(k);
  if (!style) {
    const next = rng(seedHash(k));
    style = { '--cos-tape-top': tile(next), '--cos-tape-bottom': tile(next) } as CSSProperties;
    cache.set(k, style);
  }
  return style;
};
