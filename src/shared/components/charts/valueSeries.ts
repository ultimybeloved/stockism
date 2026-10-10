// Series helpers for the portfolio value charts (portfolio modal, profile page).

export interface ValuePoint {
  timestamp: number;
  value: number;
}

export interface ChartHoverPoint {
  x: number;
  y: number;
  value: number;
  fullDate: string;
}

export const formatChartDate = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Thin a series to about maxPoints for cleaner hovering, always keeping the last point.
export function sampleSeries<T>(data: T[], maxPoints = 20): T[] {
  if (data.length <= maxPoints) return data;
  const step = Math.floor(data.length / maxPoints);
  const sampled: T[] = [];
  for (let i = 0; i < data.length; i += step) sampled.push(data[i]!);
  if (sampled[sampled.length - 1] !== data[data.length - 1]) sampled.push(data[data.length - 1]!);
  return sampled;
}

// Bounds and period change of a drawn series. fallback stands in for a missing or zero end.
export function summarizeSeries(data: ValuePoint[], fallback: number) {
  const values = data.map((d) => d.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;
  const firstValue = data[0]?.value || fallback;
  const lastValue = data[data.length - 1]?.value || fallback;
  const periodChange = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;
  const isUp = lastValue >= firstValue;
  return { minValue, maxValue, valueRange, firstValue, lastValue, periodChange, isUp };
}
