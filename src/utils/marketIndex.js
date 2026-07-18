// Pure market-index math: the equal-weight index of all non-ETF characters
// (1000 = everyone at base price) and historical series reconstruction.

import { CHARACTERS } from '../characters';

export const nonETFCharacters = CHARACTERS.filter(c => !c.isETF);

export const TIME_RANGES = [
  { key: '1d', label: 'Today', hours: 24 },
  { key: '7d', label: '7 Days', hours: 168 },
  { key: '1m', label: '1 Month', hours: 720 },
  { key: '3m', label: '3 Months', hours: 2160 },
  { key: 'all', label: 'All Time', hours: Infinity },
];

export const getTimestamp = (entry) => {
  if (typeof entry.timestamp === 'number') return entry.timestamp;
  if (entry.timestamp?.seconds) return entry.timestamp.seconds * 1000;
  return null;
};

export const computeIndex = (prices, characters) => {
  let sum = 0;
  let count = 0;
  for (const char of characters) {
    const price = prices?.[char.ticker];
    const base = char.basePrice;
    if (base > 0) {
      sum += (price != null ? price : base) / base;
      count++;
    }
  }
  return count > 0 ? 1000 * (sum / count) : 1000;
};

export const computeIndexAtTime = (priceHistory, t) => {
  let sum = 0;
  let count = 0;
  for (const char of nonETFCharacters) {
    const base = char.basePrice;
    if (base <= 0) continue;
    const history = priceHistory?.[char.ticker];
    if (!history || history.length === 0) {
      sum += 1;
      count++;
      continue;
    }
    let nearest = null;
    for (let j = history.length - 1; j >= 0; j--) {
      const ts = getTimestamp(history[j]);
      if (ts != null && ts <= t) {
        nearest = history[j].price;
        break;
      }
    }
    sum += (nearest != null ? nearest : base) / base;
    count++;
  }
  return count > 0 ? 1000 * (sum / count) : 1000;
};

export const buildIndexSeries = (priceHistory, currentIndex, hours) => {
  if (!priceHistory || Object.keys(priceHistory).length === 0) return [];

  const now = Date.now();
  const cutoff = hours === Infinity ? 0 : now - hours * 60 * 60 * 1000;

  // Determine interval based on time range for ~100-150 points
  let interval;
  if (hours <= 24) interval = 30 * 60 * 1000;        // 30 min
  else if (hours <= 168) interval = 2 * 60 * 60 * 1000;   // 2 hours
  else if (hours <= 720) interval = 8 * 60 * 60 * 1000;   // 8 hours
  else if (hours <= 2160) interval = 24 * 60 * 60 * 1000; // 1 day
  else interval = 24 * 60 * 60 * 1000;                     // 1 day

  // For "all time", find earliest data point
  let start = cutoff || now - 30 * 24 * 60 * 60 * 1000; // default 30 days back
  if (hours === Infinity) {
    for (const char of nonETFCharacters) {
      const history = priceHistory?.[char.ticker];
      if (history && history.length > 0) {
        const ts = getTimestamp(history[0]);
        if (ts && ts < start) start = ts;
      }
    }
  } else {
    start = cutoff;
  }

  const points = [];
  for (let t = start; t <= now; t += interval) {
    points.push({ timestamp: t, price: computeIndexAtTime(priceHistory, t) });
  }
  // Always include current
  points.push({ timestamp: now, price: currentIndex });
  return points;
};
