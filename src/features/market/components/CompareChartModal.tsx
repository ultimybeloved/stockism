// Two to four stocks on one chart, each drawn as its % change from the start of
// the period, so a $5 stock and a $500 stock can be compared fairly.
import { useMemo, useState } from 'react';
import { TIME_RANGES } from './PriceChart';
import { usePriceHistory } from '../hooks/usePriceHistory';
import { useMarket } from '../../../context/AppContext';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';
import { themeClasses } from '../../../utils/theme';
import { formatChange } from '../../../utils/formatters';
import { priceAt } from '../../../utils/marketStats';
import type { PricePoint } from '../../../types';
import SegmentedSwitch from '../../../shared/components/SegmentedSwitch';

export const COMPARE_MAX = 4;
const COLORS = ['#f97316', '#3b82f6', '#a855f7', '#14b8a6'];
const W = 600;
const H = 260;
const PAD = 8;

interface CompareChartModalProps {
  tickers: string[];
  onRemove: (ticker: string) => void;
  onClose: () => void;
}

const CompareChartModal = ({ tickers, onRemove, onClose }: CompareChartModalProps) => {
  useEscapeKey(onClose);
  const dialogRef = useModalFocus();
  const { prices } = useMarket();
  const [timeRange, setTimeRange] = useState('7d');
  const { overlayClass, modalShellClass, textClass, mutedClass, cardEdgeClass } = themeClasses;
  // A fixed number of hook calls; empty slots fetch nothing.
  const h0 = usePriceHistory(tickers[0]).fullHistory;
  const h1 = usePriceHistory(tickers[1]).fullHistory;
  const h2 = usePriceHistory(tickers[2]).fullHistory;
  const h3 = usePriceHistory(tickers[3]).fullHistory;

  const range = TIME_RANGES.find((r) => r.key === timeRange)!;
  const series = useMemo(() => {
    const histories = [h0, h1, h2, h3];
    const now = Date.now();
    const all = tickers.map((t, i) => histories[i] || []);
    const earliest = Math.min(...all.map((h) => h[0]?.timestamp ?? now));
    const start = range.hours === Infinity ? earliest : now - range.hours * 3600000;
    return tickers.map((ticker, i) => {
      const hist: PricePoint[] = all[i]!;
      const price = prices[ticker] || hist.at(-1)?.price || 0;
      const open = priceAt(hist, start, price);
      const pts = [
        { t: start, v: 0 },
        ...hist
          .filter((p) => p.timestamp > start)
          .map((p) => ({ t: p.timestamp, v: open > 0 ? (p.price / open - 1) * 100 : 0 })),
        { t: now, v: open > 0 ? (price / open - 1) * 100 : 0 },
      ];
      return { ticker, color: COLORS[i]!, pts, last: pts.at(-1)!.v, start };
    });
  }, [tickers, h0, h1, h2, h3, prices, range.hours]);

  const start = series[0]?.start ?? Date.now();
  const end = Date.now();
  const vals = series.flatMap((s) => s.pts.map((p) => p.v));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (t: number) => PAD + ((t - start) / Math.max(1, end - start)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div ref={dialogRef} className={`${modalShellClass} max-w-3xl`} onClick={(e) => e.stopPropagation()}>
        <div className={`p-4 border-b flex items-center justify-between ${cardEdgeClass}`}>
          <h2 className={`text-lg font-semibold ${textClass}`}>Compare</h2>
          <button aria-label="Close" onClick={onClose} className={`text-xl ${mutedClass} hover:text-orange-500`}>
            ×
          </button>
        </div>
        <div className="px-4 pt-3">
          <SegmentedSwitch
            label="Time range"
            size="md"
            options={TIME_RANGES.map((r) => [r.key, r.label] as const)}
            value={timeRange}
            onChange={setTimeRange}
          />
        </div>
        <div className="p-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64" role="img" aria-label="Comparison chart">
            <line
              x1={PAD}
              x2={W - PAD}
              y1={y(0)}
              y2={y(0)}
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeDasharray="4 4"
            />
            {series.map((s) => (
              <polyline
                key={s.ticker}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                points={s.pts.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')}
              />
            ))}
          </svg>
        </div>
        <div className="px-4 pb-4 flex flex-wrap gap-2">
          {series.map((s) => (
            <span
              key={s.ticker}
              className="flex items-center gap-2 px-2 py-1 rounded-sm border text-sm light:border-amber-200 dark:border-zinc-700"
            >
              <span className="w-3 h-3 rounded-full" style={{ background: s.color }} />
              <span className="font-mono font-semibold" style={{ color: s.color }}>
                ${s.ticker}
              </span>
              <span className={textClass}>{formatChange(s.last)}</span>
              <button
                aria-label={`Remove $${s.ticker}`}
                onClick={() => onRemove(s.ticker)}
                className={`${mutedClass} hover:text-orange-500`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CompareChartModal;
