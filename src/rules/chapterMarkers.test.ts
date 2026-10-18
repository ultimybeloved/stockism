import { describe, expect, it } from 'vitest';
import { buildChapterMarker, upsertChapterMarker, CHAPTER_MARKERS_KEPT } from './chapterMarkers';

describe('chapter markers', () => {
  it('keeps the moves that matter, rounded', () => {
    const m = buildChapterMarker({
      weekId: '2026-10-15',
      at: 1000,
      before: { GUN: 100, GOO: 50, FLAT: 10, GONE: 5 },
      after: { GUN: 108.24, GOO: 45, FLAT: 10.04 },
      indexBefore: 1000,
      indexAfter: 1012,
    });
    expect(m.moves).toEqual({ GUN: 8.2, GOO: -10 });
    expect(m.index).toBe(1.2);
  });

  it('replaces a re-run week but keeps the admin note, newest first, capped', () => {
    const a = { weekId: '2026-10-08', at: 1, moves: {}, index: 0 };
    const b = { weekId: '2026-10-15', at: 2, moves: { GUN: 1 }, index: 0, label: 'Chapter 560', note: 'Gun returns' };
    const list = upsertChapterMarker([b, a], { weekId: '2026-10-15', at: 2, moves: { GUN: 3 }, index: 1 });
    expect(list.map((m) => m.weekId)).toEqual(['2026-10-15', '2026-10-08']);
    expect(list[0]).toMatchObject({ moves: { GUN: 3 }, label: 'Chapter 560', note: 'Gun returns' });
    const many = Array.from({ length: CHAPTER_MARKERS_KEPT + 5 }, (_, i) => ({
      weekId: `w${i}`,
      at: i,
      moves: {},
      index: 0,
    }));
    expect(upsertChapterMarker(many, { weekId: 'new', at: 9999, moves: {}, index: 0 })).toHaveLength(
      CHAPTER_MARKERS_KEPT,
    );
  });
});
