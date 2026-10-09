import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useSession, useMarket } from '../../../context/AppContext';
import { calculateExitValue } from '../../../utils/calculations';
import { seasonAccountSize, seasonCapital, seasonAverageMargin, moneyIn } from '../../../utils/seasonWeeks';
import {
  SEASON_MIN_BASELINE,
  SEASON_TIER_MAP,
  nextSeasonTier,
  seasonDivisionFor,
  seasonRulesFor,
} from '../../../constants/seasons';
import type { SeasonDoc } from '../../../types';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The live season plus where this player stands in it. market/season is a small
// world-readable doc, so a subscription is cheap and the card stays current
// without polling. Return is computed client-side from the pinned baseline, the
// same way the server scores it, so the card matches the standings board.
export function useSeason() {
  const { userData } = useSession();
  const { prices } = useMarket();
  const [season, setSeason] = useState<SeasonDoc | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'market', 'season'),
      (snap) => setSeason(snap.exists() ? (snap.data() as SeasonDoc) : null),
      (err) => {
        console.error('Season subscription failed:', err);
        setSeason(null);
      },
    );
    return unsub;
  }, []);

  if (!season || season.status !== 'active') return { season, active: false as const };

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
  const belowFloor = hasBaseline && seasonAccountSize(baseline) < SEASON_MIN_BASELINE;
  const inSeason = hasBaseline && !belowFloor;

  // The market reading this player is measured from. Someone who joined
  // mid-season is compared with the market from when they joined.
  const baselineIndex = baseline?.index && baseline.index > 0 ? baseline.index : season.indexAtStart || 0;

  // Signed on purpose — a ladder deposit books a negative flow, so clamping to
  // zero would read as a trading loss. Mirrors seasonScore on the server.
  let returnPercent: number | null = null;
  let returnWithLadder: number | null = null;
  // inSeason implies hasBaseline, so baseline and userData are set below.
  if (inSeason && baseline && userData) {
    // What the account would sell for at live prices, the figure the server
    // scores (exitEquityAt). The stored portfolioValue lags until the next sync.
    const current =
      prices && Object.keys(prices).length
        ? calculateExitValue(userData, prices)
        : (userData.portfolioValue || 0) - (userData.marginUsed || 0);
    const granted = (userData.grantedValue || 0) - (baseline.granted || 0);
    const ladderNet = (userData.ladderFlowValue || 0) - (baseline.ladderFlow || 0);
    // Measured against the money traded with, margin owed on average included.
    // Grants count toward the base only for the time held; ladder and prediction
    // flows in full. Mirrors seasonScore.
    const grantedDays =
      baseline.grantedDays === undefined ? undefined : (userData.grantedDays || 0) - baseline.grantedDays;
    const now = Date.now();
    const capital = seasonCapital(baseline, {
      granted: moneyIn(
        granted,
        grantedDays,
        ladderNet + (userData.predictionFlowValue || 0) - (baseline.predictionFlow || 0),
        baseline.pinnedAt || 0,
        now,
      ),
      margin: seasonAverageMargin(userData, season.id, now),
    });
    const baselineValue = baseline.value as number;
    returnPercent = ((current - granted - baselineValue) / capital) * 100;
    // What it would have been if ladder winnings counted. Shown, never ranked.
    returnWithLadder = ((current - (granted - ladderNet) - baselineValue) / capital) * 100;
  }

  const lockedTier = userData?.seasonTier?.seasonId === season.id ? userData.seasonTier.tier || null : null;
  const activeWeeks = userData?.seasonActiveWeeks?.seasonId === season.id ? userData.seasonActiveWeeks.weeks || 0 : 0;

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
    baselineLadder: baseline?.ladder || 0,
    baselinePinnedAt: baseline?.pinnedAt || 0,
    // Platinum and Diamond are ranked within this. Fixed by the pinned baseline.
    division: inSeason ? seasonDivisionFor(seasonAccountSize(baseline), rules) : null,
    baselineIndex,
    returnPercent,
    returnWithLadder,
    lockedTier,
    lockedTierMeta: lockedTier ? SEASON_TIER_MAP[lockedTier] : null,
    activeWeeks,
    bronzeActiveWeeks: rules.bronzeActiveWeeks,
    // Kept out of Platinum and Diamond by the admin for repeated coordinated
    // trading. Mirror of isTopTierExcluded in functions/src/season/seasonTiers.js.
    topTierExcluded: userData?.seasonTopTierExclusion?.seasonId === season.id,
    // The tiers are a ladder, so without Bronze the next step is always Bronze.
    // With it, being up on the season means Silver if they finish there, so
    // point at Gold next.
    nextTier: nextSeasonTier(
      lockedTier &&
        (returnPercent ?? 0) > 0 &&
        (SEASON_TIER_MAP[lockedTier]?.order || 0) < SEASON_TIER_MAP.silver!.order
        ? 'silver'
        : lockedTier,
    ),
  };
}
