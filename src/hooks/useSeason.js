import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { calculateExitValue } from '../utils/calculations';
import {
  SEASON_MIN_BASELINE,
  SEASON_TIER_MAP,
  nextSeasonTier,
  seasonDivisionFor,
  seasonRulesFor,
} from '../constants/seasons';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The live season plus where this player stands in it. market/season is a small
// world-readable doc, so a subscription is cheap and the card stays current
// without polling. Return is computed client-side from the pinned baseline, the
// same way the server scores it, so the card matches the standings board.
export function useSeason() {
  const { userData, prices } = useAppContext();
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
  const rules = seasonRulesFor(season);

  const baseline = userData?.seasonBaseline;
  // Same floor the server scores against (seasonScore). It used to be a bare > 0
  // here, so a player who started the season under the floor watched their return
  // and tier progress climb on a card that the weekly checkpoint was skipping.
  const hasBaseline = !!baseline && baseline.seasonId === season.id;
  // Two reasons to be out, and the card tells them apart: under the floor means
  // the checkpoint re-pins them once they grow past it, no baseline yet just
  // means the next Thursday checkpoint has not picked them up.
  const belowFloor = hasBaseline && baseline.value < SEASON_MIN_BASELINE;
  const inSeason = hasBaseline && !belowFloor;

  // The market reading this player is measured from. Someone who joined
  // mid-season is compared with the market from when they joined.
  const baselineIndex = baseline?.index > 0 ? baseline.index : (season.indexAtStart || 0);

  // Signed on purpose — a ladder deposit books a negative flow, so clamping to
  // zero would read as a trading loss. Mirrors seasonScore on the server.
  let returnPercent = null;
  let returnWithLadder = null;
  if (inSeason) {
    // What the account would sell for at live prices, the figure the server
    // scores (exitEquityAt). The stored portfolioValue lags until the next sync.
    const current = prices && Object.keys(prices).length
      ? calculateExitValue(userData, prices)
      : (userData.portfolioValue || 0) - (userData.marginUsed || 0);
    const granted = (userData.grantedValue || 0) - (baseline.granted || 0);
    const ladderNet = (userData.ladderFlowValue || 0) - (baseline.ladderFlow || 0);
    returnPercent = ((current - granted - baseline.value) / baseline.value) * 100;
    // What it would have been if ladder winnings counted. Shown, never ranked.
    returnWithLadder = ((current - (granted - ladderNet) - baseline.value) / baseline.value) * 100;
  }

  const lockedTier = (userData?.seasonTier?.seasonId === season.id)
    ? userData.seasonTier.tier : null;
  const activeWeeks = (userData?.seasonActiveWeeks?.seasonId === season.id)
    ? (userData.seasonActiveWeeks.weeks || 0) : 0;

  return {
    season,
    active: true,
    weeks,
    rules,
    inSeason,
    // Pinned under the floor. The checkpoint re-pins them once they're past it,
    // as opposed to not picked up by a checkpoint yet.
    belowFloor,
    // Raw weekly record straight off the user doc; SeasonProgress derives from it.
    seasonWeeks: userData?.seasonWeeks || [],
    baselineValue: baseline?.value || 0,
    // Platinum and Diamond are ranked within this. Fixed by the pinned baseline.
    division: inSeason ? seasonDivisionFor(baseline.value, rules) : null,
    baselineIndex,
    returnPercent,
    returnWithLadder,
    lockedTier,
    lockedTierMeta: lockedTier ? SEASON_TIER_MAP[lockedTier] : null,
    activeWeeks,
    bronzeActiveWeeks: rules.bronzeActiveWeeks,
    nextTier: nextSeasonTier(lockedTier),
  };
}
