import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { getWeekId } from '../../../utils/missionProgress';

/** rivalries/{weekId}: the week's matches and the live tally. */
export interface RivalryBoard {
  matches?: { crews?: string[] }[];
  crews?: Record<string, { active?: Record<string, boolean>; qualified?: Record<string, boolean> }>;
}

const sizeOf = (m: Record<string, boolean> | undefined) => Object.keys(m || {}).length;

/** One crew's side: members with a mission, members who qualified, and the share. */
export const rivalryTally = (board: RivalryBoard | null, crew: string) => {
  const c = board?.crews?.[crew];
  const active = sizeOf(c?.active);
  const qualified = sizeOf(c?.qualified);
  return { active, qualified, pct: active > 0 ? Math.round((qualified / active) * 100) : 0 };
};

/** The two crews in `crew`'s match this week, or undefined. */
export const rivalryMatchOf = (board: RivalryBoard | null, crew: string) =>
  (board?.matches || []).map((m) => m.crews || []).find((m) => m.includes(crew));

// This week's rivalry board, live. Pass enabled=false to skip the read.
export function useRivalryBoard(enabled = true) {
  const [board, setBoard] = useState<RivalryBoard | null>(null);
  const weekId = getWeekId();
  useEffect(() => {
    if (!enabled) return undefined;
    return onSnapshot(
      doc(db, 'rivalries', weekId),
      (snap) => setBoard(snap.exists() ? (snap.data() as RivalryBoard) : {}),
      () => setBoard({}),
    );
  }, [enabled, weekId]);
  return board;
}
