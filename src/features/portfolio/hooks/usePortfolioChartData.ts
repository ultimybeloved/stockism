import { useMemo } from 'react';
import { formatChartDate, sampleSeries, summarizeSeries } from '../../../shared/components/charts/valueSeries';

// Builds the portfolio chart series (sampled, anchored, and always ending at the
// current value) plus the derived summary values the header needs. Extracted from
// PortfolioModal so the modal stays a thin orchestrator.
import type { PortfolioPoint } from './usePortfolioHistory';

export interface PortfolioChartPoint extends PortfolioPoint {
  date: string;
  fullDate: string;
}

export function usePortfolioChartData(portfolioHistory: PortfolioPoint[] | null | undefined, currentValue: number) {
  const chartData = useMemo((): PortfolioChartPoint[] => {
    if (!portfolioHistory || portfolioHistory.length === 0) {
      // No history at all - create two points for a flat line
      const now = Date.now();
      return [
        { timestamp: now - 60000, value: currentValue, date: 'Now', fullDate: 'Now' },
        { timestamp: now, value: currentValue, date: 'Now', fullDate: 'Now' },
      ];
    }

    let data: PortfolioChartPoint[] = portfolioHistory.map((point) => ({
      ...point,
      date: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullDate: formatChartDate(point.timestamp),
    }));

    // Sample down to ~20 points for cleaner interaction
    data = sampleSeries(data);

    // Always append current value as the final point so the right edge of the
    // chart reflects where the portfolio is right now, not the last history write.
    const now = Date.now();
    const lastPoint = data[data.length - 1];
    if (!lastPoint || now - lastPoint.timestamp > 60000) {
      data = [...data, { timestamp: now, value: currentValue, date: 'Now', fullDate: 'Now' }];
    }

    // If still only 1 point, duplicate it so the chart draws a flat line
    if (data.length === 1) {
      const only = data[0]!;
      data = [
        { timestamp: only.timestamp - 60000, value: only.value, date: only.date, fullDate: only.fullDate },
        ...data,
      ];
    }

    // If no data in range at all, show current value as flat line
    if (data.length === 0) {
      data = [
        { timestamp: now - 60000, value: currentValue, date: 'Now', fullDate: 'Now' },
        { timestamp: now, value: currentValue, date: 'Now', fullDate: 'Now' },
      ];
    }

    return data;
    // timeRange isn't read here — the parent refetches portfolioHistory per range.
  }, [portfolioHistory, currentValue]);

  const hasChartData = chartData.length >= 2; // Will always be true now
  const { minValue, maxValue, valueRange, firstValue, lastValue, periodChange, isUp } = summarizeSeries(
    chartData,
    currentValue,
  );

  return { chartData, hasChartData, minValue, maxValue, valueRange, firstValue, lastValue, periodChange, isUp };
}
