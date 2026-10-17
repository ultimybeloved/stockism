import { seedHash } from '../rules/cosmetics';
import { TICKERS, rng } from './tickerTape';

// Player-specific pieces of the 2026-10 backdrops, seeded by the player's name
// like the Ticker Tape, so every wearer's looks different and stays the same
// everywhere they appear.

export interface TerminalQuote {
  ticker: string;
  price: number;
  up: boolean;
  move: number;
}

export const TERMINAL_QUOTES = 16;

/** The Terminal backdrop's starting quotes: real tickers, made-up numbers. */
export const terminalQuotes = (key: string | null | undefined): TerminalQuote[] => {
  const next = rng(seedHash(key));
  return Array.from({ length: TERMINAL_QUOTES }, () => {
    const up = next() > 0.45;
    return {
      up,
      ticker: TICKERS[Math.floor(next() * TICKERS.length)] || 'STK',
      price: 20 + next() * 880,
      move: 0.1 + next() * 6,
    };
  });
};

const SERIAL_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** The Banknote backdrop's serial number, like "FU 81039716 L". */
export const banknoteSerial = (key: string | null | undefined): string => {
  const next = rng(seedHash(`${key || ''}note`));
  const letter = () => SERIAL_LETTERS.charAt(Math.floor(next() * SERIAL_LETTERS.length));
  const head = letter() + letter();
  const digits = String(Math.floor(next() * 1e8)).padStart(8, '0');
  return `${head} ${digits} ${letter()}`;
};
