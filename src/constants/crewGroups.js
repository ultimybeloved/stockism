// ============================================
// PORTFOLIO ANALYTICS GROUPINGS
// ============================================
// How the analytics donut buckets a portfolio. Derived from the real crew
// roster in src/crews.js, so it can never disagree with the crew filters, the
// crew badges, or crew missions.
//
// This used to be a hand-written ticker -> group map. It drifted badly: it
// carried groups that were never crews at all ("First Gen", "Kitae Alliance"),
// and every character added after roughly early 2026 was missing from it and
// silently fell into 'Other'.
//
// A holding cannot be split across slices, so a character in more than one crew
// is counted under the first crew that lists them. ETFs get their own slice.

import { CREWS } from '../crews';

export const OTHER_GROUP = 'Other';
export const ETF_GROUP = 'ETF';

// ticker -> crew display name, first crew wins.
export const CREW_TICKER_MAP = (() => {
  const map = {};
  for (const crew of Object.values(CREWS)) {
    for (const ticker of crew.members) {
      if (!map[ticker]) map[ticker] = crew.name;
    }
  }
  return map;
})();

// Slice colours come from each crew's own colour, so a crew recolour carries
// through to the chart automatically.
export const CREW_COLORS = {
  ...Object.fromEntries(Object.values(CREWS).map((crew) => [crew.name, crew.color])),
  [OTHER_GROUP]: '#6b7280',
  [ETF_GROUP]: '#d946ef',
};
