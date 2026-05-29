// Shared presentational helpers for the portfolio sub-components.

export const DIVIDEND_TIER_META = {
  'blue-chip': { label: 'Blue-chip', emoji: '⭐', color: 'text-amber-500' },
  'dividend':  { label: 'Dividend', emoji: '💵', color: 'text-emerald-500' },
  'etf':       { label: 'ETF',      emoji: '📊', color: 'text-sky-500' },
  'growth':    { label: 'Growth',   emoji: '📈', color: 'text-zinc-400' },
};

export const formatShares = (n) => {
  if (n === 0) return '0';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};

export const TIME_RANGES = [
  { key: '1d',  label: '24h', days: 1 },
  { key: '7d',  label: '7D',  days: 7 },
  { key: '1m',  label: '1M',  months: 1 },
  { key: '3m',  label: '3M',  months: 3 },
  { key: '1y',  label: '1Y',  years: 1 },
  { key: 'all', label: 'All' },
];
