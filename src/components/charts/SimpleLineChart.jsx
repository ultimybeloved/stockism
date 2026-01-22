// ============================================
// SimpleLineChart Component
// Lightweight SVG chart for sparklines
// ============================================

import React from 'react';

/**
 * Simple line chart component for sparklines
 * @param {Object} props
 * @param {Array} props.data - Array of { timestamp, price } objects
 * @param {boolean} props.darkMode - Dark mode flag
 * @param {number} props.width - Chart width (default 100)
 * @param {number} props.height - Chart height (default 32)
 * @param {string} props.className - Additional class names
 */
const SimpleLineChart = ({
  data,
  darkMode = false,
  width = 100,
  height = 32,
  className = ''
}) => {
  if (!data || data.length < 2) return null;

  const prices = data.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const padding = 2;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((d.price - minPrice) / priceRange) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const firstPrice = data[0]?.price || 0;
  const lastPrice = data[data.length - 1]?.price || 0;
  const isUp = lastPrice >= firstPrice;
  const strokeColor = isUp ? '#22c55e' : '#ef4444';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full h-10 ${className}`}
    >
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
};

export default SimpleLineChart;
