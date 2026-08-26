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

  it('calls out a portfolio parked in a single character', () => {
    render(
      <SeasonProgress season={season} baselineValue={10000}
        seasonWeeks={[row(1, { v: 20000, x: 1010, c: 1000, h: 1000 })]} />
    );
    expect(screen.getByText(/Riding one character is not the same/i)).toBeInTheDocument();
  });

  it('stays quiet about concentration for a spread portfolio', () => {
    render(
      <SeasonProgress season={season} baselineValue={10000}
        seasonWeeks={[row(1, { v: 20000, x: 1010, c: 300, h: 1000 })]} />
    );
    expect(screen.queryByText(/Riding one character/i)).not.toBeInTheDocument();
  });

  it('survives a record with no holdings at all', () => {
    const { container } = render(
      <SeasonProgress season={season} baselineValue={10000}
        seasonWeeks={[row(1, { v: 10000, x: 1000, c: 0, h: 0 })]} />
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });
});
