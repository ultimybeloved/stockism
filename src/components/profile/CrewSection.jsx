import { useState } from 'react';
import { getThemeClasses, getReadableCrewColor } from '../../utils/theme';

// Collapsible crew card, or a "Join a Crew" button when the user has no crew.
const CrewSection = ({ userCrew, crewData, userData, darkMode, onOpenCrewSelection }) => {
  const [showCrewSection, setShowCrewSection] = useState(false);
  const { textClass, mutedClass, borderClass } = getThemeClasses(darkMode);

  if (!userCrew) {
    return (
      <button
        onClick={onOpenCrewSelection}
        className="w-full py-3 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white"
      >
        🏴 Join a Crew
      </button>
    );
  }

  if (!crewData) return null;

  return (
    <div
      className={`rounded-sm border ${borderClass} overflow-hidden`}
      style={{ borderColor: crewData.color }}
    >
      <button
        onClick={() => setShowCrewSection(!showCrewSection)}
        className={`w-full p-3 flex items-center justify-between ${darkMode ? 'bg-zinc-800/50 hover:bg-zinc-800' : 'bg-amber-50 hover:bg-amber-100'}`}
      >
        <div className="flex items-center gap-2">
          {crewData.icon ? (
            <img src={crewData.icon} alt="" className="w-6 h-6 object-contain" />
          ) : (
            <span className="text-xl">{crewData.emblem}</span>
          )}
          <span className={`font-semibold ${textClass}`} style={{ color: getReadableCrewColor(crewData.color, darkMode) }}>
            {crewData.name}
          </span>
          {userData.isCrewHead && (
            <span className="text-amber-400">👑</span>
          )}
        </div>
        <span className={mutedClass}>{showCrewSection ? '▼' : '▶'}</span>
      </button>

      {showCrewSection && (
        <div className={`p-3 border-t ${borderClass}`}>
          <div className={`text-sm ${mutedClass} mb-2`}>
            <strong>Crew Members:</strong> {crewData.members?.join(', ')}
          </div>
          <button
            onClick={onOpenCrewSelection}
            className={`w-full py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
          >
            Switch Crew (15% penalty)
          </button>
        </div>
      )}
    </div>
  );
};

export default CrewSection;
