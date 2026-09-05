import { useMemo } from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { CHARACTER_MAP, getDividendTier, CHARACTERS } from '../characters';
import { CREWS } from '../crews';
import { useAppContext } from '../context/AppContext';
import { DIVIDEND_RATES, dividendWeightedShares, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD } from '../constants/economy';
import { TIME_RANGES } from '../components/PriceChart';
import { usePriceHistory } from './usePriceHistory';
import { fundsContaining } from '../utils/marketFilters';

// Everything StockPage derives about one ticker: the position, the price stats
// for the selected range, dividend estimate, and the crew/ETF it belongs to.
// Split out of StockPage.jsx, which was past the 300-line page limit.
//
// `timeRange` stays owned by the page (it is UI state); this hook just recomputes
// the stats when it changes.
export const useStockPageData = (ticker, timeRange) => {
  const { user, userData, prices, holdings, shorts, costBasis, rarityTiers } = useAppContext();
  const { fullHistory } = usePriceHistory(ticker);

  const character = CHARACTER_MAP[ticker];
  const currentPrice = prices[ticker] || character?.basePrice || 0;
  const positionShares = holdings?.[ticker] || 0;
  const shortPosition = shorts?.[ticker];
  const avgCost = costBasis?.[ticker] || 0;
  const spread = character?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;
  const bidPrice = currentPrice * (1 - spread / 2);
  const askPrice = currentPrice * (1 + spread / 2);

  const drip = userData?.drip || {};
  const handleToggleDrip = async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), {
      [`drip.${ticker}`]: drip[ticker] ? deleteField() : true,
    });
  };

  const priceStats = useMemo(() => {
    const range = TIME_RANGES.find(r => r.key === timeRange);
    const cutoff = range.hours === Infinity ? 0 : Date.now() - range.hours * 3600000;
    const filtered = fullHistory.filter(p => p.timestamp >= cutoff);
    const ago30d = Date.now() - 30 * 86400000;
    const ago7d = Date.now() - 7 * 86400000;
    const ago52w = Date.now() - 365 * 86400000;
    const f30d = fullHistory.filter(p => p.timestamp >= ago30d);
    const f7d = fullHistory.filter(p => p.timestamp >= ago7d);
    const f52w = fullHistory.filter(p => p.timestamp >= ago52w);

    const px = (arr) => arr.map(p => p.price);
    const hi = (arr) => arr.length ? Math.max(...px(arr)) : currentPrice;
    const lo = (arr) => arr.length ? Math.min(...px(arr)) : currentPrice;

    const first = filtered[0]?.price || currentPrice;
    const change = first > 0 ? ((currentPrice - first) / first) * 100 : 0;
    const price7dAgo = f7d[0]?.price || currentPrice;
    const change7d = price7dAgo > 0 ? ((currentPrice - price7dAgo) / price7dAgo) * 100 : 0;
    const price30dAgo = f30d[0]?.price || currentPrice;
    const change30d = price30dAgo > 0 ? ((currentPrice - price30dAgo) / price30dAgo) * 100 : 0;

    return {
      first, change, change7d, change30d,
      high: hi(filtered), low: lo(filtered),
      high30d: hi(f30d), low30d: lo(f30d),
      high52w: hi(f52w), low52w: lo(f52w),
    };
  }, [fullHistory, timeRange, currentPrice]);

  const dividendTier = character ? getDividendTier(ticker, rarityTiers) : 'none';
  const dividendRate = DIVIDEND_RATES[dividendTier] || 0;
  const cohort = userData?.holdingCohorts?.[ticker];
  // Loyalty-weighted estimate: matured shares at the top multiplier, each
  // pending lot at its own rung (0 while inside the 10-day hold).
  const weeklyDividend = dividendWeightedShares(cohort, Date.now()) * currentPrice * dividendRate;

  const positionValue = positionShares * currentPrice;
  const positionCost = avgCost * positionShares;
  const positionPL = positionValue - positionCost;
  const positionPLPct = positionCost > 0 ? (positionPL / positionCost) * 100 : 0;

  // Every crew, not the first: a character can belong to more than one (TOM is
  // in both Fist Gang and WTJC), and showing one of them silently hid the rest.
  const crews = !character?.isETF ? Object.values(CREWS).filter(c => c.members.includes(ticker)) : [];
  const memberOfETFs = fundsContaining(CHARACTERS, ticker, character?.isETF);

  return {
    character, fullHistory, currentPrice, positionShares, shortPosition, avgCost,
    spread, bidPrice, askPrice, drip, handleToggleDrip, priceStats,
    dividendTier, dividendRate, weeklyDividend,
    positionValue, positionCost, positionPL, positionPLPct,
    crews, memberOfETFs,
  };
};
