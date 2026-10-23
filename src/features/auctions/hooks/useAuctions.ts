import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../../firebase';
import type { Auction } from '../../../rules/auctions';

// The live auction (kept up to date as bids land) and the finished ones.
// auctions/{id} is public; who is behind each bidder number is not.
export function useAuctions() {
  const [live, setLive] = useState<Auction[]>([]);
  const [past, setPast] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(db, 'auctions');
    const offLive = onSnapshot(
      query(col, where('status', '==', 'live')),
      (snap) => {
        setLive(snap.docs.map((d) => ({ ...(d.data() as Auction), id: d.id })).sort((a, b) => a.endsAt - b.endsAt));
        setLoading(false);
      },
      () => setLoading(false),
    );
    const offPast = onSnapshot(
      query(col, where('status', '==', 'ended'), orderBy('endsAt', 'desc'), limit(24)),
      (snap) => setPast(snap.docs.map((d) => ({ ...(d.data() as Auction), id: d.id }))),
      () => {},
    );
    return () => {
      offLive();
      offPast();
    };
  }, []);

  return { live, past, loading };
}

/** A clock that ticks every second, for countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** The live auction, if there is one. One small listener, for the header. */
export function useLiveAuction() {
  const [live, setLive] = useState<Auction | null>(null);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'auctions'), where('status', '==', 'live'), limit(1)),
        (snap) => setLive(snap.empty ? null : { ...(snap.docs[0]!.data() as Auction), id: snap.docs[0]!.id }),
        () => setLive(null),
      ),
    [],
  );
  return live;
}
