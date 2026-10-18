// Chapter markers: what each Thursday chapter review did to every stock, so the
// charts can flag the halt and say what happened there. Shared rule module (see
// src/rules/ladder.ts): the server writes market/chapterMarkers with these
// helpers when the review locks (20:55 UTC), and the charts read the same shape.
//
// The move is the review itself: the price when the halt began (13:00) against
// the price at the 20:55 lock, before the opening auction. That is the same
// window weekly Calls are scored on, so a marker and a Call always agree.

export interface ChapterMarker {
  /** The mission week the review closes (rules/missions week id). */
  weekId: string;
  /** When the halt began (epoch ms). */
  at: number;
  /** Percent move per ticker during the review, one decimal, only moves of CHAPTER_MARKER_MIN_MOVE or more. */
  moves: Record<string, number>;
  /** The market index's move over the same window, one decimal. */
  index: number;
  /** Admin-written, e.g. "Chapter 560". */
  label?: string;
  /** Admin-written, one line about what happened. */
  note?: string;
}

export const CHAPTER_MARKER_MIN_MOVE = 0.5;
export const CHAPTER_MARKERS_KEPT = 104; // two years of Thursdays
export const CHAPTER_LABEL_MAX = 40;
export const CHAPTER_NOTE_MAX = 200;

const pct = (before: number, after: number) => Math.round((after / before - 1) * 1000) / 10;

export const buildChapterMarker = ({
  weekId,
  at,
  before,
  after,
  indexBefore,
  indexAfter,
}: {
  weekId: string;
  at: number;
  before: Record<string, number>;
  after: Record<string, number>;
  indexBefore: number;
  indexAfter: number;
}): ChapterMarker => {
  const moves: Record<string, number> = {};
  for (const [t, p0] of Object.entries(before)) {
    const p1 = after[t];
    if (!(p0 > 0) || !(p1 && p1 > 0)) continue;
    const move = pct(p0, p1);
    if (Math.abs(move) >= CHAPTER_MARKER_MIN_MOVE) moves[t] = move;
  }
  return { weekId, at, moves, index: indexBefore > 0 && indexAfter > 0 ? pct(indexBefore, indexAfter) : 0 };
};

/**
 * The list with this week's marker in it, newest first. A re-run replaces the
 * moves but keeps the admin's label and note.
 */
export const upsertChapterMarker = (list: readonly ChapterMarker[] | null | undefined, marker: ChapterMarker) => {
  const old = (list || []).find((m) => m.weekId === marker.weekId);
  const merged: ChapterMarker = {
    ...marker,
    ...(old?.label ? { label: old.label } : {}),
    ...(old?.note ? { note: old.note } : {}),
  };
  return [merged, ...(list || []).filter((m) => m.weekId !== marker.weekId)]
    .sort((a, b) => b.at - a.at)
    .slice(0, CHAPTER_MARKERS_KEPT);
};

/** How a marker reads for one stock: "Chapter 560: +8.2%" or "Chapter review Oct 22: no change". */
export const chapterMarkerTitle = (m: ChapterMarker, dateLabel: string) => m.label || `Chapter review ${dateLabel}`;
