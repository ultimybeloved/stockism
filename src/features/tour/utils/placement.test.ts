import { describe, expect, it } from 'vitest';
import { placeCallout, TOUR_GAP, TOUR_GUTTER } from './placement';

const view = { width: 1200, height: 800 };
const box = { width: 320, height: 180 };

describe('placeCallout', () => {
  it('centers the box when there is no target', () => {
    expect(placeCallout(null, box, view)).toMatchObject({ side: 'center', top: 310, left: 440 });
  });

  it('goes under the target when it fits', () => {
    const p = placeCallout({ top: 100, left: 500, width: 200, height: 50 }, box, view);
    expect(p).toMatchObject({ side: 'below', top: 150 + TOUR_GAP, left: 440 });
    expect(p.arrowLeft).toBe(160);
  });

  it('goes above the target near the bottom of the screen', () => {
    const p = placeCallout({ top: 650, left: 500, width: 200, height: 80 }, box, view);
    expect(p).toMatchObject({ side: 'above', top: 650 - TOUR_GAP - 180 });
  });

  it('stays inside the screen edge and points the arrow at the target', () => {
    const p = placeCallout({ top: 10, left: 1150, width: 40, height: 40 }, box, view);
    expect(p.left).toBe(1200 - 320 - TOUR_GUTTER);
    expect(p.arrowLeft).toBeLessThanOrEqual(320 - 18);
    expect(p.arrowLeft).toBeGreaterThan(250);
  });

  it('sits at the bottom when the target fills the screen', () => {
    const p = placeCallout({ top: 20, left: 0, width: 1200, height: 760 }, box, view);
    expect(p.side).toBe('center');
    expect(p.top).toBe(800 - TOUR_GUTTER - 180);
  });

  it('fits a phone screen', () => {
    const phone = { width: 390, height: 844 };
    const p = placeCallout({ top: 200, left: 16, width: 358, height: 60 }, { width: 358, height: 200 }, phone);
    expect(p.left).toBe(TOUR_GUTTER);
    expect(p.side).toBe('below');
  });
});
