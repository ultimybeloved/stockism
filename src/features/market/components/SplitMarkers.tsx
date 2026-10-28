import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';

// A split divides every earlier chart price by its ratio, so the line before it
// reads low. A labeled line on split day says why. market/splitHistory changes
// only when an admin splits a stock, so it is read once per session.
type SplitHistory = Record<string, { splits?: { ratio: number; at: number }[] }>;

let cached: Promise<SplitHistory> | null = null;
const load = () =>
  (cached ||= getDoc(doc(db, 'market', 'splitHistory'))
    .then((snap) => (snap.exists() ? (snap.data() as SplitHistory) : {}))
    .catch(() => {
      cached = null;
      return {};
    }));

const SPLIT_COLOR = '#f59e0b';

interface SplitMarkersProps {
  ticker: string;
  timestamps: number[];
  toX: (i: number) => number;
  top: number;
  bottom: number;
  right: number;
}

const SplitMarkers = ({ ticker, timestamps, toX, top, bottom, right }: SplitMarkersProps) => {
  const [history, setHistory] = useState<SplitHistory>({});
  useEffect(() => {
    let live = true;
    void load().then((h) => live && setHistory(h));
    return () => {
      live = false;
    };
  }, []);

  const first = timestamps[0] ?? 0;
  const last = timestamps[timestamps.length - 1] ?? 0;
  const splits = (history[ticker]?.splits || []).filter((s) => s.at >= first && s.at <= last);

  return (
    <>
      {splits.map((s) => {
        const i = timestamps.findIndex((t) => t >= s.at);
        if (i < 0) return null;
        const x = toX(i);
        const nearRight = x > right - 90;
        return (
          <g key={s.at}>
            <line x1={x} y1={top} x2={x} y2={bottom} stroke={SPLIT_COLOR} strokeDasharray="2 3" opacity={0.8} />
            <text
              x={nearRight ? x - 4 : x + 4}
              y={bottom - 6}
              textAnchor={nearRight ? 'end' : 'start'}
              fontSize={12}
              fontWeight={600}
              fill={SPLIT_COLOR}
            >
              {s.ratio}-for-1 split
            </text>
          </g>
        );
      })}
    </>
  );
};

export default SplitMarkers;
