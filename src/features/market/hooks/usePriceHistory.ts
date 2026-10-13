import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useMarket } from '../../../context/AppContext';
import { spliceReviewDetail } from '../../../utils/marketHours';
import * as Sentry from '@sentry/react';
import type { ReviewPoint } from '../../../utils/marketHours';
import type { PricePoint } from '../../../types';

// A collapsed chapter review shows as one point on the chart. `showReviewDetail`
// puts its real steps back. Fetching is a separate switch from showing, because
// the toggle has to know whether there is anything to show BEFORE it is pressed,
// or it could never appear. Both are admin-only: the tidied point is what
// players should see, and nobody else pays for the read.
export const usePriceHistory = (
  ticker: string | null | undefined,
  {
    loadReviewDetail = false,
    showReviewDetail = false,
  }: { loadReviewDetail?: boolean; showReviewDetail?: boolean } = {},
) => {
  const { priceHistory } = useMarket();
  const [archivedHistory, setArchivedHistory] = useState<PricePoint[]>([]);
  const [reviewDetail, setReviewDetail] = useState<Record<string, ReviewPoint[]> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // The stock page stays mounted when moving between tickers, so drop the last
    // stock's archive first and ignore a slow fetch that lands after a newer one.
    setArchivedHistory([]);
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    getDoc(doc(db, 'market', 'current', 'price_history', ticker))
      .then((snap) => {
        if (!cancelled && snap.exists()) setArchivedHistory(snap.data().history || []);
      })
      .catch((e) => Sentry.captureException(e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  useEffect(() => {
    if (!(loadReviewDetail || showReviewDetail) || reviewDetail) return;
    getDoc(doc(db, 'market', 'reviewDetail'))
      .then((snap) => setReviewDetail(snap.exists() ? snap.data().detail || {} : {}))
      .catch((e) => Sentry.captureException(e));
  }, [loadReviewDetail, showReviewDetail, reviewDetail]);

  const fullHistory = useMemo(() => {
    const mainHistory = (ticker && priceHistory[ticker]) || [];
    if (archivedHistory.length === 0) {
      return [...mainHistory].sort((a, b) => a.timestamp - b.timestamp);
    }
    const seen = new Set<number>();
    return [...archivedHistory, ...mainHistory]
      .filter((p) => {
        if (seen.has(p.timestamp)) return false;
        seen.add(p.timestamp);
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [priceHistory, ticker, archivedHistory]);

  const shownHistory = useMemo(
    () =>
      showReviewDetail && ticker
        ? (spliceReviewDetail(fullHistory, reviewDetail?.[ticker]) as PricePoint[])
        : fullHistory,
    [showReviewDetail, fullHistory, reviewDetail, ticker],
  );

  // True once the stash is loaded and actually has steps for this stock, so the
  // toggle can hide itself on a stock whose review was never collapsed.
  const hasReviewDetail = Boolean(ticker && reviewDetail?.[ticker]?.length);

  return { fullHistory: shownHistory, loading, hasReviewDetail };
};
