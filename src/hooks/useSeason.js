import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import {
  DEFAULT_SEASON_THRESHOLDS,
  SEASON_BRONZE_ACTIVE_WEEKS,
  seasonTierTarget,
  nextSeasonTier,
  SEASON_TIER_MAP,
} from '../constants/seasons';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The live season plus where this player stands in it. market/season is a small
// world-readable doc, so a subscription is cheap and the card stays current
// without polling. Return is computed client-side from the pinned baseline —
// the same formula the server uses, so the card matches the standings board.
export function useSeason() {
  const { userData } = useAppContext();
  const [season, setSeason] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'market', 'season'),
      (snap) => setSeason(snap.exists() ? snap.data() : null),
      (err) => { console.error('Season subscription failed:', err); setSeason(null); }
    );
    return unsub;
  }, []);

  const active = !!season && season.status === 'active';
  if (!active) return { season, active: false };

  const weeks = Math.max(1, Math.ceil((Date.now() - season.startedAt) / ONE_WEEK_MS));
  const thresholds = season.thresholds || DEFAULT_SEASON_THRESHOLDS;

  const baseline = userData?.seasonBaseline;
  const inSeason = !!baseline && baseline.seasonId === season.id && baseline.value > 0;

  let returnPercent = null;
  if (inSeason) {
    const granted = Math.max(0, (userData.grantedValue || 0) - (baseline.granted || 0));
    returnPercent = (((userData.portfolioValue || 0) - granted - baseline.value) / baseline.value) * 100;
  }

  const lockedTier = (userData?.seasonTier?.seasonId === season.id)
    ? userData.seasonTier.tier : null;
  const activeWeeks = (userData?.seasonActiveWeeks?.seasonId === season.id)
    ? (userData.seasonActiveWeeks.weeks || 0) : 0;

  // The bar to beat next. Bronze is about turning up, so it has no return target.
  const next = nextSeasonTier(lockedTier);
  let nextTarget = null;
  if (next && thresholds[next.id] !== undefined) {
    nextTarget = seasonTierTarget(thresholds[next.id], weeks);
  }

  return {
    season,
    active: true,
    weeks,
    thresholds,
    inSeason,
    returnPercent,
    lockedTier,
    lockedTierMeta: lockedTier ? SEASON_TIER_MAP[lockedTier] : null,
    activeWeeks,
    bronzeActiveWeeks: season.bronzeActiveWeeks || SEASON_BRONZE_ACTIVE_WEEKS,
    nextTier: next,
    nextTarget,
  };
}
