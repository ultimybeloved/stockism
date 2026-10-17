import { describe, it, expect } from 'vitest';
import { banknoteSerial, terminalQuotes, TERMINAL_QUOTES } from './cosmeticSeeds';
import { TICKERS } from './tickerTape';

describe('per-player backdrop pieces', () => {
  it('a serial number looks like a bill serial and is stable per player', () => {
    expect(banknoteSerial('Alice')).toMatch(/^[A-Z]{2} \d{8} [A-Z]$/);
    expect(banknoteSerial('Alice')).toBe(banknoteSerial('alice'));
    expect(banknoteSerial('Alice')).not.toBe(banknoteSerial('Bob'));
  });

  it('terminal quotes are real tickers, stable per player', () => {
    const quotes = terminalQuotes('Alice');
    expect(quotes).toHaveLength(TERMINAL_QUOTES);
    for (const q of quotes) expect(TICKERS).toContain(q.ticker);
    expect(terminalQuotes('alice')).toEqual(quotes);
    expect(terminalQuotes('Bob')).not.toEqual(quotes);
  });
});
