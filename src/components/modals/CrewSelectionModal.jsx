import { useState } from 'react';
import { CREWS, CREW_MAP, getCrewMultiplier, CREW_REJOIN_LOCKOUT_DAYS, CREW_SWITCH_PENALTY } from '../../crews';
import { formatCurrency } from '../../utils/formatters';
import { getThemeClasses, getReadableCrewColor } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const CrewSelectionModal = ({ onClose, onSelect, onLeave, isGuest, leaveLoading, selectLoading }) => {
  useEscapeKey(onClose);
  const { darkMode, userData, crewStats } = useAppContext();
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [leavingCrew, setLeavingCrew] = useState(false);

  const { textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass } = getThemeClasses(darkMode);
  const crewColor = (hex) => getReadableCrewColor(hex, darkMode);

  const currentCrew = userData?.crew;
  const portfolioValue = userData?.portfolioValue || 0;
  const penaltyAmount = Math.floor(portfolioValue * CREW_SWITCH_PENALTY);
  const penaltyPct = Math.round(CREW_SWITCH_PENALTY * 100);

  // 30-day rejoin lockout on crews you recently left
  const lockDaysLeft = (crewId) => {
    const lockedUntil = userData?.crewLockouts?.[crewId] || 0;
    if (lockedUntil <= Date.now()) return 0;
    return Math.ceil((lockedUntil - Date.now()) / (24 * 60 * 60 * 1000));
  };

  const handleSelect = (crewId) => {
    if (isGuest) return; // Guests can't select
    if (crewId === currentCrew) return;
    if (lockDaysLeft(crewId) > 0) return;
    setSelectedCrew(crewId);
    setConfirming(true);
  };

  const handleConfirm = async () => {
    if (selectLoading) return;
    // Pass true if switching crews (has existing crew), false if joining fresh.
    // Wait for the result so the modal only closes once it actually went through.
    const ok = await onSelect(selectedCrew, !!currentCrew);
    if (ok) onClose();
  };

  const handleLeave = async () => {
    await onLeave();
    onClose();
  };

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div className={`${modalShellClass} max-w-2xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏴 {isGuest ? 'Crews' : 'Crew'}</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>×</button>
          </div>
          {isGuest && (
            <p className={`text-sm text-amber-500 mt-1`}>
              Sign in to join a crew!
            </p>
          )}
          {!isGuest && currentCrew && (
            <p className={`text-sm ${mutedClass} mt-1 flex items-center gap-1`}>
              Current:
              {CREW_MAP[currentCrew]?.icon ? (
                <img src={CREW_MAP[currentCrew]?.icon} alt="" className="w-4 h-4 object-contain inline" />
              ) : (
                <span style={{ color: crewColor(CREW_MAP[currentCrew]?.color) }}>{CREW_MAP[currentCrew]?.emblem}</span>
              )}
              <span style={{ color: crewColor(CREW_MAP[currentCrew]?.color) }}>{CREW_MAP[currentCrew]?.name}</span>
            </p>
          )}
          {!isGuest && !currentCrew && (
            <p className={`text-sm ${mutedClass} mt-1`}>
              Join a crew to unlock missions. Less active crews pay bonus rewards!
            </p>
          )}
        </div>

        {/* Warning Banner - show for users without a crew AND users with a crew */}
        {!isGuest && !confirming && !leavingCrew && (
          <div className={`p-3 ${darkMode ? 'bg-amber-900/30' : 'bg-amber-100'} border-b border-amber-500/30`}>
            <p className="text-amber-400 text-sm text-center">
              ⚠️ <strong>Warning:</strong> Leaving a crew costs <strong>{penaltyPct}% of your entire portfolio</strong>
              <br />
              <span className={`text-xs ${mutedClass}`}>{penaltyPct}% of your cash and shares will be taken if you ever leave. You also can't rejoin that crew for {CREW_REJOIN_LOCKOUT_DAYS} days.</span>
            </p>
          </div>
        )}

        {leavingCrew ? (
          <div className="p-6 text-center">
            <div className="text-4xl mb-4">🚪</div>
            <h3 className={`text-xl font-bold mb-2 ${textClass}`}>Leave {CREW_MAP[currentCrew]?.name}?</h3>
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-red-900/20' : 'bg-red-50'} border border-red-500/30 mb-4`}>
              <p className="text-red-400 font-semibold mb-2">
                You will lose approximately {formatCurrency(penaltyAmount)}
              </p>
              <p className={`text-xs ${mutedClass}`}>
                {penaltyPct}% of your cash and shares will be taken.
              </p>
            </div>
            <p className={`text-sm ${mutedClass} mb-6`}>You can't rejoin {CREW_MAP[currentCrew]?.name} for {CREW_REJOIN_LOCKOUT_DAYS} days. Other crews stay open.</p>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setLeavingCrew(false)}
                className={`px-6 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300' : 'border-amber-200'}`}
              >
                Back
              </button>
              <button
                onClick={handleLeave}
                disabled={leaveLoading}
                className="px-6 py-2 rounded-sm bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50"
              >
                {leaveLoading ? 'Leaving...' : 'Leave Crew'}
              </button>
            </div>
          </div>
        ) : confirming ? (
          <div className="p-6 text-center">
            <div className="mb-4">
              {CREW_MAP[selectedCrew]?.icon ? (
                <img src={CREW_MAP[selectedCrew]?.icon} alt={CREW_MAP[selectedCrew]?.name} className="w-16 h-16 object-contain mx-auto" />
              ) : (
                <span className="text-4xl">{CREW_MAP[selectedCrew]?.emblem}</span>
              )}
            </div>
            <h3 className={`text-xl font-bold mb-2 ${textClass}`} style={{ color: crewColor(CREW_MAP[selectedCrew]?.color) }}>
              {currentCrew ? `Switch to ${CREW_MAP[selectedCrew]?.name}?` : `Join ${CREW_MAP[selectedCrew]?.name}?`}
            </h3>

            {getCrewMultiplier(crewStats, selectedCrew) > 1 && (
              <p className="text-sm text-orange-500 mb-3">
                🔥 This crew pays x{getCrewMultiplier(crewStats, selectedCrew)} mission rewards this week
              </p>
            )}

            {currentCrew ? (
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-red-900/20' : 'bg-red-50'} border border-red-500/30 mb-4`}>
                <p className="text-red-400 font-semibold mb-2">
                  You will lose approximately {formatCurrency(penaltyAmount)}
                </p>
                <p className={`text-xs ${mutedClass}`}>
                  {penaltyPct}% of your cash and shares will be taken. You can't rejoin {CREW_MAP[currentCrew]?.name} for {CREW_REJOIN_LOCKOUT_DAYS} days.
                </p>
              </div>
            ) : (
              <div className="mb-4">
                <p className={`text-sm text-orange-500 mb-3`}>
                  ✓ Joining a crew is free!
                </p>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'} border border-amber-500/30`}>
                  <p className="text-amber-400 text-sm">
                    ⚠️ <strong>Note:</strong> If you ever leave this crew, you'll lose <strong>{penaltyPct}% of your portfolio</strong>.
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setConfirming(false)}
                disabled={selectLoading}
                className={`px-6 py-2 rounded-sm border disabled:opacity-50 ${darkMode ? 'border-zinc-700 text-zinc-300' : 'border-amber-200'}`}
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={selectLoading}
                className="px-6 py-2 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold disabled:opacity-50"
              >
                {selectLoading ? (currentCrew ? 'Switching...' : 'Joining...') : (currentCrew ? 'Confirm Switch' : 'Join Crew')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            {/* Leave Crew Button */}
            {currentCrew && (
              <button
                onClick={() => setLeavingCrew(true)}
                className={`w-full mb-4 p-3 rounded-sm border-2 border-red-500/50 text-red-400 hover:bg-red-500/10 transition-all`}
              >
                🚪 Leave Current Crew
              </button>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.values(CREWS).map(crew => {
                const lockedDays = lockDaysLeft(crew.id);
                const multiplier = getCrewMultiplier(crewStats, crew.id);
                const activeCount = crewStats?.activeCounts?.[crew.id];
                const disabled = crew.id === currentCrew || lockedDays > 0;
                return (
                  <button
                    key={crew.id}
                    onClick={() => handleSelect(crew.id)}
                    disabled={disabled}
                    className={`p-4 rounded-sm border-2 text-center transition-all ${
                      disabled
                        ? 'opacity-50 cursor-not-allowed border-zinc-700'
                        : darkMode
                          ? 'border-zinc-700 hover:border-orange-500 bg-zinc-800/50'
                          : 'border-amber-200 hover:border-orange-500 bg-amber-50'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      {crew.icon ? (
                        <img src={crew.icon} alt={crew.name} className="w-8 h-8 object-contain" />
                      ) : (
                        <span className="text-2xl">{crew.emblem}</span>
                      )}
                      <span className={`font-bold ${textClass}`} style={{ color: crewColor(crew.color) }}>
                        {crew.name}
                      </span>
                    </div>
                    {crewStats && (
                      <div className="flex items-center justify-center gap-2 mt-2 text-xs">
                        {multiplier > 1 && (
                          <span className="text-orange-500 font-semibold">🔥 x{multiplier} rewards</span>
                        )}
                        {typeof activeCount === 'number' && (
                          <span className={mutedClass}>{activeCount} active</span>
                        )}
                      </div>
                    )}
                    {crew.id === currentCrew && (
                      <span className="text-xs text-orange-500 mt-2 block">✓ Current crew</span>
                    )}
                    {lockedDays > 0 && crew.id !== currentCrew && (
                      <span className="text-xs text-red-400 mt-2 block">🔒 Locked for {lockedDays}d</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CrewSelectionModal;
