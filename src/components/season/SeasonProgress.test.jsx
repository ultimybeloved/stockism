// @vitest-environment jsdom
// Render checks for the season progress panel. The maths is covered in
// src/utils/seasonWeeks.test.js; this is about the component not crashing and
// showing the right thing in each state.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const h = vi.hoisted(() => ({ ctx: { darkMode: true, userData: {} } }));
vi.mock('../../context/AppContext', () => ({ useAppContext: () => h.ctx }));

const SeasonProgress = (await import('./SeasonProgress')).default;

const season = { id: 'S1', indexAtStart: 1000 };
const row = (w, { v, g = 0, x, c = 0, h: hold = 0 }) => ({ s: 'S1', w, t: w, v, g, x, c, h: hold });

afterEach(cleanup);

describe('SeasonProgress', () => {
  it('explains itself before the first checkpoint instead of drawing an empty box', () => {
    render(<SeasonProgress season={season} seasonWeeks={[]} baselineValue={10000} />);
    expect(screen.getByText(/starts at the first Thursday checkpoint/i)).toBeInTheDocument();
  });

  it('says the same when the season has no pinned index yet', () => {
    render(<SeasonProgress season={{ id: 'S1' }} seasonWeeks={[row(1, { v: 11000, x: 1010 })]} baselineValue={10000} />);
    expect(screen.getByText(/starts at the first Thursday checkpoint/i)).toBeInTheDocument();
  });

  it('draws both lines once there is a week on record', () => {
    const { container } = render(
      <SeasonProgress season={season} baselineValue={10000}
        seasonWeeks={[row(1, { v: 11000, x: 1010, c: 500, h: 1000 })]} />
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('counts the weeks beaten and renders one mark per week', () => {
    const { container } = render(
      <SeasonProgress season={season} baselineValue={10000} seasonWeeks={[
        row(1, { v: 11000, x: 1010, c: 500, h: 1000 }),
        row(2, { v: 10500, x: 1050, c: 500, h: 1000 }),
        row(3, { v: 12000, x: 1060, c: 500, h: 1000 }),
      ]} />
    );
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(container.querySelectorAll('span[title^="Week "]')).toHaveLength(3);
  });

  it('says ahead when ahead and behind when behind', () => {
    const { unmount } = render(
      <SeasonProgress season={season} baselineValue={10000}
        seasonWeeks={[row(1, { v: 12000, x: 1010, c: 500, h: 1000 })]} />
    );
    expect(screen.getByText(/ahead of the market/i)).toBeInTheDocument();
    unmount();

    render(
      <SeasonProgress season={season} baselineValue={10000}
        seasonWeeks={[row(1, { v: 9000, x: 1100, c: 500, h: 1000 })]} />
    );
    expect(screen.getByText(/behind the market/i)).toBeInTheDocument();
  });

  it('rules out Diamond once a checkpoint finds one character over the limit', () => {
    render(
      <SeasonProgress season={season} baselineValue={10000} seasonWeeks={[
        row(1, { v: 20000, x: 1010, c: 300, h: 1000 }),
        row(2, { v: 21000, x: 1010, c: 1000, h: 1000 }),
      ]} />
    );
    expect(screen.getByText(/Diamond is out this season/i)).toBeInTheDocument();
  });

  it('shows the Diamond limit as still open for a spread portfolio', () => {
    render(
      <SeasonProgress season={season} baselineValue={10000}
        seasonWeeks={[row(1, { v: 20000, x: 1010, c: 600, h: 1000 })]} />
    );
    expect(screen.queryByText(/Diamond is out/i)).not.toBeInTheDocument();
    expect(screen.getByText(/at or under 60%/i)).toBeInTheDocument();
  });

  it('counts weeks out of every checkpoint the season has run', () => {
    // Joined late: one week on record out of three checkpoints.
    render(
      <SeasonProgress season={{ ...season, checkpointWeeks: [1, 2, 3] }} baselineValue={10000}
        seasonWeeks={[row(3, { v: 11000, x: 1000, c: 100, h: 1000 })]} />
    );
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('measures a late joiner against the market from when they joined', () => {
    render(
      <SeasonProgress season={season} baselineValue={10000} baselineIndex={1100}
        seasonWeeks={[row(1, { v: 10000, x: 1210, c: 100, h: 1000 })]} />
    );
    // 1100 -> 1210 is +10%. Measured from the season's 1000 it would read +21%.
    expect(screen.getByText(/market \+10\.0%/)).toBeInTheDocument();
  });

  it('survives a record with no holdings at all', () => {
    const { container } = render(
      <SeasonProgress season={season} baselineValue={10000}
        seasonWeeks={[row(1, { v: 10000, x: 1000, c: 0, h: 0 })]} />
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });
});
