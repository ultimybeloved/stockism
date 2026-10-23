import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import type { ChapterMarker } from '../../../rules/chapterMarkers';

// market/chapterMarkers changes once a week, so it is read once per session and
// shared by every chart on the page.
let cached: Promise<ChapterMarker[]> | null = null;
const load = () =>
  (cached ||= getDoc(doc(db, 'market', 'chapterMarkers'))
    .then((snap) => (snap.exists() ? (snap.data().markers as ChapterMarker[]) || [] : []))
    .catch(() => {
      cached = null;
      return [];
    }));

/** Every chapter review on record, newest first. Empty until loaded. */
export function useChapterMarkers() {
  const [markers, setMarkers] = useState<ChapterMarker[]>([]);
  useEffect(() => {
    let live = true;
    void load().then((m) => live && setMarkers(m));
    return () => {
      live = false;
    };
  }, []);
  return markers;
}
