// Where the tour's box goes: under the lit-up area if it fits, else above it,
// else in the middle of the screen. Pure, so it is tested without a browser.

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  /** Which side of the target the box sits on; 'center' has no arrow. */
  side: 'below' | 'above' | 'center';
  /** The arrow's distance from the box's left edge, pointing at the target. */
  arrowLeft: number;
}

/** Gap between the lit-up area and the box. */
export const TOUR_GAP = 14;
/** The box never comes closer than this to the screen edge. */
export const TOUR_GUTTER = 16;
/** Extra room lit up around the target. */
export const TOUR_PADDING = 6;
const ARROW_INSET = 18;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function placeCallout(
  target: Box | null,
  box: { width: number; height: number },
  view: { width: number; height: number },
): Placement {
  const center = {
    top: Math.max(TOUR_GUTTER, (view.height - box.height) / 2),
    left: Math.max(TOUR_GUTTER, (view.width - box.width) / 2),
    side: 'center' as const,
    arrowLeft: 0,
  };
  if (!target) return center;

  const left = clamp(target.left + target.width / 2 - box.width / 2, TOUR_GUTTER, view.width - box.width - TOUR_GUTTER);
  const arrowLeft = clamp(target.left + target.width / 2 - left, ARROW_INSET, box.width - ARROW_INSET);

  const below = target.top + target.height + TOUR_GAP;
  const above = target.top - TOUR_GAP - box.height;
  const roomBelow = view.height - TOUR_GUTTER - below;
  if (roomBelow >= box.height) return { top: below, left, side: 'below', arrowLeft };
  if (above >= TOUR_GUTTER) return { top: above, left, side: 'above', arrowLeft };
  // A target taller than the screen allows: the box sits over its bottom edge.
  return { top: Math.max(TOUR_GUTTER, view.height - TOUR_GUTTER - box.height), left, side: 'center', arrowLeft };
}
