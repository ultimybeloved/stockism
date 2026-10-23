import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { CHARACTER_MAP } from '../../../characters';
import { foldEntries, type ActivityEntry, type RawItem } from '../foldEntries';

export type { ActivityEntry };

// Each entry shows once it is this old. The bot round writes every 15
// minutes, so entries come out one by one between writes.
export const ACTIVITY_REVEAL_MS = 20 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Recent trades with no name and no size. Pass a ticker for one stock. */
export function useMarketActivity(ticker?: string) {
  const [raw, setRaw] = useState<RawItem[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'market', 'activity'),
        (snap) => setRaw(((snap.data()?.entries || []) as RawItem[]).filter((x) => CHARACTER_MAP[x.t])),
        () => {},
      ),
    [],
  );

  const mine = useMemo(() => (ticker ? raw.filter((x) => x.t === ticker) : raw), [raw, ticker]);

  // Wake up exactly when the next entry is due, so they land one at a time.
  useEffect(() => {
    const next = mine.find((x) => x.at + ACTIVITY_REVEAL_MS > now);
    if (!next) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(250, next.at + ACTIVITY_REVEAL_MS - Date.now()));
    return () => clearTimeout(t);
  }, [mine, now]);

  const visible = useMemo(() => mine.filter((x) => x.at + ACTIVITY_REVEAL_MS <= now), [mine, now]);
  const entries = useMemo(() => foldEntries(visible), [visible]);

  const lastHour = useMemo(() => {
    const since = now - ACTIVITY_REVEAL_MS - HOUR;
    let buys = 0;
    let sells = 0;
    for (const x of visible) {
      if (x.at < since) continue;
      if (x.s === 'b') buys++;
      else sells++;
    }
    return { buys, sells };
  }, [visible, now]);

  return { entries, lastHour };
}
