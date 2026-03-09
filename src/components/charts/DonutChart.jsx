// ============================================
// DonutChart Component
// Reusable SVG donut chart with legend
// ============================================

import React from 'react';

/**
 * Donut chart component
 * @param {Object} props
 * @param {Array} props.data - Array of { label, value, color } objects
 * @param {number} props.size - Chart diameter (default 200)
 * @param {boolean} props.darkMode - Dark mode flag
 */
const DonutChart = ({ data = [], size = 200, darkMode = false }) => {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!data.length || total === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = size * 0.18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;

  const segments = data.map((d) => {
    const pct = d.value / total;
    const dashArray = pct * circumference;
    const dashOffset = -cumulativeOffset * circumference;
    cumulativeOffset += pct;
    return { ...d, pct, dashArray, dashOffset };
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={darkMode ? '#3f3f46' : '#e5e7eb'}
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${seg.dashArray} ${circumference - seg.dashArray}`}
            strokeDashoffset={seg.dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            className="transition-all duration-300"
          />
        ))}
        {/* Center text */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          className={`text-xs font-medium ${darkMode ? 'fill-zinc-400' : 'fill-zinc-500'}`}
        >
          Total
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          className={`text-sm font-bold ${darkMode ? 'fill-zinc-100' : 'fill-slate-900'}`}
        >
          ${total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total.toFixed(0)}
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>
              {seg.label}
            </span>
            <span className={darkMode ? 'text-zinc-500' : 'text-zinc-400'}>
              ${seg.value.toFixed(0)} ({(seg.pct * 100).toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DonutChart;
