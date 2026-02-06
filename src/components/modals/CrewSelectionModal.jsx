import React, { useState } from 'react';
import { CREWS, CREW_MAP } from '../../crews';
import { formatCurrency } from '../../utils/formatters';

const CrewSelectionModal = ({ onClose, onSelect, onLeave, darkMode, userData, isGuest }) => {
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [leavingCrew, setLeavingCrew] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const currentCrew = userData?.crew;
  const portfolioValue = userData?.portfolioValue || 0;
  const penaltyAmount = Math.floor(portfolioValue * 0.15);

  const handleSelect = (crewId) => {
    if (isGuest) return; // Guests can't select
    if (crewId === currentCrew) return;
    setSelectedCrew(crewId);
    setConfirming(true);
  };

  const handleConfirm = () => {
    // Pass true if switching crews (has existing crew), false if joining fresh
    onSelect(selectedCrew, !!currentCrew);
    onClose();
  };

  const handleLeave = () => {
    onLeave();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏴 {isGuest ? 'Crews' : 'Crew'}</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
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
                <span style={{ color: CREW_MAP[currentCrew]?.color }}>{CREW_MAP[currentCrew]?.emblem}</span>
              )}
              <span style={{ color: CREW_MAP[currentCrew]?.color }}>{CREW_MAP[currentCrew]?.name}</span>
            </p>
          )}
          {!isGuest && !currentCrew && (
            <p className={`text-sm ${mutedClass} mt-1`}>
              Join a crew to unlock daily missions and crew dividends!
            </p>
          )}
        </div>

        {/* Warning Banner - show for users without a crew AND users with a crew */}
        {!isGuest && !confirming && !leavingCrew && (
          <div className={`p-3 ${darkMode ? 'bg-amber-900/30' : 'bg-amber-100'} border-b border-amber-500/30`}>
            <p className="text-amber-400 text-sm text-center">
              ⚠️ <strong>Warning:</strong> Leaving a crew costs <strong>15% of your entire portfolio</strong>
              <br />
              <span className={`text-xs ${mutedClass}`}>15% of your cash and shares will be taken if you ever leave.</span>
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
                15% of your cash and shares will be taken.
              </p>
            </div>
            <p className={`text-sm ${mutedClass} mb-6`}>You can rejoin any crew later.</p>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setLeavingCrew(false)}
                className={`px-6 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300' : 'border-amber-200'}`}
              >
                Back
              </button>
              <button
                onClick={handleLeave}
                className="px-6 py-2 rounded-sm bg-red-600 hover:bg-red-700 text-white font-semibold"
              >
                Leave Crew
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
            <h3 className={`text-xl font-bold mb-2 ${textClass}`} style={{ color: CREW_MAP[selectedCrew]?.color }}>
              {currentCrew ? `Switch to ${CREW_MAP[selectedCrew]?.name}?` : `Join ${CREW_MAP[selectedCrew]?.name}?`}
            </h3>

            {currentCrew ? (
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-red-900/20' : 'bg-red-50'} border border-red-500/30 mb-4`}>
                <p className="text-red-400 font-semibold mb-2">
                  You will lose approximately {formatCurrency(penaltyAmount)}
                </p>
                <p className={`text-xs ${mutedClass}`}>
                  15% of your cash and shares will be taken.
                </p>
              </div>
            ) : (
              <div className="mb-4">
                <p className={`text-sm text-orange-500 mb-3`}>
                  ✓ Joining a crew is free!
                </p>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'} border border-amber-500/30`}>
                  <p className="text-amber-400 text-sm">
                    ⚠️ <strong>Note:</strong> If you ever leave this crew, you'll lose <strong>15% of your portfolio</strong>.
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setConfirming(false)}
                className={`px-6 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300' : 'border-amber-200'}`}
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                className="px-6 py-2 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold"
              >
                {currentCrew ? 'Confirm Switch' : 'Join Crew'}
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
              {Object.values(CREWS).map(crew => (
                <button
                  key={crew.id}
                  onClick={() => handleSelect(crew.id)}
                  disabled={crew.id === currentCrew}
                  className={`p-4 rounded-sm border-2 text-center transition-all ${
                    crew.id === currentCrew
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
                    <span className={`font-bold ${textClass}`} style={{ color: crew.color }}>
                      {crew.name}
                    </span>
                  </div>
                  {crew.id === currentCrew && (
                    <span className="text-xs text-orange-500 mt-2 block">✓ Current crew</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CrewSelectionModal;
