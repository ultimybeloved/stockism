// A plain SVG line chart for the admin panel (net worth over time and the
// like). No axes library: a min/max label on the left and the date range below.
import { useId } from 'react';
import { compact, utcDate } from '../../utils/termFormat';

interface Point {
  x: number;
  y: number;
}

const LineChart = ({
  points,
  height = 140,
  color = 'var(--t-green)',
}: {
  points: Point[];
  height?: number;
  color?: string;
}) => {
  const id = useId();
  if (points.length < 2) {
    return <div className="t-mono text-xs text-[var(--t-dim)] py-8 text-center">Not enough history yet</div>;
  }
  const W = 600;
  const H = height;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const sy = (y: number) => H - 6 - ((y - y0) / (y1 - y0 || 1)) * (H - 12);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <div>
      <div className="flex gap-2">
        <div className="t-mono text-[10px] text-[var(--t-muted)] flex flex-col justify-between py-0.5 w-12 text-right">
          <span>{compact(y1)}</span>
          <span>{compact(y0)}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="flex-1" style={{ height }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="t-mono text-[10px] text-[var(--t-muted)] flex justify-between pl-14">
        <span>{utcDate(x0)}</span>
        <span>{utcDate(x1)}</span>
      </div>
    </div>
  );
};

export default LineChart;
