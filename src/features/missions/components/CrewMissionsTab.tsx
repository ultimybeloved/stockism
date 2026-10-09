import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { claimCrewMissionFunction } from '../../../api/callables';
import { errorMessage } from '../../../utils/errors';
import {
  CREW_MAP,
  getWeekId,
  CREW_MISSION_REWARDS,
  CREW_CONTRIB,
  getCrewBuyTarget,
  getCrewSellTarget,
  getCrewVolumeTarget,
  getCrewMultiplier,
} from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses, getReadableCrewColor } from '../../../utils/theme';
import { useTheme, useSession, useMarket } from '../../../context/AppContext';

// Contribution fields stored booleans before June 2026; treat those as
// qualifying until the Monday reset clears them (matches the backend).
/** crewMissions/{crew}_{week}: the crew's running totals and who has claimed. */
interface CrewMissionWeek {
  buyCount?: number;
  sellCount?: number;
  tradeVolume?: number;
  contributorsBuy?: Record<string, number | boolean>;
  contributorsSell?: Record<string, number | boolean>;
  contributorsVolume?: Record<string, number | boolean>;
  claimed?: Record<string, Record<string, boolean>>;
}

interface CrewMissionDef {
  id: string;
  name: string;
  description: string;
  reward: number;
  color: string;
  getProgress: (d: CrewMissionWeek, memberCount: number) => { value: number; target: number };
  contributed: (d: CrewMissionWeek, uid: string | undefined) => boolean;
  formatProgress?: (v: number) => string;
  formatTarget?: (t: number) => string;
}

const meetsContribution = (value: number | boolean | undefined, threshold: number) =>
  value === true || (typeof value === 'number' && value >= threshold);

const CREW_MISSIONS: CrewMissionDef[] = [
  {
    id: 'CREW_BUY_500',
    name: 'Buying Spree',
    description: `Buy shares of your own crew's stocks this week. You must buy ${CREW_CONTRIB.BUY_SHARES}+ of them yourself. (Target scales with crew size.)`,
    reward: CREW_MISSION_REWARDS.CREW_BUY_500,
    color: 'blue',
    getProgress: (d, memberCount) => ({ value: d.buyCount || 0, target: getCrewBuyTarget(memberCount) }),
    contributed: (d, uid) => meetsContribution(uid ? d.contributorsBuy?.[uid] : undefined, CREW_CONTRIB.BUY_SHARES),
  },
  {
    id: 'CREW_SELL_500',
    name: 'Liquidation Day',
    description: `Sell shares of your own crew's stocks this week. You must sell ${CREW_CONTRIB.SELL_SHARES}+ of them yourself. (Target scales with crew size.)`,
    reward: CREW_MISSION_REWARDS.CREW_SELL_500,
    color: 'blue',
    getProgress: (d, memberCount) => ({ value: d.sellCount || 0, target: getCrewSellTarget(memberCount) }),
    contributed: (d, uid) => meetsContribution(uid ? d.contributorsSell?.[uid] : undefined, CREW_CONTRIB.SELL_SHARES),
  },
  {
    id: 'CREW_VOLUME',
    name: 'High Volume',
    description: `Trade your own crew's stocks this week. You must trade $${CREW_CONTRIB.VOLUME}+ of it yourself. (Target scales with crew size.)`,
    reward: CREW_MISSION_REWARDS.CREW_VOLUME,
    color: 'blue',
    getProgress: (d, memberCount) => ({ value: d.tradeVolume || 0, target: getCrewVolumeTarget(memberCount) }),
    contributed: (d, uid) => meetsContribution(uid ? d.contributorsVolume?.[uid] : undefined, CREW_CONTRIB.VOLUME),
    formatProgress: (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`),
    formatTarget: (t) => (t >= 1000 ? `$${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}k` : `$${t}`),
  },
];

export default function CrewMissionsTab() {
  const { darkMode } = useTheme();
  const { userData, user } = useSession();
  const { crewStats } = useMarket();
  const { cardClass: _, textClass, mutedClass, borderClass } = themeClasses;
  const [missionData, setMissionData] = useState<CrewMissionWeek | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const crew = userData?.crew;
  const weekId = getWeekId();
  const uid = user?.uid;

  useEffect(() => {
    if (!crew) return;
    const ref = doc(db, 'crewMissions', `${crew}_${weekId}`);
    return onSnapshot(ref, (snap) => {
      setMissionData(snap.exists() ? (snap.data() as CrewMissionWeek) : {});
    });
  }, [crew, weekId]);

  const handleClaim = async (missionId: string) => {
    setClaimError(null);
    setClaiming(missionId);
    try {
      await claimCrewMissionFunction({ missionId });
    } catch (err) {
      setClaimError(errorMessage(err) || 'Claim failed.');
    } finally {
      setClaiming(null);
    }
  };

  if (!crew) {
    return (
      <div className="p-4 rounded-sm text-center light:bg-amber-50 dark:bg-zinc-800/50">
        <p className={mutedClass}>Join a crew to participate in crew missions.</p>
      </div>
    );
  }

  const data = missionData || {};
  const crewInfo = CREW_MAP[crew];
  // Underdog bonus: displayed rewards match what the server pays on claim.
  const crewMultiplier = getCrewMultiplier(crewStats, crew);

  return (
    <div className="space-y-3">
      {/* Crew banner */}
      <div className="px-3 py-2 rounded-sm flex items-center gap-2 light:bg-blue-50 dark:bg-zinc-800/50">
        {crewInfo?.icon ? (
          <img src={crewInfo.icon} alt="" className="w-4 h-4 object-contain" />
        ) : (
          <span style={{ color: getReadableCrewColor(crewInfo?.color, darkMode) }}>{crewInfo?.emblem}</span>
        )}
        <span className="text-xs font-semibold" style={{ color: getReadableCrewColor(crewInfo?.color, darkMode) }}>
          {crewInfo?.name || crew}
        </span>
        <span className={`text-xs ${mutedClass}`}>(resets Monday)</span>
        {crewMultiplier > 1 && (
          <span className="text-xs text-orange-500 font-semibold ml-auto">🔥 x{crewMultiplier} underdog bonus</span>
        )}
      </div>

      {claimError && <p className="text-xs text-red-500 text-center px-2">{claimError}</p>}

      {CREW_MISSIONS.map((mission) => {
        const memberCount = (crewInfo?.members || []).length;
        const { value, target } = mission.getProgress(data, memberCount);
        const isClaimed = !!(uid && data.claimed?.[uid]?.[mission.id]);
        const hasContributed = mission.contributed(data, uid);
        const goalMet = value >= target;
        const canClaim = goalMet && hasContributed && !isClaimed;

        const pct = Math.min(100, target > 0 ? (value / target) * 100 : 0);
        const progressLabel = mission.formatProgress ? mission.formatProgress(value) : String(value);
        const targetLabel = mission.formatTarget ? mission.formatTarget(target) : String(target);

        return (
          <div
            key={mission.id}
            className={`p-3 rounded-sm border ${
              isClaimed ? 'border-blue-500/30 bg-blue-500/5' : canClaim ? 'border-blue-500 bg-blue-500/10' : borderClass
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1 pr-2">
                <h3 className={`font-semibold text-sm ${textClass}`}>{mission.name}</h3>
                <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
              </div>
              <span className={`text-sm font-bold shrink-0 ${isClaimed || canClaim ? 'text-blue-500' : mutedClass}`}>
                +{formatCurrency(Math.round(mission.reward * crewMultiplier))}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full light:bg-slate-200 dark:bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all ${goalMet ? 'bg-blue-500' : 'bg-blue-400/60'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`text-xs ${mutedClass} w-16 text-right`}>
                {progressLabel}/{targetLabel}
              </span>
            </div>

            {!hasContributed && !isClaimed && (
              <p className={`text-xs ${mutedClass} mt-1 italic`}>You haven't contributed yet.</p>
            )}

            {canClaim && (
              <button
                onClick={() => handleClaim(mission.id)}
                disabled={claiming === mission.id}
                className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {claiming === mission.id ? 'Claiming...' : 'Claim Reward'}
              </button>
            )}
            {isClaimed && <p className="text-xs text-blue-500 mt-2 text-center">Claimed</p>}
          </div>
        );
      })}
    </div>
  );
}
