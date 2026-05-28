import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase';
import { CREW_MAP } from '../../crews';
import { getWeekId } from '../../crews';
import { formatCurrency } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';

const CREW_MISSIONS = [
  {
    id: 'CREW_BUY_500',
    name: 'Buying Spree',
    description: 'Your crew buys 1500 shares total this week.',
    reward: 500,
    color: 'blue',
    getProgress: (d) => ({ value: d.buyCount || 0, target: 1500 }),
    contributed: (d, uid) => !!d.contributorsBuy?.[uid],
  },
  {
    id: 'CREW_SELL_500',
    name: 'Liquidation Day',
    description: 'Your crew sells 1500 shares total this week.',
    reward: 400,
    color: 'blue',
    getProgress: (d) => ({ value: d.sellCount || 0, target: 1500 }),
    contributed: (d, uid) => !!d.contributorsSell?.[uid],
  },
  {
    id: 'CREW_VOLUME',
    name: 'High Volume',
    description: 'Your crew reaches $20,000 in total trade volume this week.',
    reward: 500,
    color: 'blue',
    getProgress: (d) => ({ value: d.tradeVolume || 0, target: 20000 }),
    contributed: (d, uid) => !!d.contributorsVolume?.[uid],
    formatProgress: (v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`,
    formatTarget: () => '$20k',
  },
  {
    id: 'CREW_RECRUIT',
    name: 'Open Recruitment',
    description: 'A new member joins your crew this week. Must have been in the crew before they joined.',
    reward: 300,
    color: 'blue',
    getProgress: (d) => ({ value: Math.min(d.newMemberCount || 0, 1), target: 1 }),
    contributed: (d, uid, userData) => {
      const weekStartTs = new Date(getWeekId() + 'T00:00:00Z').getTime();
      return (userData?.crewJoinedAt || 0) < weekStartTs;
    },
  },
  {
    id: 'CREW_PUMP',
    name: 'Pump It Up',
    description: 'Any crew stock rises 10% from its Monday price. Must have bought a crew stock this week.',
    reward: 600,
    color: 'blue',
    getProgress: () => ({ value: 0, target: 1, serverSide: true }),
    contributed: (d, uid) => !!d.contributorsPump?.[uid],
  },
  {
    id: 'CREW_FULL_ROSTER',
    name: 'Full Roster',
    description: 'Every crew member stock is held by at least one person in your crew. Must hold a crew stock.',
    reward: 750,
    color: 'blue',
    getProgress: () => ({ value: 0, target: 1, serverSide: true }),
    contributed: (d, uid, userData) => {
      const crew = userData?.crew;
      const crewInfo = crew ? CREW_MAP[crew] : null;
      const members = crewInfo?.members || [];
      const holdings = userData?.holdings || {};
      return members.some(t => (holdings[t] || 0) > 0);
    },
  },
];

export default function CrewMissionsTab() {
  const { darkMode, userData, user } = useAppContext();
  const { cardClass: _, textClass, mutedClass } = getThemeClasses(darkMode);
  const [missionData, setMissionData] = useState(null);
  const [claiming, setClaiming] = useState(null);
  const [claimError, setClaimError] = useState(null);

  const crew = userData?.crew;
  const weekId = getWeekId();
  const uid = user?.uid;

  useEffect(() => {
    if (!crew) return;
    const ref = doc(db, 'crewMissions', `${crew}_${weekId}`);
    return onSnapshot(ref, (snap) => {
      setMissionData(snap.exists() ? snap.data() : {});
    });
  }, [crew, weekId]);

  const handleClaim = async (missionId) => {
    setClaimError(null);
    setClaiming(missionId);
    try {
      const fns = getFunctions();
      const claimCrewMission = httpsCallable(fns, 'claimCrewMission');
      await claimCrewMission({ missionId });
    } catch (err) {
      setClaimError(err.message || 'Claim failed.');
    } finally {
      setClaiming(null);
    }
  };

  if (!crew) {
    return (
      <div className={`p-4 rounded-sm text-center ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
        <p className={mutedClass}>Join a crew to participate in crew missions.</p>
      </div>
    );
  }

  const data = missionData || {};
  const crewInfo = CREW_MAP[crew];

  return (
    <div className="space-y-3">
      {/* Crew banner */}
      <div className={`px-3 py-2 rounded-sm flex items-center gap-2 ${darkMode ? 'bg-zinc-800/50' : 'bg-blue-50'}`}>
        {crewInfo?.icon ? (
          <img src={crewInfo.icon} alt="" className="w-4 h-4 object-contain" />
        ) : (
          <span style={{ color: crewInfo?.color }}>{crewInfo?.emblem}</span>
        )}
        <span className={`text-xs font-semibold`} style={{ color: crewInfo?.color }}>
          {crewInfo?.name || crew}
        </span>
        <span className={`text-xs ${mutedClass}`}>— resets Monday</span>
      </div>

      {claimError && (
        <p className="text-xs text-red-500 text-center px-2">{claimError}</p>
      )}

      {CREW_MISSIONS.map((mission) => {
        const { value, target, serverSide } = mission.getProgress(data);
        const isClaimed = !!data.claimed?.[uid]?.[mission.id];
        const hasContributed = mission.contributed(data, uid, userData);
        const goalMet = serverSide ? false : value >= target;
        const canClaim = goalMet && hasContributed && !isClaimed;

        const pct = serverSide ? 0 : Math.min(100, target > 0 ? (value / target) * 100 : 0);
        const progressLabel = mission.formatProgress ? mission.formatProgress(value) : String(value);
        const targetLabel = mission.formatTarget ? mission.formatTarget() : String(target);

        return (
          <div
            key={mission.id}
            className={`p-3 rounded-sm border ${
              isClaimed
                ? 'border-blue-500/30 bg-blue-500/5'
                : canClaim
                  ? 'border-blue-500 bg-blue-500/10'
                  : darkMode ? 'border-zinc-700' : 'border-amber-200'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1 pr-2">
                <h3 className={`font-semibold text-sm ${textClass}`}>{mission.name}</h3>
                <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
              </div>
              <span className={`text-sm font-bold shrink-0 ${isClaimed || canClaim ? 'text-blue-500' : mutedClass}`}>
                +{formatCurrency(mission.reward)}
              </span>
            </div>

            {serverSide ? (
              <p className={`text-xs ${mutedClass} italic`}>Verified server-side on claim</p>
            ) : (
              <div className="flex items-center gap-2">
                <div className={`flex-1 h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                  <div
                    className={`h-full rounded-full transition-all ${goalMet ? 'bg-blue-500' : 'bg-blue-400/60'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={`text-xs ${mutedClass} w-16 text-right`}>
                  {progressLabel}/{targetLabel}
                </span>
              </div>
            )}

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
            {isClaimed && (
              <p className="text-xs text-blue-500 mt-2 text-center">Claimed</p>
            )}
            {serverSide && hasContributed && !isClaimed && (
              <button
                onClick={() => handleClaim(mission.id)}
                disabled={claiming === mission.id}
                className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {claiming === mission.id ? 'Checking...' : 'Check & Claim'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
