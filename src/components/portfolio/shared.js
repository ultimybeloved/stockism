// Shared presentational helpers for the portfolio sub-components.

// Tier names and colors follow the card rarity tiers (see src/index.css).
export const DIVIDEND_TIER_META = {
  legendary: { label: 'Legendary', color: 'text-amber-500' },
  epic:      { label: 'Epic',      color: 'text-purple-500' },
  rare:      { label: 'Rare',      color: 'text-blue-500' },
  uncommon:  { label: 'Uncommon',  color: 'text-emerald-500' },
  common:    { label: 'Common',    color: 'text-zinc-400' },
  etf:       { label: 'ETF',       color: 'text-sky-500' },
};

export const formatShares = (n) => {
  if (n === 0) return '0';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};

// Sort options for the holdings (long positions) list.
export const HOLDING_SORTS = [
  { key: 'value', label: 'Value' },
  { key: 'shares', label: 'Shares' },
  { key: 'name', label: 'Name' },
];

// Case-insensitive filter on ticker or character name. Empty query = all.
export const filterHoldings = (items, query) => {
  const q = (query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) =>
    (i.ticker || '').toLowerCase().includes(q) ||
    (i.character?.name || '').toLowerCase().includes(q)
  );
};

// Pure sort — returns a new array. value/shares are numeric; name uses
// localeCompare on the character name (falling back to ticker).
export const sortHoldings = (items, key, dir = 'desc') => {
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (key === 'name') {
      const an = (a.character?.name || a.ticker || '').toLowerCase();
      const bn = (b.character?.name || b.ticker || '').toLowerCase();
      return an.localeCompare(bn) * sign;
    }
    const av = key === 'shares' ? (a.shares || 0) : (a.value || 0);
    const bv = key === 'shares' ? (b.shares || 0) : (b.value || 0);
    return (av - bv) * sign;
  });
  return sorted;
};

export const TIME_RANGES = [
  { key: '1d',  label: '24h', days: 1 },
  { key: '7d',  label: '7D',  days: 7 },
  { key: '1m',  label: '1M',  months: 1 },
  { key: '3m',  label: '3M',  months: 3 },
  { key: '1y',  label: '1Y',  years: 1 },
  { key: 'all', label: 'All' },
];
