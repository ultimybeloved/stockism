import { useRef, type MouseEvent } from 'react';
import { formatCurrency, formatAxisLabels } from '../../../utils/formatters';
import { useTheme } from '../../../context/AppContext';
import { formatChartDate, type ChartHoverPoint, type ValuePoint } from './valueSeries';

interface ValueLineChartProps {
  data: ValuePoint[];
  minValue: number;
  maxValue: number;
  valueRange: number;
  isUp: boolean;
  colorBlindMode: boolean;
  hoveredPoint: ChartHoverPoint | null;
  setHoveredPoint: (point: ChartHoverPoint | null) => void;
  // Wrapper classes; must include a positioning class for the hover overlay.
  className: string;
}

const SVG_WIDTH = 500;
const SVG_HEIGHT = 150;
const PAD_X = 40;
const PAD_Y = 20;
const CHART_WIDTH = SVG_WIDTH - PAD_X * 2;
const CHART_HEIGHT = SVG_HEIGHT - PAD_Y * 2;

// The interactive portfolio value line (grid, area, line, hover readout) shared by
// the portfolio modal and the profile page. data always has at least two points.
// hoveredPoint is lifted so a parent header can show the hovered value.
const ValueLineChart = ({
  data,
  minValue,
  maxValue,
  valueRange,
  isUp,
  colorBlindMode,
  hoveredPoint,
  setHoveredPoint,
  className,
}: ValueLineChartProps) => {
  const { darkMode } = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);

  const getX = (index: number) => PAD_X + (index / (data.length - 1 || 1)) * CHART_WIDTH;
  const getY = (value: number) => PAD_Y + CHART_HEIGHT - ((value - minValue) / valueRange) * CHART_HEIGHT;

  const pathData = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.value)}`).join(' ');
  const areaPath =
    data.length > 0
      ? `${pathData} L ${getX(data.length - 1)} ${PAD_Y + CHART_HEIGHT} L ${PAD_X} ${PAD_Y + CHART_HEIGHT} Z`
      : '';

  // Colour-blind mode swaps green/red for teal/purple.
  const strokeColor = colorBlindMode ? (isUp ? '#14b8a6' : '#a855f7') : isUp ? '#22c55e' : '#ef4444';
  const fillColor = colorBlindMode
    ? isUp
      ? 'rgba(20, 184, 166, 0.1)'
      : 'rgba(168, 85, 247, 0.1)'
    : isUp
      ? 'rgba(34, 197, 94, 0.1)'
      : 'rgba(239, 68, 68, 0.1)';

  const ratios = [0, 0.5, 1];
  const axisLabels = formatAxisLabels(
    ratios.map((r) => maxValue - r * valueRange),
    { kilo: true },
  );

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = svgRef.current ? svgRef.current.getBoundingClientRect() : e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH;
    if (mouseX < PAD_X || mouseX > SVG_WIDTH - PAD_X) {
      setHoveredPoint(null);
      return;
    }
    // Find the bracketing data points and interpolate between them.
    let leftIdx = 0;
    for (let i = 0; i < data.length - 1; i++) {
      if (getX(i + 1) >= mouseX) {
        leftIdx = i;
        break;
      }
      leftIdx = i;
    }
    const rightIdx = Math.min(leftIdx + 1, data.length - 1);
    const x1 = getX(leftIdx),
      x2 = getX(rightIdx);
    const t = x2 === x1 ? 0 : (mouseX - x1) / (x2 - x1);
    // Both indexes are clamped into data.
    const left = data[leftIdx]!,
      right = data[rightIdx]!;
    const interpValue = left.value + t * (right.value - left.value);
    const interpTs = left.timestamp + t * (right.timestamp - left.timestamp);
    setHoveredPoint({ x: mouseX, y: getY(interpValue), value: interpValue, fullDate: formatChartDate(interpTs) });
  };

  return (
    <div className={className}>
      <svg ref={svgRef} viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="w-full">
        {ratios.map((ratio, i) => {
          const y = PAD_Y + ratio * CHART_HEIGHT;
          return (
            <g key={i}>
              <line
                x1={PAD_X}
                y1={y}
                x2={SVG_WIDTH - PAD_X}
                y2={y}
                stroke={darkMode ? '#334155' : '#e2e8f0'}
                strokeWidth="1"
              />
              {axisLabels[i] && (
                <text x={PAD_X - 5} y={y + 4} textAnchor="end" fill={darkMode ? '#64748b' : '#94a3b8'} fontSize="9">
                  {axisLabels[i]}
                </text>
              )}
            </g>
          );
        })}

        <path d={areaPath} fill={fillColor} />
        <path d={pathData} fill="none" stroke={strokeColor} strokeWidth="2" />

        {/* Start/end markers */}
        <circle cx={getX(0)} cy={getY(data[0]!.value)} r={4} fill="none" stroke={strokeColor} strokeWidth={2} />
        <circle
          cx={getX(data.length - 1)}
          cy={getY(data[data.length - 1]!.value)}
          r={4}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
        />

        {hoveredPoint !== null && (
          <>
            <line
              x1={hoveredPoint.x}
              y1={PAD_Y}
              x2={hoveredPoint.x}
              y2={PAD_Y + CHART_HEIGHT}
              stroke={strokeColor}
              strokeWidth="1"
              strokeDasharray="4,4"
              opacity="0.5"
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r={6}
              fill={strokeColor}
              stroke={strokeColor}
              strokeWidth={2}
            />
          </>
        )}
      </svg>

      <div
        className="absolute inset-0 cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
      />

      {hoveredPoint !== null && (
        <div
          className="absolute pointer-events-none px-3 py-2 rounded-sm shadow-lg text-xs z-10 light:bg-zinc-900 light:text-white dark:bg-zinc-800 dark:text-zinc-100"
          style={{
            left: `${(hoveredPoint.x / SVG_WIDTH) * 100}%`,
            top: `${(hoveredPoint.y / SVG_HEIGHT) * 100}%`,
            transform: 'translate(-50%, -130%)',
          }}
        >
          <div className="font-bold text-orange-400">{formatCurrency(hoveredPoint.value)}</div>
          <div className="text-zinc-400">{hoveredPoint.fullDate}</div>
        </div>
      )}
    </div>
  );
};

export default ValueLineChart;
