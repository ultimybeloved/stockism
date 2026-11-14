import type { PricePoint } from '../../../types';

// The prices a share picture's chart line runs through: the price when the
// range opened, every point since, then the live price. Thinned to `max`
// points so a long history still draws as a clean line.
export const sharePrices = (history: PricePoint[], hours: number, currentPrice: number, max = 160): number[] => {
  const cutoff = hours === Infinity ? 0 : Date.now() - hours * 3600000;
  let opening: number | null = null;
  const inRange: number[] = [];
  for (const p of history) {
    if (p.timestamp < cutoff) opening = p.price;
    else inRange.push(p.price);
  }
  const all = [...(opening === null ? [] : [opening]), ...inRange, currentPrice];
  if (all.length < 2) return [currentPrice, currentPrice];
  if (all.length <= max) return all;
  const step = (all.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => all[Math.round(i * step)]!);
};

/** The SVG path of those prices across a `width` by `height` box, with `pad` of air above and below. */
export const sharePath = (prices: number[], width: number, height: number, pad = 6): string => {
  const min = Math.min(...prices);
  const range = Math.max(...prices) - min || 1;
  return prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = pad + (1 - (p - min) / range) * (height - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
};
