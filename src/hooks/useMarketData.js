import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { CHARACTERS } from '../characters';
import { IPO_TOTAL_SHARES } from '../constants';

// All global market subscriptions: prices/market doc, chart history,
// dividend tier overrides, IPOs, and predictions.
export function useMarketData() {
  const [prices, setPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [marketData, setMarketData] = useState(null);
  const [dividendTierOverrides, setDividendTierOverrides] = useState({});
  const [launchedTickers, setLaunchedTickers] = useState([]);
  const [activeIPOs, setActiveIPOs] = useState([]); // IPOs currently in hype or active phase
  const [predictions, setPredictions] = useState([]);
  const [crewStats, setCrewStats] = useState(null); // weekly underdog multipliers + active counts

  // Listen to global market data. Chart history lives in its own doc
  // (market/priceHistory) and is fetched ONCE below — the live subscription
  // only carries the small prices doc, so every price tick no longer pushes
  // the full chart history for every stock to every player.
  const prevPricesRef = useRef(null);
  useEffect(() => {
    const marketRef = doc(db, 'market', 'current');

    const unsubscribe = onSnapshot(marketRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Merge stored prices with basePrices for any new characters
        const storedPrices = data.prices || {};
        const launched = data.launchedTickers || [];
        const mergedPrices = {};
        CHARACTERS.forEach(c => {
          // Only include character if it doesn't require IPO, or if it's been launched
          if (!c.ipoRequired || launched.includes(c.ticker)) {
            mergedPrices[c.ticker] = storedPrices[c.ticker] ?? c.basePrice;
          }
        });
        setPrices(mergedPrices);
        setMarketData(data);
        setLaunchedTickers(launched);

        // Extend local chart history from live ticks (the server appends the
        // same points to market/priceHistory; these local ones just keep the
        // charts moving without re-downloading history).
        const prev = prevPricesRef.current;
        if (prev) {
          const ts = Date.now();
          const changed = Object.entries(mergedPrices)
            .filter(([t, p]) => prev[t] !== undefined && prev[t] !== p);
          if (changed.length > 0) {
            setPriceHistory(prevHist => {
              const next = { ...prevHist };
              changed.forEach(([t, p]) => {
                next[t] = [...(next[t] || []), { timestamp: ts, price: p }].slice(-2000);
              });
              return next;
            });
          }
        }
        prevPricesRef.current = mergedPrices;
      } else {
        // Market doc missing (fresh environment) — show base prices; the
        // backend owns market initialization.
        const initialPrices = {};
        CHARACTERS.forEach(c => {
          if (!c.ipoRequired) initialPrices[c.ticker] = c.basePrice;
        });
        setPrices(initialPrices);
        setLaunchedTickers([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Listen to dividend tier overrides (admin-editable config doc)
  useEffect(() => {
    const ref = doc(db, 'dividendConfig', 'tierOverrides');
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setDividendTierOverrides(snap.data().tiers || {});
      } else {
        setDividendTierOverrides({});
      }
    }, (err) => {
      // Missing doc is fine — fall back to hardcoded defaults.
      console.warn('dividendConfig/tierOverrides subscription:', err?.message);
    });
    return () => unsubscribe();
  }, []);

  // Fetch chart history once per session from its own doc. Live ticks keep it
  // current locally (see the market subscription above); merging preserves any
  // points that arrived before this fetch resolved.
  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'market', 'priceHistory'))
      .then(snap => {
        if (cancelled || !snap.exists()) return;
        const fetched = snap.data() || {};
        setPriceHistory(prevLocal => {
          const merged = {};
          const tickers = new Set([...Object.keys(fetched), ...Object.keys(prevLocal)]);
          tickers.forEach(t => {
            const base = Array.isArray(fetched[t]) ? fetched[t] : [];
            const seen = new Set(base.map(p => p.timestamp));
            const extra = (prevLocal[t] || []).filter(p => !seen.has(p.timestamp));
            merged[t] = [...base, ...extra].sort((a, b) => a.timestamp - b.timestamp);
          });
          return merged;
        });
      })
      .catch(err => console.error('Failed to load price history:', err));
    return () => { cancelled = true; };
  }, []);

  // Fetch crew stats once per session — the doc only changes on Monday's
  // weekly recompute, so a live subscription would be wasted reads.
  useEffect(() => {
    getDoc(doc(db, 'market', 'crewStats'))
      .then(snap => { if (snap.exists()) setCrewStats(snap.data()); })
      .catch(err => console.warn('Failed to load crew stats:', err?.message));
  }, []);

  // Listen to IPO data
  useEffect(() => {
    const ipoRef = doc(db, 'market', 'ipos');

    const unsubscribe = onSnapshot(ipoRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const ipos = data.list || [];
        const now = Date.now();

        // Filter to only show active IPOs (in hype or buying phase)
        const activeOnes = ipos.filter(ipo => {
          const inHypePhase = now < ipo.ipoStartsAt;
          const inBuyingPhase = now >= ipo.ipoStartsAt && now < ipo.ipoEndsAt && (ipo.sharesRemaining ?? (ipo.totalShares || IPO_TOTAL_SHARES)) > 0;
          return inHypePhase || inBuyingPhase;
        });

        setActiveIPOs(activeOnes);
      }
    });

    return () => unsubscribe();
  }, []);

  // Listen to predictions
  useEffect(() => {
    const predictionsRef = doc(db, 'predictions', 'current');

    const unsubscribe = onSnapshot(predictionsRef, (snap) => {
      if (snap.exists()) {
        setPredictions(snap.data().list || []);
      } else {
        // No predictions document - just show empty state
        // Only admins can create predictions via Admin Panel
        setPredictions([]);
      }
    });

    return () => unsubscribe();
  }, []);

  return { prices, priceHistory, marketData, dividendTierOverrides, launchedTickers, activeIPOs, predictions, crewStats };
}
