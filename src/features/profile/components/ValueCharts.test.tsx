// @vitest-environment jsdom
// Pins the drawn output of the two portfolio value charts (portfolio modal and
// profile page) so the shared drawing code can't change what players see.
process.env.TZ = 'UTC';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import ProfileChart from './ProfileChart';
import PortfolioChart from '../../portfolio/components/PortfolioChart';
import { usePortfolioChartData } from '../../portfolio/hooks/usePortfolioChartData';
import type { ChartHoverPoint } from '../../portfolio/utils/shared';

let darkMode = false;
vi.mock('../../../context/AppContext', () => ({
  useTheme: () => ({ darkMode }),
}));

const T0 = Date.UTC(2026, 8, 1, 12, 0);
const HOUR = 60 * 60 * 1000;
const history = [1000, 1200, 900, 1500, 1400].map((value, i) => ({ timestamp: T0 + i * HOUR, value }));
const longHistory = Array.from({ length: 47 }, (_, i) => ({ timestamp: T0 + i * HOUR, value: 500 + ((i * 37) % 90) }));

// Every bounding box is 1000x300 at the origin, so a mouse x maps to svg x / 2.
Element.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, width: 1000, height: 300, right: 1000, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

const PortfolioHarness = ({ points, current, cb }: { points: typeof history; current: number; cb: boolean }) => {
  const [hovered, setHovered] = useState<ChartHoverPoint | null>(null);
  const [range, setRange] = useState('7d');
  const d = usePortfolioChartData(points, current);
  return (
    <PortfolioChart
      chartData={d.chartData}
      minValue={d.minValue}
      maxValue={d.maxValue}
      valueRange={d.valueRange}
      isUp={d.isUp}
      hoveredPoint={hovered}
      setHoveredPoint={setHovered}
      showChart
      setShowChart={() => {}}
      loadingHistory={false}
      timeRange={range}
      setTimeRange={setRange}
      timeRanges={[
        { key: '1d', label: '24h' },
        { key: '7d', label: '7D' },
      ]}
      colorBlindMode={cb}
    />
  );
};

const hoverAt = (container: HTMLElement, clientX: number) => {
  const overlay = container.querySelector('.cursor-crosshair')!;
  fireEvent.mouseMove(overlay, { clientX, clientY: 50 });
};

describe('portfolio value charts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 200 * HOUR, toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    darkMode = false;
  });

  const cases = [
    { name: 'up', points: history, current: 1400, cb: false, dark: false },
    { name: 'down colorblind dark', points: [...history].reverse(), current: 1000, cb: true, dark: true },
    { name: 'sampled', points: longHistory, current: 550, cb: false, dark: true },
    { name: 'single point', points: history.slice(0, 1), current: 1100, cb: false, dark: false },
  ];

  for (const c of cases) {
    it(`profile chart: ${c.name}`, () => {
      darkMode = c.dark;
      const { container } = render(
        <ProfileChart
          portfolioValue={c.current}
          portfolioHistory={c.points}
          colorBlindMode={c.cb}
          timeRange="7d"
          onTimeRangeChange={() => {}}
        />,
      );
      expect(container.innerHTML).toMatchSnapshot('idle');
      hoverAt(container, 400);
      expect(container.innerHTML).toMatchSnapshot('hover');
      hoverAt(container, 10);
      expect(container.querySelector('.pointer-events-none')).toBeNull();
    });

    it(`portfolio chart: ${c.name}`, () => {
      darkMode = c.dark;
      const { container } = render(<PortfolioHarness points={c.points} current={c.current} cb={c.cb} />);
      expect(container.innerHTML).toMatchSnapshot('idle');
      hoverAt(container, 600);
      expect(container.innerHTML).toMatchSnapshot('hover');
      fireEvent.mouseLeave(container.querySelector('.cursor-crosshair')!);
      expect(container.querySelector('.pointer-events-none')).toBeNull();
    });
  }
});
